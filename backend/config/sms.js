// Real SMS delivery. Only a configured provider can send an OTP; if the
// gateway request fails, callers receive an error so no customer is ever told
// a message went out when it did not.
//
// Provider: textbee.dev — POST /api/v1/gateway/send-sms with the API key in
// the x-api-key header and the recipients array in +63 E.164. Messages are
// sent from the registered Android device's own SIM, so there is no sender
// name and no per-network fallback: one route covers all PH networks.
//
// The OTP engine (hashing, TTL, attempts, cooldown) stays entirely on this
// server; the response carries an smsBatchId for delivery tracking.
//
// textbee can answer non-2xx with an error body — every response is judged by
// the validators in utils/textbee.js, never by HTTP status alone.
//
// "console" exists for development only: it delivers nothing and never prints
// the code — tests read the stored hash row instead.
import { env } from "./env.js";
import { textbeeSendRejected, textbeeNumber } from "../utils/textbee.js";

const TEXTBEE_BASE = "https://api.textbee.dev/api/v1";

export async function sendSms(phoneE164, message) {
  if (env.smsProvider === "textbee") {
    if (!env.textbeeApiKey) {
      throw new Error("TEXTBEE_API_KEY is missing — cannot send SMS.");
    }
    const body = { recipients: [textbeeNumber(phoneE164)], message };
    if (env.textbeeDeviceId) body.deviceId = env.textbeeDeviceId;
    const response = await fetch(`${TEXTBEE_BASE}/gateway/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.textbeeApiKey },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);
    const rejected = textbeeSendRejected(response.status, payload);
    if (rejected) throw new Error(rejected);
    return { delivered: true, messageId: payload.data.smsBatchId };
  }

  if (env.smsProvider === "console" && !env.isProd) {
    // Deliberately does NOT print the message body (must never log OTPs).
    console.log(`[dev-sms] Message queued for ${phoneE164} (dev channel: content withheld).`);
    return { delivered: true, dev: true };
  }

  throw new Error("No SMS provider is configured.");
}
