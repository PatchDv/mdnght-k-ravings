// Shared credentials for the probe scripts, read from environment variables
// so no real credential ever lives in this repository.
//
// Set before running any probe (PowerShell):
//   $env:DEMO_PHONE="09990000001"; $env:DEMO_PASSWORD="…"; $env:ADMIN_PASSWORD="…"
// DEMO_USERNAME defaults to "demo1".
export function loadCreds() {
  const phone = process.env.DEMO_PHONE;
  const password = process.env.DEMO_PASSWORD;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!phone || !password || !adminPassword) {
    throw new Error(
      "Probes need credentials in environment variables: DEMO_PHONE, DEMO_PASSWORD, ADMIN_PASSWORD. " +
      "See tests/probes/README.md."
    );
  }
  return { phone, password, adminPassword, username: process.env.DEMO_USERNAME || "demo1" };
}
