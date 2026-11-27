globalThis.window = {};

const { test } = await import("node:test");
const assert = await import("node:assert/strict");

await import("../frontend/js/algorithms.js");
const A = globalThis.window.MKAlgorithms;

test("cleanPhoneDigits keeps the Philippine mobile format and caps its length", () => {
  assert.equal(A.cleanPhoneDigits("0917 123 4567"), "09171234567");
  assert.equal(A.cleanPhoneDigits("+63 917 123 4567"), "639171234567");
  assert.equal(A.cleanPhoneDigits("0917123456789"), "09171234567", "overlong 09… form caps at 11");
  assert.equal(A.cleanPhoneDigits("6391712345678"), "639171234567", "overlong +63 form caps at 12");
  assert.equal(A.cleanPhoneDigits("abc0917x123"), "0917123", "non-digits are dropped");
  assert.equal(A.cleanPhoneDigits(""), "");
  assert.equal(A.cleanPhoneDigits(null), "");
});

test("cleanPhoneDigits lets any complete 09… number survive pasted separators", () => {
  assert.equal(A.cleanPhoneDigits("0917-123-4567"), "09171234567");
  assert.equal(A.cleanPhoneDigits("+639171234567").startsWith("639"), true);
});
