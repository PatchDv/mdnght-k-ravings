// Explicit FIFO kitchen queue over a plain array. The head is always the
// oldest working order (confirmed/preparing/delivering) — closed orders
// (delivered/cancelled, plus the retired pending status) never enter.
// FIFO key: created_at, with id as the tie-break so same-second orders
// keep a stable order.

const WORKING_STATUSES = ["confirmed", "preparing", "delivering"];

const timeOf = (order) => Date.parse(order.createdAt ?? order.created_at ?? "") || 0;

export function compareOrders(a, b) {
  return timeOf(a) - timeOf(b) || (a.id - b.id);
}

export function isWorking(order) {
  return WORKING_STATUSES.includes(order.status);
}

export function createOrderQueue() {
  let items = [];
  return {
    enqueue(order) {
      if (!isWorking(order)) return false;
      const at = items.findIndex((item) => compareOrders(order, item) < 0);
      if (at === -1) items.push(order);
      else items.splice(at, 0, order);
      return true;
    },
    dequeue() {
      return items.shift() ?? null;
    },
    peek() {
      return items[0] ?? null;
    },
    size() {
      return items.length;
    }
  };
}

// One-shot form for the API: filter to working orders, oldest first.
export function buildOrderQueue(orders) {
  return (orders || []).filter(isWorking).sort(compareOrders);
}
