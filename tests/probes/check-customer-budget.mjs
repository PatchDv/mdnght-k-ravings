import { loadCreds } from "./creds.mjs";
const demoCreds = loadCreds();
// Wrong customer password must answer 401 with a visible attempts budget.
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`); if (!cond) fail++; };

const r = await fetch("http://localhost:3000/api/customers/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: demoCreds.username, password: "wrong-password" })
});
const body = await r.json();
ok("wrong password answers 401", r.status === 401, `status ${r.status}`);
ok("attemptsLeft present and below the cap", Number.isInteger(body.attemptsLeft) && body.attemptsLeft < 10, JSON.stringify(body.attemptsLeft));
const r2 = await fetch("http://localhost:3000/api/customers/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: demoCreds.username, password: "wrong-password-2" })
});
const b2 = await r2.json();
ok("budget counts down", b2.attemptsLeft === body.attemptsLeft - 1, `${body.attemptsLeft} -> ${b2.attemptsLeft}`);
console.log(fail === 0 ? "CUSTOMER-BUDGET PASS" : `CUSTOMER-BUDGET ${fail} FAILED`);
process.exit(fail ? 1 : 0);
