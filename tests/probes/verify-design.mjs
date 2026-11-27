import { loadCreds } from "./creds.mjs";
const demoCreds = loadCreds();
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"]
});
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
p.on("response", (r) => {
  if (r.status() >= 400) errs.push(`${r.status()} ${r.url().slice(-60)}`);
});

let fail = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
  if (!cond) fail++;
};

// login: mobile layout fits, toggle works
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await p.goto("http://localhost:3000/staff-portal-x7k2", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 600));
const login = await p.evaluate(() => {
  const toggle = document.querySelector(".pass-toggle");
  const input = document.getElementById("login-pass");
  const tr = toggle.getBoundingClientRect();
  const ir = input.getBoundingClientRect();
  return {
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    toggleInside: tr.left > ir.left && tr.right < ir.right && tr.top > ir.top && tr.bottom < ir.bottom,
    twoCol: getComputedStyle(document.querySelector(".admin-login")).gridTemplateColumns.split(" ").length
  };
});
ok("login: no horizontal overflow on phone", login.overflow <= 0, `${login.overflow}px`);
ok("login: reveal button sits inside the field", login.toggleInside);
ok("login: single column on phone", login.twoCol === 1, `cols ${login.twoCol}`);

// board: every view fits a phone
await p.setViewport({ width: 1360, height: 900 });
await p.type("#login-user", "admin");
await p.type("#login-pass", demoCreds.adminPassword);
await p.click("#login-button");
await p.waitForFunction(() => location.pathname.endsWith("/board"), { timeout: 15000 });
await p.waitForSelector("#admin-app:not([hidden])");

const rail = await p.evaluate(() => ({
  live: Boolean(document.querySelector(".rail-live")),
  date: document.getElementById("admin-date")?.textContent,
  avatar: document.getElementById("admin-avatar")?.textContent,
  name: document.getElementById("rail-name")?.textContent
}));
ok("rail shows live + date + admin", rail.live && rail.date.length > 3 && rail.avatar === "C" && /Camille/.test(rail.name || ""), JSON.stringify(rail));

await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await new Promise((r) => setTimeout(r, 600));
for (const view of ["insights", "orders", "customers", "menu", "profit", "profile"]) {
  await p.evaluate((v) => document.querySelector(`[data-view="${v}"]`)?.click(), view);
  await new Promise((r) => setTimeout(r, 900));
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`board ${view}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
}

console.log("ERRORS:", errs.length ? errs.slice(0, 6) : "none");
console.log(fail ? `${fail} FAILED` : "ALL PASS");
await b.close();
process.exit(fail || errs.length ? 1 : 0);
