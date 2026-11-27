import { getDb } from "./db.js";

// Key/value settings backing the admin's store status.
// All reads happen per request, so an admin toggle takes effect immediately
// and survives restarts without any caching to invalidate.
export async function getSetting(key, fallback = "") {
  const db = await getDb();
  const row = await db.get("SELECT value FROM settings WHERE key = ?", [key]);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  const db = await getDb();
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [key, String(value)]
  );
}

export async function getStoreOpen() {
  return (await getSetting("store_open", "1")) !== "0";
}

export async function setStoreOpen(open) {
  await setSetting("store_open", open ? "1" : "0");
}
