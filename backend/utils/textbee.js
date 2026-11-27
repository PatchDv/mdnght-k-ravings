// textbee.dev (textbee.dev) response evaluation — pure so tests run without
// the network. textbee sends through the user's own Android SIM, so there is
// no sender-name restriction and no per-network fallback: acceptance means the
// message is queued on the device (delivery still needs the phone online).
//
// Success: HTTP 200 -> {"data":{"success":true,"message":"SMS added to queue
// for processing","smsBatchId":"…","recipientCount":1}}
// Failure: 401 {"error":"Unauthorized","code":"AUTH_INVALID"}, 400 (no enabled
// device / email unverified), 403, 429 (plan limit).
// textbeeSendRejected returns null when the request was accepted for sending,
// otherwise a short human-readable reason.

export function textbeeSendRejected(httpStatus, payload) {
  if (httpStatus === 401) {
    return "SMS gateway rejected the credentials — check TEXTBEE_API_KEY.";
  }
  if (httpStatus === 429) {
    return "SMS gateway plan limit reached — check your textbee.dev plan.";
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    const body = typeof payload === "object" && payload !== null ? String(payload.error || "") : "";
    return `SMS gateway returned HTTP ${httpStatus}${body ? ` (${body})` : ""}.`;
  }
  if (payload === null || payload === undefined) {
    return "SMS gateway returned no JSON body.";
  }
  if (typeof payload !== "object" || typeof payload.data !== "object" || payload.data === null) {
    return "SMS gateway returned a malformed response.";
  }
  if (payload.data.success !== true) {
    const msg = typeof payload.data.message === "string" ? payload.data.message : "";
    return `SMS gateway did not accept the send${msg ? `: ${msg}` : ""}.`;
  }
  if (!payload.data.smsBatchId) {
    return "SMS gateway accepted the send but returned no batch id.";
  }
  return null;
}

// textbee expects international format (+63…). Our internal phones are already
// E.164; normalize anyway so 09…/63… pasted values still reach the gateway.
export function textbeeNumber(phoneE164) {
  const digits = String(phoneE164 || "").replace(/\D/g, "");
  if (digits.startsWith("63")) return "+" + digits;
  if (digits.startsWith("0")) return "+63" + digits.slice(1);
  return "+" + digits;
}
