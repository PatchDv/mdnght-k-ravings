# SECURITY AUDIT REPORT — MDNGHT K-RAVINGS

**Date:** 2026-11-08
**Scope:** Full white-box audit + fixes + tests for the storefront, admin dashboard, backend API, database, and build configuration.
**Method:** Manual white-box code review + exploitation via automated tests (Puppeteer/fetch). The Strix automated scanner could not run — `strix` and `docker` are not installed on this machine — so every finding below comes from reading the actual source and proving issues with executable tests, not pattern guessing.

---

## 1. Executive summary

The application was rebuilt around a hard rule: **the server decides everything that matters** — identity, ownership, prices, session validity, and whether a phone number was actually verified. The largest gaps closed were:

- Customer registration had **no phone verification at all** (single-step form). Now a 5-step wizard exists where the server enforces every step, backed by real SMS-capable OTP infrastructure.
- **No rate limiting anywhere.** Now: login lockouts (failures only), OTP request/verify caps + cooldown + daily cap, registration and password-reset caps, order-create caps, order-tracking caps.
- **No security headers, open CORS, no HTTPS enforcement option.** Now: CSP + full header stack, CORS allowlist, `FORCE_HTTPS` redirect + HSTS.
- **Password reset did not exist.** Now: OTP-based, single-use step token, session invalidation via `token_version` rotation.
- Session secrets were random per boot (or missing) with **no environment validation**. Now `config/env.js` validates all secrets and fails fast in production.
- Admin actions were unaudited; demo-data seeding ran in any mode. Now append-only audit table + demo seed hard-403s in production.

**Verdict: NOT READY FOR PRODUCTION yet** — the code is, but two external things are missing and must be done by the owner (§13, §14): a real SMS gateway account with an approved sender name, and production secrets/deploy configuration. Everything in code is implemented and tested.

---

## 2. Findings and fixes

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **Critical** | Registration created accounts with zero phone verification | **Fixed** — OTP wizard, server-enforced (§4) |
| 2 | **Critical** | No password reset; forgotten password = lost account | **Fixed** — OTP reset with session rotation |
| 3 | **High** | No rate limits on login/OTP/register/orders | **Fixed** — `utils/security.js` limiter on all sensitive routes |
| 4 | **High** | Default admin password `mdnght2026` acceptable in prod | **Fixed** — prod boot warns; password policy enforced on change; `ADMIN_PASSWORD` env |
| 5 | **High** | CORS wide open (`cors()` with no options) | **Fixed** — origin allowlist + `ALLOWED_ORIGIN` |
| 6 | **High** | No security headers / CSP | **Fixed** — CSP, XFO DENY, nosniff, no-referrer, Permissions-Policy, HSTS option |
| 7 | **High** | Session secrets random per boot; no env validation | **Fixed** — `config/env.js`, prod fail-fast, separate customer/admin/OTP secrets |
| 8 | **Medium** | No security audit trail for admin actions | **Fixed** — append-only `admin_audit` table + writes on every admin mutation + failed logins |
| 9 | **Medium** | Demo seed possible in production | **Fixed** — 403 in prod (tested) |
| 10 | **Medium** | Order lookup by number+phone was an unthrottled guessing vector | **Fixed** — rate limited; owner sessions skip phone; `customerId` stripped from public responses |
| 11 | **Medium** | Passwords bcrypt cost 8; weak policy | **Fixed** — cost 12, policy: ≥8 ≤128, letter+digit, common-password blocklist (register, reset, admin change) |
| 12 | **Medium** | `seed.js` hardcoded default admin password | **Mitigated** — `ADMIN_USERNAME`/`ADMIN_PASSWORD` env override; prod boot compares the default hash and warns loudly |
| 13 | **Low** | `.env` handling did not exist | **Fixed** — `.env` (real secrets, gitignored), `.env.example`, tiny dependency-free loader |
| 14 | **Low** | `x-powered-by` exposed | Already disabled; kept |
| 15 | **Info** | Tokens in `localStorage` (customers/admin) | **Accepted risk** (§13) — CSP restricts script origins; cookie refactor would break the tested frontend |
| 16 | **Info** | `trust proxy` not set | **Fixed** (`trust proxy 1`) for `FORCE_HTTPS`/`clientIp` behind reverse proxies |

