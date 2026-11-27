import express from "express";
import { getDb } from "../config/db.js";
import { parseJson } from "../utils/pricing.js";

const router = express.Router();

function serializeItem(item) {
  return {
    id: item.id,
    categoryId: item.category_id,
    categoryName: item.category_name,
    categorySlug: item.category_slug,
    name: item.name,
    description: item.description,
    price: Number(item.price),
    imageKey: item.image_key,
    badge: item.badge || "",
    tags: parseJson(item.tags, []),
    optionGroups: parseJson(item.option_groups, []),
    isAvailable: Boolean(item.is_available),
    isFeatured: Boolean(item.is_featured),
    displayOrder: item.display_order
  };
}

export async function getBestSellers(db, limit = 5) {
  return db.all(
    `SELECT mi.id, mi.name, mi.image_key, mi.price,
            SUM(oi.quantity) AS sold,
            SUM(oi.line_total) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE o.status != 'cancelled'
      GROUP BY mi.id
      ORDER BY sold DESC, revenue DESC
      LIMIT ?`,
    [limit]
  ).then((rows) => rows.map((row) => ({
    id: row.id,
    name: row.name,
    imageKey: row.image_key,
    price: Number(row.price),
    sold: Number(row.sold),
    revenue: Number(row.revenue)
  })));
}

router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const categories = await db.all(
      "SELECT * FROM categories WHERE is_active = 1 ORDER BY display_order, id"
    );
    // Unavailable items stay visible so customers see what's out of stock;
    // ordering is blocked client-side and re-checked in /api/orders.
    const items = await db.all(
      `SELECT mi.*, c.name AS category_name, c.slug AS category_slug
         FROM menu_items mi
         JOIN categories c ON c.id = mi.category_id
        WHERE c.is_active = 1
        ORDER BY c.display_order, mi.display_order, mi.id`
    );
    const payload = categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      accent: category.accent,
      items: items.filter((item) => item.category_id === category.id).map(serializeItem)
    }));

    // No recommendation data here on purpose: the storefront is a plain menu.
    // getBestSellers() stays for the admin board's own analytics view.
    res.json({
      success: true,
      data: {
        categories: payload
      }
    });
  } catch (error) {
    console.error("Menu load failed:", error);
    res.status(500).json({ success: false, error: "Could not load the menu." });
  }
});

router.get("/items", async (req, res) => {
  try {
    const db = await getDb();
    const items = await db.all(
      `SELECT mi.*, c.name AS category_name, c.slug AS category_slug
         FROM menu_items mi
         JOIN categories c ON c.id = mi.category_id
        WHERE mi.is_available = 1
        ORDER BY c.display_order, mi.display_order`
    );
    res.json({ success: true, data: items.map(serializeItem) });
  } catch (error) {
    res.status(500).json({ success: false, error: "Could not load menu items." });
  }
});

export default router;
