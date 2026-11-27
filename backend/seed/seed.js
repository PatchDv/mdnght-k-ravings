import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getDb, initDb } from "../config/db.js";
import { env } from "../config/env.js";
import { categoryData, menuData } from "./menuData.js";

// No credentials belong in the source. The admin account is created only when
// ADMIN_USERNAME + ADMIN_PASSWORD are set; a dev machine without them gets a
// one-time random password printed in the console.
const ADMIN_USERNAME = env.adminBootstrapUsername;
const ADMIN_PASSWORD = env.adminBootstrapPassword;

async function insertOrder(db, order) {
  const result = await db.run(
    `INSERT INTO orders
      (order_number, first_name, last_name, phone, barangay, address, landmark, notes,
      payment_method, subtotal, delivery_fee, delivery_fee_set, total, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now', ?), datetime('now', ?))`,
    [
      order.orderNumber,
      order.firstName,
      order.lastName,
      order.phone,
      order.barangay,
      order.address,
      order.landmark || "",
      order.notes || "",
      order.paymentMethod,
      order.subtotal,
      order.deliveryFee,
      order.total,
      order.status,
      order.createdOffset,
      order.createdOffset
    ]
  );

  for (const item of order.items) {
    await db.run(
      `INSERT INTO order_items
        (order_id, menu_item_id, name, unit_price, quantity, options_text, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        result.lastID,
        item.id,
        item.name,
        item.unitPrice,
        item.quantity,
        item.optionsText || "",
        item.lineTotal
      ]
    );
  }
}

export async function seedDatabase() {
  const db = await getDb();
  const categoryCount = await db.get("SELECT COUNT(*) AS count FROM categories");

  if (categoryCount.count === 0) {
    console.log("Seeding menu...");

    const itemIdByName = new Map();

    for (const category of categoryData) {
      const result = await db.run(
        `INSERT INTO categories (name, slug, description, accent, display_order, is_active)
        VALUES (?, ?, ?, ?, ?, 1)`,
        [category.name, category.slug, category.description, category.accent, category.displayOrder]
      );

      const items = menuData[category.slug] || [];
      for (const item of items) {
        const itemResult = await db.run(
          `INSERT INTO menu_items
            (category_id, name, description, price, image_key, badge, tags, option_groups,
            is_available, is_featured, display_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            result.lastID,
            item.name,
            item.description,
            item.price,
            item.imageKey,
            item.badge || "",
            JSON.stringify(item.tags || []),
            JSON.stringify(item.optionGroups || []),
            item.isFeatured ? 1 : 0,
            item.displayOrder
          ]
        );
        itemIdByName.set(item.name, itemResult.lastID);
      }
    }

    const wingsId = itemIdByName.get("6pcs Wings with Flavor");
    const friesId = itemIdByName.get("Cheesy Fries");
    const mediumTrayId = itemIdByName.get("Medium Tray · 24 pieces");
    const samyangId = itemIdByName.get("Cheesy Samyang with Seaweed");
    const liempoId = itemIdByName.get("Liempo Silog");
    const kimbapId = itemIdByName.get("Cheese Kimbap 10pcs");
    const overloadId = itemIdByName.get("Samyang Overload");
    const tteokbokkiId = itemIdByName.get("Spicy Tteokbokki Rice Cake");

    // A few sample orders make the admin insights useful on the very first run.
    await insertOrder(db, {
      orderNumber: "MK-DEMO-1001",
      firstName: "Mika",
      lastName: "Santos",
      phone: "0917 555 0101",
      barangay: "Dapdap (Madapdap Resettlement)",
      address: "Purok 3, near Madapdap covered court",
      landmark: "Blue gate",
      notes: "Extra sauce on the side, please.",
      paymentMethod: "cash",
      subtotal: 447,
      deliveryFee: 0,
      total: 447,
      status: "delivered",
      createdOffset: "-3 days",
      items: [
        { id: wingsId, name: "6pcs Wings with Flavor", unitPrice: 179, quantity: 2, optionsText: "Flavor: Buffalo + Soy Garlic", lineTotal: 358 },
        { id: friesId, name: "Cheesy Fries", unitPrice: 89, quantity: 1, optionsText: "", lineTotal: 89 }
      ]
    });

    await insertOrder(db, {
      orderNumber: "MK-DEMO-1002",
      firstName: "Paolo",
      lastName: "Reyes",
      phone: "0918 555 0102",
      barangay: "Dau",
      address: "Dau Access Road, Villa Maria",
      landmark: "Beside the bakery",
      notes: "",
      paymentMethod: "gcash",
      subtotal: 818,
      deliveryFee: 0,
      total: 818,
      status: "preparing",
      createdOffset: "-1 day",
      items: [
        { id: mediumTrayId, name: "Medium Tray · 24 pieces", unitPrice: 669, quantity: 1, optionsText: "Flavors: Buffalo + Cheese + Soy Garlic", lineTotal: 669 },
        { id: samyangId, name: "Cheesy Samyang with Seaweed", unitPrice: 149, quantity: 1, optionsText: "", lineTotal: 149 }
      ]
    });

    await insertOrder(db, {
      orderNumber: "MK-DEMO-1003",
      firstName: "Andrea",
      lastName: "Dizon",
      phone: "0919 555 0103",
      barangay: "Mabiga",
      address: "Mabiga, Purok 5",
      landmark: "Yellow house at the corner",
      notes: "",
      paymentMethod: "cash",
      subtotal: 273,
      deliveryFee: 0,
      total: 273,
      status: "pending",
      createdOffset: "-4 hours",
      items: [
        { id: liempoId, name: "Liempo Silog", unitPrice: 154, quantity: 1, optionsText: "Sauce: Toyomansi • Extras: Extra rice", lineTotal: 154 },
        { id: kimbapId, name: "Cheese Kimbap 10pcs", unitPrice: 119, quantity: 1, optionsText: "", lineTotal: 119 }
      ]
    });

    await insertOrder(db, {
      orderNumber: "MK-DEMO-1004",
      firstName: "Jan",
      lastName: "Garcia",
      phone: "0920 555 0104",
      barangay: "Dapdap (Madapdap Resettlement)",
      address: "Madapdap Resettlement, Block 12",
      landmark: "Near the parish",
      notes: "Please call when outside.",
      paymentMethod: "gcash",
      subtotal: 298,
      deliveryFee: 0,
      total: 298,
      status: "confirmed",
      createdOffset: "-2 hours",
      items: [
        { id: overloadId, name: "Samyang Overload", unitPrice: 179, quantity: 1, optionsText: "", lineTotal: 179 },
        { id: tteokbokkiId, name: "Spicy Tteokbokki Rice Cake", unitPrice: 119, quantity: 1, optionsText: "", lineTotal: 119 }
      ]
    });

    console.log("Menu and sample orders seeded.");
  }

  const adminCount = await db.get("SELECT COUNT(*) AS count FROM admin_users");
  if (adminCount.count === 0) {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      if (env.isProd) {
        throw new Error("No admin account exists and ADMIN_USERNAME/ADMIN_PASSWORD are not set.");
      }
    }
    const username = ADMIN_USERNAME || "admin";
    // Dev-only convenience: a random one-time password, never a baked-in default.
    const password = ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
    const hash = await bcrypt.hash(password, 10);
    await db.run(
      "INSERT INTO admin_users (username, password_hash, display_name) VALUES (?, ?, ?)",
      [username, hash, "MDNGHT Store Team"]
    );
    if (ADMIN_PASSWORD) console.log(`Admin account created (${username}).`);
    else console.warn(`[dev] Admin account created: ${username} / ${password}\n[dev] Set ADMIN_USERNAME and ADMIN_PASSWORD in .env to choose your own.`);
  }

  return true;
}

async function main() {
  await initDb();
  await seedDatabase();
  const db = await getDb();
  await db.close();
  console.log("Seed complete.");
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("backend/seed/seed.js")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
