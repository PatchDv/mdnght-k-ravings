# Account, Address & Profile Improvements — Implementation Plan

**Goal:** easier account creation (password UX, manual address), cleaner storefront, professional name display.

**Spec:** user's BUILD MODE brief (2026-11-18). Files all in `C:\Users\admin\Desktop\CamsKraving` + e2e in `C:\Users\admin\AppData\Local\Temp\pptr`.

**Architecture:** no DB migration needed — `customers.address`/`landmark` TEXT columns already exist and are nullable; barangay stays NOT NULL but new registrations insert `""` (no invented address). Names title-cased at save (register, order creation) and at display (serializeCustomer, admin customers). Password policy = existing `validatePassword` + new 12-char max, mirrored in the two wizard inputs.

## Global Constraints
- Do not break OTP verification or the step order (1 number, 2 code, 3 password, 4 name, 5 location, 6 done).
- Preserve existing accounts/orders/address records; no destructive migration.
- Passwords: bcrypt only, never plaintext (already true).
- 12-char max enforced on both password fields AND backend.
- Do not invent/assign addresses; manual entry only.
- e2e suites run with `SMS_PROVIDER=console`; restore `textbee` after.

## Tasks

### Task 1: Backend password policy + name formatting (TDD)
- Modify: `backend/routes/customers.js`
- Test: create `tests/registration-policy.test.js` (node --test)
- `validatePassword`: add `if (value.length > 12) return "Use 12 characters or fewer..."` (min 8 stays).
- Export `titleCaseName(value)`: trim, collapse inner spaces, capitalize first letter of each word, lowercase rest (`matt`→`Matt`, `MARIA`→`Maria`, `anna mae`→`Anna Mae`).
- Register route: apply `titleCaseName` to firstName/lastName; barangay optional (absent ⇒ `""`); address now required: trim, reject if <10 or >240 chars with a clear message; store slice 240.
- `serializeCustomer`: title-case names on the way out (legacy lowercase rows display correctly).
- Steps: failing unit tests → implement → tests pass.

### Task 2: Order names capitalized at creation
- Modify: `backend/routes/orders.js` (order create), `backend/routes/admin.js` (`/customers` display name)
- Import `titleCaseName`; apply to order firstName/lastName; capitalize `row.name` in admin customers listing.

### Task 3: Step 3 password UX
- Modify: `frontend/login.html` (HTML step 3 + JS handler)
- Both inputs `maxlength="12"`, placeholder `8–12 characters`.
- New: strength meter `<p id="reg-pass-strength">` (Weak/Medium/Strong; Strong = ≥8 chars + 3 of 4 classes incl. a special char encouraged; Medium = ≥8 + 2 classes; else Weak).
- New: "Suggest a strong password" button — on click generates a random 12-char password (upper+lower+digit+special via `crypto.getRandomValues`), fills BOTH fields, updates meter. Never auto-fills/saves without the click.
- Keep confirm + match check; add copy: "Please remember your password. You will need it to log in to your account." and recommendation of upper/lower/number/special.
- Show/hide toggles already exist (pass-toggle).
- Frontend match message stays "Those passwords do not match."

### Task 4: Step 5 manual address
- Modify: `frontend/login.html` step 5 HTML + JS
- Remove: `#r-barangay` select, its label, the location breadcrumb, `#r-nearest`.
- Add: `<textarea id="r-address">` (rows≈3, required, maxlength 240) labeled "Complete Delivery Address", helper "Enter your block, lot, phase, street, and barangay or subdivision.", placeholder `"Blk, Lot, Phase, Street, Madapdap Resettlement Center, Dapdap, Mabalacat City, Pampanga"`.
- Keep `#r-landmark` optional, relabel "Nearby Place or Landmark", placeholder "Example: Near Madapdap Elementary School or beside a sari-sari store".
- Register payload: `address: $("#r-address").value.trim(), landmark: $("#r-landmark").value.trim()` (no barangay key). Error message if server rejects address.
- Profile render fallback in `app.js`: `${esc(profile.barangay || "Madapdap")}` → show "Mabalacat City, Pampanga" when barangay empty (no invented barangay).

### Task 5: Storefront scrollbar
- Modify: `frontend/css/styles.css`
- `html { scrollbar-width: none; } html::-webkit-scrollbar { width: 0; height: 0; }` — page stays fully scrollable (wheel/touch/keys), scrollbar chrome hidden. No global overflow:hidden.

### Task 6: e2e updates + full battery
- Update `flow37` A-section: password step (type 14 chars ⇒ value stays 12; strength text present; suggest button fills both fields and they match), step 5 = `#r-address` textarea + `#r-landmark`, A9 asserts saved address/landmark; no `#r-barangay`.
- Update `flow34` G-section same way. `flow23` line 25 check its usage. probe/repro leftovers irrelevant.
- Run: units, flow37, flow34 (fresh server), quick manual-address + scrollbar + name-cap probe; restore `.env` textbee.

## Review Focus
- Existing customers with long passwords (>12) — sign-in unaffected (login has no max): verify.
- Legacy lowercase names — display-side title-casing must not corrupt mixed-case names on write paths (only normalize at register/order-create writes; serialize display).
- Checkout for new users with empty barangay — select shows no preselect, user picks; address prefill from profile.
- Admin order details show order.address + landmark (already rendered).
