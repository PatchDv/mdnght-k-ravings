import { test } from "node:test";
import assert from "node:assert/strict";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { linkLegacyOrders, insertCustomer } from "../backend/routes/customers.js";

async function testDb() {
  const dir = await mkdtemp(path.join(tmpdir(), "mk-accounts-"));
  const db = await open({ filename: path.join(dir, "t.sqlite"), driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      barangay TEXT NOT NULL DEFAULT '',
      cart_json TEXT NOT NULL DEFAULT '[]',
      address TEXT,
      landmark TEXT,
      token_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      customer_id INTEGER,
      is_demo INTEGER DEFAULT 0
    );
  `);
  return db;
}

test("signing in claims orphaned real orders but never demo or admin-test rows", async () => {
  const db = await testDb();
  // orphaned real order (pre-account era)
  await db.run("INSERT INTO orders (order_number, phone, customer_id, is_demo) VALUES ('MK-A-1', '09175550101', NULL, 0)");
  // admin storefront preview order (is_demo)
  await db.run("INSERT INTO orders (order_number, phone, customer_id, is_demo) VALUES ('MK-B-2', '09175550101', NULL, 1)");
  // seeded first-run demo order (labelled MK-DEMO)
  await db.run("INSERT INTO orders (order_number, phone, customer_id, is_demo) VALUES ('MK-DEMO-1001', '09175550101', NULL, 0)");
  // another customer's order must never move
  await db.run("INSERT INTO orders (order_number, phone, customer_id, is_demo) VALUES ('MK-C-3', '09175550101', 42, 0)");

  await linkLegacyOrders(db, { id: 7, phone: "09175550101" });

  const rows = await db.all("SELECT order_number, customer_id FROM orders ORDER BY order_number");
  const byNumber = Object.fromEntries(rows.map((r) => [r.order_number, r.customer_id]));
  assert.equal(byNumber["MK-A-1"], 7, "real orphan claimed");
  assert.equal(byNumber["MK-B-2"], null, "admin test order never claimed");
  assert.equal(byNumber["MK-DEMO-1001"], null, "seeded demo order never claimed");
  assert.equal(byNumber["MK-C-3"], 42, "other customer's order untouched");
  await db.close();
});

test("registering on top of a colliding username answers 'taken' instead of crashing", async () => {
  const db = await testDb();
  // A legacy account whose username matches cust<digits> but whose stored
  // phone is written differently, so the phone-uniqueness check misses it.
  await db.run(
    "INSERT INTO customers (username, password_hash, first_name, last_name, phone, barangay) VALUES (?, ?, ?, ?, ?, '')",
    ["cust9175550101", "h$ash", "Old", "Row", "0917 000 9999"]
  );
  const clash = await insertCustomer(db, {
    username: "cust9175550101",
    passwordHash: "h$ash2",
    firstName: "New",
    lastName: "Row",
    phone: "09175550101",
    barangay: "Madapdap",
    address: "1 Test Street, Madapdap",
    landmark: ""
  });
  assert.equal(clash, null, "duplicate username reports taken, never throws");
  const normal = await insertCustomer(db, {
    username: "cust9175550102",
    passwordHash: "h$ash3",
    firstName: "Fresh",
    lastName: "Row",
    phone: "09175550102",
    barangay: "Madapdap",
    address: "2 Test Street, Madapdap",
    landmark: ""
  });
  assert.ok(normal?.lastID, "a normal insert still works");
  await db.close();
});
