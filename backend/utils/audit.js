import { getDb } from "../config/db.js";

// Append-only audit trail for administrator actions (who, what, when). A
// failure to record an action is logged locally but never blocks the action's
// HTTP response path twice.
export async function auditAdmin(req, action, detail = "") {
  try {
    const db = await getDb();
    await db.run(
      "INSERT INTO admin_audit (admin_id, username, action, detail) VALUES (?, ?, ?, ?)",
      [req?.admin?.id ?? null, req?.admin?.username ?? (req?.admin ? String(req.admin) : ""), action, String(detail ?? "").slice(0, 400)]
    );
  } catch (error) {
    console.error("Audit write failed:", error?.message || error);
  }
}
