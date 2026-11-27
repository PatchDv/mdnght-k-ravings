# System Mapping — MDNGHT K-RAVINGS

How each project requirement maps to concrete code in this repository, with the
exact file and line to open during a demonstration. Line numbers refer to the
current source.

## 1. Business context

| Requirement | Evidence in the system |
| --- | --- |
| Business: MDNGHT K-RAVINGS, a late-night Korean-Filipino mini restaurant in Madapdap, Mabalacat, Pampanga | `package.json` (`"description"`); storefront copy and menu sections in `frontend/index.html`; menu data `backend/seed/menuData.js` (Korean Cravings / Trays and Bilao / Silog Meals) |
| Problem: orders, delivery fees, and sales are tracked by hand; customers have no queue visibility; no automatic reporting | The whole admin side replaces the paper process: Order Flow board (`backend/views/admin.html` → `view-orders`), per-order fee quoting (`backend/routes/admin.js` → `PATCH /orders/:id/delivery-fee`), and the auto-computed Profit report (`backend/routes/admin.js` → `GET /analytics`) |

## 2. Data structures

| Requirement | Evidence + demo step |
| --- | --- |
| Arrays | `backend/routes/orders.js:155` — `pricedItems.push({...})` builds the priced line array for a new order. Demo: place an order with 3 dishes; the array becomes one row in `orders` plus three rows in `order_items`. |
| Hash table (`Map`) | `backend/utils/profit.js:13` — `ordersByDay()` buckets orders into a `Map` keyed by day. `backend/routes/admin.js:211` — `salesMap = new Map(...)` for the 7-day sales chart. Demo: open Kitchen board → Profit; the day buckets come straight from that Map. |
| SQLite B-tree indexes | `backend/config/db.js:253-259` — `CREATE INDEX` on `menu_items(category_id)`, `menu_items(is_available)`, `order_items(order_id)`, `order_items(menu_item_id)`, `orders(created_at)`, `orders(customer_id)`. Demo: open the database in DB Browser for SQLite → table `orders` → *Indexes* tab shows `idx_orders_created` etc. |
| Queues (FIFO) | `backend/utils/orderQueue.js` — explicit first-in-first-out kitchen queue over plain arrays, ordered by `created_at` then `id`; working orders only (confirmed / preparing / delivering). Demo: Kitchen board → Orders → "Next up to cook" card. |

## 3. Algorithms

| Requirement | Evidence + demo step |
| --- | --- |
| Merge sort, O(n log n) | `frontend/js/algorithms.js:9` (`mergeSort`), used by the storefront menu at `frontend/js/app.js:630` via `A.sortMenu(...)` in every sort mode. Demo: storefront → change sort to "Price: low to high"; the list is reordered by merge sort in the browser. |
| Binary search | `frontend/js/algorithms.js:108` (`searchExact`) — exact dish-name lookup over a sorted copy of the menu, O(log n). Demo: type the full exact name of a dish in search; the single exact hit comes from binary search. |
| Linear search | `frontend/js/algorithms.js:131` (`searchPartial`) — O(n) scan over names/categories/tags/descriptions. Demo: type a partial word ("kimba"); matches come from the linear scan. |
| Levenshtein fuzzy match | `frontend/js/algorithms.js:46` (`editDistance`) — dynamic-programming edit distance; a one-typo fallback ("kimba" still finds "kimbap") scored in `scoreItem`. Demo: mistype a dish name; results still appear. |
| Aggregation traversal | `backend/utils/profit.js:12-59` — `ordersByDay()` walks all delivered orders once into day buckets; `summarizeRange()` walks the buckets to produce revenue / cost / profit per day. Demo: Kitchen board → Profit → pick a date range. |
| Server-side pricing (trust boundary) | `backend/routes/orders.js:155-165` — the browser sends only `menuItemId`, `quantity`, `selectedOptions`; the server re-reads the item, recalculates unit price via `calculateItemPricing` (`backend/utils/pricing.js`), and rounds line totals, so the client can never set a price. Demo: Kitchen board → Menu studio → change a price; the storefront checkout uses the new price even for an already-open tab. |

