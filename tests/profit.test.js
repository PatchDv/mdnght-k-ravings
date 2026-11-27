import test from "node:test";
import assert from "node:assert/strict";
import { ordersByDay, summarizeRange, periodSummaries, isoShift } from "../backend/utils/profit.js";

const put = (days, day, rev, cost, orders = 1, miss = false) =>
  days.set(day, { revenue: rev, productCost: cost, orders, hasUnknownCosts: miss });

test("ordersByDay aggregates revenue, cost and missing-cost flag", () => {
  const orders = [
    { day: "2026-11-04", total: 500, productCost: 200, costMissing: 0 },
    { day: "2026-11-04", total: 300, productCost: 100, costMissing: 1 },
    { day: "bad", total: 999, productCost: 1, costMissing: 0 }
  ];
  const days = ordersByDay(orders);
  assert.equal(days.size, 1);
  assert.equal(days.get("2026-11-04").revenue, 800);
  assert.equal(days.get("2026-11-04").productCost, 300);
  assert.equal(days.get("2026-11-04").hasUnknownCosts, true);
});

test("summarizeRange empty range yields zeros", () => {
  const r = summarizeRange(new Map(), new Map(), "2026-01-01", "2026-01-03");
  assert.equal(r.profit, 0);
  assert.equal(r.days.length, 3);
  assert.equal(r.orders, 0);
});

test("summarizeRange subtracts product cost and expenses", () => {
  const days = new Map();
  put(days, "2026-01-01", 1000, 400);
  const exp = new Map([["2026-01-01", 150]]);
  const r = summarizeRange(days, exp, "2026-01-01", "2026-01-02");
  assert.equal(r.revenue, 1000);
  assert.equal(r.costs, 550);
  assert.equal(r.profit, 450);
});

test("summarizeRange flags estimated only when an order day has unknown costs", () => {
  const days = new Map();
  put(days, "2026-01-01", 1000, 400, 1, true);
  const a = summarizeRange(days, new Map(), "2026-01-01", "2026-01-01");
  assert.equal(a.estimated, true);

  const clean = new Map();
  put(clean, "2026-01-01", 1000, 400, 1, false);
  const b = summarizeRange(clean, new Map(), "2026-01-01", "2026-01-02");
  assert.equal(b.estimated, false);
});

test("summarizeRange keeps expenses per day separate from product cost", () => {
  const days = new Map();
  put(days, "2026-01-01", 1000, 400);
  const exp = new Map([["2026-01-01", 150]]);
  const r = summarizeRange(days, exp, "2026-01-01", "2026-01-02");
  assert.equal(r.days[0].expenses, 150);
  assert.equal(r.days[0].cost, 550); // product + expenses
  assert.equal(r.days[1].expenses, 0);
  assert.equal(r.days[0].orders, 1);
});

test("periodSummaries returns the four recent cards, nothing older", () => {
  const days = new Map();
  put(days, "2026-11-04", 700, 250);                // today
  put(days, "2026-11-03", 450, 150);                // yesterday
  put(days, isoShift("2026-11-04", -5), 500, 200);  // inside last 7
  put(days, isoShift("2026-11-04", -10), 321, 100); // inside last 14
  put(days, isoShift("2026-11-04", -20), 888, 1);   // older — nowhere
  const exp = new Map([["2026-11-04", 30]]);

  const p = periodSummaries(days, exp, "2026-11-04");
  assert.equal(p.today.profit, 700 - 250 - 30);
  assert.equal(p.yesterday.profit, 300);
  assert.equal(p.week7.profit, 420 + 300 + 300);
  assert.equal(p.week14.profit, p.week7.profit + 221);
});

test("isoShift moves across month boundaries", () => {
  assert.equal(isoShift("2026-03-01", -1), "2026-02-28");
  assert.equal(isoShift("2026-11-01", -1), "2026-10-31");
});
