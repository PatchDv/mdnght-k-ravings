import express from "express";
import { getDb } from "../config/db.js";
import { calculateItemPricing } from "../utils/pricing.js";
import { verifyCustomerToken } from "../config/auth.js";
import { readAdminSession, readAdminShopper, saveAdminShopper } from "../config/adminAuth.js";
import { env } from "../config/env.js";
import { getStoreOpen } from "../config/settings.js";
import { rateLimit, clientIp } from "../utils/security.js";

const router = express.Router();

function cleanText(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function phoneDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function createOrderNumber() {
  const stamp = Date.now().toString().slice(-7);
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `MK-${stamp}-${suffix}`;
}

async function loadOrder(db, orderNumber) {
  const order = await db.get("SELECT * FROM orders WHERE order_number = ?", [orderNumber]);
  if (!order) return null;
  const items = await db.all("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", [order.id]);
  return {
    id: order.id,
    orderNumber: order.order_number,
    customerId: order.customer_id,
    firstName: order.first_name,
    lastName: order.last_name,
    phone: order.phone,
    barangay: order.barangay,
    address: order.address,
    landmark: order.landmark,
    notes: order.notes,
    paymentMethod: order.payment_method,
    subtotal: Number(order.subtotal),
    // Until the admin quotes it, the fee is unknown — null, not a fake ₱0.
    deliveryFee: order.delivery_fee_set ? Number(order.delivery_fee) : null,
    deliveryFeeSet: Boolean(order.delivery_fee_set),
    total: Number(order.total),
    status: order.status,
    createdAt: order.created_at,
    estimatedMinutes: 35,
    isDemo: Boolean(order.is_demo),
    items: items.map((item) => ({
      id: item.id,
      menuItemId: item.menu_item_id,
      name: item.name,
      unitPrice: Number(item.unit_price),
      quantity: item.quantity,
      optionsText: item.options_text,
      lineTotal: Number(item.line_total)
    }))
  };
}

router.post("/", async (req, res) => {
  const db = await getDb();
  let transactionOpen = false;

  try {
    // Two identities can order: a signed-in customer, or the admin's own
    // httpOnly session (storefront preview). Admin orders are is_demo rows with
    // no customer_id, so the board can separate them from real orders.
    const authHeader = req.headers.authorization || "";
    const decoded = authHeader.startsWith("Bearer ") ? verifyCustomerToken(authHeader.slice(7)) : null;
    let customer = null;
    let adminShopper = null;
    if (decoded && decoded.role === "customer") {
      // Abuse ceiling for order spamming; one account/IP, ten orders per 10 min.
      rateLimit({ key: `order:${clientIp(req)}:${decoded.id}`, max: 10, windowMs: 10 * 60 * 1000, message: "Too many orders placed recently. Please slow down." });
      // Personal details come ONLY from the customer's DB row — the browser's
      // copy is never trusted, so nobody can order under someone else's info.
      customer = await db.get(
        "SELECT id, token_version, first_name, last_name, phone, barangay, address, landmark FROM customers WHERE id = ?",
        [decoded.id]
      );
      if (!customer || Number(customer.token_version) !== Number(decoded.version || 0)) {
        return res.status(401).json({ success: false, error: "Your session expired. Please sign in again." });
      }
    } else {
      const admin = await readAdminSession(req);
      if (!admin) {
        return res.status(401).json({ success: false, error: "Please sign in before ordering." });
      }
      rateLimit({ key: `order:${clientIp(req)}:admin:${admin.id}`, max: 10, windowMs: 10 * 60 * 1000, message: "Too many orders placed recently. Please slow down." });
      adminShopper = await readAdminShopper(admin);
    }

    // The owner can close the kitchen at any moment; re-checked right here so
    // a customer mid-checkout can't slip an order past the closed sign.
    if (!(await getStoreOpen())) {
      return res.status(403).json({ success: false, error: "The store is currently closed. Ordering is unavailable right now." });
    }

    const details = customer || adminShopper.profile;
    const firstName = customer ? details.first_name : details.firstName;
    const lastName = customer ? details.last_name : details.lastName;
    const phone = details.phone || "";
    // Admin preview orders are tests: they may have no delivery address at
    // all. Customers still must provide one (checked below).
    const barangay = customer ? (details.barangay || "") : (details.barangay || "Madapdap");
    const address = customer ? (details.address || "") : (details.address || "Admin test order — no delivery address");
    const landmark = details.landmark || "";
    const notes = cleanText(req.body.notes, 300);
    // COD is the only payment method; anything else the client sends is ignored.
    const paymentMethod = "cash";
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];

    if (customer && address.length < 4) {
      return res.status(400).json({ success: false, error: "Please add your delivery address in your Profile before ordering." });
    }
    if (rawItems.length === 0) {
      return res.status(400).json({ success: false, error: "Your cart is empty." });
    }
    if (rawItems.length > 30) {
      return res.status(400).json({ success: false, error: "That is too many items for one order." });
    }

    const pricedItems = [];
    for (const rawItem of rawItems) {
      const menuItemId = Number(rawItem.menuItemId);
      const quantity = Math.max(1, Math.min(20, Number(rawItem.quantity) || 1));
      if (!Number.isInteger(menuItemId)) {
        return res.status(400).json({ success: false, error: "One of the items is invalid." });
      }

      const item = await db.get(
        "SELECT * FROM menu_items WHERE id = ? AND is_available = 1",
        [menuItemId]
      );
      if (!item) {
        return res.status(400).json({
          success: false,
          error: "One of your items is no longer available. Please refresh your cart."
        });
      }

      let pricing;
      try {
        pricing = calculateItemPricing(item, rawItem.selectedOptions || {});
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: `${item.name}: ${error.message}`
        });
      }

      pricedItems.push({
        menuItemId,
        name: item.name,
        unitPrice: pricing.unitPrice,
        quantity,
        optionsText: pricing.optionsText,
        lineTotal: Math.round(pricing.unitPrice * quantity * 100) / 100
      });
    }

    const subtotal = Math.round(pricedItems.reduce((total, item) => total + item.lineTotal, 0) * 100) / 100;
    // ₱400+ orders are free delivery immediately. Below that the admin quotes
    // ₱10/15/20 after the order arrives, so the fee stays "to be confirmed".
    const freeDelivery = subtotal >= 400;
    const deliveryFee = 0;
    const deliveryFeeSet = freeDelivery ? 1 : 0;
    const total = subtotal;

    await db.run("BEGIN");
    transactionOpen = true;
    const orderNumber = createOrderNumber();

    const result = await db.run(
      `INSERT INTO orders
        (order_number, first_name, last_name, phone, barangay, address, landmark, notes,
         payment_method, subtotal, delivery_fee, delivery_fee_set, total, status, customer_id, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        orderNumber,
        firstName,
        lastName,
        phone,
        barangay,
        address,
        landmark,
        notes,
        paymentMethod,
        subtotal,
        deliveryFee,
        deliveryFeeSet,
        total,
        customer ? customer.id : null,
        customer ? 0 : 1
      ]
    );

    for (const item of pricedItems) {
      await db.run(
        `INSERT INTO order_items
          (order_id, menu_item_id, name, unit_price, quantity, options_text, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          result.lastID,
          item.menuItemId,
          item.name,
          item.unitPrice,
          item.quantity,
          item.optionsText,
          item.lineTotal
        ]
      );
    }

    await db.run("COMMIT");
    transactionOpen = false;

    // Order placed: this customer's saved cart starts empty next sign-in, and
    // their last delivery spot is remembered for the next checkout. The admin's
    // preview cart clears the same way.
    if (customer) {
      await db.run("UPDATE customers SET cart_json = '[]', address = ?, landmark = ? WHERE id = ?", [
        address,
        landmark,
        customer.id
      ]);
    } else {
      await saveAdminShopper({ cart: [] });
    }

    const order = await loadOrder(db, orderNumber);
    res.status(201).json({ success: true, data: order });
  } catch (error) {
    if (transactionOpen) await db.run("ROLLBACK").catch(() => {});
    console.error("Order failed:", error);
    res.status(500).json({ success: false, error: "We could not place your order. Please try again." });
  }
});