### What was already good (verified, unchanged)
- Server-side re-pricing of orders (`utils/pricing.js` recalculates from DB; browser price tampering cannot change totals — tested, F4).
- Parameterized SQL everywhere (no string-concatenated queries found in any route).
- Delivery fee is per order, set by the admin through an authenticated endpoint; the client cannot choose it.
- Bcrypt hashing of all passwords (admin + customers); hashes never returned by any API.

---

## 3. Authentication & password security

- bcrypt cost **12** for every password hash (registration, reset, admin change).
- Password policy enforced **server-side** and surfaced in UI: 8–128 chars, letter+digit, common-password blocklist.
- Password/confirm mismatch, weak passwords, and common passwords all rejected (tested C8, C9, E6).
- **No password hashes or plaintext ever returned** by any endpoint (customer `serializeCustomer`, admin payloads, login responses audited).
- Login accepts mobile number or legacy username; generic "Wrong username or password" (no account-existence reveal).
- Failed-login lockouts count **only failures** (10/5min customers, 5/5min admin per IP) — repeated legitimate sign-ins are never punished.
- Sessions: JWT with separate secrets per audience; customer tokens 7d, admin 10h; every protected request re-checks `customers.token_version` against the token — a password reset kills all previous sessions instantly (tested E8).

## 4. Phone-OTP registration wizard

1. **Step 1 – number + code:** PH numbers normalized to E.164 (`+63…`) server- and client-side. 6-digit code, HMAC-SHA256 hashed with `OTP_PEPPER`, 5-min expiry, single use, max 5 wrong attempts, 60-second resend cooldown, max 5 requests/day per number, old codes invalidated on reissue. Codes never logged; dev-console channel returns the code **only** when `SMS_PROVIDER=console` **and** `NODE_ENV !== production`.
2. **Step 2–4 – name / password + confirm / barangay:** the server enforces every field on final submit; barangay validated against the real 27-barangay Mabalacat list; a code from the reset screen cannot register, and vice-versa (tested E5).
3. **Step 5 – created:** account created only after a verified step token (10-minute TTL), returns session + auto-login; "Your account has been successfully created!" screen then redirects to the storefront.

**Reset flow:** existing numbers get the same OTP discipline; unknown numbers get an identical 200 shape with nothing sent (no account probing). Reset requires password policy + version bump (all older sessions die).

## 5. SMS provider (needs owner action)

- `SMS_PROVIDER=textbee` → calls textbee.dev `POST /api/v1/gateway/send-sms` with `TEXTBEE_API_KEY` (`x-api-key` header), recipients in `+63…` E.164, message text `Your MDNGHT K-RAVINGS verification code is …`. Every response is shape-validated (`backend/utils/textbee.js`); a gateway failure returns **502 to the customer — never a fake "sent"**. Accepted sends persist the gateway `smsBatchId` in `sms_message_id` for delivery checks. Sends go out through the registered Android device's own SIM (one route covers all PH networks); boot probe `GET /gateway/devices` warns on bad key, no enabled device, or a stale heartbeat. Optional `TEXTBEE_DEVICE_ID` pins a specific device.
- `SMS_PROVIDER=console` → dev-only: sends nothing, `_dev-sms_` log omits the code, HTTP response carries `devCode` **only in non-production** (turned off automatically in prod — tested P5/P6).

## 6. Database & customer data isolation

- WAL mode, parameterized queries everywhere (audited every route module).
- New tables: `otp_requests` (hashed codes, expiry indexes, boot-time sweep), `admin_audit` (append-only).
- New column `customers.token_version` (session rotation), index on phone.
- **IDOR posture:** identity always comes from the Bearer token, ownership always filtered by `customer_id = token.id`; a customer's orders endpoint returns only token-owned rows; cross-customer order tracking with another customer's phone → 403 (tested F2/F3); public tracking strips `customerId` (F5).
- **Price tampering:** server re-prices everything from menu data — `unitPrice: 0.5` tamper test produced a correctly priced order (F4); unavailable items → 400 (F7, D-check in flow23).
- Automated boot-time backup of the SQLite files into `backups/` before migrations; manual pre-migration backup: `backups/database-20261108-192901.sqlite`.

## 7. API keys and environment protection

