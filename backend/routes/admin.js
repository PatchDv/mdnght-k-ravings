import express from "express";
import bcrypt from "bcryptjs";
import { getDb } from "../config/db.js";
import { parseJson, resolveDeliveryFee, isValidMenuPrice } from "../utils/pricing.js";
import { ordersByDay, summarizeRange, periodSummaries, isoShift } from "../utils/profit.js";
import { buildOrderQueue } from "../utils/orderQueue.js";
import { getBestSellers } from "./menu.js";
import { env } from "../config/env.js";
import { rateLimit, rateLimitReserve, rateLimitRemaining, clientIp } from "../utils/security.js";
import { auditAdmin } from "../utils/audit.js";
import { statusSmsText } from "../utils/notify.js";
import { sendSms } from "../config/sms.js";
import { normalizePhoneE164 } from "../config/otp.js";
import { BCRYPT_COST, titleCaseName } from "./customers.js";
import { getStoreOpen, setStoreOpen } from "../config/settings.js";
import {
  requireAdmin,
  createAdminSession,
  destroyAdminSession,
  invalidateAdminSessions
} from "../config/adminAuth.js";

const router = express.Router();

// Admin-selectable statuses. Pending is retired (it only survives on legacy
// rows for history) so the API cannot mint new pending orders either.
const ORDER_STATUSES = ["confirmed", "preparing", "delivering", "delivered", "cancelled"];

function serializeItem(item, sold = 0) {
  return {
    id: item.id,
    categoryId: item.category_id,
    categoryName: item.category_name,
    name: item.name,
    description: item.description,
    price: Number(item.price),
    imageKey: item.image_key,
    badge: item.badge || "",
    tags: parseJson(item.tags, []),
    optionGroups: parseJson(item.option_groups, []),
    isAvailable: Boolean(item.is_available),
    isFeatured: Boolean(item.is_featured),
    displayOrder: item.display_order,
    costPrice: Number(item.cost_price || 0),
    sold: Number(sold),
    updatedAt: item.updated_at
  };
}

function serializeOrder(order, items = []) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    customer: `${order.first_name} ${order.last_name}`,
    firstName: order.first_name,
    lastName: order.last_name,
    phone: order.phone,
    barangay: order.barangay,
    address: order.address,
    landmark: order.landmark,
    notes: order.notes,
    paymentMethod: order.payment_method,
    subtotal: Number(order.subtotal),
    deliveryFee: order.delivery_fee_set ? Number(order.delivery_fee) : null,
    deliveryFeeSet: Boolean(order.delivery_fee_set),
    total: Number(order.total),
    status: order.status,
    createdAt: order.created_at,
    // Admin storefront orders are is_demo rows with no customer account.
    isDemo: Boolean(order.is_demo),
    adminTest: Boolean(order.is_demo) && order.customer_id == null,
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

function cleanText(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanOptionGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .filter((group) => group && typeof group === "object" && group.key)
    .map((group) => ({
      key: cleanText(group.key, 40),
      label: cleanText(group.label, 80),
      type: ["flavors", "radio", "checkbox"].includes(group.type) ? group.type : "radio",
      required: Boolean(group.required),
      exact: Boolean(group.exact),
      max: Number(group.max) || undefined,
      included: Number(group.included) || 0,
      extraPrice: Number(group.extraPrice) || 0,
      choices: Array.isArray(group.choices)
        ? group.choices
            .map((choice) => {
              if (typeof choice === "string") return choice.slice(0, 80);
              if (choice && typeof choice === "object" && choice.name) {
                return { name: cleanText(choice.name, 80), price: Number(choice.price) || 0 };
              }
              return null;
            })
            .filter(Boolean)
        : []
    }));
}

async function loadAllItems(db) {
  const rows = await db.all(
    `SELECT mi.*, c.name AS category_name,
            COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN oi.quantity ELSE 0 END), 0) AS sold
       FROM menu_items mi
       JOIN categories c ON c.id = mi.category_id
       LEFT JOIN order_items oi ON oi.menu_item_id = mi.id
       LEFT JOIN orders o ON o.id = oi.order_id
      GROUP BY mi.id
      ORDER BY c.display_order, mi.display_order, mi.id`
  );
  return rows.map((row) => serializeItem(row, row.sold));
}

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Brute-force ceiling for the staff door: 5 failed attempts per 5 minutes
// per IP, then the IP cools down. Correct passwords never consume the cap.
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

