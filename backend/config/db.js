import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DB_PATH = path.join(__dirname, "..", "database.sqlite");

let connection = null;

export async function getDb() {
  if (!connection) {
    connection = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
  }
  return connection;
}

export async function initDb() {
  const db = await getDb();

  await db.exec("PRAGMA foreign_keys = ON");
  await db.exec("PRAGMA journal_mode = WAL");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      accent TEXT DEFAULT '#fec714',
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image_key TEXT,
      badge TEXT,
      tags TEXT DEFAULT '[]',
      option_groups TEXT DEFAULT '[]',
      is_available INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      barangay TEXT NOT NULL,
      address TEXT NOT NULL,
      landmark TEXT,
      notes TEXT,
      payment_method TEXT DEFAULT 'cash',
      subtotal REAL NOT NULL,
      delivery_fee REAL NOT NULL DEFAULT 0,
      delivery_fee_set INTEGER NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      menu_item_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      options_text TEXT,
      line_total REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT 'Store Admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      admin_id INTEGER NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at)");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      barangay TEXT NOT NULL,
      cart_json TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Older orders predate customer accounts; customer_id is stamped at sign-in
  // for any legacy order that matches the phone number.
  try {
    await db.exec("ALTER TABLE orders ADD COLUMN customer_id INTEGER");
  } catch {
    /* column already exists */
  }

  // Delivery fee is quoted per order by the admin, not a store-wide amount.
  // New orders start unset; existing rows are stamped as already set so their
  // historical totals never change.
  try {
    await db.exec("ALTER TABLE orders ADD COLUMN delivery_fee_set INTEGER NOT NULL DEFAULT 0");
    await db.exec("UPDATE orders SET delivery_fee_set = 1");
  } catch {
    /* column already exists */
  }

  // Demo data marker so sample profit records stay clearly separated from real
  // business transactions.
  try {
    await db.exec("ALTER TABLE orders ADD COLUMN is_demo INTEGER DEFAULT 0");
  } catch {
    /* column already exists */
  }

  // Product cost per unit for profit math; 0 = cost unknown (estimated profit).
  try {
    await db.exec("ALTER TABLE menu_items ADD COLUMN cost_price REAL NOT NULL DEFAULT 0");
  } catch {
    /* column already exists */
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      amount REAL NOT NULL,
      spent_on DATE NOT NULL,
      is_demo INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(spent_on)
  `);

  // One-time-verification codes (registration OTPs, password-reset OTPs).
  // Codes are stored keyed-hashed; plaintext is deleted with the process.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS otp_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts_left INTEGER NOT NULL DEFAULT 5,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_requests(phone, purpose, created_at);
    CREATE INDEX IF NOT EXISTS idx_otp_expiry ON otp_requests(expires_at);
  `);

  // Admin-controlled storefront settings (store open/closed, admin preview).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Delivery fees are quoted per order now; this row is a dead leftover from
  // the abandoned store-wide fee model and nothing reads it.
  await db.run("DELETE FROM settings WHERE key = 'delivery_fee'").catch(() => {});

  // Append-only record of administrator actions for auditing.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Bumped whenever an account's sessions should be invalidated (password
  // reset). Existing signed tokens carry no version and read as version 0, so
  // accounts created before this column keep working until they expire.
  try {
    await db.exec("ALTER TABLE customers ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* column already exists */
  }
  await db.exec("CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)");

  // Last delivery address per account, remembered from the order form so the
  // next checkout (on ANY device they sign in from) can prefill it.
  try {
    await db.exec("ALTER TABLE customers ADD COLUMN address TEXT");
  } catch {
    /* column already exists */
  }
  try {
    await db.exec("ALTER TABLE customers ADD COLUMN landmark TEXT");
  } catch {
    /* column already exists */
  }
  // Gateway message id per OTP so delivery can be checked at IPROG SMS later.
  try {
    await db.exec("ALTER TABLE otp_requests ADD COLUMN sms_message_id TEXT");
  } catch {
    /* column already exists */
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
    CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(is_available);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_menu ON order_items(menu_item_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
  `);

  console.log("Database ready.");
  // Codes are one-time, short-lived records; expired rows are dead weight.
  await db.run("DELETE FROM otp_requests WHERE expires_at <= datetime('now')").catch(() => {});
  return db;
}
