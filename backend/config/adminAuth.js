import crypto from "crypto";
import { getDb } from "./db.js";
import { env } from "./env.js";
import { getSetting, setSetting } from "./settings.js";

// Opaque admin sessions: the browser holds a random token in an httpOnly
// cookie, the DB holds only its SHA-256 hash. No JWT, no token in JS storage.
export const SESSION_COOKIE = "mk_admin_session";
export const CSRF_COOKIE = "mk_admin_csrf";
const SESSION_TTL_SECONDS = 10 * 60 * 60;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function cookie(name, value, { maxAge, httpOnly = false, secure = false }) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Strict${httpOnly ? "; HttpOnly" : ""}${secure ? "; Secure" : ""}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function createAdminSession(req, res, adminId) {
  const token = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const secure = Boolean(req.secure || env.forceHttps);
  const db = await getDb();
  await db.run("DELETE FROM admin_sessions WHERE datetime(expires_at) <= datetime('now')");
  await db.run(
    "INSERT INTO admin_sessions (token_hash, admin_id, csrf_token, expires_at) VALUES (?, ?, ?, datetime('now', '+10 hours'))",
    [sha256(token), adminId, csrfToken]
  );
  res.append("Set-Cookie", cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS, httpOnly: true, secure }));
  res.append("Set-Cookie", cookie(CSRF_COOKIE, csrfToken, { maxAge: SESSION_TTL_SECONDS, secure }));
  return csrfToken;
}

export async function readAdminSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const db = await getDb();
  const row = await db.get(
    `SELECT s.id AS session_id, s.csrf_token, s.admin_id, a.username, a.display_name
       FROM admin_sessions s
       JOIN admin_users a ON a.id = s.admin_id
      WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')`,
    [sha256(token)]
  );
  if (!row) return null;
  return {
    id: row.admin_id,
    username: row.username,
    name: row.display_name,
    csrfToken: row.csrf_token,
    sessionId: row.session_id
  };
}

// Session check for every admin API route. Unsafe methods also need the
// per-session CSRF header (double-submit against the readable cookie).
export async function requireAdmin(req, res, next) {
  try {
    const session = await readAdminSession(req);
    if (!session) {
      return res.status(401).json({ success: false, error: "Admin sign-in required." });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !safeEqual(req.get("x-csrf-token") || "", session.csrfToken)) {
      return res.status(403).json({ success: false, error: "Security check failed. Refresh the board and try again." });
    }
    req.admin = session;
    next();
  } catch (error) {
    console.error("Admin session check failed:", error);
    res.status(500).json({ success: false, error: "Could not verify your admin session." });
  }
}

export async function destroyAdminSession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    const db = await getDb();
    await db.run("DELETE FROM admin_sessions WHERE token_hash = ?", [sha256(token)]);
  }
  clearAdminCookies(res);
}

export async function invalidateAdminSessions(adminId) {
  const db = await getDb();
  await db.run("DELETE FROM admin_sessions WHERE admin_id = ?", [adminId]);
}

export function clearAdminCookies(res) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly`);
  res.append("Set-Cookie", `${CSRF_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`);
}

/* ---------------------------------------------------------------------------
   Admin as shopper — the storefront reads the admin session server-side only.
   The admin cookie never becomes a customer token: these helpers turn it into
   an in-memory shopper for cart/checkout, and its cart/details live in one
   settings row instead of a duplicate customer account.
   ------------------------------------------------------------------------- */

const STOREFRONT_KEY = "admin_storefront";

async function readSavedShopper() {
  try {
    const saved = JSON.parse(await getSetting(STOREFRONT_KEY, "{}"));
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function splitAdminName(session) {
  const words = String(session.name || session.username || "Admin").trim().split(/\s+/);
  return { firstName: words[0] || "Admin", lastName: words.slice(1).join(" ") };
}

export async function readAdminShopper(session) {
  const saved = await readSavedShopper();
  const name = splitAdminName(session);
  return {
    cart: Array.isArray(saved.cart) ? saved.cart : [],
    profile: {
      id: null,
      role: "admin",
      username: session.username,
      firstName: saved.firstName || name.firstName,
      lastName: saved.lastName || name.lastName,
      phone: saved.phone || `admin:${session.username}`,
      barangay: saved.barangay || "",
      address: saved.address || "",
      landmark: saved.landmark || ""
    }
  };
}

// Read-modify-write on one settings row: chain the writes so a cart save and
// a profile save arriving together merge instead of clobbering each other.
let shopperWriteChain = Promise.resolve();

export function saveAdminShopper(patch) {
  const write = shopperWriteChain.then(async () => {
    const next = { ...(await readSavedShopper()), ...patch };
    await setSetting(STOREFRONT_KEY, JSON.stringify(next));
    return next;
  });
  shopperWriteChain = write.catch(() => {});
  return write;
}
