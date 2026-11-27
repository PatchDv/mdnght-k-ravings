import { test } from "node:test";
import assert from "node:assert/strict";
import { statusSmsText } from "../backend/utils/notify.js";

test("status SMS names the store, order, and human status", () => {
  assert.equal(
    statusSmsText("MK-123-ABC", "delivering"),
    "MDNGHT K-RAVINGS: Order MK-123-ABC is out for delivery. Please be ready."
  );
  assert.equal(
    statusSmsText("MK-1-XY", "pending"),
    "MDNGHT K-RAVINGS: Order MK-1-XY was received. The kitchen will confirm shortly."
  );
  assert.equal(
    statusSmsText("MK-9-XZ", "cancelled"),
    "MDNGHT K-RAVINGS: Order MK-9-XZ was cancelled."
  );
});

test("status SMS falls back to the raw status and keeps messages short", () => {
  assert.equal(
    statusSmsText("MK-7-QQ", "weird_status"),
    "MDNGHT K-RAVINGS: Order MK-7-QQ status: weird_status"
  );
  for (const status of ["pending", "confirmed", "preparing", "delivering", "delivered", "cancelled"]) {
    assert.ok(statusSmsText("MK-7-QQ", status).length <= 160, `${status} must fit SMS`);
  }
});
