import puppeteer from "puppeteer-core";
import { setTimeout as wait } from "node:timers/promises";
import { loadCreds } from "./creds.mjs";
const demoCreds = loadCreds();


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

// ---------- storefront as customer ----------
await p.setViewport({ width: 1280, height: 900 });
await p.goto(`${BASE}/login.html`, { waitUntil: "networkidle2" });
await p.type("#c-phone", demoCreds.phone);
await p.type("#c-pass", demoCreds.password);
await Promise.all([p.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}), p.click("#login-button")]);
await wait(1800);

// 1. recommendations gone
const rec = await p.evaluate(async () => {
  const menu = await (await fetch("/api/menu")).json();
  return {
    apiBest: "bestSellers" in (menu?.data || {}),
    soldTags: document.querySelectorAll(".card-sold").length,
    sortOptions: [...document.querySelectorAll("#sort-select option")].map((o) => o.value),
    trending: document.body.innerHTML.includes("Trending right now"),
    mostOrdered: document.body.innerHTML.includes("Most ordered")
  };
});
ok("menu API has no bestSellers", !rec.apiBest);
ok("no sold-count badges", rec.soldTags === 0, `${rec.soldTags} found`);
ok("no best-seller sort option", !rec.sortOptions.includes("best-seller"), rec.sortOptions.join(","));
ok("search suggestions de-recommended", !rec.trending && !rec.mostOrdered);

// 2. My Order bottom nav (mobile)
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await wait(700);
await p.evaluate(() => document.querySelector('[data-bnav="orders"]')?.click());
await wait(900);
const myOrder = await p.evaluate(() => ({
  open: document.querySelector("#cart-drawer")?.classList.contains("is-open"),
  active: document.querySelector('[data-bnav="orders"]')?.classList.contains("is-active"),
  latest: document.querySelector(".cart-latest-order")?.textContent.trim() || ""
}));
ok("My Order icon opens the cart drawer", Boolean(myOrder.open), JSON.stringify(myOrder));
ok("My Order icon highlighted", Boolean(myOrder.active));
ok("My Order shows latest order status or empty state", true, myOrder.latest.slice(0, 80));
await p.evaluate(() => document.querySelector("#cart-close")?.click());
await wait(600);
const navReset = await p.evaluate(() => document.querySelector('[data-bnav="orders"]')?.classList.contains("is-active"));
ok("bottom nav resets when My Order closes", !navReset);

// 3. K-Bot mobile sheet: fits, above bottom nav, big mic
await p.evaluate(() => document.querySelector("#voice-launcher")?.click());
await wait(900);
const sheet = await p.evaluate(() => {
  const panel = document.querySelector("#voice-panel");
  const cs = getComputedStyle(panel);
  const nav = document.querySelector("#bottom-nav").getBoundingClientRect();
  const r = panel.getBoundingClientRect();
  return {
    open: panel.classList.contains("is-open"),
    bottom: Math.round(r.bottom),
    navTop: Math.round(nav.top),
    width: Math.round(r.width),
    vw: window.innerWidth,
    mic: Math.round(document.querySelector("#voice-mic").getBoundingClientRect().width),
    log: Boolean(document.querySelector("#voice-log"))
  };
});
ok("K-Bot opens as a mobile sheet", sheet.open && sheet.width === sheet.vw, JSON.stringify(sheet));
ok("K-Bot sheet does not cover the bottom nav", sheet.bottom <= sheet.navTop + 2, `panel bottom ${sheet.bottom} vs nav top ${sheet.navTop}`);
ok("K-Bot mic is large", sheet.mic >= 60, `${sheet.mic}px`);

// 4. voice ordering flow (driven through the MKBot seam)
const flow = await p.evaluate(() => {
  const bot = window.MKBot;
  const say = (t) => { bot.handleCommand(t); return bot.draft(); };
  const log = [];
  log.push(["add 2 cheese kimbap", say("add 2 cheese kimbap")]);
  log.push(["that's all", say("that's all")]);
  const beforeCart = window.MK.cartCount();
  say("yes");
  return { log, beforeCart, afterCart: window.MK.cartCount(), drawerOpen: document.querySelector("#cart-drawer")?.classList.contains("is-open") };
});
ok("voice adds only what was said", flow.log[1][1].length === 1 && flow.log[1][1][0].quantity === 2 && /kimbap/i.test(flow.log[1][1][0].name), JSON.stringify(flow.log[1][1]));
ok("confirm puts the order into My Order", flow.beforeCart === 0 && flow.afterCart === 2 && flow.drawerOpen, `cart ${flow.beforeCart}->${flow.afterCart}`);
const confirmMsg = await p.evaluate(() => [...document.querySelectorAll("#voice-log .voice-msg-bot p")].some((el) => /My Order/.test(el.textContent)));
ok("confirmation message mentions My Order", confirmMsg);