router.post("/login", async (req, res) => {
  try {
    const chargeFail = rateLimitReserve({ key: `ip:${clientIp(req)}:adminlogin`, max: LOGIN_MAX_FAILS, windowMs: LOGIN_WINDOW_MS, message: "Too many admin sign-in attempts. Please wait five minutes." });
    const username = cleanText(req.body.username, 80);
    const password = String(req.body.password || "");
    const db = await getDb();
    const admin = await db.get("SELECT * FROM admin_users WHERE username = ?", [username]);

    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      chargeFail();
      await auditAdmin(null, "admin_login_failed", `username=${username}`);
      // Tell the human how much budget is left: a silent countdown to a
      // 5-minute lockout reads as "the door is broken".
      const attemptsLeft = rateLimitRemaining({ key: `ip:${clientIp(req)}:adminlogin`, max: LOGIN_MAX_FAILS, windowMs: LOGIN_WINDOW_MS });
      return res.status(401).json({ success: false, error: "Wrong username or password.", attemptsLeft });
    }
    await auditAdmin({ admin: { id: admin.id, username: admin.username } }, "admin_login", "ok");

    const csrfToken = await createAdminSession(req, res, admin.id);
    res.json({
      success: true,
      data: {
        admin: { id: admin.id, username: admin.username, name: admin.display_name },
        csrfToken
      }
    });
  } catch (error) {
    if (error.status === 429) return res.status(429).json({ success: false, error: error.message, retryAfter: error.retryAfter });
    console.error("Admin login failed:", error);
    res.status(500).json({ success: false, error: "Could not sign you in right now." });
  }
});

router.post("/logout", async (req, res) => {
  try {
    await destroyAdminSession(req, res);
    res.json({ success: true, data: { signedOut: true } });
  } catch {
    res.status(500).json({ success: false, error: "Could not sign you out." });
  }
});

router.get("/overview", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const totals = await db.get(
      `SELECT
        COUNT(*) AS orders,
        COALESCE(SUM(total), 0) AS revenue,
        COALESCE(AVG(total), 0) AS average
       FROM orders
       WHERE status != 'cancelled'
         AND CASE WHEN @mode = 'real' THEN is_demo = 0 WHEN @mode = 'demo' THEN is_demo = 1 ELSE 1 END
       ;`,
      { "@mode": req.query.mode === "demo" ? "demo" : req.query.mode === "real" ? "real" : "all" }
    );
    const pending = await db.get(
      "SELECT COUNT(*) AS count FROM orders WHERE status IN ('pending', 'confirmed', 'preparing', 'delivering') AND customer_id IS NOT NULL"
    );
    const menuCount = await db.get("SELECT COUNT(*) AS count FROM menu_items WHERE is_available = 1");
    const bestSellers = await getBestSellers(db, 5);

    const recentRows = await db.all(
      "SELECT * FROM orders ORDER BY datetime(created_at) DESC LIMIT 7"
    );
    const recentOrders = [];
    for (const order of recentRows) {
      const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", [order.id]);
      recentOrders.push(serializeOrder(order, items));
    }

    const salesRows = await db.all(
      `SELECT date(created_at) AS day, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
         FROM orders
        WHERE status != 'cancelled' AND date(created_at) >= date('now', '-6 days')
        GROUP BY date(created_at)`
    );
    const salesMap = new Map(salesRows.map((row) => [row.day, row]));
    const salesByDay = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date();
      day.setDate(day.getDate() - offset);
      const key = toLocalDateKey(day);
      const row = salesMap.get(key);
      salesByDay.push({
        date: key,
        label: day.toLocaleDateString("en-PH", { weekday: "short" }),
        revenue: Number(row?.revenue || 0),
        orders: Number(row?.orders || 0)
      });
    }

    res.json({
      success: true,
      data: {
        stats: {
          revenue: Number(totals.revenue),
          orders: Number(totals.orders),
          average: Number(totals.average),
          activeOrders: Number(pending.count),
          menuCount: Number(menuCount.count),
          bestSeller: bestSellers[0] || null
        },
        bestSellers,
        recentOrders,
        salesByDay
      }
    });
  } catch (error) {
    console.error("Admin overview failed:", error);
    res.status(500).json({ success: false, error: "Could not load insights." });
  }
});

router.get("/menu", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const categories = await db.all("SELECT * FROM categories ORDER BY display_order, id");
    const items = await loadAllItems(db);
    res.json({ success: true, data: { categories, items } });
  } catch (error) {
    console.error("Admin menu load failed:", error);
    res.status(500).json({ success: false, error: "Could not load the menu." });
  }
});

