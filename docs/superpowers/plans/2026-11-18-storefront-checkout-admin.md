# Storefront, Checkout & Admin Improvements — Implementation Plan

**Goal:** scrollbars gone everywhere, polished auth pages with working OTP resend + back buttons, profile-driven COD checkout, settings-driven delivery fee (free >₱400), admin-controlled store open/closed with backend enforcement, 5-status admin order management with colors.

**Spec:** user's BUILD MODE brief (2026-11-18, second). Files: `C:\Users\admin\Desktop\CamsKraving` + e2e in `%TEMP%\pptr`.

**Architecture:** one new `settings` key/value table (safe CREATE IF NOT EXISTS) drives store status + delivery fee. New module `backend/config/settings.js` (get/set/getStoreOpen/getDeliveryFee). Public `GET /api/store` feeds the storefront; admin GET/PUT `/api/admin/settings`. Orders route takes personal data ONLY from the DB customer row (token already required); payment forced to cash; store-closed → 403.

## Global Constraints
- Preserve accounts/orders/statuses; settings table is the only schema change.
- Fee rule both sides: `subtotal > 400 ? 0 : fee`, fee admin-set, default ₱15, clamped 10–20. Exactly ₱400 pays.
- Never trust browser name/phone/address/fee/total; server recomputes.
- COD only, enforced server-side (any submitted paymentMethod is overridden).
- Pending stays valid for history; selector offers only the 5 new statuses.
- No full-page reloads for status changes; admin stays in current view.

## Tasks
1. **Settings infra (TDD)** — db.js `settings` table; `backend/config/settings.js` exports `getSetting/setSetting/getStoreOpen/setStoreOpen/getDeliveryFee/setDeliveryFee` (fee clamp 10–20, default 15); pricing.js export `deliveryFeeFor(subtotal, fee)` = `subtotal === 0 || subtotal > 400 ? 0 : fee`; unit tests: 400 pays, 400.01 free, clamp.
2. **Orders route** — use DB customer row for firstName/lastName/phone/barangay/address/landmark (ignore body); force `paymentMethod = "cash"`; address <4 from DB → 400 "add your delivery address in your profile"; store closed → 403; fee via settings. Delete body-derived fields.
3. **Public + admin endpoints** — server.js `GET /api/store` → `{open, deliveryFee}`; admin.js `GET/PUT /settings` (requireAdmin, audit, storeOpen boolean, deliveryFee clamp).
4. **Storefront closed UI** — app.js: `state.storeOpen`, fetch /api/store on load + 30s sync + visibilitychange; body class `store-closed`; banner "STORE CURRENTLY CLOSED" (+ explanation) inserted in hero; addToCart + openCheckout guards with toast; CSS `body.store-closed main {filter...}` + disabled add buttons. CFG.DELIVERY_FEE updated from /api/store (default 15).
5. **Checkout simplification** — renderCheckout: read-only "Delivering to" summary (profile name/phone/address/landmark) + "Update in Profile" link; missing address → notice + disabled submit; COD-only fixed line; placeOrder sends only notes/items/paymentMethod:"cash".
6. **Admin dashboard** — insights badge → Store Status OPEN/CLOSED toggle + delivery fee input (Save) with toasts; admin.js settings load/save; admin.css toggle + status colors (confirmed blue, preparing orange, delivering purple, delivered green, cancelled red, pending amber history-only); selector options exclude `pending` (add completed display label).
7. **Auth pages** — global scrollbar hide in admin.css (`*` rule); reset back buttons (step2→step1 change number, step3→step2 with verified shortcut); resend handlers in BOTH register+reset: success note only on acceptance + devCode fill (currently dropped — real bug) + error display; minor spacing polish (uniform field gaps, reminder text unchanged).
8. **Tests** — new probe `probe-buildmode2.mjs`: COD forced, info from DB not body, closed-store 403 + reopen, fee 400/401 rule via orders, settings persist, status selector has no pending, colors present, storefront banner + scrollability 360/414. Update flow34/flow37 if they break. Restore .env textbee after.

## Review Focus
- Legacy orders with status completed/pending — display only; selector can't produce completed either (label fallback added).
- New customers (barangay "") ordering — barangay taken from DB (""), location check skipped for the DB value; address (required at registration) always present.
- Admin browsing storefront — checkout unreachable (no cart); store toggle only via admin API.
- Race: store closed mid-checkout — server rejects at POST /orders.
