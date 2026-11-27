import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCartLines } from "../backend/routes/customers.js";

test("cart bearer keeps only owner's lines", () => {
  const lines = sanitizeCartLines([
    { menuItemId: 2, quantity: 2, unitPrice: 169, name: "Wings" },
    null,
    "junk",
    { menuItemId: -1, quantity: 1, unitPrice: 99 },
    { menuItemId: 3, quantity: 1, unitPrice: 139 },
    { menuItemId: 4, quantity: 0, unitPrice: 100 }
  ]);
  assert.deepEqual(lines.map((line) => line.menuItemId), [2, 3, 4]);
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[2].quantity, 1, "zero quantity clamps to one");
});

test("cart bearer refuses more than 30 lines and garbage fields", () => {
  const many = Array.from({ length: 40 }, (unused, index) => ({
    menuItemId: index + 1,
    quantity: 1,
    unitPrice: 99
  }));
  assert.equal(sanitizeCartLines(many).length, 30);
  assert.deepEqual(
    sanitizeCartLines([{ menuItemId: Number.NaN, quantity: 1, unitPrice: 1 }, "x", {}]),
    []
  );
});