router.post("/menu", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const name = cleanText(req.body.name, 120);
    const description = cleanText(req.body.description, 400);
    const price = Number(req.body.price);
    const categoryId = Number(req.body.categoryId);
    const imageKey = cleanText(req.body.imageKey, 200) || "flavored-wings";
    const badge = cleanText(req.body.badge, 40);
    const tags = Array.isArray(req.body.tags)
      ? req.body.tags.map((tag) => cleanText(tag, 40)).filter(Boolean)
      : cleanText(req.body.tags, 300).split(",").map((tag) => tag.trim()).filter(Boolean);
    const optionGroups = cleanOptionGroups(req.body.optionGroups);

    if (!name) return res.status(400).json({ success: false, error: "The dish needs a name." });
    if (!isValidMenuPrice(price)) {
      return res.status(400).json({ success: false, error: "Enter a price between ₱1 and ₱100,000." });
    }
    const category = await db.get("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if (!category) return res.status(400).json({ success: false, error: "Choose a menu section." });

    const nextOrder = await db.get(
      "SELECT COALESCE(MAX(display_order), 0) + 1 AS next FROM menu_items WHERE category_id = ?",
      [categoryId]
    );

    const result = await db.run(
      `INSERT INTO menu_items
        (category_id, name, description, price, image_key, badge, tags, option_groups,
         is_available, is_featured, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryId,
        name,
        description,
        price,
        imageKey,
        badge,
        JSON.stringify(tags),
        JSON.stringify(optionGroups),
        req.body.isAvailable === false ? 0 : 1,
        req.body.isFeatured ? 1 : 0,
        nextOrder.next
      ]
    );

    const item = await db.get(
      `SELECT mi.*, c.name AS category_name FROM menu_items mi
       JOIN categories c ON c.id = mi.category_id WHERE mi.id = ?`,
      [result.lastID]
    );
    await auditAdmin(req, "menu_create", `id=${result.lastID} name=${name} price=${price}`);
    res.status(201).json({ success: true, data: serializeItem(item) });
  } catch (error) {
    console.error("Add dish failed:", error);
    res.status(500).json({ success: false, error: "Could not add that dish." });
  }
});

router.put("/menu/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const existing = await db.get("SELECT * FROM menu_items WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ success: false, error: "Dish not found." });

    const name = cleanText(req.body.name, 120);
    const description = cleanText(req.body.description, 400);
    const price = Number(req.body.price);
    const categoryId = Number(req.body.categoryId);
    const imageKey = cleanText(req.body.imageKey, 200) || existing.image_key;
    const badge = cleanText(req.body.badge, 40);
    const tags = Array.isArray(req.body.tags)
      ? req.body.tags.map((tag) => cleanText(tag, 40)).filter(Boolean)
      : cleanText(req.body.tags, 300).split(",").map((tag) => tag.trim()).filter(Boolean);
    const optionGroups = cleanOptionGroups(req.body.optionGroups);

    if (!name) return res.status(400).json({ success: false, error: "The dish needs a name." });
    if (!isValidMenuPrice(price)) {
      return res.status(400).json({ success: false, error: "Enter a price between ₱1 and ₱100,000." });
    }
    const category = await db.get("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if (!category) return res.status(400).json({ success: false, error: "Choose a menu section." });

    await db.run(
      `UPDATE menu_items SET
        category_id = ?, name = ?, description = ?, price = ?, image_key = ?,
        badge = ?, tags = ?, option_groups = ?, is_available = ?, is_featured = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        categoryId,
        name,
        description,
        price,
        imageKey,
        badge,
        JSON.stringify(tags),
        JSON.stringify(optionGroups),
        req.body.isAvailable === false ? 0 : 1,
        req.body.isFeatured ? 1 : 0,
        id
      ]
    );

    const item = await db.get(
      `SELECT mi.*, c.name AS category_name FROM menu_items mi
       JOIN categories c ON c.id = mi.category_id WHERE mi.id = ?`,
      [id]
    );
    await auditAdmin(req, "menu_update", `id=${id} name=${name} price=${price}`);
    res.json({ success: true, data: serializeItem(item) });
  } catch (error) {
    console.error("Update dish failed:", error);
    res.status(500).json({ success: false, error: "Could not update that dish." });
  }
});

router.delete("/menu/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const existing = await db.get("SELECT id, name FROM menu_items WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ success: false, error: "Dish not found." });

    const used = await db.get(
      "SELECT COUNT(*) AS count FROM order_items WHERE menu_item_id = ?",
      [id]
    );

    if (Number(used.count) > 0) {
      await db.run(
        "UPDATE menu_items SET is_available = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [id]
      );
      return res.json({
        success: true,
        data: {
          id,
          deleted: false,
          archived: true,
          message: "Removed from the storefront. Past orders keep their record."
        }
      });
    }

    await db.run("DELETE FROM menu_items WHERE id = ?", [id]);
    await auditAdmin(req, "menu_delete", `id=${id} name=${existing.name}`);
    res.json({
      success: true,
      data: { id, deleted: true, archived: false, message: "Dish removed from the menu." }
    });
  } catch (error) {
    console.error("Delete dish failed:", error);
    res.status(500).json({ success: false, error: "Could not remove that dish." });
  }
});

