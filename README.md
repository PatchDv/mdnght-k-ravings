# MDNGHT K-RAVINGS

A late-night Korean-Filipino food delivery storefront for **Madapdap, Mabalacat, Pampanga** â€” with customer accounts, a searchable/sortable menu, a voice-only guide for customers who prefer not to type, and a private kitchen board for the store team.

## Quick start

```powershell
cd C:\Users\admin\Desktop\CamsKraving
npm install
npm start
```

Open **http://localhost:3000**. The Express server also serves the frontend, so there is no separate frontend server.

- Storefront: `http://localhost:3000`
- Staff door (admin): the secret path from `ADMIN_PATH` in `.env` (default `http://localhost:3000/staff-portal-x7k2`), dashboard at `<path>/board`

The SQLite database (`backend/database.sqlite`) is created and seeded automatically on first start. To reset the demo, stop the server and delete that file, then start again.

## What's included

### Customer storefront
- First-visit form for first name, last name, and barangay.
- Fixed delivery area shown as **Philippines â†’ Pampanga â†’ Mabalacat â†’ Madapdap**.
- Exactly three menu sections:
  1. **Your Korean Cravings Provider**
  2. **TRAYS AND BILAO**
  3. **Silog Meals**
- Live search with typo tolerance and six sort modes.
- Item customizer with required flavor/sauce choices, extra-flavor pricing, add-ons, and quantity.
- Persistent cart saved to the customer account (sign-in required to order).
- Checkout using the saved delivery address and phone on the account, with cash on delivery.
- Order confirmation with order number and 30â€“45 minute estimate.
- Saved order history in the profile drawer, refreshed from the server when possible.
- Responsive layout with one unified navigation bar: a floating dock on desktop that becomes a full-width bottom bar on phones.
- Customer pages never link to, mention, or open the admin area.

### Kitchen board (secret staff door)
- The login page lives at `ADMIN_PATH`; the dashboard at `ADMIN_PATH/board` answers 404 without a live admin session. The old `/admin` path is dead (404).
- Cookie sessions: opaque token in an httpOnly `SameSite=Strict` cookie, stored hashed in `admin_sessions`; per-session CSRF token required on every state-changing admin API call; logout destroys the server-side session.
- Brute-force guard: 5 failed sign-ins per IP start a 5-minute cooldown; the staff door shows the attempts remaining and counts down while locked.
- Delivery fee options are fixed at â‚±10 / â‚±15 / â‚±20; orders of â‚±400+ are free automatically (backend-enforced).
- Insights: revenue, order count, average order, active orders, 7-day sales chart, best sellers, recent orders.
- Menu Studio: search/filter dishes, edit details, adjust prices, change photos, set availability, add dishes, remove dishes, and edit option groups (flavors, required radio choices, add-ons).
- Admin-only changes go live on the storefront immediately.
- Order Flow: the kitchen sees every customer order, quotes the delivery fee (â‚±10/15/20, â‚±400+ free), and moves orders through `confirmed â†’ preparing â†’ delivering â†’ delivered` (or cancel). Status updates fire an SMS heads-up to the customer when a phone number is available.
- Signed-in admins get a "Back to Admin" button while browsing the storefront; the secret path is fetched from the server on tap and is never present in the page source for anyone else.
- Admins can also order from the storefront (preview mode): their first visit asks for delivery details once, checkout resumes automatically, and their orders are flagged "Admin test" on the board â€” kept out of real revenue via the demo lane.

### Voice guide (K-Bot)
- Microphone-only interface: no text input in the voice panel.
- Uses the browser's **SpeechRecognition** API for input and **SpeechSynthesis** for spoken answers.
- **Voice-only ordering:** builds a draft order, asks one short clarifying question when a dish is ambiguous or an option is missing, supports corrections ("remove that", "change it to 2", "cancel"), reads the order back, and only after a spoken "yes" puts it into My Order â€” checkout is still finished by the customer in My Order.
- Understands intents such as:
  - â€œAdd 2 cheese kimbapâ€
  - â€œHow much is Samyang?â€
  - â€œFind wingsâ€
  - â€œMenuâ€
  - â€œRemove thatâ€
  - â€œChange it to 3â€
  - â€œThat's allâ€ â†’ read-back â†’ â€œyesâ€ / â€œnoâ€
  - â€œOpen my orderâ€
  - â€œHow do I order?â€
- Knowledge is the live menu only: names, prices, options, availability. It never suggests or upsells anything that was not said, and off-topic questions get a polite "menu only" answer.
- **Browser support:** voice recognition works best in Chrome or Edge and requires `localhost` or HTTPS. Firefox/Safari users see a clear fallback message. K-Bot is an intent-based local guide, not a cloud LLM.

## Menu and pricing

The seed menu is in `backend/seed/menuData.js`:

