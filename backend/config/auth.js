import jwt from "jsonwebtoken";
import { env } from "./env.js";

// Validated by config/env.js: stable secret required in production.
const CUSTOMER_SECRET = env.customerJwtSecret;

export function signCustomerToken(customer, version = 0) {
  return jwt.sign(
    { id: customer.id, username: customer.username, role: "customer", version: Number(customer.token_version ?? version) },
    CUSTOMER_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyCustomerToken(token) {
  try {
    return jwt.verify(token, CUSTOMER_SECRET);
  } catch {
    return null;
  }
}
