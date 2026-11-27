window.MK_API = (function () {
  const base = window.MK_CONFIG.API_BASE;

  // Doubles as the CSRF header value: the server sets this readable cookie,
  // the httpOnly session cookie stays out of reach of scripts.
  function readCookie(name) {
    const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
  }

  async function request(path, options = {}) {
    const method = options.method || "GET";
    const headers = { "Content-Type": "application/json" };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (path.startsWith("/admin") && !["GET", "HEAD"].includes(method)) {
      headers["X-CSRF-Token"] = readCookie("mk_admin_csrf");
    }

    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const error = new Error(payload?.error || "Something went wrong. Please try again.");
      error.status = response.status;
      error.retryAfter = payload?.retryAfter;
      error.attemptsLeft = payload?.attemptsLeft;
      throw error;
    }

    return payload?.data;
  }

  function customerToken() {
    return localStorage.getItem(window.MK_CONFIG.STORAGE.CUSTOMER_TOKEN) || "";
  }

  return {
    getMenu: () => request("/menu"),
    createOrder: (order) => request("/orders", { method: "POST", token: customerToken(), body: order }),
    getStoreStatus: () => request("/store"),

    customerLogin: (username, password) =>
      request("/customers/login", { method: "POST", body: { username, password } }),
    // Who is signed in on the storefront: customer token or, server-side, an
    // admin cookie. Never returns an admin token to JavaScript.
    customerSession: () => request("/customers/session", { token: customerToken() }),
    // Phone-OTP registration wizard. stepToken proves the server verified the
    // phone; it never comes from and is never trusted by the client alone.
    customerOtpRequest: (phone, mode) =>
      request("/customers/otp/request", { method: "POST", body: { phone, mode } }),
    customerOtpVerify: (phone, code) =>
      request("/customers/otp/verify", { method: "POST", body: { phone, code } }),
    customerRegister: (payload, stepToken) =>
      request("/customers/register", { method: "POST", token: stepToken, body: payload }),
    customerPasswordReset: (payload, stepToken) =>
      request("/customers/password/reset", { method: "POST", token: stepToken, body: payload }),
    customerCart: () => request("/customers/cart", { token: customerToken() }),
    customerSaveCart: (lines) =>
      request("/customers/cart", { method: "PUT", token: customerToken(), body: { cart: lines } }),
    customerOrders: () => request("/customers/orders", { token: customerToken() }),
    customerUpdateProfile: (payload) =>
      request("/customers/profile", { method: "PUT", token: customerToken(), body: payload }),
    getOrder: (orderNumber, phone) =>
      request(`/orders/${encodeURIComponent(orderNumber)}?phone=${encodeURIComponent(phone)}`),

    adminLogin: (username, password) =>
      request("/admin/login", { method: "POST", body: { username, password } }),
    adminLogout: () => request("/admin/logout", { method: "POST" }),
    adminOverview: () => request("/admin/overview"),
    adminSettings: () => request("/admin/settings"),
    adminSaveSettings: (payload) =>
      request("/admin/settings", { method: "PUT", body: payload }),
    adminMenu: () => request("/admin/menu"),
    adminCreateItem: (item) =>
      request("/admin/menu", { method: "POST", body: item }),
    adminUpdateItem: (id, item) =>
      request(`/admin/menu/${id}`, { method: "PUT", body: item }),
    adminDeleteItem: (id) =>
      request(`/admin/menu/${id}`, { method: "DELETE" }),
    adminSetAvailability: (id, isAvailable) =>
      request(`/admin/menu/${id}/availability`, { method: "PATCH", body: { isAvailable } }),
    adminOrders: () => request("/admin/orders"),
    adminOrderQueue: () => request("/admin/orders-queue"),
    // The storefront's Back-to-Admin button asks for the door only when an
    // admin session exists; the path never ships in static page source.
    adminDoor: () => request("/admin/door"),
    adminAccount: () => request("/admin/account"),
    adminUpdateAccount: (payload) =>
      request("/admin/account", { method: "PUT", body: payload }),
    adminUpdateOrderStatus: (id, status) =>
      request(`/admin/orders/${id}/status`, { method: "PATCH", body: { status } }),
    adminSetDeliveryFee: (id, deliveryFee) =>
      request(`/admin/orders/${id}/delivery-fee`, { method: "PATCH", body: { deliveryFee } }),
    adminAnalytics: (mode, from, to) =>
      request(`/admin/analytics?mode=${encodeURIComponent(mode || "all")}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`),
    adminCustomers: (mode) =>
      request(`/admin/customers?mode=${encodeURIComponent(mode || "all")}`),
    adminDeleteCustomer: (id) =>
      request(`/admin/customers/${id}`, { method: "DELETE" }),
    adminSetCost: (id, costPrice) =>
      request(`/admin/menu/${id}/cost`, { method: "PUT", body: { costPrice } }),
    adminExpenses: (mode) =>
      request(`/admin/expenses?mode=${encodeURIComponent(mode || "all")}`),
    adminAddExpense: (payload) =>
      request("/admin/expenses", { method: "POST", body: payload }),
    adminDeleteExpense: (id) =>
      request(`/admin/expenses/${id}`, { method: "DELETE" }),
    adminSeedDemo: (reset) =>
      request("/admin/seed-demo", { method: "POST", body: { reset: Boolean(reset) } }),
    adminClearDemo: () =>
      request("/admin/seed-demo", { method: "DELETE" })
  };
})();