router.patch("/menu/:id/availability", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const available = Boolean(req.body.isAvailable);
    const result = await db.run(
      "UPDATE menu_items SET is_available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [available ? 1 : 0, id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: "Dish not found." });
    }
    await auditAdmin(req, "availability", `id=${id} isAvailable=${available}`);
    res.json({ success: true, data: { id, isAvailable: available } });
  } catch (error) {
    res.status(500).json({ success: false, error: "Could not update availability." });
  }
});

router.get("/orders", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all("SELECT * FROM orders ORDER BY datetime(created_at) DESC LIMIT 200");
    const orders = [];
    for (const order of rows) {
      const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", [order.id]);
      orders.push(serializeOrder(order, items));
    }
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Admin orders failed:", error);
    res.status(500).json({ success: false, error: "Could not load orders." });
  }
});

// Explicit FIFO kitchen queue: the oldest working order is always the head.
// Read-only sibling of /orders; the existing response there stays an array.
router.get("/orders-queue", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all("SELECT * FROM orders");
    const counts = await db.all(
      "SELECT order_id, SUM(quantity) AS items FROM order_items GROUP BY order_id"
    );
    const itemsByOrder = new Map(counts.map((row) => [row.order_id, Number(row.items)]));
    const now = Date.now();
    const queue = buildOrderQueue(rows).map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      customer: `${order.first_name} ${order.last_name}`,
      status: order.status,
      itemCount: itemsByOrder.get(order.id) || 0,
      createdAt: order.created_at,
      ageMinutes: Math.max(0, Math.round((now - Date.parse(order.created_at)) / 60000))
    }));
    res.json({ success: true, data: { nextUp: queue[0] || null, queue } });
  } catch (error) {
    console.error("Order queue failed:", error);
    res.status(500).json({ success: false, error: "Could not load the order queue." });
  }
});

// Move one order's status forward (or back). The customer gets an SMS heads-up
// fire-and-forget: a gateway failure never blocks the admin's own update.
router.patch("/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const status = String(req.body.status || "");
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: "That order status is not valid." });
    }
    const result = await db.run(
      "UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status, id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: "Order not found." });
    }
    const order = await db.get("SELECT * FROM orders WHERE id = ?", [id]);
    const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", [id]);
    await auditAdmin(req, "order_status", `order=${order.order_number} status=${status}`);

    const to = normalizePhoneE164(order.phone);
    if (to) {
      sendSms(to, statusSmsText(order.order_number, status)).catch((error) => {
        console.error("Status SMS failed:", error.message);
      });
    }

    res.json({ success: true, data: serializeOrder(order, items) });
  } catch (error) {
    res.status(500).json({ success: false, error: "Could not update the order." });
  }
});

// Quote (or re-quote) one order's delivery fee. Options are fixed at ₱10/15/20
// and orders of ₱400+ are always free. Saving the fee recalculates the total
// the customer sees on their receipt.
router.patch("/orders/:id/delivery-fee", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const order = await db.get("SELECT * FROM orders WHERE id = ?", [id]);
    if (!order) return res.status(404).json({ success: false, error: "Order not found." });

    const resolved = resolveDeliveryFee(order.subtotal, req.body.deliveryFee);
    if (!resolved.ok) {
      return res.status(400).json({ success: false, error: resolved.error });
    }
    const { fee } = resolved;
    const total = Math.round((Number(order.subtotal) + fee) * 100) / 100;
    await db.run(
      "UPDATE orders SET delivery_fee = ?, delivery_fee_set = 1, total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [fee, total, id]
    );
    await auditAdmin(req, "order_delivery_fee", `order=${order.order_number} fee=${fee}`);

    const updated = await db.get("SELECT * FROM orders WHERE id = ?", [id]);
    const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", [id]);
    res.json({ success: true, data: serializeOrder(updated, items) });
  } catch (error) {
    console.error("Delivery fee update failed:", error);
    res.status(500).json({ success: false, error: "Could not save the delivery fee." });
  }
});

// The admin board can hand the storefront a "Back to Admin" door. The secret
// path only ever reaches a browser that already holds a valid admin session —
// the storefront page itself never contains it.
router.get("/door", requireAdmin, (req, res) => {
  res.json({ success: true, data: { path: env.adminPath } });
});

// Store status is the only store-wide admin setting.
router.get("/settings", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, data: { storeOpen: await getStoreOpen() } });
  } catch {
    res.status(500).json({ success: false, error: "Could not load settings." });
  }
});

