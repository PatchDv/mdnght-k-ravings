import { loadCreds } from "./creds.mjs";
const demoCreds = loadCreds();
import puppeteer from "puppeteer-core";
import { setTimeout as wait } from "node:timers/promises";

const BASE = "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`PASS ${name}${extra ? " :: " + extra : ""}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? " :: " + extra : ""}`); }
};

const b = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: "new", args: ["--no-sandbox"] });
const errs = [];
const ctx = await b.createBrowserContext();
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 140)));

// --- admin signs into the board -------------------------------------------
await p.goto(`${BASE}/staff-portal-x7k2`, { waitUntil: "networkidle2" });
await p.type("#login-user", "admin");
await p.type("#login-pass", demoCreds.adminPassword);
await p.click("#login-button");
await p.waitForFunction(() => location.pathname.endsWith("/board"), { timeout: 15000 });
await p.waitForSelector("#admin-app:not([hidden])", { timeout: 15000 });
ok("admin signed into board", true);

// --- same browser -> storefront: no login screen, Admin label --------------
await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle2" });
await wait(1800);
const shop = await p.evaluate(() => ({
  url: location.pathname,
  badge: !document.querySelector("#admin-shop-badge")?.hidden,
  initials: document.querySelector("#profile-initials")?.textContent,
  title: document.title,
  bodyAdmin: document.body.classList.contains("admin-shopper")
}));
ok("admin lands on storefront without login", shop.url.includes("index.html") && shop.bodyAdmin, JSON.stringify(shop));
ok("admin label in header", shop.badge && shop.initials === "CG", JSON.stringify(shop));

const session = await p.evaluate(async () => {
  const r = await fetch("/api/customers/session", { credentials: "same-origin" });
  return { status: r.status, body: await r.json() };
});
ok("storefront session reports admin (server-side)", session.status === 200 && session.body?.data?.role === "admin", JSON.stringify(session.body?.data));

// --- admin cart + profile + order acceptance -------------------------------
const menu = await (await fetch(`${BASE}/api/menu`)).json();
const item = menu.data.categories.flatMap((c) => c.items).find((i) => i.isAvailable !== false) || menu.data.categories[0].items[0];
ok("menu item available for probe", Boolean(item), item?.name);

const profileRes = await p.evaluate(async () => {
  const r = await fetch("/api/customers/profile", {
    method: "PUT", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "Camille", lastName: "Garcia", barangay: "Madapdap", address: "Blk 1 Lot 2, Madapdap Resettlement, Mabalacat", landmark: "Blue gate" })
  });
  return { status: r.status, body: await r.json() };
});
ok("admin storefront profile saves", profileRes.status === 200 && profileRes.body?.data?.role === "admin", JSON.stringify(profileRes.body?.data));

const cartRes = await p.evaluate(async (id) => {
  const r = await fetch("/api/customers/cart", {
    method: "PUT", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cart: [{ menuItemId: id, quantity: 1, unitPrice: 100, name: "Probe" }] })
  });
  const saved = await r.json();
  const back = await (await fetch("/api/customers/cart", { credentials: "same-origin" })).json();
  return { status: r.status, saved: saved.data?.length, reloaded: back.data?.length };
}, item.id);
ok("admin cart persists server-side", cartRes.status === 200 && cartRes.saved === 1 && cartRes.reloaded === 1, JSON.stringify(cartRes));

const orderRes = await p.evaluate(async (id) => {
  const r = await fetch("/api/orders", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: "probe admin order", paymentMethod: "cash", items: [{ menuItemId: id, quantity: 1, selectedOptions: {} }] })
  });
  return { status: r.status, body: await r.json() };
}, item.id);
ok("admin can place a storefront order", orderRes.status === 201 && orderRes.body?.data?.orderNumber, `status ${orderRes.status} ${orderRes.body?.error || orderRes.body?.data?.orderNumber}`);
const probeOrder = orderRes.body?.data?.orderNumber || "";
ok("admin order flagged as test/demo", orderRes.body?.data?.isDemo === true && (orderRes.body?.data?.customerId === undefined || orderRes.body?.data?.customerId === null), JSON.stringify({ isDemo: orderRes.body?.data?.isDemo, customerId: orderRes.body?.data?.customerId }));

