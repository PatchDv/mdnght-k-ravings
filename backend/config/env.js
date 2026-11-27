// Central environment configuration. Fail fast in production when a secret is
// missing instead of silently minting fallbacks.
import crypto from "crypto";

// Minimal .env loader (no dotenv dependency): reads ./.env once, never
// overreading existing process.env values set by the host.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

const isProd = process.env.NODE_ENV === "production";

// Secrets may fall back to a random per-boot value ONLY in development.
// In production a missing secret is a startup failure (sessions must survive
// restarts and rely on a stable secret).
function requiredSecret(name) {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (isProd) {
    console.error(`Missing required environment variable ${name} (32+ chars). Refusing to start with insecure defaults.`);
    process.exit(1);
  }
  console.warn(`[dev] ${name} not set — using a random per-boot value. Sessions die on restart.`);
  return crypto.randomBytes(32).toString("hex");
}

// The admin door lives at one secret segment, e.g. /staff-portal-x7k2. Keep it
// in ADMIN_PATH so moving it is a config change, never a code change.
function normalizeAdminPath(raw) {
  const fallback = "/staff-portal-x7k2";
  let value = String(raw || fallback).trim();
  if (!value.startsWith("/")) value = `/${value}`;
  value = value.replace(/\/+$/, "");
  const reserved = new Set(["/", "/admin", "/admin.html", "/api", "/css", "/js", "/assets"]);
  if (!/^\/[A-Za-z0-9._~-]{6,}$/.test(value) || reserved.has(value.toLowerCase())) {
    console.error(`Invalid ADMIN_PATH '${raw}'. Use one long random segment, e.g. /staff-portal-x7k2.`);
    process.exit(1);
  }
  return value;
}

// One secret per signing audience; sharing would let a customer token
// authenticate as admin if the payload roles ever matched by accident.
export const env = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  customerJwtSecret: requiredSecret("JWT_SECRET"),
  // Separate salt/pepper for OTP hashing so a leaked JWT secret cannot turn a
  // stored OTP hash back into a code.
  otpPepper: requiredSecret("OTP_PEPPER"),
  adminJwtSecret: process.env.ADMIN_JWT_SECRET
    ? (process.env.ADMIN_JWT_SECRET.length >= 32 ? process.env.ADMIN_JWT_SECRET : (isProd ? (console.error("ADMIN_JWT_SECRET must be 32+ chars."), process.exit(1)) : console.warn("[dev] ADMIN_JWT_SECRET too short.").value || process.env.ADMIN_JWT_SECRET))
    : (isProd ? (console.error("Missing ADMIN_JWT_SECRET. Refusing to start."), process.exit(1)) : crypto.randomBytes(32).toString("hex")),
  allowedOrigin: process.env.ALLOWED_ORIGIN || "",       // e.g. https://shop.example.com
  forceHttps: process.env.FORCE_HTTPS === "true",
  // SMS: textbee.dev — sends through the registered Android device's own SIM,
  // one route covers all PH networks. Device id optional (default device used
  // when omitted).
  smsProvider: process.env.SMS_PROVIDER || "",          // "textbee" | "console" (dev only)
  textbeeApiKey: process.env.TEXTBEE_API_KEY || "",
  textbeeDeviceId: process.env.TEXTBEE_DEVICE_ID || "",
  // Dev-only OTP visibility: with a real provider on a dev machine, this
  // returns the code in the HTTP response so automated tests can complete
  // flows. Production never sets it and the flag is force-disabled there.
  otpTestDebug: !isProd && process.env.OTP_TEST_DEBUG === "true",
  adminBootstrapPassword: process.env.ADMIN_PASSWORD || "",
  adminBootstrapUsername: process.env.ADMIN_USERNAME || "",
  // Secret path for the staff door (login page + /board dashboard).
  adminPath: normalizeAdminPath(process.env.ADMIN_PATH)
};

export function validateSmsOrReport() {
  if (!env.smsProvider) return "NOT CONFIGURED: set SMS_PROVIDER.";
  if (env.smsProvider === "textbee") {
    if (!env.textbeeApiKey) return "SMS_PROVIDER=textbee but TEXTBEE_API_KEY is missing.";
    return null; // configured
  }
  if (env.smsProvider === "console") {
    if (env.isProd) return "SMS_PROVIDER=console is not allowed in production.";
    return null;
  }
  return `SMS_PROVIDER '${env.smsProvider}' is not supported (textbee or console).`;
}