- `config/env.js` centralizes: `JWT_SECRET`, `ADMIN_JWT_SECRET`, `OTP_PEPPER` (32+ chars, fail-fast exit in prod), `SMS_PROVIDER`, `IPROGSMS_API_TOKEN`, `SMS_SENDER_NAME`, `ALLOWED_ORIGIN`, `FORCE_HTTPS`, `ADMIN_PASSWORD`.
- Dev fallbacks are random-per-boot and loudly warned; production refuses to start without full secrets (tested P8/P9).
- `.env` holds the real dev secrets and is in `.gitignore` (`.env`, `backups/`, DB files, logs). `.env.example` contains placeholders only.
- Frontend never receives any secret (`js/config.js` carries only public base URL + static barangay list).
- Secret scan of the working tree (`backend/`, `frontend/`, `tests/`, seed data, root configs): **no hardcoded keys, tokens, or passwords found**. The only file with real secret values is `.env` itself (gitignored).

## 8. Admin security

- `ADMIN_JWT_SECRET` separate from the customer secret; admin token 10h.
- Every admin API requires role-verified Bearer token; customer tokens → 401 (tested B1).
- `admin_audit` records: login, login failures (with attempted username), menu create/update/delete, availability toggles, order status changes, account changes, expense add/delete, demo clear.
- Admin password change enforces the same policy and requires the current password.
- Demo seeding disabled in production (403 on both POST and DELETE; tested P3/P4).

## 9. HTTPS, sessions, CSRF

- `FORCE_HTTPS=true` → 301 redirect for all GETs + `Strict-Transport-Security: max-age=31536000, includeSubDomains`; `trust proxy 1` set. Off in dev by default (no TLS terminating in front of localhost).
- Auth is Bearer-token, not cookie-based; sessions are **not** sent automatically by the browser, which removes the classic CSRF vector (a forged cross-site POST cannot carry our Authorization header). CORS allowlist additionally blocks cross-origin reads. Documented tradeoff: tokens live in `localStorage` (§13).
- State-changing endpoints additionally rate-limited and (for admin) audited.

## 10. Dependency audit (`npm audit`)

- `npm audit fix` applied; the remaining **7 advisories (2 low, 4 high, 1 critical)** are all in `tar`
  pulled by `@mapbox/node-pre-gyp` inside **`sqlite3` 5.x for binary download at install time**.
  This code is never loaded at runtime; exposure is build-machine-only.
- The fixes would force **sqlite3 6.0.1 (breaking major)**. Not applied blindly — recommend upgrading deliberately and re-running the full suite on a quiet day.
- No unused dependencies found to remove.

## 11. Git history and secret scan

- **This project is not a git repository** (`.git` absent). There is no commit history to scan.
- Working-tree scan (source files, configs, test fixtures; `node_modules` excluded) for API keys (`TEXTBEE_API_KEY=`, `apikey:`, `sk_live`, `ghp_`, `AIza…`), tokens and credential-like strings: **clean**. Only `.env` contains real secrets and it is gitignored.
- Before the first remote push: create the repo, verify the ignore rules with `git status`, and never commit `backups/` or `.env`.

## 12. Security tests performed

**Unit (`node --test tests/` → 27/27 pass)** — phone normalization, password policy, cart sanitizer shape/limit abuse, rate limiter cap + 429 + per-key isolation.

**E2E security suite (`flow34-security-e2e.mjs` → 58/58 pass)**

| Test | Result |
|---|---|
| CSP + frame-ancestors + DENY + nosniff + no-referrer + Permissions-Policy on `/`, `/admin` | PASS |
| Customer token on admin API / no token / garbage token → 401/401/401 | PASS |
| SQL-injection login probe → rejected | PASS |
| OTP issue w/ devCode; immediate resend → 429; wrong code attempts counter | PASS |
| Verified step token; single-use code reuse → 400 | PASS |
| Register without valid step token → 403 (×2 variants) | PASS |
| Confirm mismatch / common password / invented barangay rejected | PASS |
| Full wizard register → 201 + session; new account can log in | PASS |
| Existing number re-register → 409 | PASS |
| Expired correct code (DB-manipulated) → 400 | PASS |
| Attempt cap kills later correct code → 400 | PASS |
| Reset: unknown number no-reveal; reset code single-use; reset token can't register; weak password rejected; reset succeeds; old session dead (401); new password works | PASS (7/7) |
| Own cart isolation; B never sees A's orders; B's phone on A's order → 403 | PASS |
| Price tamper → server re-price correct total | PASS |
| Unavailable item order → 400 (+ state restored) | PASS |
| Anonymous order → 401 | PASS |
| Public order-track hides customerId; owner phone-track works | PASS |
| **UI wizard browser flow**: 5 steps, devCode autofill, resend cooldown disabled button, mismatch error, barangay select, success screen, auto-redirect, saved session, no page errors | PASS (11/11) |
| **UI forgot-password flow** end-to-end + sign-in with new password | PASS |
| Admin/customer failure-count lockouts trip 429 | PASS |