// admin orders list carries the badge flag
const adminOrders = await p.evaluate(async () => {
  const csrf = document.cookie.split("; ").find((c) => c.startsWith("mk_admin_csrf="))?.split("=")[1] || "";
  const r = await fetch("/api/admin/orders", { credentials: "same-origin", headers: { "X-CSRF-Token": decodeURIComponent(csrf) } });
  return await r.json();
});
const adminOrder = adminOrders.data?.find((o) => o.orderNumber === probeOrder);
// The Orders VIEW was removed; the data feed still flags admin test orders.
ok("admin orders feed flags admin test order", adminOrder?.adminTest === true, JSON.stringify({ found: Boolean(adminOrder), adminTest: adminOrder?.adminTest }));

// --- separations -----------------------------------------------------------
const cust = await (await fetch(`${BASE}/api/customers/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: demoCreds.phone, password: demoCreds.password }) })).json();
const custToken = cust.data?.token;
const adminWithCustomer = await fetch(`${BASE}/api/admin/overview`, { headers: { Authorization: `Bearer ${custToken}` } });
ok("customer token rejected by admin API", adminWithCustomer.status === 401, `status ${adminWithCustomer.status}`);

const cookies = await p.cookies();
const adminCookie = cookies.filter((c) => c.name === "mk_admin_session").map((c) => `${c.name}=${c.value}`).join("; ");
const customerApiWithAdmin = await fetch(`${BASE}/api/customers/cart`, { headers: { Cookie: adminCookie } });
ok("admin cookie accepted by customer cart (preview)", customerApiWithAdmin.status === 200, `status ${customerApiWithAdmin.status}`);

// --- storefront sign-out must end the admin session ------------------------
await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle2" });
await wait(1500);
await p.evaluate(() => document.querySelector("#profile-button")?.click());
await wait(700);
await p.evaluate(() => document.querySelector(".profile-signout")?.click());
await wait(2000);
const shopOut = {
  url: p.url(),
  cookieGone: !(await p.cookies()).some((c) => c.name === "mk_admin_session")
};
ok("storefront admin sign-out ends admin session", shopOut.cookieGone && shopOut.url.includes("login.html"), JSON.stringify(shopOut));
await p.goto(`${BASE}/login.html`, { waitUntil: "networkidle2" });
await wait(1200);
ok("login page stays put after sign-out", !p.url().includes("index.html"), p.url());

// --- admin logout ends the storefront session ------------------------------
await p.goto(`${BASE}/staff-portal-x7k2`, { waitUntil: "networkidle2" });
await p.type("#login-user", "admin");
await p.type("#login-pass", demoCreds.adminPassword);
await p.click("#login-button");
await p.waitForFunction(() => location.pathname.endsWith("/board"), { timeout: 15000 });
await p.waitForSelector("#admin-app:not([hidden])", { timeout: 15000 });
await p.goto(`${BASE}/staff-portal-x7k2/board`, { waitUntil: "networkidle2" });
await wait(1200);
await p.evaluate(() => document.querySelector("#drawer-logout")?.click());
await wait(1800);
ok("admin logout leaves the door", p.url().endsWith("/staff-portal-x7k2") || p.url().endsWith("/staff-portal-x7k2/"), p.url());
await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle2" });
await wait(1400);
ok("storefront no longer treats visitor as admin", p.url().includes("login.html"), p.url());

// --- normal customer still works ------------------------------------------
const cctx = await b.createBrowserContext();
const cp = await cctx.newPage();
await cp.goto(`${BASE}/login.html`, { waitUntil: "networkidle2" });
await cp.type("#c-phone", demoCreds.phone);
await cp.type("#c-pass", demoCreds.password);
await Promise.all([cp.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}), cp.click("#login-button")]);
await wait(1600);
const custState = await cp.evaluate(() => ({
  url: location.pathname,
  badge: !document.querySelector("#admin-shop-badge")?.hidden,
  role: JSON.parse(localStorage.getItem("mk_profile") || "{}").role
}));
ok("normal customer still signs in, no admin badge", custState.url.includes("index.html") && !custState.badge && custState.role === "customer", JSON.stringify(custState));

console.log("PAGE ERRORS:", errs.length ? errs : "none");
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
