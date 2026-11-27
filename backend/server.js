import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { initDb, DB_PATH } from "./config/db.js";
import { getStoreOpen } from "./config/settings.js";
import { env, validateSmsOrReport } from "./config/env.js";
import { readAdminSession } from "./config/adminAuth.js";
import fs from "fs";
import { seedDatabase } from "./seed/seed.js";
import menuRoutes from "./routes/menu.js";
import orderRoutes from "./routes/orders.js";
import adminRoutes from "./routes/admin.js";
import customerRoutes from "./routes/customers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.join(__dirname, "..", "frontend");
const viewsDir = path.join(__dirname, "views");
const ADMIN_PATH = env.adminPath;
const ADMIN_BOARD = `${ADMIN_PATH}/board`;

const app = express();
const PORT = env.port;

app.disable("x-powered-by");
app.set("trust proxy", 1); // X-Forwarded-For/Proto behind the hosting proxy

// Redirect browsers to HTTPS before anything else when the platform asks for
// it. Trust proxy reads X-Forwarded-Proto from the TLS terminator.
app.use((req, res, next) => {
  if (env.forceHttps && req.protocol === "http" && req.method === "GET") {
    return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
  }
  next();
});

// Security headers on every response, static files included.
// CSP: everything is same-origin; inline <style> blocks stay allowed because
// the pages carry their layout styles inline; localhost connect for dev
// mirror serving (file:// / Live Server) against the API.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // https: is required by Menu Studio's custom dish-image URLs (admin-entered).
  "img-src 'self' data: https:",
  // shortcut: inline scripts/styles are load-bearing on every page (vanilla
  // site, no build step); upgrade to nonces/hashes only alongside a bundler.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "script-src 'self' 'unsafe-inline'",
  // dev only: any-host :3000 lets LAN devices on Live Server / file mirrors
  // reach the local API; production stays strictly same-origin.
  `connect-src 'self'${env.isProd ? "" : " http://localhost:3000 http://127.0.0.1:3000 http://*:3000"}`
].join("; ");
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // microphone=(self): K-Bot's speech recognition needs the mic on our own
  // origin; camera and geolocation stay fully disabled.
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  if (env.forceHttps) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// Bearer-token API: browsers cannot accidentally send our auth across origins,
// but the public menu data need not be open to any origin either. CORS stays
// explicitly allowlisted (same-origin requests carry no Origin header).
const allowedOrigins = new Set(
  [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    env.isProd ? env.allowedOrigin : "",
    env.allowedOrigin
  ].filter(Boolean)
);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false); // no Access-Control-Allow-Origin: browser blocks the call
  },
  maxAge: 600
}));

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "MDNGHT K-RAVINGS is awake.", timestamp: new Date().toISOString() });
});

// Public storefront status: no auth — the menu page needs it before sign-in.
app.get("/api/store", async (req, res) => {
  try {
    res.json({ success: true, data: { open: await getStoreOpen() } });
  } catch (error) {
    console.error("Store status failed:", error);
    res.status(500).json({ success: false, error: "Could not load store status." });
  }
});

app.use("/api/menu", menuRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/customers", customerRoutes);

// Staff door: one secret segment from ADMIN_PATH. The login page is public at
// that path; the board is a separate route gated by a live admin session and
// answers 404 (not 401) so a customer never learns the dashboard exists.
function markAdminPage(res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
}

app.get(ADMIN_PATH, async (req, res) => {
  markAdminPage(res);
  const session = await readAdminSession(req).catch(() => null);
  if (session) return res.redirect(302, ADMIN_BOARD);
  res.sendFile(path.join(viewsDir, "staff-login.html"));
});

app.get(ADMIN_BOARD, async (req, res) => {
  markAdminPage(res);
  const session = await readAdminSession(req).catch(() => null);
  if (!session) return res.status(404).sendFile(path.join(frontendDir, "404.html"));
  res.sendFile(path.join(viewsDir, "admin.html"));
});

// Bots are told to stay out of both the retired path and the live one.
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(
    `User-agent: *\nDisallow: /admin\nDisallow: ${ADMIN_PATH}\nDisallow: /api/admin\n`
  );
});