**Korean Cravings**
- 6pcs Wings Plain â€” â‚±159
- 6pcs Wings with Flavor â€” â‚±169 (one flavor included, +â‚±10 per extra flavor)
- 20pcs Pops â€” **â‚±179** (see note below)
- Spicy Tteokbokki Rice Cake â€” â‚±119
- Spicy Tteokbokki Fish Cake â€” â‚±119
- Cheesy Samyang with Seaweed â€” â‚±149
- Samyang Overload â€” â‚±179
- Cheese Kimbap 10pcs â€” â‚±119
- Cheesy Fries â€” â‚±89

**Trays and Bilao**
- Small Tray Â· 16pcs â€” â‚±449 (up to 2 flavors)
- Medium Tray Â· 24pcs â€” â‚±669 (up to 3 flavors)
- Large Tray Â· 32pcs â€” â‚±899 (up to 4 flavors)
- Spicy Tteokbokki Tray â€” â‚±399
- Cheese Kimbap Small Bilao â€” â‚±599
- Cheese Kimbap Medium Bilao â€” â‚±899
- Cheese Kimbap Large Bilao â€” â‚±1,199

**Silog Meals** (each includes garlic rice and egg)
- Porkchop Silog â€” â‚±129
- Liempo Silog â€” â‚±139
- Chick Silog â€” â‚±159
- Sauce choice: Buffalo, Toyomansi, Cheese, or Teriyaki
- Add-ons: extra rice â‚±15, chili garlic â‚±15

Flavors: **Buffalo, Soy Garlic, Cheese, Garlic Parmesan**.

> **Price assumption:** the price for **20pcs Pops** was not supplied. It is set to **â‚±179** so the menu can be ordered. Change it in **Kitchen board â†’ Menu studio â†’ 20pcs Pops** if the real price is different.

Delivery is quoted **per order**. Orders of **â‚±400 or more get free delivery automatically** (enforced in the backend, not just the UI). Orders under â‚±400 start with "Delivery fee: to be confirmed by admin", and the kitchen admin picks â‚±10, â‚±15, or â‚±20 from **Kitchen board â†’ Order flow**; the customer then sees the final fee and total in their order history.

## Images

All food photos live in `frontend/assets/images/`. The mapping from menu item to image is in **`frontend/js/images.js`** â€” change a key there to swap a photo without touching app logic.

You can also set a custom path or `https://` URL per dish inside the admin Menu Studio.

The demo photos were downloaded from Wikimedia Commons; see `frontend/assets/images/CREDITS.md` for the replacement guide and licensing note.

## Sorting and search algorithms

`frontend/js/algorithms.js` contains:
- **Merge sort** (`O(n log n)`) used for all menu sorting.
- Sort modes: recommended, price ascending/descending, name Aâ€“Z/Zâ€“A.
- **Typo-tolerant token search**: normalized phrase matching plus a one-edit-distance fallback, e.g. â€œkimbaâ€ still finds â€œkimbapâ€.
- Shared helpers for peso formatting, HTML escaping, and debouncing.

Search and sort run entirely in the browser after the menu is fetched.

## Project structure

```
CamsKraving/
  backend/
    config/
      db.js           SQLite schema, indexes, connection (WAL)
      auth.js         customer JWT sessions
      adminAuth.js    admin cookie sessions + CSRF
      otp.js          one-time codes (hashing, expiry, cooldowns)
      env.js          environment and secrets
      location.js     barangay list
      settings.js     key-value store helpers
      sms.js          SMS gateway client
    routes/
      menu.js         public menu + best sellers
      orders.js       checkout + order lookup (server-side pricing)
      customers.js    accounts, OTP, cart, profile
      admin.js        kitchen board API (menu, orders, fees, queue,
                      customers, profit analytics, expenses)
    seed/
      menuData.js     exact menu, prices, options
      seed.js         first-run seeding
    utils/
      pricing.js      option validation + pricing + fee rules
      orderQueue.js   FIFO kitchen queue
      profit.js       revenue/profit aggregation
      security.js     rate limiting + attempt budgets
      audit.js        append-only admin audit log
      notify.js       status SMS texts
      textbee.js      SMS gateway helpers
    views/
      staff-login.html   staff door page
      admin.html         kitchen board page
    server.js         Express app, static frontend, secret admin routes
  docs/               project documentation
  frontend/
    index.html        storefront
    login.html        customer sign in / registration / reset
    404.html
    css/              styles.css, admin.css
    js/               config, images, algorithms, api, app, assistant, admin
    assets/images/    food photos, logo, credits
  tests/              unit tests (node --test)
  package.json
```

