import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "node:url";
const db = await open({ filename: fileURLToPath(new URL("../../backend/database.sqlite", import.meta.url)), driver: sqlite3.Database });

// 1. Probe/test orders: pre-launch, every order that is not part of the
//    labelled demo datasets (MK-DEMO seed + is_demo analytics set) is probe
//    junk — including real-looking ones placed by probes as demo accounts.
const victims = await db.all(
  `SELECT id, order_number, customer_id, is_demo FROM orders
    WHERE order_number NOT LIKE 'MK-DEMO-%' AND is_demo = 0`
);
console.log("probe/test orders to delete:", victims.length);
for (const v of victims.slice(0, 60)) console.log("  del", v.id, v.order_number, "cust=" + v.customer_id, "demo=" + v.is_demo);
const ids = victims.map((v) => v.id);
if (ids.length) {
  await db.run(`DELETE FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")})`, ids);
  await db.run(`DELETE FROM orders WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
}

// 2. Any E2E leftovers from this session's probes.
await db.run("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'MK-E2E-%')");
await db.run("DELETE FROM orders WHERE order_number LIKE 'MK-E2E-%'");
await db.run("DELETE FROM customers WHERE username = 'e2edeleteprobe'");

// 3. Restore the seeded demo dataset to its delivered state (probes mutated
//    some MK-DEMO statuses into the working lanes).
const mutated = await db.run("UPDATE orders SET status = 'delivered' WHERE order_number LIKE 'MK-DEMO-%' AND status != 'delivered'");
console.log("MK-DEMO statuses restored to delivered:", mutated.changes);

// 3b. Restore dishes hidden by probe runs within the last 2 hours (the
//     availability fixture). Older hides may be intentional admin state and
//     are left alone.
const hides = await db.all(
  "SELECT detail FROM admin_audit WHERE action = 'availability' AND detail LIKE '%isAvailable=false' AND created_at > datetime('now', '-2 hours')"
);
const hiddenIds = [...new Set(hides.map((h) => Number((h.detail.match(/id=(\d+)/) || [])[1])))].filter(Boolean);
if (hiddenIds.length) {
  const restored = await db.run(`UPDATE menu_items SET is_available = 1 WHERE id IN (${hiddenIds.map(() => "?").join(",")})`, hiddenIds);
  console.log("probe-hidden dishes restored:", restored.changes);
}

// 4. Safety report: anything left that is NOT seeded demo and NOT business data?
const odd = await db.all(
  "SELECT id, order_number, status, is_demo, customer_id, created_at FROM orders WHERE order_number NOT LIKE 'MK-DEMO-%' ORDER BY id"
);
console.log("remaining non-MK-DEMO orders:", odd.length);
for (const o of odd) console.log("  keep", o.id, o.order_number, o.status, "cust=" + o.customer_id, o.created_at);
const totals = await db.get("SELECT COUNT(*) AS n, SUM(CASE WHEN is_demo=1 THEN 1 ELSE 0 END) AS demo FROM orders");
console.log("orders total:", JSON.stringify(totals));
const queueLeft = await db.all("SELECT order_number, status FROM orders WHERE status IN ('confirmed','preparing','delivering')");
console.log("working orders left:", JSON.stringify(queueLeft));
await db.close();