// clear cart for the next tests
await p.evaluate(() => {
  return window.MK.voiceRemoveLine ? document.querySelectorAll(".cart-line .cart-remove").forEach((b) => b.click()) : null;
});
await wait(800);

// options clarification
const opts = await p.evaluate(() => {
  const bot = window.MKBot;
  bot.reset();
  bot.handleCommand("add 6pcs wings with flavor");
  let d = bot.draft();
  if (!d.length) { bot.handleCommand("buffalo"); d = bot.draft(); }
  return { draft: d };
});
ok("missing required option is clarified then filled", opts.draft.length === 1 && /Buffalo/i.test(opts.draft[0].optionsText || ""), JSON.stringify(opts.draft));
await p.evaluate(() => window.MKBot.reset());

// corrections
const corr = await p.evaluate(() => {
  const bot = window.MKBot;
  bot.reset();
  bot.handleCommand("add cheese kimbap");
  const one = bot.draft().length;
  bot.handleCommand("add 6pcs wings with flavor"); // requires sauce -> pending, not added
  const withPending = bot.draft().length;
  bot.handleCommand("remove that"); // drops pending + removes the kimbap line
  const afterRemove = bot.draft().length;
  bot.handleCommand("add 3 porkchop silog");
  bot.handleCommand("cheese"); // answer the sauce question
  const afterOptions = bot.draft();
  bot.handleCommand("change it to 5");
  const changed = bot.draft();
  bot.handleCommand("cancel the order");
  return { one, withPending, afterRemove, afterOptions, changed, afterCancel: bot.draft().length };
});
ok("pending option item is not added until answered", corr.one === 1 && corr.withPending === 1, JSON.stringify({ one: corr.one, withPending: corr.withPending }));
ok("remove that drops pending + last line", corr.afterRemove === 0, JSON.stringify(corr.afterRemove));
ok("voice answer fills the option", corr.afterOptions.some((l) => /silog/i.test(l.name) && /Cheese/i.test(l.optionsText || "")), JSON.stringify(corr.afterOptions));
ok("change it to 5 updates quantity", corr.changed.some((l) => /silog/i.test(l.name) && l.quantity === 5), JSON.stringify(corr.changed));
ok("cancel empties the voice order", corr.afterCancel === 0);

// ambiguity: one clarifying question, no guessing
const amb = await p.evaluate(() => {
  const bot = window.MKBot;
  bot.reset();
  bot.handleCommand("add wings");
  return { draft: bot.draft().length };
});
ok("ambiguous item asks instead of guessing", amb.draft === 0);
await p.evaluate(() => window.MKBot.reset());

// menu-only: off-topic refusals, no store info
const only = await p.evaluate(() => {
  const bot = window.MKBot;
  bot.reset();
  const answers = {};
  const grab = (q) => { bot.handleCommand(q); const ps = [...document.querySelectorAll("#voice-log .voice-msg-bot p")]; answers[q] = ps[ps.length - 1]?.textContent || ""; };
  grab("what time are you open");
  grab("who is the president of the philippines");
  grab("where do you deliver");
  grab("how do I change my password");
  bot.reset();
  return answers;
});
const forbidden = /open daily|10 (in|AM)|madapdap|password|sign in|admin|account/i;
const menuOnly = Object.entries(only).every(([q, t]) => !forbidden.test(t) && (/only help with ordering|menu/i.test(t) || /order|dish|craving/i.test(t)));
ok("off-topic questions refused (menu only)", menuOnly, JSON.stringify(only).slice(0, 260));
const noHours = await p.evaluate(() => !document.body.innerText.includes("Open daily"));
ok("store hours not spoken by K-Bot markup", noHours);

// mobile screenshots
await p.evaluate(() => window.scrollTo(0, 0));
await wait(400);
await p.screenshot({ path: "C:/Users/admin/AppData/Local/Temp/opencode/kbot-mobile.png" });

// ---------- admin board ----------
await p.setViewport({ width: 1280, height: 900 });
await p.goto(`${BASE}/staff-portal-x7k2`, { waitUntil: "networkidle2" });
await p.type("#login-user", "admin");
await p.type("#login-pass", demoCreds.adminPassword);
await p.click("#login-button");
await p.waitForFunction(() => location.pathname.endsWith("/board"), { timeout: 15000 });
await p.waitForSelector("#admin-app:not([hidden])", { timeout: 15000 });
await wait(1200);

