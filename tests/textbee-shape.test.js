globalThis.window = {};

const { test } = await import("node:test");
const assert = await import("node:assert/strict");

const S = await import("../backend/utils/textbee.js");
const reject = (status, payload) => S.textbeeSendRejected(status, payload);

test("accepts the documented success shape", () => {
  // docs: 200 -> {data:{success:true,message:"SMS added to queue for processing",smsBatchId,recipientCount}}
  assert.equal(
    reject(200, { data: { success: true, message: "SMS added to queue for processing", smsBatchId: "b-123", recipientCount: 1 } }),
    null
  );
});

test("rejects every known error shape", () => {
  // 401: {error:"Unauthorized",code:"AUTH_INVALID"}
  assert.match(reject(401, { error: "Unauthorized", code: "AUTH_INVALID" }), /credentials|unauthorized/i);
  // 400: no enabled device / email unverified etc.
  assert.match(reject(400, { error: "No enabled device found" }), /device/i);
  // 429: plan limit
  assert.match(reject(429, { error: "Plan limit exceeded" }), /limit/i);
  // generic HTTP failure
  assert.match(reject(403, null), /HTTP 403/i);
  // 200 but data.success missing/false is not a send
  assert.match(reject(200, { data: { success: false } }), /not accept/i);
  assert.match(reject(200, { message: "ok" }), /malformed/i);
  // accepted but no batch id — nothing trackable
  assert.match(reject(200, { data: { success: true } }), /batch/i);
  // malformed body
  assert.match(reject(200, "not json"), /malformed/i);
  assert.match(reject(200, null), /no JSON/i);
});

test("textbeeNumber normalizes PH numbers to +63 E.164", () => {
  assert.equal(S.textbeeNumber("+639946675562"), "+639946675562");
  assert.equal(S.textbeeNumber("639946675562"), "+639946675562");
  assert.equal(S.textbeeNumber("09946675562"), "+639946675562");
  assert.equal(S.textbeeNumber("+63 917 777 0007"), "+639177770007");
});
