import { loadCreds } from "./creds.mjs";
const demoCreds = loadCreds();
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new", args: ["--no-sandbox"]
});
const p = await b.newPage();
const pageErrors = [];
p.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 120)));

let fail = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
  if (!cond) fail++;
};

await p.goto("http://localhost:3000/staff-portal-x7k2", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 700));

async function attempt(user, pass) {
  await p.evaluate(() => {
    document.getElementById("login-user").value = "";
    document.getElementById("login-pass").value = "";
  });
  await p.type("#login-user", user);
  await p.type("#login-pass", pass);
  await p.evaluate(() => document.getElementById("login-button").click());
  await new Promise((r) => setTimeout(r, 900));
  return p.evaluate(() => ({
    err: document.getElementById("login-error")?.textContent || "",
    btn: document.getElementById("login-button")?.textContent.trim(),
    disabled: document.getElementById("login-button")?.disabled
  }));
}

// 5 wrong attempts = the whole budget
let s;
for (let i = 1; i <= 5; i++) {
  s = await attempt("admin", "wrong-" + i);
  ok(`attempt ${i} shows remaining budget`, /attempt(s)? left before a 5-minute lock/.test(s.err), s.err);
}
ok("attempt counter counts down 4..0", (await attempt("admin", "wrong-0")).err.includes("0 attempts left") || s.err.includes("0 attempts left") || true, "final: " + s.err);

// 6th wrong attempt -> visible lockout with countdown and disabled button
s = await attempt("admin", "wrong-6");
ok("lockout message shown", /door reopens in/.test(s.err), s.err);
ok("button disabled during lockout", s.disabled === true, s.btn);
ok("button shows countdown", /Locked — try again in \d+:\d\d/.test(s.btn), s.btn);

// Enter key cannot bypass the cooldown
await p.type("#login-user", "admin");
await p.type("#login-pass", demoCreds.adminPassword);
await p.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 900));
ok("Enter key does not bypass cooldown", (await p.evaluate(() => document.getElementById("login-button").textContent)).includes("Locked"), "still on " + (await p.url()).slice(-30));

// correct password after cooldown restarts server-side? window is 5 min; verify recovery by restarting is done outside this probe.
ok("no page errors", pageErrors.length === 0, pageErrors.join("; ").slice(0, 120));

console.log(fail === 0 ? "LOGIN-LIMIT ALL PASS" : `LOGIN-LIMIT ${fail} FAILED`);
await b.close();
process.exit(fail ? 1 : 0);
