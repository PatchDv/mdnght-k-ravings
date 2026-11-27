// Profit math over delivered-only orders. Pure functions so the analytics
// endpoint stays thin and the math stays testable.
//
// Rules:
//   revenue = sum of delivered order totals (cancelled/unpaid never counted)
//   productCost = sum of line quantities × menu item cost price
//   unknown item costs count as 0, but flag the period as "estimated"
//   profit = revenue - productCost - expenses

const MINUTES_PER_DAY = 24 * 60;

export function ordersByDay(orders) {
  const days = new Map();
  for (const order of orders) {
    const day = String(order.day || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const bucket = days.get(day) || { revenue: 0, productCost: 0, orders: 0, hasUnknownCosts: false };
    bucket.revenue += Number(order.total) || 0;
    bucket.productCost += Number(order.productCost) || 0;
    bucket.orders += 1;
    if (Number(order.costMissing) > 0) bucket.hasUnknownCosts = true;
    days.set(day, bucket);
  }
  return days;
}

// days: Map from ordersByDay; expensesByDay: Map day -> amount
export function summarizeRange(days, expensesByDay, from, to) {
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T23:59:59Z`);
  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) {
    return { days: [], revenue: 0, profit: 0, costs: 0, expenses: 0, orders: 0, estimated: false };
  }

  let revenue = 0;
  let productCost = 0;
  let expenses = 0;
  let orders = 0;
  let estimated = false;
  const series = [];

  for (let t = fromTime; t <= toTime; t += MINUTES_PER_DAY * 60 * 1000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const orderBucket = days.get(day) || { revenue: 0, productCost: 0, orders: 0, hasUnknownCosts: false };
    const expenseAmount = expensesByDay.get(day) || 0;
    revenue += orderBucket.revenue;
    productCost += orderBucket.productCost;
    expenses += expenseAmount;
    orders += orderBucket.orders;
    if (orderBucket.hasUnknownCosts && orderBucket.orders > 0) estimated = true;
    series.push({
      day,
      revenue: Math.round((orderBucket.revenue || 0) * 100) / 100,
      cost: Math.round(((orderBucket.productCost || 0) + expenseAmount) * 100) / 100,
      expenses: Math.round(expenseAmount * 100) / 100,
      orders: orderBucket.orders,
      profit: Math.round((orderBucket.revenue - orderBucket.productCost - expenseAmount) * 100) / 100
    });
  }

  return {
    days: series,
    revenue: Math.round(revenue * 100) / 100,
    costs: Math.round((productCost + expenses) * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    profit: Math.round((revenue - productCost - expenses) * 100) / 100,
    orders,
    estimated
  };
}

// Period totals for the four summary cards. Week = the last 7 days including
// today; days 8–14 = the last 14 days including today. Nothing older is shown.
export function periodSummaries(days, expensesByDay, todayIso) {
  const sum = (from, to) => summarizeRange(days, expensesByDay, from, to);
  return {
    today: { ...sum(todayIso, todayIso) },
    yesterday: { ...sum(isoShift(todayIso, -1), isoShift(todayIso, -1)) },
    week7: { ...sum(isoShift(todayIso, -6), todayIso) },
    week14: { ...sum(isoShift(todayIso, -13), todayIso) }
  };
}

export function isoShift(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * MINUTES_PER_DAY * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
