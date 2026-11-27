import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { getDb } from "../config/db.js";
import { BARANGAYS, normalizeName, barangayAlias } from "../config/location.js";
import { env } from "../config/env.js";
import { signCustomerToken, verifyCustomerToken } from "../config/auth.js";
import { readAdminSession, readAdminShopper, saveAdminShopper } from "../config/adminAuth.js";
import { issueOtp, verifyOtp, normalizePhoneE164, last10Digits } from "../config/otp.js";
import { rateLimit, rateLimitReserve, rateLimitRemaining, clientIp } from "../utils/security.js";

const router = express.Router();
export const BCRYPT_COST = 12;

const COMMON_PASSWORDS = new Set(["password", "password1", "password123", "12345678", "123456789", "qwerty123", "letmein123", "iloveyou111" ]);

export function validatePassword(password) {
  const value = String(password ?? "");
  if (value.length < 8) return "Use at least 8 characters for your password.";
  if (value.length > 12) return "Use 12 characters or fewer for your password.";
  if (COMMON_PASSWORDS.has(value.toLowerCase())) return "That password is too common. Please pick something unique.";
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "Your password needs at least one letter and one number.";
  return "";
}

// Display-quality names: "matt" -> "Matt", "anna mae" -> "Anna Mae",
// "MARIA" -> "Maria". Never applied to passwords, phones or emails.
export function titleCaseName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ""))
    .join(" ");
}


// The storefront accepts two identities: a customer Bearer token, or a valid
// admin cookie. The admin path is read-only from the browser's point of view —
// the httpOnly cookie never leaves the server and never becomes a customer
// token. Admin routes still reject customer tokens (see requireAdmin).
async function resolveShopper(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    const decoded = verifyCustomerToken(header.slice(7));
    if (decoded && decoded.role === "customer" && (await isCurrentCustomerSession(req, decoded))) {
      return { role: "customer", customer: decoded };
    }
    // A dead or forged customer token falls through: a live admin cookie may
    // still be present (storefront preview), otherwise the caller answers 401.
  }
  const admin = await readAdminSession(req);
  return admin ? { role: "admin", admin } : null;
}

function requireCustomer(req, res, next) {
  resolveShopper(req)
    .then((shopper) => {
      if (!shopper) {
        return res.status(401).json({ success: false, error: "Your session expired. Please sign in again." });
      }
      req.shopper = shopper;
      if (shopper.role === "customer") req.customer = shopper.customer;
      next();
    })
    .catch(() => res.status(500).json({ success: false, error: "Something went wrong." }));
}

async function isCurrentCustomerSession(req, decoded) {
  const db = await getDb();
  const row = await db.get("SELECT token_version FROM customers WHERE id = ?", [decoded.id]);
  if (!row) return false;
  return Number(row.token_version) === Number(decoded.version || 0);
}


// Cart lines are client display data — checkout re-prices everything against
// menu_items, so this only guards shape, never trusts prices.
export function sanitizeCartLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 30)
    .map((line, index) => {
      if (!line || typeof line !== "object" || String(line.__removed) === "1") return null;
      const menuItemId = Number(line.menuItemId);
      const quantity = Math.max(1, Math.min(20, Math.floor(Number(line.quantity) || 1)));
      const unitPrice = Number(line.unitPrice);
      if (!Number.isInteger(menuItemId) || menuItemId <= 0) return null;
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
      return {
        key: String(line.key || `line-${menuItemId}-${index}`).slice(0, 120),
        menuItemId,
        name: String(line.name || "Saved craving").slice(0, 120),
        imageKey: String(line.imageKey || "default").slice(0, 80),
        categoryName: String(line.categoryName || "").slice(0, 120),
        basePrice: Number(line.basePrice) || unitPrice,
        unitPrice,
        quantity,
        selectedOptions: line.selectedOptions && typeof line.selectedOptions === "object" ? line.selectedOptions : {},
        optionsText: String(line.optionsText || "").slice(0, 240)
      };
    })
    .filter(Boolean);
}

function serializeCustomer(customer) {
  return {
    id: customer.id,
    username: customer.username,
    // Display-cased on the way out so pre-existing lowercase rows read well.
    firstName: titleCaseName(customer.first_name),
    lastName: titleCaseName(customer.last_name),
    phone: customer.phone,
    barangay: customer.barangay,
    address: customer.address || "",
    landmark: customer.landmark || ""
  };
}