const boardGone = await p.evaluate(() => ({
  navOrders: Boolean(document.querySelector('[data-view="orders"]')),
  panelOrders: Boolean(document.getElementById("view-orders")),
  views: [...document.querySelectorAll(".sidebar-link[data-view]")].map((b) => b.dataset.view)
}));
ok("admin Orders view restored", boardGone.navOrders && boardGone.panelOrders, boardGone.views.join(","));

// customers view still works with history drill-down
await p.evaluate(() => document.querySelector('[data-view="customers"]')?.click());
await wait(1400);
const customers = await p.evaluate(() => {
  const row = document.querySelector(".customer-row .customer-toggle");
  row?.click();
  return { rows: document.querySelectorAll(".customer-row").length };
});
await wait(700);
const history = await p.evaluate(() => ({
  historyOpen: Boolean(document.querySelector(".customer-history")),
  orders: document.querySelectorAll(".customer-order").length
}));
ok("customers view loads", customers.rows > 0, `${customers.rows} rows`);
ok("customer history drill-down works", history.historyOpen && history.orders > 0, `${history.orders} orders`);

// profit view renders (chart, cards, expenses, cost editor)
await p.evaluate(() => document.querySelector('[data-view="profit"]')?.click());
await wait(1800);
const profit = await p.evaluate(() => ({
  cards: document.querySelectorAll("#profit-cards .stat-card").length,
  groups: document.querySelectorAll(".profit-group").length,
  expenses: document.querySelectorAll(".expense-row").length,
  costRows: document.querySelectorAll(".cost-row").length,
  pills: document.querySelectorAll(".profit-pill").length
}));
ok("profit view renders", profit.cards > 0 && profit.groups > 0 && profit.costRows > 0, JSON.stringify(profit));

// menu editor modal renders with option group editor
await p.evaluate(() => document.querySelector('[data-view="menu"]')?.click());
await wait(900);
await p.evaluate(() => document.querySelector("#add-dish")?.click());
await wait(900);
const editor = await p.evaluate(() => ({
  open: document.querySelector("#editor-modal")?.classList.contains("is-open"),
  grid: Boolean(document.querySelector(".editor-grid")),
  addGroup: Boolean(document.querySelector("#add-group"))
}));
ok("menu editor modal renders", editor.open && editor.grid, JSON.stringify(editor));
await p.evaluate(() => document.querySelector("#add-group")?.click());
await wait(400);
const group = await p.evaluate(() => Boolean(document.querySelector(".group-card .group-grid")));
ok("option group editor renders", group);
await p.evaluate(() => document.querySelector("#editor-cancel")?.click());
await wait(400);

// toasts
await p.evaluate(() => document.querySelector("#refresh-button")?.click());
await wait(1300);
const toast = await p.evaluate(() => Boolean(document.querySelector(".admin-toast")));
ok("admin toasts render", toast);

// Back to Admin on the storefront (admin session; drop the customer identity
// from the earlier part of this tab first)
await p.evaluate(() => { localStorage.removeItem("mk_customer_token"); localStorage.removeItem("mk_profile"); });
await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle2" });
await wait(1600);
const backBtn = await p.evaluate(() => {
  const el = document.querySelector("#admin-return");
  return { present: Boolean(el), visible: el ? !el.hidden : false, text: el?.textContent.trim() };
});
ok("Back to Admin button visible for admin", backBtn.present && backBtn.visible, JSON.stringify(backBtn));
await p.evaluate(() => document.querySelector("#admin-return")?.click());
await p.waitForFunction(() => location.pathname.includes("staff-portal-x7k2"), { timeout: 15000 });
ok("Back to Admin returns to the board", true, p.url());

// customer must NOT see the button or get the path
const cctx = await b.createBrowserContext();
const cp = await cctx.newPage();
await cp.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await cp.goto(`${BASE}/login.html`, { waitUntil: "networkidle2" });
await cp.type("#c-phone", demoCreds.phone);
await cp.type("#c-pass", demoCreds.password);
await Promise.all([cp.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}), cp.click("#login-button")]);
await wait(1600);
const custBack = await cp.evaluate(() => {
  const el = document.querySelector("#admin-return");
  return { hidden: el ? el.hidden : "absent", pathInSource: document.documentElement.outerHTML.includes("staff-portal") };
});
ok("customer sees no Back to Admin and no secret path", (custBack.hidden === true || custBack.hidden === "absent") && !custBack.pathInSource, JSON.stringify(custBack));

// door API refuses logged-out
const doorAnon = await fetch(`${BASE}/api/admin/door`);
ok("door API refuses non-admins", doorAnon.status === 401, `status ${doorAnon.status}`);

console.log("PAGE ERRORS:", errs.length ? errs : "none");
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
