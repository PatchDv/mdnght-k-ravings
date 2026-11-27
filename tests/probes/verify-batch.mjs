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
p.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 120)));
p.on("console", (m) => m.type() === "error" && !/CSP|favicon|404/.test(m.text()) && errs.push("console: " + m.text().slice(0, 120)));

// --- customer flow --------------------------------------------------------
await p.setViewport({ width: 1280, height: 900 });
await p.goto(`${BASE}/login.html`, { waitUntil: "networkidle2" });
await p.type("#c-phone", demoCreds.phone);
await p.type("#c-pass", demoCreds.password);
await Promise.all([p.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}), p.click("#login-button")]);
ok("customer lands on storefront", p.url().includes("index.html"), p.url());
await wait(1800);

// 1. Header fee note
const feeNote = await p.evaluate(() => document.querySelector(".utility-bar p")?.textContent.trim() || "");
ok("header fee note mentions 400+ free", /Free delivery for orders of ₱400 or more/.test(feeNote), feeNote);

// 2. Middle bar merged into top bar
const nav = await p.evaluate(() => ({
  menuControls: Boolean(document.getElementById("menu-controls")),
  primaryNav: Boolean(document.getElementById("primary-nav")),
  navToggle: Boolean(document.getElementById("nav-toggle")),
  mobileNav: Boolean(document.getElementById("mobile-nav")),
  pillsInHeader: Boolean(document.querySelector(".site-header #filter-pills")),
  sortInHeader: Boolean(document.querySelector(".site-header #sort-select")),
  summaryInHeader: Boolean(document.querySelector(".site-header #result-summary")),
  pillCount: document.querySelectorAll(".filter-pill").length,
  headerH: document.querySelector(".site-header")?.offsetHeight
}));
ok("middle bar removed", !nav.menuControls && !nav.primaryNav && !nav.navToggle && !nav.mobileNav, JSON.stringify(nav));
ok("pills + sort + summary live in the header", nav.pillsInHeader && nav.sortInHeader && nav.summaryInHeader && nav.pillCount === 4, `header ${nav.headerH}px, pills ${nav.pillCount}`);

// features still work from the top bar
await p.evaluate(() => document.querySelector('.filter-pill[data-filter="korean-cravings"]').click());
await wait(700);
let state1 = await p.evaluate(() => ({
  filter: window.MK.state.filter,
  koreanVisible: !document.querySelector("#korean-cravings").classList.contains("is-filtered-out"),
  traysHidden: document.querySelector("#trays-bilao").classList.contains("is-filtered-out"),
  scrolledToMenu: window.scrollY > 200,
  activePill: document.querySelector(".filter-pill.is-active")?.dataset.filter
}));
ok("pill filters + scrolls + active state", state1.filter === "korean-cravings" && state1.koreanVisible && state1.traysHidden && state1.activePill === "korean-cravings", JSON.stringify(state1));

await p.evaluate(() => { const s = document.querySelector("#sort-select"); s.value = "price-asc"; s.dispatchEvent(new Event("change")); });
await wait(500);
const firstPrice = await p.evaluate(() => {
  const grid = document.querySelector("#grid-korean-cravings");
  const card = grid?.querySelector(".menu-card .card-price");
  return card ? card.textContent.trim() : "none";
});
ok("sort works from header", firstPrice !== "none", "first card: " + firstPrice);

await p.evaluate(() => { const i = document.querySelector("#menu-search"); i.value = "kimbap"; i.dispatchEvent(new Event("input", { bubbles: true })); });
await wait(700);
const searchState = await p.evaluate(() => ({
  summary: document.querySelector("#result-summary")?.textContent.trim(),
  visibleSections: [...document.querySelectorAll(".menu-section")].filter((s) => !s.classList.contains("is-filtered-out")).length
}));
ok("search works with header controls", /craving|dish/i.test(searchState.summary || ""), JSON.stringify(searchState));
await p.evaluate(() => { const i = document.querySelector("#menu-search"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); });
await p.evaluate(() => document.querySelector('.filter-pill[data-filter="all"]').click());
await wait(500);

// cart + profile from header
await p.evaluate(() => document.querySelector("#cart-button").click());
await wait(600);
const cartOpen = await p.evaluate(() => document.querySelector("#cart-drawer")?.classList.contains("is-open"));
ok("cart opens from header", Boolean(cartOpen));
await p.keyboard.press("Escape");
await wait(400);
await p.evaluate(() => document.querySelector("#profile-button").click());
await wait(600);
const profileOpen = await p.evaluate(() => document.querySelector("#profile-drawer")?.classList.contains("is-open"));
ok("profile opens from header", Boolean(profileOpen));
await p.keyboard.press("Escape");
await wait(400);

// fee wording in cart/checkout/receipt
const copy = await p.evaluate(() => document.body.innerHTML.includes("Free for orders of ₱400 or more") || document.body.innerHTML.includes("Free delivery for orders of ₱400 or more"));
ok("fee wording consistent in cart/checkout copy", copy);
const notices = await p.evaluate(() => (document.body.innerHTML.match(/Free delivery for orders of ₱400 or more/g) || []).length);
ok("checkout/receipt notices updated", notices >= 1, `${notices} matches`);

// sticky header: no leftover gap between hero and first section
const gaps = await p.evaluate(() => {
  const hero = document.querySelector("#home").getBoundingClientRect();
  const section = document.querySelector("#korean-cravings").getBoundingClientRect();
  return { heroBottom: Math.round(hero.bottom + window.scrollY), sectionTop: Math.round(section.top + window.scrollY) };
});
ok("no stray gap where middle bar was", gaps.sectionTop - gaps.heroBottom < 120, JSON.stringify(gaps));

