# Browser & API probes

Scripted end-to-end checks that drive the real app in headless Microsoft Edge
(via `puppeteer-core`, a dev dependency) and call the live API. The unit tests
in `tests/` cover pure logic; these probes cover the whole stack running.

## Setup

1. The app must be running: `npm start` (probes target `http://localhost:3000`).
2. Credentials are read from environment variables — never committed:

```powershell
$env:DEMO_PHONE="09990000001"      # a demo customer's sign-in phone
$env:DEMO_PASSWORD="…"
$env:ADMIN_PASSWORD="…"            # the admin account's password
node tests/probes/verify-rebuild.mjs
```

3. Headless Edge is expected at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`
   (edit the `executablePath` in a probe if your Edge lives elsewhere). Chrome
   works too — any Chromium build with SpeechRecognition.

## What each probe checks

| Probe | Checks |
| --- | --- |
| `verify-rebuild.mjs` | The big one: recommendations stay removed, mobile My Order + bottom nav, K-Bot mobile sheet and the full voice ordering flow (add, clarify, correct, read-back, confirm, commit), admin board, door security, Back-to-Admin |
| `admin-storefront-check.mjs` | Admin/customer session separation, Back-to-Admin button, door refusal, storefront preview flagging |
| `verify-batch.mjs` | Sessions: customer sign-in/out, admin cookie survives customer sign-out and vice versa, expiry behavior |
| `verify-design.mjs` | Mobile layout: no horizontal overflow on any storefront page or admin view, login page layout |
| `verify-free-delivery-success.mjs` | Places a real ₱400+ order through the UI and verifies the receipt shows Free delivery with the correct total |
| `verify-fee-status.mjs` | Delivery fee quoting: pending → 10/15/20, free at 400+ |
| `verify-login-limit.mjs` | Admin door: attempt budget shown, lockout countdown, Enter-key cannot bypass |
| `check-customer-budget.mjs` | Customer sign-in answers 401 with a visible attempts-left budget |
| `e2e-new-features.mjs` | Kitchen queue FIFO + "Move to preparing", customer removal with typed confirmation (anonymization + audit) |

## Support scripts

- `cleanup.mjs` — after probe runs: removes probe-placed orders (everything that is not the labelled MK-DEMO / `is_demo` datasets), restores dishes hidden by the availability fixture within the last 2 hours.
- `inspect-db.mjs` — prints customers, orders, settings for a quick look.
- `creds.mjs` — shared environment-variable credential loader (no credentials live in this repository).
- `render-schema.mjs` / `render-flow.mjs` + `schema.html` / `flow.html` — regenerate the diagrams in `docs/` (`node tests/probes/render-schema.mjs`).

## One caution

Probes place real orders and toggle availability as part of their checks.
Run `node tests/probes/cleanup.mjs` after a probe session to return the
database to its clean demo state.
