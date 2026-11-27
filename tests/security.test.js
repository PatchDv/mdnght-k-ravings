import test from "node:test";
import assert from "node:assert/strict";

import { normalizePhoneE164 } from "../backend/config/otp.js";
import { validatePassword, sanitizeCartLines } from "../backend/routes/customers.js";
import { rateLimit } from "../backend/utils/security.js";

test("normalizePhoneE164 handles PH formats", () => {
  assert.equal(normalizePhoneE164("09177770007"), "+639177770007");
  assert.equal(normalizePhoneE164("+63 917 777 0007"), "+639177770007");
  assert.equal(normalizePhoneE164("639177770007"), "+639177770007");
  assert.equal(normalizePhoneE164("+639177770007"), "+639177770007");
  assert.equal(normalizePhoneE164("917-777-0007"), "+639177770007");
  assert.equal(normalizePhoneE164("123"), "");
  assert.equal(normalizePhoneE164(""), "");
  assert.equal(normalizePhoneE164("09-9876"), ""); // too short
});

test("validatePassword policy", () => {
  assert.equal(validatePassword("password777"), "");
  assert.notEqual(validatePassword("short1"), "");
  assert.notEqual(validatePassword("nodigits"), "");
  assert.notEqual(validatePassword("12345678"), "");
  assert.notEqual(validatePassword("password"), "");
  assert.notEqual(validatePassword("12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678"), "");
});

test("sanitizeCartLines rejects hostile shapes", () => {
  assert.deepEqual(sanitizeCartLines([{ menuItemId: 1, unitPrice: 10, quantity: 2, options: {} }])[0].menuItemId, 1);
  assert.deepEqual(sanitizeCartLines({ bad: "shape" }), []);
  assert.deepEqual(sanitizeCartLines("[]"), []);
  assert.equal(sanitizeCartLines(new Array(60).fill({ menuItemId: 1, unitPrice: 10, quantity: 1, options: {} })).length, 30);
});

test("rateLimit throws 429 past the cap and resets after the window", () => {
  const key = `test:${Math.random()}`;
  for (let i = 0; i < 3; i++) {
    rateLimit({ key, max: 3, windowMs: 50 });
  }
  assert.throws(() => rateLimit({ key, max: 3, windowMs: 50 }), (error) => error.status === 429);
  assert.throws(() => rateLimit({ key, max: 3, windowMs: 50 }), (error) => error.status === 429);
  rateLimit({ key: `${key}-b`, max: 1, windowMs: 50 }); // other keys unaffected
});