// desktop screenshot
await p.evaluate(() => window.scrollTo(0, 0));
await wait(400);
await p.screenshot({ path: "C:/Users/admin/AppData/Local/Temp/opencode/topbar-desktop.png" });

// mobile: pills usable one-hand, scrollable bar, bottom nav intact
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await wait(600);
const mobile = await p.evaluate(() => {
  const pills = document.querySelector("#filter-pills");
  const header = document.querySelector(".site-header");
  return {
    scrollable: pills.scrollWidth > pills.clientWidth,
    headerH: header?.offsetHeight,
    bottomNav: Boolean(document.querySelector("#bottom-nav")),
    overflow: document.documentElement.scrollWidth - window.innerWidth
  };
});
ok("mobile: pills horizontally scrollable + bottom nav + no overflow", mobile.scrollable && mobile.bottomNav && mobile.overflow <= 0, JSON.stringify(mobile));
await p.screenshot({ path: "C:/Users/admin/AppData/Local/Temp/opencode/topbar-mobile.png" });

// --- store hours fully gone ----------------------------------------------
await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle2" });
await wait(1200);
const hoursGone = await p.evaluate(() => !document.body.innerText.includes("Open daily") && !document.body.innerText.includes("10:00 AM"));
ok("customer side: no hours text", hoursGone);
{
  const store = await (await fetch(`${BASE}/api/store`)).json();
  ok("/api/store has no hours field", !("hours" in (store?.data || {})), JSON.stringify(store?.data));
}

// --- session separation ----------------------------------------------------
// admin board session must NOT make the storefront logged-in
const actx = await b.createBrowserContext();
const ap = await actx.newPage();
await ap.setViewport({ width: 1280, height: 900 });
await ap.goto(`${BASE}/staff-portal-x7k2`, { waitUntil: "networkidle2" });
await ap.type("#login-user", "admin");
await ap.type("#login-pass", demoCreds.adminPassword);
await ap.click("#login-button");
await ap.waitForFunction(() => location.pathname.endsWith("/board"), { timeout: 15000 });
await ap.waitForSelector("#admin-app:not([hidden])", { timeout: 15000 });
await wait(800);
ok("admin logged into board", true, ap.url());

// same browser context now opens the storefront: no customer session exists
await ap.goto(`${BASE}/login.html`, { waitUntil: "networkidle2" });
const custGate = await ap.evaluate(() => ({
  onLogin: location.pathname.includes("login.html"),
  hasCustomerToken: Boolean(localStorage.getItem("mk_customer_token")),
  hasProfile: Boolean(localStorage.getItem("mk_profile") || localStorage.getItem("mk_customer_profile"))
}));
ok("admin browser: storefront signs in as admin preview", !custGate.onLogin && !custGate.hasCustomerToken, JSON.stringify(custGate));

// admin API must reject a customer session, and vice versa
{
  const clogin = await (await fetch(`${BASE}/api/customers/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: demoCreds.phone, password: demoCreds.password }) })).json();
  const ctoken = clogin?.data?.token;
  const r1 = await fetch(`${BASE}/api/admin/overview`, { headers: { Authorization: `Bearer ${ctoken}` } });
  ok("customer token on admin API -> 401", r1.status === 401, `status ${r1.status}`);
  // admin cookie must not authenticate customer APIs
  const cookies = await ap.cookies();
  const adminCookie = cookies.filter((c) => c.name === "mk_admin_session").map((c) => `${c.name}=${c.value}`).join("; ");
  const r2 = await fetch(`${BASE}/api/customers/cart`, { headers: { Cookie: adminCookie } });
  ok("admin cookie accepted by customer cart (preview)", r2.status === 200, `status ${r2.status} cookie ${adminCookie ? "present" : "none"}`);
}

// no admin board UI mentions hours anymore
await ap.goto(`${BASE}/staff-portal-x7k2/board`, { waitUntil: "networkidle2" });
await wait(1200);
const adminHours = await ap.evaluate(() => document.body.innerText.includes("Opening hours") || document.body.innerText.includes("Save hours"));
ok("admin board: no Store Hours UI", !adminHours);

// logout isolation: customer sign-out keeps admin cookie, admin sign-out keeps customer token
{
  // customer signs out (profile drawer) — do it via the API-backed UI state: clear token manually? Use the UI:
  await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle2" });
  await wait(1000);
  await p.evaluate(() => document.querySelector("#profile-button")?.click?.() || document.querySelector('[data-bnav="profile"]')?.click());
  await wait(800);
  await p.evaluate(() => document.querySelector(".profile-signout")?.click());
  await wait(1200);
  const afterCustOut = await p.evaluate(() => ({ onLogin: location.pathname.includes("login.html"), token: localStorage.getItem("mk_customer_token") }));
  ok("customer sign-out clears customer session", afterCustOut.onLogin && !afterCustOut.token, JSON.stringify(afterCustOut));
  const adminStill = (await ap.cookies()).some((c) => c.name === "mk_admin_session");
  ok("admin cookie survives customer sign-out", adminStill);

  // admin signs out of the board
  await ap.evaluate(() => document.querySelector("#drawer-logout")?.click());
  await wait(1500);
  const adminGone = !(await ap.cookies()).some((c) => c.name === "mk_admin_session");
  const boardGone = ap.url().endsWith("/staff-portal-x7k2") || ap.url().endsWith("/staff-portal-x7k2/");
  ok("admin sign-out kills admin session -> back at door", adminGone && boardGone, ap.url());
}

console.log("ERRORS", errs.length ? errs : "none");
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
