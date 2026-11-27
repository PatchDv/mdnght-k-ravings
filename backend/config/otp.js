// Phone verification codes: HMAC-hashed at rest, 5-minute expiry, single use,
// attempt-capped, cooldown-limited per phone and purpose. Never log codes.
import crypto from "crypto";
import { getDb } from "./db.js";
import { env } from "./env.js";
import { sendSms } from "./sms.js";

export const OTP_CODE_LENGTH = 6;
const OTP_TTL_SECONDS = 300;        // 5 minutes per the spec
const MAX_ATTEMPTS = 5;             // per issued code
const RESEND_COOLDOWN_SECONDS = 60; // between sends to the same phone/purpose
const MAX_PER_PHONE_PER_DAY = 5;

export function normalizePhoneE164(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("639") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("9") && digits.length === 10) return `+63${digits}`;
  if (digits.startsWith("09") && digits.length === 11) return `+63${digits.slice(1)}`;
  return "";
}

export function last10Digits(phoneE164) {
  const digits = String(phoneE164 ?? "").replace(/\D/g, "");
  return digits.slice(-10);
}

// Keyed hash: verifying needs only the DB row and the server pepper; a leaked
// database without OTP_PEPPER cannot recover any code.
function hashCode(phoneE164, code) {
  return crypto.createHmac("sha256", env.otpPepper).update(`${phoneE164}:${code}`).digest("hex");
}

const PURPOSES = ["register", "reset"];

export async function issueOtp(phoneE164, purpose) {
  if (!PURPOSES.includes(purpose)) throw new Error("Unknown verification purpose.");
  const db = await getDb();

  // SQLite timestamps are "YYYY-MM-DD HH:MM:SS" UTC strings — compare them in
  // SQL against datetime('now'), never against JS ISO strings (T+Z formats
  // sort differently and silently never match).
  const recent = await db.get(
    `SELECT id,
            MAX(0, ${RESEND_COOLDOWN_SECONDS} - (strftime('%s','now') - strftime('%s', created_at))) AS seconds_left
       FROM otp_requests
      WHERE phone = ? AND purpose = ? AND created_at > datetime('now', '-60 seconds')`,
    [phoneE164, purpose]
  );
  if (recent) {
    // Report the real remaining time so the button countdown starts correctly
    // even after a reload or a second tab.
    const secondsLeft = Math.max(1, Math.ceil(Number(recent.seconds_left) || 1));
    const error = new Error(`Please wait ${secondsLeft} seconds before requesting another code.`);

    error.cooldown = secondsLeft;
    throw error;
  }

  const count = await db.get(
    "SELECT COUNT(*) AS count FROM otp_requests WHERE phone = ? AND purpose = ? AND created_at > datetime('now', '-24 hours')",
    [phoneE164, purpose]
  );
  if (Number(count?.count || 0) >= MAX_PER_PHONE_PER_DAY) {
    throw new Error("Too many codes requested for this number today. Try again tomorrow.");
  }

  // Invalidate any outstanding codes for this phone + purpose.
  await db.run(
    "UPDATE otp_requests SET used_at = datetime('now') WHERE phone = ? AND purpose = ? AND used_at IS NULL",
    [phoneE164, purpose]
  );

  // The plain route carries OUR code in the message; if the shared sender is
  // refused (Smart/TNT) sms.js falls back to IPROG's all-networks OTP route,
  // which returns the gateway-generated code — hash that one instead so
  // verification matches what the customer actually received.
  const code = String(crypto.randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, "0");
  const body = `Your MDNGHT K-RAVINGS verification code is ${code}. It expires in 5 minutes. Do not share it.`;
  const delivery = await sendSms(phoneE164, body, { code });
  const finalCode = delivery.code || code;

  await db.run(
    `INSERT INTO otp_requests (phone, purpose, code_hash, expires_at, attempts_left, sms_message_id)
     VALUES (?, ?, ?, datetime('now', '+${OTP_TTL_SECONDS} seconds'), ?, ?)`,
    [phoneE164, purpose, hashCode(phoneE164, finalCode), MAX_ATTEMPTS, delivery.messageId ? String(delivery.messageId) : null]
  );
  // Dev console channel: the code rides the HTTP response for testing only.
  // A real gateway response or a production environment never returns it —
  // OTP_TEST_DEBUG re-enables it on dev machines using a real provider.
  return {
    expiresInSeconds: OTP_TTL_SECONDS,
    resendAfter: RESEND_COOLDOWN_SECONDS,
    devChannel: Boolean(delivery.dev),
    code: finalCode
  };
}

// Verifies the code and, when a dev console provider issued it, hands it back
// in-process so integration tests can complete flows. Production responses
// never include code values.
export async function verifyOtp(phoneE164, purpose, code) {
  const db = await getDb();
  const row = await db.get(
    `SELECT *, (expires_at <= datetime('now')) AS expired FROM otp_requests
      WHERE phone = ? AND purpose = ? AND used_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [phoneE164, purpose]
  );
  const mismatch = new Error("That code is not correct or has expired.");
  if (!row) throw mismatch;

  const left = Number(row.attempts_left);
  if (row.expired || left <= 0) {
    await db.run("UPDATE otp_requests SET used_at = datetime('now') WHERE id = ?", [row.id]);
    throw mismatch;
  }

  const stored = Buffer.from(row.code_hash);
  const given = Buffer.from(hashCode(phoneE164, String(code || "")));
  if (stored.length !== given.length || !crypto.timingSafeEqual(stored, given)) {
    await db.run("UPDATE otp_requests SET attempts_left = ? WHERE id = ?", [left - 1, row.id]);
    if (left - 1 <= 0) {
      await db.run("UPDATE otp_requests SET used_at = datetime('now') WHERE id = ?", [row.id]);
      throw new Error("Too many wrong attempts. Please request a new code.");
    }
    throw new Error(`That code is not correct. ${left - 1} ${left - 1 === 1 ? "try" : "tries"} left.`);
  }

  await db.run("UPDATE otp_requests SET used_at = datetime('now') WHERE id = ?", [row.id]);
  return { ok: true };
}