router.get("/:orderNumber", async (req, res) => {
  try {
    const db = await getDb();
    // Throttle lookups: order numbers are short, so guessing them without a
    // rate limit would be a cheap brute force.
    rateLimit({ key: `ordertrack:${clientIp(req)}`, max: 20, windowMs: 5 * 60 * 1000, message: "Too many order lookups. Please wait a few minutes." });
    const order = await loadOrder(db, req.params.orderNumber);
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found." });
    }

    const authHeader = req.headers.authorization || "";
    const decoded = authHeader.startsWith("Bearer ") ? verifyCustomerToken(authHeader.slice(7)) : null;
    const ownsOrder = decoded
      && decoded.role === "customer"
      && order.customerId === decoded.id
      && (await db.get("SELECT id FROM customers WHERE id = ? AND token_version = ?", [decoded.id, decoded.version || 0]));
    // Admin test orders can be reopened from the storefront profile without a
    // phone number, because the admin cookie is the proof of identity.
    const adminPreview = !ownsOrder
      && order.isDemo
      && order.customerId == null
      && Boolean(await readAdminSession(req));

    // Order history contains a name, phone, and address: require either the
    // signed-in owner or the phone number used at checkout.
    if (!ownsOrder && !adminPreview && (!req.query.phone || phoneDigits(req.query.phone) !== phoneDigits(order.phone))) {
      return res.status(403).json({ success: false, error: "That phone number does not match this order." });
    }

    res.json({ success: true, data: { ...order, customerId: undefined } });
  } catch (error) {
    if (error.status === 429) return res.status(429).json({ success: false, error: error.message });
    res.status(500).json({ success: false, error: "Could not load that order." });
  }
});

export default router;
