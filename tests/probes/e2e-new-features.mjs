import { loadCreds } from "./creds.mjs";
const demoCreds = loadCreds();
import puppeteer from "puppeteer-core";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire("C:/Users/admin/Desktop/CamsKraving/package.json");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const DB = fileURLToPath(new URL("../../backend/database.sqlite", import.meta.url));
const db = await open({ filename: DB, driver: sqlite3.Database });

let fail = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
  if (!cond) fail++;
};

// --- Seed a throwaway customer + delivered order for the delete flow ---
await db.run("DELETE FROM customers WHERE username = 'e2edeleteprobe'");
await db.run("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'MK-E2E-%')");
await db.run("DELETE FROM orders WHERE order_number LIKE 'MK-E2E-%'");
const seed = await db.run(
  "INSERT INTO customers (username, password_hash, first_name, last_name, phone, barangay) VALUES (?, ?, ?, ?, ?, ?)",
  ["e2edeleteprobe", "x", "E2E", "Delete Probe", "09189990001", "Madapdap"]
);
const e2eCustomerId = seed.lastID;
const e2eOrder = await db.run(
  "INSERT INTO orders (order_number, first_name, last_name, phone, barangay, address, subtotal, delivery_fee, delivery_fee_set, total, status, customer_id) VALUES (?, ?, ?, ?, ?, ?, 250, 0, 1, 250, 'delivered', ?)",
  ["MK-E2E-DEL-1", "E2E", "Delete Probe", "09189990001", "Madapdap", "1 Test St", e2eCustomerId]
);
await db.run(
  "INSERT INTO order_items (order_id, menu_item_id, name, unit_price, quantity, line_total) VALUES (?, 1, '6pcs Wings Plain', 99, 1, 99)",
  [e2eOrder.lastID]
);

// --- Place a real order as the test customer (server mints it 'pending') ---
const login = await fetch("http://localhost:3000/api/customers/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: demoCreds.username, password: demoCreds.password })
}).then((r) => r.json());
const token = login?.data?.token;
ok("test customer login", Boolean(token));

const placed = await fetch("http://localhost:3000/api/orders", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ items: [{ menuItemId: 1, quantity: 1, selectedOptions: {} }] })
}).then((r) => r.json());
const queueOrderId = placed?.data?.id;
const queueOrderNumber = placed?.data?.orderNumber;
ok("order placed (pending until confirmed)", Boolean(queueOrderId), queueOrderNumber);

// --- Board ---
const b = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new", args: ["--no-sandbox"]
});
const p = await b.newPage();
const pageErrors = [];
p.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 100)));

await p.goto("http://localhost:3000/staff-portal-x7k2", { waitUntil: "networkidle2" });
await p.type("#login-user", "admin");
await p.type("#login-pass", demoCreds.adminPassword);
await p.click("#login-button");
await p.waitForFunction(() => location.pathname.endsWith("/board"), { timeout: 15000 });
await p.waitForSelector("#admin-app:not([hidden])");

// B: confirm the order from the board session (real admin flow), refresh, use the queue head
await p.evaluate(() => document.querySelector('[data-view="orders"]')?.click());
await new Promise((r) => setTimeout(r, 1000));
const confirmed = await p.evaluate(async (id) => {
  const csrf = document.cookie.split("; ").find((c) => c.startsWith("mk_admin_csrf="))?.slice(14) || "";
  const r = await fetch(`/api/admin/orders/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) },
    body: JSON.stringify({ status: "confirmed" })
  });
  return r.status;
}, queueOrderId);
ok("order confirmed via board session PATCH", confirmed === 200, `status ${confirmed}`);
await p.evaluate(() => document.getElementById("refresh-button")?.click());
await new Promise((r) => setTimeout(r, 1500));
const headBefore = await p.evaluate(() => document.getElementById("order-queue-head")?.innerText.replace(/\n/g, " | "));
ok("queue head shows the confirmed order with a Move button", Boolean(headBefore?.includes(queueOrderNumber)) && Boolean(await p.$("#order-queue-head [data-queue-advance]")), headBefore?.slice(0, 140));
await p.evaluate(() => document.querySelector("#order-queue-head [data-queue-advance]")?.click());
await new Promise((r) => setTimeout(r, 1200));
const headAfter = await p.evaluate(() => document.getElementById("order-queue-head")?.innerText.replace(/\n/g, " | "));
ok("head now reads preparing", /PREPARING|ALREADY IN THE KITCHEN/i.test(headAfter || ""), headAfter?.slice(0, 140));
const st = await db.get("SELECT status FROM orders WHERE id = ?", [queueOrderId]);
ok("order status is preparing in DB (reused PATCH)", st?.status === "preparing", st?.status);

// C: customers view delete with typed confirm
await p.evaluate(() => document.querySelector('[data-view="customers"]')?.click());
await new Promise((r) => setTimeout(r, 1500));
const expanded = await p.evaluate(() => {
  const buttons = [...document.querySelectorAll("[data-customer-toggle]")];
  const row = buttons.find((b) => b.innerText.includes("Delete Probe")); // titleCaseName makes it "E2e Delete Probe"
  if (!row) return false;
  row.click();
  return true;
});
ok("E2E customer row found and expanded", expanded);
await new Promise((r) => setTimeout(r, 400));
ok("Remove record button present", Boolean(await p.$("[data-customer-delete]")));
const clickIn = (sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel);
await clickIn("[data-customer-delete]");
await new Promise((r) => setTimeout(r, 400));
await p.type("[data-customer-confirm-input]", "WRONG");
await clickIn("[data-customer-confirm-form] button[type='submit']");
await new Promise((r) => setTimeout(r, 500));
const still = await db.get("SELECT id FROM customers WHERE id = ?", [e2eCustomerId]);
ok("wrong keyword does NOT delete", Boolean(still));
await clickIn("[data-customer-confirm-form] [data-customer-cancel]");
await new Promise((r) => setTimeout(r, 400));
ok("cancel returns to Remove record button", Boolean(await p.$("[data-customer-delete]")));
await clickIn("[data-customer-delete]");
await new Promise((r) => setTimeout(r, 400));
await p.type("[data-customer-confirm-input]", "DELETE");
await clickIn("[data-customer-confirm-form] button[type='submit']");
await new Promise((r) => setTimeout(r, 1500));
const gone = await db.get("SELECT id FROM customers WHERE id = ?", [e2eCustomerId]);
ok("customer row deleted", !gone);
const kept = await db.get("SELECT customer_id FROM orders WHERE id = ?", [e2eOrder.lastID]);
ok("order kept with customer_id NULL", Boolean(kept) && kept.customer_id === null, JSON.stringify(kept));
const audit = await db.get("SELECT action, detail FROM admin_audit WHERE action = 'customer_delete' AND detail LIKE ?", [`%id=${e2eCustomerId}%`]);
ok("audit entry written", Boolean(audit), audit?.detail);
const rowsAfter = await p.evaluate(() => [...document.querySelectorAll("[data-customer-toggle]")].some((b) => b.innerText.includes("Delete Probe")));
ok("customers list refreshed without the row", !rowsAfter);

ok("no page errors during E2E", pageErrors.length === 0, pageErrors.join(" ; ").slice(0, 160));
await b.close();
console.log(fail === 0 ? "E2E ALL PASS" : `E2E ${fail} FAILED`);
process.exit(fail ? 1 : 0);