**Production mode (`flow35-prod-mode.mjs` → 9/9 pass)** — prod boot with secrets; seed-demo 403×2; console-SMS refused (no devCode, no logs); CSP in prod; boot without secrets refuses to start with fail-fast message.

**Regression (all green after the changes)** — flow23 storefront, flow27 admin full (25/25), flow28 admin mobile, flow29 bridge (18/18), flow31 admin actions (12/12), flow32 optimistic cart (12/12), flow33 nav fixes (10/10), flow34 (58/58), unit 27/27.

**NOT TESTED (stated honestly)**
- Real SMS delivery — no gateway credentials exist yet (§14). Only the dev channel and failure path are proven.
- Order-create rate limiter under a real 11-order burst (limiter unit-tested; skipped in e2e to avoid 11 junk orders in business data).
- Multi-IP distributed OTP abuse (single-node limiter is per-IP; a CDN/proxy IP farm is out of scope).
- File uploads — the app has **no upload feature**; nothing to test (and deliberately none added).

## 13. Remaining risks (accepted, documented)

1. **Tokens in localStorage** — XSS is the threat; mitigations: strict CSP (`frame-ancestors none`, `default-src self`), all user data rendered via `textContent` in existing UI code, no `innerHTML` on user input audited. A HttpOnly-cookie redesign would touch every authenticated call in the tested frontend — deferred as a deliberate later migration, not a silent gamble.
2. **Inline `'unsafe-inline'` script/style CSP** — the frontend is vanilla HTML/JS with load-bearing inline blocks and no build step; nonces require bundling. XSS impact is reduced by textContent-everywhere rendering; flagged `shortcut:` in `server.js` for a future migration.
3. **In-memory rate limiter** — resets on restart, single-node only. Fine for one small Node process; note for future multi-node hosting.
4. **Order "track by phone"** — anyone who knows an order number AND the checkout phone can view it (rate-limited 20/5min/IP). This is the existing customer-facing tracking feature, kept for business continuity; the phone check was never removed.

## 14. Required manual actions (owner)

1. **textbee.dev account + API key (`TEXTBEE_API_KEY`), registered online Android device (textbee app, heartbeat).
2. **Production secrets** — generate fresh 32+ char `JWT_SECRET`, `ADMIN_JWT_SECRET`, `OTP_PEPPER` on the production host's `.env` (never reuse dev values) + `NODE_ENV=production`, `ALLOWED_ORIGIN=<deployment hostname>`, `FORCE_HTTPS=true`.
3. **Domain + TLS terminator** (reverse proxy or host with HTTPS cert) — the 301/HSTS path activates when `FORCE_HTTPS=true`.
4. **Change the admin password** if the seeded `admin/mdnght2026` is ever used in production (boot check warns).
5. Optional: upgrade sqlite3 → 6.x deliberately (resolves remaining `tar` advisories, build-time only).
6. Optional: run `npm audit` on the prod machine after its first install.

## 15. Production deployment checklist

- [ ] textbee.dev provider live (API key + online Android device pending from owner)
- [ ] Fresh secrets set; `NODE_ENV=production`; server boots with no `Refusing to start` and no `SMS:` warning
- [ ] `FORCE_HTTPS=true` + proxy in front; `https://` loads site, headers present (`curl -I`)
- [ ] `ALLOWED_ORIGIN` = the real storefront origin
- [ ] Admin password changed from default; first login audited
- [ ] Place one real end-to-end test order (registration → OTP → order) on the live gateway
- [ ] `SECURITY_AUDIT_REPORT.md` targeted for re-check after launch changes
