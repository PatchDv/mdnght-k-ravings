import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrderQueue, buildOrderQueue } from "../backend/utils/orderQueue.js";

const order = (id, createdAt, status) => ({ id, createdAt, status });

test("queue serves orders FIFO by created_at, not arrival order", () => {
  const queue = createOrderQueue();
  queue.enqueue(order(3, "2026-11-20 22:10:00", "confirmed"));
  queue.enqueue(order(1, "2026-11-20 21:55:00", "confirmed"));
  queue.enqueue(order(2, "2026-11-20 22:00:00", "preparing"));
  assert.equal(queue.size(), 3);
  assert.equal(queue.peek().id, 1, "head is the oldest working order");
  assert.equal(queue.dequeue().id, 1);
  assert.equal(queue.dequeue().id, 2);
  assert.equal(queue.dequeue().id, 3);
  assert.equal(queue.size(), 0);
});

test("queue skips closed orders (delivered, cancelled, retired pending)", () => {
  const queue = createOrderQueue();
  assert.equal(queue.enqueue(order(1, "2026-11-20 21:00:00", "delivered")), false);
  assert.equal(queue.enqueue(order(2, "2026-11-20 21:01:00", "cancelled")), false);
  assert.equal(queue.enqueue(order(3, "2026-11-20 21:02:00", "pending")), false);
  assert.equal(queue.enqueue(order(4, "2026-11-20 21:03:00", "confirmed")), true);
  assert.equal(queue.size(), 1);
  assert.equal(queue.peek().id, 4);
});

test("equal created_at breaks the tie by id", () => {
  const queue = createOrderQueue();
  queue.enqueue(order(9, "2026-11-20 21:00:00", "confirmed"));
  queue.enqueue(order(4, "2026-11-20 21:00:00", "confirmed"));
  queue.enqueue(order(6, "2026-11-20 21:00:00", "delivering"));
  assert.deepEqual(queue.dequeue().id, 4);
  assert.deepEqual(queue.dequeue().id, 6);
  assert.deepEqual(queue.dequeue().id, 9);
});

test("empty queue reads as empty", () => {
  const queue = createOrderQueue();
  assert.equal(queue.size(), 0);
  assert.equal(queue.peek(), null);
  assert.equal(queue.dequeue(), null);
});

test("buildOrderQueue filters and sorts a raw order list", () => {
  const rows = [
    order(2, "2026-11-20 22:00:00", "preparing"),
    order(1, "2026-11-20 21:30:00", "confirmed"),
    order(3, "2026-11-20 20:00:00", "delivered"),
    order(4, "2026-11-20 23:00:00", "cancelled")
  ];
  const queue = buildOrderQueue(rows);
  assert.deepEqual(queue.map((entry) => entry.id), [1, 2]);
});