router.put("/settings", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body.storeOpen === "boolean") {
      await setStoreOpen(body.storeOpen);
      await auditAdmin(req, "store_status", body.storeOpen ? "open" : "closed");
    }
    res.json({ success: true, data: { storeOpen: await getStoreOpen() } });
  } catch {
    res.status(500).json({ success: false, error: "Could not save settings." });
  }
});

router.get("/account", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const admin = await db.get(
      "SELECT id, username, display_name, datetime(created_at) AS created_at FROM admin_users WHERE id = ?",
      [req.admin.id]
    );
    if (!admin) return res.status(404).json({ success: false, error: "Account not found." });
    res.json({ success: true, data: { id: admin.id, username: admin.username, name: admin.display_name, createdAt: admin.created_at } });
  } catch {
    res.status(500).json({ success: false, error: "Could not load the account." });
  }
});

// Update display name and/or change password. Password change requires the
// current password.
router.put("/account", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const admin = await db.get("SELECT * FROM admin_users WHERE id = ?", [req.admin.id]);
    if (!admin) return res.status(404).json({ success: false, error: "Account not found." });

    const name = cleanText(req.body.name, 80) || admin.display_name;
    const updates = { display_name: name };
    let passwordChange = null;

    if (req.body.currentPassword || req.body.newPassword) {
      const current = String(req.body.currentPassword || "");
      const next = String(req.body.newPassword || "");
      if (!(await bcrypt.compare(current, admin.password_hash))) {
        return res.status(400).json({ success: false, error: "Your current password is not correct." });
      }
      if (next.length < 8) {
        return res.status(400).json({ success: false, error: "Use at least 8 characters for the new password." });
      }
      if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) {
        return res.status(400).json({ success: false, error: "Your password needs at least one letter and one number." });
      }
      passwordChange = await bcrypt.hash(next, BCRYPT_COST);
    }

    await db.run(
      "UPDATE admin_users SET display_name = ?, password_hash = ? WHERE id = ?",
      [updates.display_name, passwordChange ?? admin.password_hash, admin.id]
    );

    await auditAdmin(req, "admin_account", passwordChange ? "password_changed" : "name_changed");
    let csrfToken;
    if (passwordChange) {
      // Changing the password ends every old session, including any stolen
      // cookie, then signs this browser back in.
      await invalidateAdminSessions(admin.id);
      csrfToken = await createAdminSession(req, res, admin.id);
    }
    res.json({
      success: true,
      data: { name, ...(csrfToken ? { csrfToken } : {}) },
      passwordChanged: Boolean(passwordChange)
    });
  } catch (error) {
    console.error("Admin account update failed:", error);
    res.status(500).json({ success: false, error: "Could not save the account." });
  }
});

/* -------------------------------------------------------------------------
   PROFIT ANALYTICS — delivered orders only, demo data separable by is_demo
   ------------------------------------------------------------------------- */

const DELIVERED_STATUSES = ["delivered", "completed"];

const analyticsModeClause = (mode) =>
  mode === "demo" ? "AND o.is_demo = 1" : mode === "real" ? "AND o.is_demo = 0" : "";

const expensesModeClause = (mode) =>
  mode === "demo" ? "AND is_demo = 1" : mode === "real" ? "AND is_demo = 0" : "";

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  // server-local day, matching the SQLite date() day business runs on
  return `${y}-${m}-${String(date.getDate()).padStart(2, "0")}`;
}

router.get("/analytics", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const mode = req.query.mode === "demo" ? "demo" : req.query.mode === "real" ? "real" : "all";
    const todayIso = localDateKey();

    const orderRows = await db.all(
      `SELECT date(o.created_at) AS day,
              o.total AS total,
              COALESCE(SUM(oi.quantity * COALESCE(mi.cost_price, 0)), 0) AS productCost,
              MAX(CASE WHEN COALESCE(mi.cost_price, 0) <= 0 THEN 1 ELSE 0 END) AS costMissing
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
        WHERE o.status IN ('delivered', 'completed') ${analyticsModeClause(mode)}
        GROUP BY o.id`
    );
    const dayMap = ordersByDay(orderRows);

    const expenseRows = await db.all(
      `SELECT spent_on AS day, SUM(amount) AS amount
         FROM expenses
        WHERE 1 = 1 ${expensesModeClause(mode)}
        GROUP BY spent_on`
    );
    const expenseMap = new Map(expenseRows.map((row) => [row.day, Number(row.amount)]));

    let { from, to } = req.query;
    // The profit section only ever shows the most recent 14 days — clamp
    // anything broader so no monthly/yearly data leaks in.
    const earliest = isoShift(todayIso, -13);
    const freeFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(from || "")) ? String(from) : earliest;
    const freeTo = /^\d{4}-\d{2}-\d{2}$/.test(String(to || "")) ? String(to) : todayIso;
    if (freeFrom > freeTo) [from, to] = [freeTo, freeFrom]; else [from, to] = [freeFrom, freeTo];
    if (from < earliest) from = earliest;
    if (to > todayIso) to = todayIso;

    res.json({
      success: true,
      data: {
        mode,
        todayIso,
        cards: periodSummaries(dayMap, expenseMap, todayIso),
        range: { from, to, ...summarizeRange(dayMap, expenseMap, from, to) }
      }
    });
  } catch (error) {
    console.error("Analytics failed:", error);
    res.status(500).json({ success: false, error: "Could not load the profit analytics." });
  }
});