## 4. Database

| Requirement | Evidence |
| --- | --- |
| SQLite file database | `backend/database.sqlite`, opened in WAL mode with `PRAGMA foreign_keys = ON` (`backend/config/db.js:26-27`) |
| 11 tables | `categories`, `menu_items`, `orders`, `order_items`, `admin_users`, `admin_sessions`, `customers`, `expenses`, `otp_requests`, `settings`, `admin_audit` — all defined in `backend/config/db.js` |
| Foreign keys | e.g. `order_items.order_id → orders.id ON DELETE CASCADE`, `menu_items.category_id → categories.id` (`config/db.js:57,93`) |
| CRUD — Create | `POST /api/orders`, `POST /api/admin/menu`, `POST /api/admin/expenses` |
| CRUD — Read | `GET /api/menu`, `GET /api/orders/:orderNumber`, `GET /api/admin/orders`, `GET /api/admin/customers`, `GET /api/admin/analytics` |
| CRUD — Update | `PUT /api/customers/profile`, `PUT /api/admin/menu/:id`, `PATCH /api/admin/orders/:id/status`, `PATCH /api/admin/orders/:id/delivery-fee` |
| CRUD — Delete | `DELETE /api/admin/menu/:id`, `DELETE /api/admin/expenses/:id`, `DELETE /api/admin/customers/:id` (anonymizes: keeps the orders, clears the account link) |
| Full route list | `README.md` → *API overview* table |

## 5. Improvement over the manual process

| Requirement | How the system improves it |
| --- | --- |
| Normalized schema instead of paper notebooks | One row per entity: dishes, orders, order lines, customers, expenses (`config/db.js`); order lines are never duplicated text — they reference `menu_items.id`. |
| O(log n) exact search instead of flipping pages | Binary search over the sorted menu (`algorithms.js:108`) plus B-tree indexes server-side (`config/db.js:253-259`). |
| Automatic revenue / profit / best sellers instead of manual tally | `GET /api/admin/analytics` computes revenue, product cost, expenses, and profit from real delivered orders (`utils/profit.js`); best sellers aggregate `order_items` (`routes/menu.js` → `getBestSellers`). |
| SMS on status change instead of phone calls | `PATCH /api/admin/orders/:id/status` fires `statusSmsText` through the SMS gateway (`routes/admin.js:474-479`). |
| Audit log instead of "who changed this?" | Every admin action is appended to `admin_audit` (`backend/utils/audit.js`); visible in DB Browser. |

## 6. Five-minute demo script

1. **Menu studio (CRUD)** — Kitchen board → Menu: add a dish ("Demo Tteokbokki", ₱99), edit its price to ₱109, then delete it. Past orders referencing a dish are kept: deletion archives instead of destroying.
2. **Database** — open `backend/database.sqlite` in DB Browser for SQLite: show the 11 tables, the `orders` / `order_items` relationship, and the indexes tab. Rows created during this demo are marked `is_demo = 1` (or are admin test orders) so real numbers stay clean.
3. **Order flow** — place an order from the storefront (sign in as one of the five demo accounts — see the launch notes, not this file, for credentials), watch it appear on the board's "Next up to cook" card (FIFO queue), quote the delivery fee (₱10/15/20, ₱400+ free), then move it Confirmed → Preparing → Delivering → Delivered. Each change SMS-notifies the customer and appends to `admin_audit`.
4. **Profit report** — Kitchen board → Profit: today / 7-day / 14-day revenue, cost, and profit with best sellers, computed live by the aggregation traversal.
5. **Customers** — Kitchen board → Customers: records built from real orders, per-customer revenue, order history drill-down, and *Remove record* (typed confirmation) which anonymizes the customer but keeps every order for revenue history.
6. **Cleanup** — Profit → *Remove demo data* (and delete any test order rows) so the database is left clean for grading.

> Note: rows created for the demo are flagged `is_demo` in the `orders` /
> `expenses` tables, and the Profit view has a "Remove demo" action that clears
> them in one click.