// Some browsers speculatively fetch relative asset URLs before the page's
// <base> tag applies, producing paths like ${ADMIN_PATH}/js/config.js (door
// prefix + the real path). Redirect those to the real frontend file instead
// of answering 404 — the assets themselves are public.
app.use((req, res, next) => {
  if (req.method === "GET" && req.path.startsWith(ADMIN_PATH + "/")) {
    const rest = req.path.slice(ADMIN_PATH.length + 1);
    if (/^(js|css|assets)\//.test(rest)) {
      return res.redirect(301, "/" + rest);
    }
  }
  next();
});

app.use(express.static(frontendDir, {
  setHeaders(res, filePath) {
    if (/\.(html|css|js)$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

app.use("/api", (req, res) => {
  res.status(404).json({ success: false, error: "API route not found." });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(frontendDir, "404.html"));
});

// 500: friendly page for browser navigations, JSON for API calls. Stack
// traces and internal error text never reach the visitor.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  const wantsJson = req.path.startsWith("/api") || !String(req.headers.accept || "").includes("text/html");
  if (wantsJson) {
    return res.status(500).json({ success: false, error: "Something went wrong. Please try again in a moment." });
  }
  res.status(500).sendFile(path.join(frontendDir, "500.html"));
});

async function start() {
  try {
    const smsProblem = validateSmsOrReport();
    if (smsProblem) console.warn("SMS:", smsProblem);
    else console.log(`SMS provider ready: ${env.smsProvider}${env.textbeeDeviceId ? ` (device ${env.textbeeDeviceId})` : ""}`);
    // textbee only queues to the device — if no device is registered/online
    // nothing will ever send. Probe the device list once at boot so a bad key
    // or offline phone is loud at startup, not at the first customer's OTP.
    if (env.smsProvider === "textbee" && env.textbeeApiKey) {
      try {
        const probe = await fetch(`${"https://api.textbee.dev/api/v1"}/gateway/devices`, {
          headers: { "x-api-key": env.textbeeApiKey }
        });
        const body = await probe.json().catch(() => null);
        if (probe.status === 401) {
          console.warn("SMS WARNING: textbee rejected the API key — no OTP will be delivered until TEXTBEE_API_KEY is fixed.");
        } else if (probe.ok) {
          const devices = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.devices) ? body.data.devices : [];
          const enabled = devices.filter((d) => d.enabled);
          if (enabled.length === 0) {
            console.warn("SMS WARNING: no enabled textbee device — register the Android app (textbee.dev/dashboard) or no OTP will be delivered.");
          } else {
            const heartbeat = Math.max(...enabled.map((d) => Date.parse(d.lastHeartbeat) || 0));
            const staleMin = Math.round((Date.now() - heartbeat) / 60000);
            if (!heartbeat) console.warn("SMS WARNING: textbee device has never reported a heartbeat.");
            else if (staleMin > 10) console.warn(`SMS WARNING: textbee device heartbeat is ${staleMin} min stale — the phone may be offline.`);
            else console.log(`SMS: textbee device online (heartbeat ${staleMin || "<1"} min ago).`);
          }
        }
      } catch { /* offline at boot — sends will surface errors themselves */ }
    }
    // Snapshot the DB BEFORE migrations touch the schema.
    fs.mkdirSync(path.join(__dirname, "..", "backups"), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (const suffix of ["", "-wal", "-shm"]) {
      const source = `${DB_PATH}${suffix}`;
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(__dirname, "..", "backups", `database-${stamp}${suffix || ".sqlite"}`));
    }
    await initDb();
    await seedDatabase();
    app.listen(PORT, () => {
      console.log("");
      console.log("  MDNGHT K-RAVINGS");
      console.log(`  Store: http://localhost:${PORT}`);
      console.log(`  Staff: http://localhost:${PORT}${ADMIN_PATH}`);
      console.log("");
    });
  } catch (error) {
    console.error("Failed to start:", error);
    process.exit(1);
  }
}

start();
