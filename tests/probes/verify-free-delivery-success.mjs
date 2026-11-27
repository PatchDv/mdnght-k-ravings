import { loadCreds } from "./creds.mjs";
const demoCreds = loadCreds();
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new", args: ["--no-sandbox"]
});
const p = await b.newPage();
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`); if (!cond) fail++; };

// Sign in as the documented test customer
await p.goto("http://localhost:3000/login.html", { waitUntil: "networkidle2" });
await p.type("#c-phone", demoCreds.phone);
await p.type("#c-pass", demoCreds.password);
await p.click("#login-button");
await p.waitForFunction(() => location.pathname.endsWith("index.html") || location.pathname === "/", { timeout: 15000 });
await p.waitForSelector("#app:not([hidden])", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1200));

// Build a >= 400 cart from option-free dishes via the exposed cart API,
// starting from an EMPTY cart (previous runs may have saved leftovers):
// 3 x Cheese Kimbap (119) + 1 x Cheesy Fries (89) = 446
const subtotal = await p.evaluate(async () => {
  if (typeof window.MK_CONFIG === "undefined") {
    return { probeError: `no MK_CONFIG on ${location.href} — title: ${document.title}` };
  }
  const token = localStorage.getItem(window.MK_CONFIG.STORAGE.CUSTOMER_TOKEN) || "";
  await fetch("/api/customers/cart", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cart: [] })
  });
  window.MK.state.cart = [];
  const items = window.MK.state.items;
  const kimbap = items.find((i) => /cheese kimbap 10pcs/i.test(i.name) && i.isAvailable);
  const fries = items.find((i) => /cheesy fries/i.test(i.name) && i.isAvailable);
  if (!kimbap || !fries) return 0;
  window.MK.addToCart(kimbap, {}, 3, { silent: true });
  window.MK.addToCart(fries, {}, 1, { silent: true });
  return window.MK.cartTotals().subtotal;
});
ok("cart subtotal crosses the free-delivery threshold", subtotal >= 400, `subtotal ${subtotal}`);

// Checkout through the real UI
await p.evaluate(() => window.MK.openCheckout());
await p.waitForSelector("#place-order", { timeout: 10000 });
await p.click("#place-order");
await p.waitForSelector(".order-success", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 400));

const feeLine = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".order-ticket > div")];
  const feeRow = rows.find((r) => /delivery fee/i.test(r.textContent));
  const totalRow = rows.find((r) => /total/i.test(r.textContent) && !/subtotal/i.test(r.textContent));
  return { fee: feeRow?.textContent.trim().replace(/\s+/g, " ") || "", total: totalRow?.textContent.trim().replace(/\s+/g, " ") || "" };
});
ok("success screen does NOT say 'to be confirmed' for a free order", !/to be confirmed/i.test(feeLine.fee), feeLine.fee);
ok("success screen shows the fee as free (0 pesos)", /free|â‚±0|P0/i.test(feeLine.fee), feeLine.fee);
ok("success screen shows the final total", /446|â‚±446|P446/i.test(feeLine.total), feeLine.total);

console.log(fail === 0 ? "FREE-DELIVERY-SUCCESS PASS" : `FREE-DELIVERY-SUCCESS ${fail} FAILED`);
await b.close();
process.exit(fail ? 1 : 0);