// Menu item product cost (editable in the dashboard)
router.put("/menu/:id/cost", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const cost = Number(req.body.costPrice);
    if (!Number.isFinite(cost) || cost < 0 || cost > 100000) {
      return res.status(400).json({ success: false, error: "Enter a product cost between 0 and 100000." });
    }
    const result = await db.run("UPDATE menu_items SET cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      Math.round(cost * 100) / 100,
      req.params.id
    ]);
    if (!result.changes) return res.status(404).json({ success: false, error: "Menu item not found." });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: "Could not save the product cost." });
  }
});

// Business expenses (list/create/delete)
router.get("/expenses", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const mode = req.query.mode === "demo" ? "demo" : req.query.mode === "real" ? "real" : "all";
    const rows = await db.all(
      `SELECT id, label, amount, spent_on AS spentOn, is_demo AS isDemo
         FROM expenses
        WHERE 1 = 1 ${expensesModeClause(mode)}
        ORDER BY spent_on DESC, id DESC
        LIMIT 200`
    );
    res.json({ success: true, data: rows.map((row) => ({ ...row, amount: Number(row.amount), isDemo: Boolean(row.isDemo) })) });
  } catch {
    res.status(500).json({ success: false, error: "Could not load the expenses." });
  }
});

router.post("/expenses", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const label = String(req.body.label || "").trim().slice(0, 120);
    const amount = Number(req.body.amount);
    const spentOn = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.spentOn || "")) ? String(req.body.spentOn) : localDateKey();
    if (!label) return res.status(400).json({ success: false, error: "Give the expense a name." });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ success: false, error: "Enter an expense amount between 1 and 1000000." });
    }
    const result = await db.run(
      "INSERT INTO expenses (label, amount, spent_on, is_demo) VALUES (?, ?, ?, 0)",
      [label, amount, spentOn]
    );
    await auditAdmin(req, "expense_add", `id=${result.lastID} amount=${amount}`);
    res.json({ success: true, data: { id: result.lastID, label, amount, spentOn, isDemo: false } });
  } catch {
    res.status(500).json({ success: false, error: "Could not save the expense." });
  }
});

router.delete("/expenses/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.run("DELETE FROM expenses WHERE id = ?", [req.params.id]);
    if (!result.changes) return res.status(404).json({ success: false, error: "Expense not found." });
    await auditAdmin(req, "expense_delete", `id=${req.params.id}`);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: "Could not delete the expense." });
  }
});

/* ------------------------------------------------------------------------- */
/* DEMO DATA — clearly labelled sample records for the profit dashboard.      */
/* Generated from real menu prices, never random hardcoded profit numbers.   */
/* ------------------------------------------------------------------------- */

const DEMO_PEOPLE = [
  { first: "Ana", last: "Reyes" },
  { first: "Ben", last: "Santos" },
  { first: "Cielo", last: "Garcia" },
  { first: "Dio", last: "Mendoza" },
  { first: "Eka", last: "Tolentino" }
];

// Small family-run gas refill; stable price.
const DEMO_EXPENSES = [
  { label: "Cooking gas refill (11kg)", amount: 780, cycle: 7 },
  { label: "Motorcycle fuel for deliveries", amount: 320, cycle: 5 },
  { label: "Packaging, cups & sauce containers", amount: 540, cycle: 10 },
  { label: "Ingredients restock run (market)", amount: 1250, cycle: 12 }
];