// Old orders were placed before accounts existed. When a customer signs in,
// claim any orphaned orders that match their phone so their history follows
// them. Admin storefront-preview orders (is_demo) and the labelled MK-DEMO
// sample rows are demo data — they stay orphaned no matter whose phone they
// carry, so a real account never inherits test orders into its history.
export async function linkLegacyOrders(db, customer) {
  await db.run(
    "UPDATE orders SET customer_id = ? WHERE customer_id IS NULL AND phone = ? AND is_demo = 0 AND order_number NOT LIKE 'MK-DEMO-%'",
    [customer.id, customer.phone]
  );
}

// Account creation that answers "taken" instead of crashing when the derived
// username collides with a legacy row whose stored phone is written
// differently from its username digits.
export async function insertCustomer(db, account) {
  try {
    return await db.run(
      `INSERT INTO customers (username, password_hash, first_name, last_name, phone, barangay, address, landmark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [account.username, account.passwordHash, account.firstName, account.lastName, account.phone, account.barangay, account.address, account.landmark]
    );
  } catch (error) {
    if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT") || /UNIQUE/i.test(String(error?.message || ""))) {
      return null;
    }
    throw error;
  }
}

/* ---------------------------------------------------------------------------
   Phone OTP verification — the door to registration and password recovery.
   The server decides per phone number whether a verified session may register
   a new account or reset the existing one; the client cannot choose except by
   starting from the right screen.
--------------------------------------------------------------------------- */

// Step 1a: send the code. Response shape never varies with account existence
// ORIGIN of failures, so a reset request against an unknown number looks the
// same as a request against an account (except obvious duplicate-registration).
router.post("/otp/request", async (req, res) => {
  try {
    rateLimit({ key: `ip:${clientIp(req)}:otpreq`, max: 20, windowMs: 10 * 60 * 1000, message: "Too many code requests. Please try again later." });
    const phoneE164 = normalizePhoneE164(req.body.phone || "");
    if (!phoneE164) {
      return res.status(400).json({ success: false, error: "Please enter a valid Philippine mobile number (09… or +639…)." });
    }
    const mode = req.body.mode === "reset" ? "reset" : "register";
    const db = await getDb();
    const existing = await db.get(
      "SELECT id FROM customers WHERE SUBSTR(REPLACE(REPLACE(phone, ' ', ''), '-', ''), -10) = ?",
      [last10Digits(phoneE164)]
    );
    // The phone record decides the true purpose: a verified number can
    // register a NEW account; a known number can reset its password. The
    // client's mode only chooses the screen.
    if (mode === "register" && existing) {
      return res.status(409).json({ success: false, error: "That mobile number already has an account. Please sign in instead." });
    }
    // Reset on an unknown number: identical 200 shape, nothing sent, nothing
    // revealed about which numbers have accounts.
    const purpose = mode === "reset" ? (existing ? "reset" : null) : "register";
    // Whether or not an SMS is possible, dead branches never expose intent... except reset for known number proceeds below.
    if (!purpose) {
      return res.json({ success: true, data: { mode, expiresInSeconds: 300, resendAfter: 60 } });
    }
    const issued = await issueOtp(phoneE164, purpose);
    const data = { mode, expiresInSeconds: issued.expiresInSeconds, resendAfter: issued.resendAfter };
    // Dev visibility only: the console channel, or an explicitly flagged dev
    // machine using the real provider (OTP_TEST_DEBUG). Production never
    // returns a code value.
    if (!env.isProd && (issued.devChannel || env.otpTestDebug)) data.devCode = issued.code;
    res.json({ success: true, data });
  } catch (error) {
    if (error.cooldown) return res.status(429).json({ success: false, error: error.message, retryAfter: error.cooldown });
    if (error.status === 429) return res.status(429).json({ success: false, error: error.message });
    console.error("OTP request failed:", error.message || error);
    res.status(502).json({ success: false, error: "We could not send a verification code right now. Please try again soon." });
  }
});



// Step 1b: verify the code. Emits a short-lived signed step token that proves
// the phone was verified. Registration and reset cannot continue without it,
// and the client cannot choose which flow the token unlocks — the database
// decides (existing number ⇒ reset, unknown number ⇒ register).
router.post("/otp/verify", async (req, res) => {
  try {
    rateLimit({ key: `ip:${clientIp(req)}:otpverify`, max: 30, windowMs: 10 * 60 * 1000, message: "Too many verification attempts. Please try again later." });
    const phoneE164 = normalizePhoneE164(req.body.phone || "");
    const code = String(req.body.code || "").replace(/\D/g, "");
    if (!phoneE164 || code.length !== 6) {
      return res.status(400).json({ success: false, error: "Enter the 6-digit code we sent you." });
    }
    const db = await getDb();
    const existing = await db.get(
      "SELECT * FROM customers WHERE SUBSTR(REPLACE(REPLACE(phone, ' ', ''), '-', ''), -10) = ?",
      [last10Digits(phoneE164)]
    );
    const purpose = existing ? "reset" : "register";
    await verifyOtp(phoneE164, purpose, code);

    const stepToken = jwt.sign(
      { purpose: `${purpose}-phone`, phone: phoneE164 },
      env.customerJwtSecret,
      { expiresIn: purpose === "reset" ? "15m" : "10m" }
    );
    res.json({ success: true, data: { step: purpose, stepToken } });
  } catch (error) {
    if (error.cooldown || error.status === 429) {
      return res.status(429).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message || "That code is not correct or has expired." });
  }
});

// Steps 2–4 (name, password + confirm, barangay) all arrive together but the
// server enforces every rule: phone must verify first, password must pass the
// policy and both fields, barangay must be one we deliver to.
router.post("/register", async (req, res) => {
  // Only successful account creations count against the cap — validation
  // failures must not lock a user out by staff-side hamfistedness.
  try {
    // Reserved inside the try: a tripped limit throws a 429 that the catch
    // below turns into a response instead of an unhandled rejection.
    const chargeRegister = rateLimitReserve({ key: `ip:${clientIp(req)}:register`, max: 5, windowMs: 60 * 60 * 1000, message: "Too many registration attempts. Please try again later." });
    const step = (req.headers.authorization || "").startsWith("Bearer ")
      ? verifyCustomerToken(req.headers.authorization.slice(7))
      : null;
    if (!step || step.purpose !== "register-phone") {
      return res.status(403).json({ success: false, error: "Please verify your mobile number first." });
    }
    const db = await getDb();
    const phoneKey = last10Digits(step.phone);
    const taken = await db.get(
      "SELECT id FROM customers WHERE SUBSTR(REPLACE(REPLACE(phone, ' ', ''), '-', ''), -10) = ?",
      [phoneKey]
    );
    if (taken) {
      return res.status(409).json({ success: false, error: "That mobile number already has an account. Please sign in instead." });
    }

    const firstName = titleCaseName(req.body.firstName).slice(0, 60);
    const lastName = titleCaseName(req.body.lastName).slice(0, 60);
    const password = String(req.body.password || "");
    const confirm = String(req.body.confirmPassword ?? req.body.password ?? "");
    // Barangay is no longer part of registration: the customer types one
    // complete address instead. Kept as "" (the column is NOT NULL) and the
    // checkout barangay picker still serves returning/delivery needs.
    const barangayName = barangayAlias(req.body.barangay);
    const barangay = barangayName ? BARANGAYS.find((name) => normalizeName(name) === barangayName) || "" : "";
    // The wizard's required "Complete Delivery Address" + optional landmark.
    const landmark = String(req.body.landmark || "").trim().slice(0, 120);
    const address = String(req.body.address || "").trim().slice(0, 240);

    if (!firstName || !lastName) {
      return res.status(400).json({ success: false, error: "Add your first and last name." });
    }
    if (!address || address.length < 10) {
      return res.status(400).json({ success: false, error: "Enter your complete delivery address (block, lot, phase, street, barangay)." });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ success: false, error: passwordError });
    }
    if (password !== confirm) {
      return res.status(400).json({ success: false, error: "Those passwords do not match." });
    }

    const username = `cust${phoneKey}`;
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const insert = await insertCustomer(db, {
      username,
      passwordHash,
      firstName,
      lastName,
      phone: step.phone,
      barangay,
      address,
      landmark
    });
    if (!insert) {
      return res.status(409).json({ success: false, error: "That mobile number already has an account. Please sign in instead." });
    }
    const customer = await db.get("SELECT * FROM customers WHERE id = ?", [insert.lastID]);
    chargeRegister();

    const token = signCustomerToken(customer);
    await linkLegacyOrders(db, customer);

    res.status(201).json({
      success: true,
      data: { token, profile: serializeCustomer(customer), cart: [] }
    });
  } catch (error) {
    if (error.status === 429) return res.status(429).json({ success: false, error: error.message });
    console.error("Customer register failed:", error);
    res.status(500).json({ success: false, error: "Could not create your account. Please try again." });
  }
});

// Forgot password, final step: the browser presents the reset step token.
// Setting a new password bumps token_version so every earlier session (any
// device signed in with the old password) dies immediately.
router.post("/password/reset", async (req, res) => {
  try {
    const chargeReset = rateLimitReserve({ key: `ip:${clientIp(req)}:pwreset`, max: 10, windowMs: 60 * 60 * 1000, message: "Too many password reset attempts. Please try again later." });
    const step = (req.headers.authorization || "").startsWith("Bearer ")
      ? verifyCustomerToken(req.headers.authorization.slice(7))
      : null;
    if (!step || step.purpose !== "reset-phone") {
      return res.status(403).json({ success: false, error: "Please verify your mobile number first." });
    }
    const password = String(req.body.password || "");
    const confirm = String(req.body.confirmPassword ?? req.body.password ?? "");
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ success: false, error: passwordError });
    if (password !== confirm) {
      return res.status(400).json({ success: false, error: "Those passwords do not match." });
    }

    const db = await getDb();
    const customer = await db.get(
      "SELECT * FROM customers WHERE SUBSTR(REPLACE(REPLACE(phone, ' ', ''), '-', ''), -10) = ?",
      [last10Digits(step.phone)]
    );
    if (!customer) {
      return res.status(404).json({ success: false, error: "That step expired. Please start again." });
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await db.run(
      "UPDATE customers SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
      [passwordHash, customer.id]
    );
    chargeReset();
    res.json({ success: true });
  } catch (error) {
    if (error.status === 429) return res.status(429).json({ success: false, error: error.message });
    console.error("Password reset failed:", error);
    res.status(500).json({ success: false, error: "Could not update your password right now." });
  }
});

// Brute-force ceiling for customer sign-in — same visible-budget treatment as
// the staff door: a silent countdown to a lockout reads as a broken page.
const CUSTOMER_LOGIN_MAX_FAILS = 10;
const CUSTOMER_LOGIN_WINDOW_MS = 5 * 60 * 1000;

router.post("/login", async (req, res) => {
  try {
    // Brute-force ceiling counts ONLY failed attempts — correct password never
    // consumes the cap. Reserved inside the try so a tripped limit answers 429
    // instead of crashing the process.
    const chargeFail = rateLimitReserve({ key: `ip:${clientIp(req)}:login`, max: CUSTOMER_LOGIN_MAX_FAILS, windowMs: CUSTOMER_LOGIN_WINDOW_MS, message: "Too many sign-in attempts. Please wait five minutes." });
    const db = await getDb();
    // Accept username (older accounts, admin-created demo data) or mobile number.
    const usernameOrPhone = String(req.body.username || "").trim().slice(0, 40);
    const password = String(req.body.password || "");
    if (!usernameOrPhone || !password) {
      return res.status(400).json({ success: false, error: "Enter your mobile number and password." });
    }
    const phoneKey = usernameOrPhone.replace(/\D/g, "").slice(-10);

    const customer = await db.get(
      "SELECT * FROM customers WHERE username = ? OR SUBSTR(REPLACE(REPLACE(phone, ' ', ''), '-', ''), -10) = ?",
      [usernameOrPhone, phoneKey]
    );
    if (!customer || !(await bcrypt.compare(password, customer.password_hash))) {
      chargeFail();
      const attemptsLeft = rateLimitRemaining({ key: `ip:${clientIp(req)}:login`, max: CUSTOMER_LOGIN_MAX_FAILS, windowMs: CUSTOMER_LOGIN_WINDOW_MS });
      return res.status(401).json({ success: false, error: "Wrong username or password.", attemptsLeft });
    }

    const token = signCustomerToken(customer);
    await linkLegacyOrders(db, customer);

    let cart = [];
    try { cart = sanitizeCartLines(JSON.parse(customer.cart_json || "[]")); } catch { cart = []; }

    res.json({
      success: true,
      data: { token, profile: serializeCustomer(customer), cart }
    });
  } catch (error) {
    if (error.status === 429) return res.status(429).json({ success: false, error: error.message });
    console.error("Customer login failed:", error);
    res.status(500).json({ success: false, error: "Could not sign you in. Please try again." });
  }
});

// Who is browsing the storefront? Lets the page skip the login screen when an
// admin session exists, without handing any admin token to client JavaScript.
router.get("/session", async (req, res) => {
  try {
    const shopper = await resolveShopper(req);
    if (!shopper) return res.json({ success: true, data: { signedIn: false } });
    if (shopper.role === "admin") {
      const { profile } = await readAdminShopper(shopper.admin);
      return res.json({ success: true, data: { signedIn: true, role: "admin", profile } });
    }
    const db = await getDb();
    const row = await db.get("SELECT * FROM customers WHERE id = ?", [shopper.customer.id]);
    if (!row) return res.json({ success: true, data: { signedIn: false } });
    res.json({ success: true, data: { signedIn: true, role: "customer", profile: serializeCustomer(row) } });
  } catch (error) {
    console.error("Storefront session check failed:", error);
    res.status(500).json({ success: false, error: "Could not check your session." });
  }
});

router.get("/cart", requireCustomer, async (req, res) => {
  try {
    if (req.shopper.role === "admin") {
      const { cart } = await readAdminShopper(req.shopper.admin);
      return res.json({ success: true, data: sanitizeCartLines(cart) });
    }
    const db = await getDb();
    const customer = await db.get("SELECT cart_json FROM customers WHERE id = ?", [req.customer.id]);
    if (!customer) return res.status(404).json({ success: false, error: "Account not found." });
    let cart = [];
    try { cart = sanitizeCartLines(JSON.parse(customer.cart_json || "[]")); } catch { cart = []; }
    res.json({ success: true, data: cart });
  } catch (error) {
    console.error("Customer cart load failed:", error);
    res.status(500).json({ success: false, error: "Could not load your cart." });
  }
});

// Replace-all cart save: the client owns the edit flow, the server owns the data.
router.put("/cart", requireCustomer, async (req, res) => {
  try {
    const cart = sanitizeCartLines(req.body.cart);
    if (req.shopper.role === "admin") {
      await saveAdminShopper({ cart });
      return res.json({ success: true, data: cart });
    }
    const db = await getDb();
    await db.run("UPDATE customers SET cart_json = ? WHERE id = ?", [JSON.stringify(cart), req.customer.id]);
    res.json({ success: true, data: cart });
  } catch (error) {
    console.error("Customer cart save failed:", error);
    res.status(500).json({ success: false, error: "Could not save your cart." });
  }
});

// Update the signed-in customer's own details. Names/phone stay account-level
// (names display-cased here); address feeds the DB the order route reads from.
router.put("/profile", requireCustomer, async (req, res) => {
  try {
    const body = req.body || {};
    const firstName = titleCaseName(body.firstName);
    const lastName = titleCaseName(body.lastName);
    const barangay = String(body.barangay ?? "").trim().slice(0, 100);
    const address = String(body.address ?? "").trim().slice(0, 240);
    const landmark = String(body.landmark ?? "").trim().slice(0, 120);

    if (!firstName || !lastName) {
      return res.status(400).json({ success: false, error: "Please add your first and last name." });
    }
    if (!barangay) {
      return res.status(400).json({ success: false, error: "Please choose your barangay." });
    }
    if (address.length < 10) {
      return res.status(400).json({ success: false, error: "Enter your complete delivery address (block, lot, phase, street, barangay)." });
    }

    if (req.shopper.role === "admin") {
      // One admin, so the storefront's delivery details live in the settings
      // row instead of a second customer account.
      await saveAdminShopper({ firstName, lastName, barangay, address, landmark });
      const { profile } = await readAdminShopper(req.shopper.admin);
      return res.json({ success: true, data: profile });
    }

    const db = await getDb();
    await db.run(
      "UPDATE customers SET first_name = ?, last_name = ?, barangay = ?, address = ?, landmark = ? WHERE id = ?",
      [firstName, lastName, barangay, address, landmark, req.customer.id]
    );
    const row = await db.get("SELECT * FROM customers WHERE id = ?", [req.customer.id]);
    res.json({ success: true, data: serializeCustomer(row) });
  } catch (error) {
    console.error("Customer profile update failed:", error);
    res.status(500).json({ success: false, error: "Could not save your details." });
  }
});

router.get("/orders", requireCustomer, async (req, res) => {
  try {
    const db = await getDb();
    // Admin test orders are is_demo rows with no customer account attached.
    const rows = req.shopper.role === "admin"
      ? await db.all(
          "SELECT * FROM orders WHERE is_demo = 1 AND customer_id IS NULL ORDER BY datetime(created_at) DESC LIMIT 20"
        )
      : await db.all(
          "SELECT * FROM orders WHERE customer_id = ? ORDER BY datetime(created_at) DESC LIMIT 20",
          [req.customer.id]
        );
    const orders = [];
    for (const order of rows) {
      const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", [order.id]);
      orders.push({
        orderNumber: order.order_number,
        total: Number(order.total),
        subtotal: Number(order.subtotal),
        deliveryFee: order.delivery_fee_set ? Number(order.delivery_fee) : null,
        deliveryFeeSet: Boolean(order.delivery_fee_set),
        status: order.status,
        paymentMethod: order.payment_method,
        createdAt: order.created_at,
        itemCount: items.reduce((total, item) => total + item.quantity, 0),
        items: items.map((item) => ({ name: item.name, quantity: item.quantity }))
      });
    }
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Customer orders load failed:", error);
    res.status(500).json({ success: false, error: "Could not load your orders." });
  }
});

export default router;