## API overview

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/menu` | Categories and items (plain menu, no recommendation data) |
| `POST` | `/api/orders` | Create an order for the signed-in customer (server recalculates all prices) |
| `GET` | `/api/orders/:orderNumber?phone=â€¦` | Look up an order; phone must match |
| `POST` | `/api/admin/login` | Admin sign-in, sets an httpOnly session cookie + CSRF token |
| `GET` | `/api/admin/overview` | Stats, chart, best sellers, recent orders |
| `GET` | `/api/admin/menu` | All items, including hidden ones |
| `POST` | `/api/admin/menu` | Add a dish |
| `PUT` | `/api/admin/menu/:id` | Update a dish |
| `DELETE` | `/api/admin/menu/:id` | Remove a dish (or hide it if past orders reference it) |
| `PATCH` | `/api/admin/menu/:id/availability` | Show/hide a dish |
| `GET` | `/api/admin/orders` | Order list |
| `GET` | `/api/admin/orders-queue` | FIFO kitchen queue: working orders oldest-first plus the `nextUp` head ("Next up to cook") |
| `PATCH` | `/api/admin/orders/:id/status` | Move an order status (customer gets an SMS heads-up) |
| `PATCH` | `/api/admin/orders/:id/delivery-fee` | Set or edit one order's delivery fee and total |
| `GET` | `/api/admin/door` | The secret admin path â€” answered only to a live admin session (Back-to-Admin button) |
| `DELETE` | `/api/admin/customers/:id` |
| `GET` | `/api/store` | Store open/closed status for the storefront |
| `POST` | `/api/customers/login` | Customer sign-in |
| `POST` | `/api/customers/otp/request` | Send a one-time code (registration or password reset) |
| `POST` | `/api/customers/otp/verify` | Verify a one-time code |
| `POST` | `/api/customers/register` | Create the account (requires the verified-code step token) |
| `POST` | `/api/customers/password/reset` | Reset the password after code verification |
| `GET` / `PUT` | `/api/customers/cart` | Read or save the signed-in customer's cart |
| `PUT` | `/api/customers/profile` | Update profile and delivery details |
| `GET` | `/api/customers/orders` | The customer's order history |
| `GET` | `/api/admin/analytics` | Profit analytics (delivered orders, demo/real separation) |
| `GET` / `POST` / `DELETE` | `/api/admin/expenses` | Business expenses for the profit report |
| `PUT` | `/api/admin/menu/:id/cost` | Set a dish's product cost |
| `POST` / `DELETE` | `/api/admin/seed-demo` | Seed or clear the labelled demo dataset |
| `DELETE` | `/api/admin/customers/:id` | Remove a customer account with anonymization: orders are kept for revenue history (`customer_id` cleared), the action is appended to the audit log |

Admin routes require the httpOnly session cookie, and every state-changing call must carry the session's `X-CSRF-Token` header (the browser client does this automatically).

Prices and option choices are recalculated on the server from the database, so the browser cannot change what an order costs. Order lookup requires the matching phone number.

## Configuration and deployment

Every setting and secret comes from environment variables. Copy **`.env.example`** to **`.env`** and fill it in — `.env` is gitignored and must never be committed or published.

```powershell
copy .env.example .env     # then edit .env with your real values
npm install
npm start
```

Minimum for production: `NODE_ENV=production`, `ALLOWED_ORIGIN=https://yourdomain.com`, `FORCE_HTTPS=true`, three 32+ character secrets (`JWT_SECRET`, `ADMIN_JWT_SECRET`, `OTP_PEPPER`), a strong `ADMIN_PASSWORD` (used only to seed the admin account on first run), `SMS_PROVIDER=textbee` with `TEXTBEE_API_KEY`, and a private `ADMIN_PATH`. The server refuses to start in production when a secret is missing or too short. There are no baked-in admin credentials anywhere in the code. The server takes a timestamped database snapshot into `backups/` on every start; schedule copies of that folder for real backups.

## Demo data

Two labelled demo datasets keep the board presentable without touching real numbers: four first-run sample orders (`MK-DEMO-1001` through `MK-DEMO-1004`) and a larger analytics demo dataset (35 days of delivered orders plus expenses, flagged `is_demo = 1`) that the Profit view can seed and clear with its Remove demo action. Delete the database file to start completely fresh.

## Production notes

- Set real `ADMIN_USERNAME`/`ADMIN_PASSWORD`, a long `ADMIN_PATH`, and rotate all secrets; no default credentials exist in the code.
- Replace the Wikimedia demo photography with your own images and update `CREDITS.md`.
- Serve over HTTPS (`FORCE_HTTPS=true` behind your TLS terminator) so microphone access works outside localhost.
- Customer accounts, carts, and order history live on the server (SQLite); the browser only caches a display copy.
- SQLite is suitable for a single-store local deployment. For multiple stores or high traffic, move ordering/menu data to a managed database and add rate limiting.
- K-Bot uses the browser speech service. If a browser blocks it, the written menu, search, and cart still work normally.
