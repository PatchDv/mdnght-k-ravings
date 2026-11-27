import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePassword, titleCaseName } from "../backend/routes/customers.js";

test("password minimum is 8 characters", () => {
  assert.match(validatePassword("Ab1x"), /at least 8/i);
  assert.equal(validatePassword("Ab1x5678"), "");
});

test("password maximum is exactly 12 characters", () => {
  assert.equal(validatePassword("Ab1x56789012"), ""); // 12 chars ok
  assert.match(validatePassword("Ab1x567890123"), /12 characters or fewer/i); // 13 rejected
  assert.match(validatePassword("A".repeat(60) + "b1"), /12 characters or fewer/i);
});

test("password still requires a letter and a number", () => {
  assert.match(validatePassword("abcdefghij"), /letter and one number/i);
});

test("titleCaseName handles the spec cases", () => {
  assert.equal(titleCaseName("matt"), "Matt");
  assert.equal(titleCaseName("MARIA"), "Maria");
  assert.equal(titleCaseName("john doe"), "John Doe");
  assert.equal(titleCaseName("juan carlos"), "Juan Carlos");
  assert.equal(titleCaseName("anna mae"), "Anna Mae");
  assert.equal(titleCaseName("  juan   dela  cruz "), "Juan Dela Cruz");
});

test("titleCaseName never touches non-name fields", () => {
  assert.equal(titleCaseName(""), "");
  assert.equal(titleCaseName(null), "");
});
