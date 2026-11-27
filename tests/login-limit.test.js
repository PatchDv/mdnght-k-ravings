import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, rateLimitRemaining } from "../backend/utils/security.js";

test("rateLimitRemaining peeks the failed-attempt budget without charging it", () => {
  const key = `loginlimit:${Math.random()}`;
  assert.equal(rateLimitRemaining({ key, max: 5, windowMs: 60000 }), 5, "fresh key = full budget");
  rateLimit({ key, max: 5, windowMs: 60000 });
  rateLimit({ key, max: 5, windowMs: 60000 });
  assert.equal(rateLimitRemaining({ key, max: 5, windowMs: 60000 }), 3, "two charges leave three");
  assert.equal(rateLimitRemaining({ key, max: 5, windowMs: 60000 }), 3, "peeking never charges");
});

test("rateLimitRemaining clamps at zero once the cap is exceeded", () => {
  const key = `loginlimit2:${Math.random()}`;
  for (let i = 0; i < 7; i++) {
    try { rateLimit({ key, max: 5, windowMs: 30000 }); } catch { /* past the cap */ }
  }
  assert.equal(rateLimitRemaining({ key, max: 5, windowMs: 30000 }), 0);
});