function demoWobble(seed) {
  // Deterministic so repeated seeds look identical; no truly random noise.
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

router.post("/seed-demo", requireAdmin, async (req, res) => {
    // Demo rows would pollute real business data; keep them out of production.
    if (env.isProd) {
      return res.status(403).json({ success: false, error: "Demo data is disabled in production." });
    }
  try {
    const db = await getDb();
    const todayIso = localDateKey();

    if (req.body.reset) await db.run("DELETE FROM orders WHERE is_demo = 1");

    const already = await db.get("SELECT COUNT(*) AS count FROM orders WHERE is_demo = 1");
    if (already.count) {
      return res.status(409).json({ success: false, error: "Demo data already exists. Use reset to reseed." });
    }

    // Product costs apply to real items too — fill only where still unknown,
    // and leave two items at 0 so the dashboard can demo "estimated" labelling.
    const items = await db.all("SELECT id, name, price, cost_price FROM menu_items ORDER BY id");
    if (!items.length) return res.status(400).json({ success: false, error: "Seed the menu first." });
    for (const item of items) {
      if (Number(item.cost_price) > 0) continue;
      const wobble = 0.5 + demoWobble(item.id) * 0.2;
      await db.run(
        "UPDATE menu_items SET cost_price = ROUND(price * ?, 0) WHERE id = ?",
        [wobble, item.id]
      );
    }
    const zeroCostIds = items.slice(0, 2).map((item) => item.id);
    if (zeroCostIds.length) {
      await db.run(`UPDATE menu_items SET cost_price = 0 WHERE id IN (${zeroCostIds.map(() => "?").join(",")})`, zeroCostIds);
    }

    // Demo customers: clearly named accounts with the same shape as real ones.
    const demoCustomers = [];
    for (const [index, person] of DEMO_PEOPLE.entries()) {
      const username = `demo${index + 1}`;
      const phone = `0999000000${index + 1}`;
      let row = await db.get("SELECT id FROM customers WHERE username = ?", [username]);
      if (!row) {
        const hash = await bcrypt.hash("demo12345", 10);
        const result = await db.run(
          `INSERT INTO customers (username, password_hash, first_name, last_name, phone, barangay)
           VALUES (?, ?, ?, ?, ?, 'Madapdap')`,
          [
            username,
            hash,
            `DEMO ${person.first}`,
            person.last,
            phone
          ]
        );
        row = { id: result.lastID };
      }
      demoCustomers.push({ ...person, id: row.id, phone });
    }

    // Orders spread over the past 35 days, delivered, realistic baskets.
    let orderNumberSeq = 1;
    for (let dayOffset = 35; dayOffset >= 0; dayOffset -= 1) {
      const dayKey = isoShift(todayIso, -dayOffset);
      const busy = demoWobble(dayOffset * 3.7) > 0.45 ? 2 : demoWobble(dayOffset * 5.1) > 0.25 ? 1 : 0;
      for (let o = 0; o < busy; o += 1) {
        const person = demoCustomers[Math.floor(demoWobble(dayOffset * 7.3 + o) * demoCustomers.length)];
        const hour = 20 + Math.floor(demoWobble(dayOffset * 9.1 + o) * 4); // 20:00–23:00, late-night kitchen
        const createdAt = `${dayKey} ${String(hour).padStart(2, "0")}:${String(Math.floor(demoWobble(dayOffset * 11.7 + o) * 60)).padStart(2, "0")}:00`;

        let subtotal = 0;
        const lines = [];
        const lineCount = 1 + Math.floor(demoWobble(dayOffset * 13.9 + o) * 3);
        for (let l = 0; l < lineCount; l += 1) {
          const item = items[Math.floor(demoWobble(dayOffset * 17.3 + o * 5 + l) * items.length)];
          const qty = 1 + Math.floor(demoWobble(dayOffset * 23.1 + o * 7 + l) * 2);
          const lineTotal = Math.round(Number(item.price) * 100) / 100 * qty;
          subtotal += lineTotal;
          lines.push({ item, qty, lineTotal });
        }
        subtotal = Math.round(subtotal * 100) / 100;
        // Historical demo rows have a final fee; no store-wide estimate.
        const deliveryFee = 0;
        const total = subtotal;

        const order = await db.run(
          `INSERT INTO orders
             (order_number, first_name, last_name, phone, barangay, address, payment_method,
              subtotal, delivery_fee, delivery_fee_set, total, status, created_at, updated_at, customer_id, is_demo)
           VALUES (?, ?, ?, ?, 'Madapdap', ?, ?, ?, ?, 1, ?, 'delivered', ?, ?, ?, 1)`,
          [
            `MK-DEMO-${String(orderNumberSeq).padStart(5, "0")}`,
            `DEMO ${person.first}`,
            person.last,
            person.phone,
            person.address || "Demo residence, Purok 1, Madapdap",
            demoWobble(orderNumberSeq) > 0.3 ? "cash" : "gcash",
            subtotal,
            deliveryFee,
            total,
            createdAt,
            createdAt,
            person.id
          ]
        );
        orderNumberSeq += 1;

        for (const line of lines) {
          await db.run(
            `INSERT INTO order_items (order_id, menu_item_id, name, unit_price, quantity, line_total)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [order.lastID, line.item.id, line.item.name, line.item.price, line.qty, line.lineTotal]
          );
        }
      }
    }

    // Recurring expenses, kept separate from real spend with is_demo.
    for (const expense of DEMO_EXPENSES) {
      for (let dayOffset = 35; dayOffset >= 0; dayOffset -= expense.cycle) {
        const dayKey = isoShift(todayIso, -dayOffset);
        await db.run(
          "INSERT INTO expenses (label, amount, spent_on, is_demo) VALUES (?, ?, ?, 1)",
          [expense.label, expense.amount, dayKey]
        );
      }
    }

    const count = await db.get("SELECT COUNT(*) AS count FROM orders WHERE is_demo = 1");
    res.json({ success: true, data: { demoOrders: count.count } });
  } catch (error) {
    console.error("Demo seed failed:", error);
    res.status(500).json({ success: false, error: "Could not seed the demo data." });
  }
});

router.delete("/seed-demo", requireAdmin, async (req, res) => {
  try {
    if (env.isProd) {
      return res.status(403).json({ success: false, error: "Demo data is disabled in production." });
    }
    const db = await getDb();
    await db.run("DELETE FROM orders WHERE is_demo = 1");
    await db.run("DELETE FROM expenses WHERE is_demo = 1");
    await db.run("DELETE FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)");
    await auditAdmin(req, "demo_cleared", "");
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: "Could not clear the demo data." });
  }
});


// Customer records built from actual orders - one row per phone number, with
// each customer's delivered revenue and last order date.
router.get("/customers", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const mode = req.query.mode === "demo" ? "demo" : req.query.mode === "real" ? "real" : "all";
    const rows = await db.all(
      `SELECT o.phone,
              MAX(o.customer_id) AS customerId,
              MAX(o.first_name || ' ' || o.last_name) AS name,
              MAX(o.barangay) AS barangay,
              COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN o.status IN ('delivered', 'completed') THEN o.total ELSE 0 END), 0) AS deliveredRevenue,
              SUM(CASE WHEN o.status IN ('pending', 'confirmed', 'preparing', 'delivering') THEN 1 ELSE 0 END) AS openOrders,
              MAX(date(o.created_at)) AS lastOrder
         FROM orders o
        WHERE customer_id IS NOT NULL ${analyticsModeClause(mode)}
        GROUP BY o.phone
        ORDER BY lastOrder DESC`
    );
    res.json({
      success: true,
      data: rows.map((row) => ({
        phone: row.phone,
        customerId: row.customerId,
        name: titleCaseName(row.name),
        barangay: row.barangay,
        orders: Number(row.orders),
        deliveredRevenue: Number(row.deliveredRevenue),
        openOrders: Number(row.openOrders),
        lastOrder: row.lastOrder
      }))
    });
  } catch (error) {
    console.error("Customers load failed:", error);
    res.status(500).json({ success: false, error: "Could not load the customer records." });
  }
});

// Anonymizing delete: the account row goes away, every order stays as
// revenue history with customer_id cleared (which also drops the record
// from the phone-grouped Customers view). The password hash never leaves
// the row — the row is what dies — and the customer's signed-in JWTs die
// with it, because the token lookup by id finds nothing. The audit line is
// written here so the DB change and its record land together and stay
// testable without HTTP.
export async function deleteCustomerRecord(db, id, actor = null) {
  const customer = await db.get(
    "SELECT id, username, first_name, last_name, phone FROM customers WHERE id = ?",
    [id]
  );
  if (!customer) return null;
  const counted = await db.get("SELECT COUNT(*) AS count FROM orders WHERE customer_id = ?", [id]);
  await db.run("UPDATE orders SET customer_id = NULL WHERE customer_id = ?", [id]);
  await db.run("DELETE FROM customers WHERE id = ?", [id]);
  await db.run(
    "INSERT INTO admin_audit (admin_id, username, action, detail) VALUES (?, ?, ?, ?)",
    [actor?.id ?? null, actor?.username ?? "", "customer_delete",
     `id=${id} username=${customer.username} orders_kept=${counted.count}`]
  );
  return { customer, ordersKept: Number(counted.count) };
}

router.delete("/customers/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: "Invalid customer id." });
    }
    const db = await getDb();
    const result = await deleteCustomerRecord(db, id, req.admin);
    if (!result) return res.status(404).json({ success: false, error: "Customer not found." });
    res.json({ success: true, data: { id, deleted: true, ordersKept: result.ordersKept } });
  } catch (error) {
    console.error("Customer delete failed:", error);
    res.status(500).json({ success: false, error: "Could not remove that customer." });
  }
});

export default router;
