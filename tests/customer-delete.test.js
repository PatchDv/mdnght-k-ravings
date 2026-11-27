import { test } from "node:test";
import assert from "node:assert/strict";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { deleteCustomerRecord } from "../backend/routes/admin.js";

// Minimal schema matching the columns the helper touches (config/db.js).
async function testDb() {
  const dir = await mkdtemp(path.join(tmpdir(), "mk-delete-"));
  const db = await open({ filename: path.join(dir, "t.sqlite"), driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      barangay TEXT NOT NULL
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      barangay TEXT NOT NULL,
      address TEXT NOT NULL,
      total REAL NOT NULL,
      status TEXT,
      customer_id INTEGER
    );
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      menu_item_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      line_total REAL NOT NULL
    );
    CREATE TABLE admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const customer = await db.run(
    "INSERT INTO customers (username, password_hash, first_name, last_name, phone, barangay) VALUES (?, ?, ?, ?, ?, ?)",
    ["juandelacruz", "h$ash", "Juan", "Dela Cruz", "09177770007", "Madapdap"]
  );
  for (const [number, status] of [["MK-T-1", "delivered"], ["MK-T-2", "preparing"]]) {
    await db.run(
      "INSERT INTO orders (order_number, first_name, last_name, phone, barangay, address, total, status, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [number, "Juan", "Dela Cruz", "09177770007", "Madapdap", "1 Rizal St", 250, status, customer.lastID]
    );
  }
  const orders = await db.all("SELECT id FROM orders");
  await db.run(
    "INSERT INTO order_items (order_id, menu_item_id, name, unit_price, quantity, line_total) VALUES (?, ?, ?, ?, ?, ?)",
    [orders[0].id, 1, "6pcs Wings Plain", 159, 1, 159]
  );
  return { db, customerId: customer.lastID };
}

test("delete removes the customer but keeps every order, anonymized", async () => {
  const { db, customerId } = await testDb();
  const result = await deleteCustomerRecord(db, customerId, { id: 1, username: "admin" });
  assert.ok(result, "helper reports the deleted customer");
  assert.equal(result.ordersKept, 2);

  assert.equal(await db.get("SELECT id FROM customers WHERE id = ?", [customerId]), undefined);
  const orders = await db.all("SELECT order_number, customer_id FROM orders ORDER BY id");
  assert.equal(orders.length, 2, "orders are never deleted");
  assert.deepEqual(orders.map((o) => o.customer_id), [null, null]);
  const lines = await db.get("SELECT COUNT(*) AS count FROM order_items");
  assert.equal(Number(lines.count), 1, "order lines stay intact");
});

test("delete writes one audit entry and never touches other customers", async () => {
  const { db, customerId } = await testDb();
  await db.run(
    "INSERT INTO customers (username, password_hash, first_name, last_name, phone, barangay) VALUES (?, ?, ?, ?, ?, ?)",
    ["otheruser", "h$ash", "Other", "User", "09170000001", "Madapdap"]
  );
  await db.run(
    "INSERT INTO orders (order_number, first_name, last_name, phone, barangay, address, total, status, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["MK-T-3", "Other", "User", "09170000001", "Madapdap", "2 Rizal St", 100, "delivered", null]
  );

  await deleteCustomerRecord(db, customerId, { id: 7, username: "kitchen" });

  const audits = await db.all("SELECT admin_id, username, action, detail FROM admin_audit");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].admin_id, 7);
  assert.equal(audits[0].username, "kitchen");
  assert.equal(audits[0].action, "customer_delete");
  assert.match(audits[0].detail, /orders_kept=2/);

  const others = await db.all("SELECT order_number FROM orders");
  assert.equal(others.length, 3, "other customers' orders untouched");
  assert.equal(await db.get("SELECT id FROM customers WHERE username = 'otheruser'").then((r) => Boolean(r)), true);
});

test("unknown customer id reports not-found and writes no audit", async () => {
  const { db } = await testDb();
  const result = await deleteCustomerRecord(db, 999, { id: 1, username: "admin" });
  assert.equal(result, null);
  const audits = await db.all("SELECT id FROM admin_audit");
  assert.equal(audits.length, 0);
});
