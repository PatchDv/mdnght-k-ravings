import crypto from "crypto";

// Dependency-free fixed-window rate limiter keyed by arbitrary strings
// (IP:route, phone:purpose, ...). Good enough for a single-node deployment;
// a multi-node install would move this to the DB or a shared store.
const buckets = new Map();

function sweep() {
  const now = Date.now();
  buckets.forEach((entry, bucketKey) => {
    if (entry.expiresAt < now) buckets.delete(bucketKey);
  });
}

function increment(key, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    bucket = { count: 0, expiresAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket;
}

// Consume a request immediately (default limiter).
export function rateLimit({ key, max, windowMs, message = "Too many requests. Please slow down." }) {
  sweep();
  const bucket = increment(key, windowMs);
  if (bucket.count > max) {
    const error = new Error(message);
    error.status = 429;
    error.retryAfter = Math.ceil((bucket.expiresAt - Date.now()) / 1000);
    throw error;
  }
  return true;
}

// Reserve WITHOUT consuming: use for flows where only a finished action
// (e.g. an account actually created) should count against the cap. Failures
// and validation errors stay free.
export function rateLimitReserve({ key, max, windowMs, message = "Too many requests. Please try again later." }) {
  sweep();
  const bucket = buckets.get(key);
  if (bucket && bucket.count >= max) {
    const error = new Error(message);
    error.status = 429;
    error.retryAfter = Math.ceil((bucket.expiresAt - Date.now()) / 1000);
    throw error;
  }
  return () => increment(key, windowMs);
}

// Read-only peek at a bucket's budget, for surfacing "attempts left" to the
// client without charging anything.
export function rateLimitRemaining({ key, max, windowMs }) {
  sweep();
  const bucket = buckets.get(key);
  if (!bucket || bucket.expiresAt <= Date.now()) return max;
  return Math.max(0, max - bucket.count);
}

export function clientIp(req) {
  const forward = req.headers["x-forwarded-for"];
  return (typeof forward === "string" ? forward.split(",")[0].trim() : "") || req.socket?.remoteAddress || "unknown";
}

export function secureRandomSuffix(length = 4) {
  return crypto.randomBytes(length).toString("hex");
}
