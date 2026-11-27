import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "node:url";
const db = await open({ filename: fileURLToPath(new URL("../../backend/database.sqlite", import.meta.url)), driver: sqlite3.Database });
const rows = await db.all(`
  SELECT c.id, c.username, c.first_name, c.last_name, c.phone,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orderCount,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.is_demo = 1) AS demoOrders
    FROM customers c ORDER BY c.id`);
for (const r of rows) console.log([r.id, r.username, r.first_name, r.last_name, r.phone, "orders=" + r.orderCount, "demo=" + r.demoOrders].join(" | "));
console.log("total customers:", rows.length);
const admins = await db.all("SELECT id, username FROM admin_users");
console.log("admins:", JSON.stringify(admins));
const otp = await db.get("SELECT COUNT(*) AS n FROM otp_requests");
console.log("otp rows:", otp.n);
await db.close();
