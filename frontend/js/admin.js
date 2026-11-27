/**
 * MDNGHT K-RAVINGS - Kitchen Board
 * Admin authentication, insights, menu studio, and order flow.
 */
(function () {
  "use strict";

  const CFG = window.MK_CONFIG;
  const API = window.MK_API;
  const A = window.MKAlgorithms;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = (value) => A.escapeHtml(value);
  const money = (value) => A.formatPeso(value);

  // sessionStorage key for the admin's last dashboard section.
  const VIEW_KEY = "mk_admin_view";

  const STATUS_LABELS = {
    pending: "Pending",
    confirmed: "Confirmed",
    preparing: "Preparing",
    delivering: "On the way",
    delivered: "Delivered",
    cancelled: "Cancelled",
    // Legacy rows only: never offered in the selector, shown for history.
    completed: "Completed"
  };

  const state = {
    adminName: sessionStorage.getItem(CFG.STORAGE.ADMIN_NAME) || "Kitchen Admin",
    ready: false,
    overview: null,
    menu: null,
    orders: [],
    orderStatus: "all",
    // A round trip to the storefront (or a reload) must not dump the admin
    // back on Overview; the live section is kept in sessionStorage. setView
    // validates the name on boot, so stale or hand-edited values are safe.
    view: sessionStorage.getItem(VIEW_KEY) || "insights",
    menuQuery: "",
    category: "all",
    editingId: null,
    editorGroups: [],
    busy: false,
    profit: null,           // analytics payload for the Profit view
    profitMode: "all",
    profitFilter: "14",
    profitLoaded: false,
    customers: [],
    customerQuery: "",
    expandedCustomer: null,
    confirmDeletePhone: null,
    orderQueue: null,
    storeOpen: true
  };

  // Admin-selectable statuses. Pending is retired; legacy pending rows stay
  // visible but can only be moved forward to one of these.
  const SELECTABLE_STATUSES = ["confirmed", "preparing", "delivering", "delivered", "cancelled"];

  const els = {};


  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    setDate();
    bindShell();
    bindMenuStudio();
    bindOrders();
    bindEditor();
    bindProfile();
    bindProfit();
    bindCustomers();
    bindStoreControl();

    // Verify the session on the server before showing anything: an expired or
    // missing session (e.g. this file opened directly from disk) goes back to
    // the staff door instead of a dead board.
    boot();
  }

  async function boot() {
    try {
      const account = await API.adminAccount();
      state.adminName = account?.name || state.adminName;
      sessionStorage.setItem(CFG.STORAGE.ADMIN_NAME, state.adminName);
      showApp();
      loadData();
    } catch {
      redirectToLogin();
    }
  }

  function cacheElements() {
    els.app = $("#admin-app");
    els.pageTitle = $("#admin-page-title");
    els.kicker = $("#admin-kicker");
    els.date = $("#admin-date");
    els.avatar = $("#admin-avatar");
    els.menuList = $("#admin-menu-list");
    els.menuCount = $("#admin-menu-count");
    els.menuSearch = $("#admin-menu-search");
    els.categoryFilter = $("#admin-category-filter");
    els.sidebarCount = $("#sidebar-order-count");
    els.orderStatusFilter = $("#order-status-filter");
    els.ordersList = $("#admin-orders");
    els.queueHead = $("#order-queue-head");
    els.editorModal = $("#editor-modal");
    els.editorTitle = $("#editor-title");
    els.editorBody = $("#editor-body");
    els.editorForm = $("#editor-form");
    els.editorError = $("#editor-error");
    els.editorSave = $("#editor-save");
    els.editorDelete = $("#editor-delete");
    els.toastStack = $("#admin-toast-stack");
    els.storeToggle = $("#store-open-toggle");
    els.storeLabel = $("#store-status-label");
  }

  function setDate() {
    if (!els.date) return;
    els.date.textContent = new Date().toLocaleDateString("en-PH", {
      weekday: "long",
      month: "short",
      day: "numeric"
    });
  }

  function initials(name) {
    return String(name || "Kitchen Admin").trim().charAt(0).toUpperCase() || "K";
  }

  /* ------------------------------------------------------------------------
     Admin profile view
     ------------------------------------------------------------------------ */

  /* ------------------------------------------------------------------------
     Session: the login form lives on the secret staff door page; this board
     only handles an already-signed-in session and expiry.
     ------------------------------------------------------------------------ */

  // The staff door is the same secret path without /board. Opened outside the
  // app (file:// or a static mirror)? The login page sits in the same folder —
  // resolved from the real document URL, because a relative string would be
  // resolved against the <base> tag that fixes up asset paths.
  function loginUrl() {
    if (window.location.protocol === "file:" || (window.location.port && window.location.port !== "3000")) {
      return new URL("staff-login.html", window.location.href).href;
    }
    return window.location.pathname.replace(/\/board\/?$/, "");
  }

  function redirectToLogin() {
    window.location.replace(loginUrl());
  }

  async function signOut() {
    try { await API.adminLogout(); } catch { /* cookie may already be dead */ }
    sessionStorage.removeItem(CFG.STORAGE.ADMIN_NAME);
    sessionStorage.removeItem(VIEW_KEY);
    // Never touch the customer side: PROFILE/CUSTOMER_TOKEN belong to the
    // storefront account and must survive an admin sign-out (and vice versa).
    state.ready = false;
    state.adminName = "Kitchen Admin";
    state.overview = null;
    state.menu = null;
    state.orders = [];
    redirectToLogin();
  }

  function showApp() {
    els.app.hidden = false;
    updateAvatar();
    setView(state.view);
  }

  function updateAvatar(account) {
    const letter = initials(state.adminName);
    if (els.avatar) {
      els.avatar.textContent = letter;
      els.avatar.title = state.adminName;
    }
    const railName = $("#rail-name");
    if (railName) railName.textContent = state.adminName;
    $("#profile-avatar")?.replaceChildren(document.createTextNode(letter));
    if (account) {
      const nameEl = $("#account-name");
      const userEl = $("#account-username");
      if (nameEl) nameEl.textContent = account.name || state.adminName;
      if (userEl) userEl.textContent = account.username || "";
      state.adminName = account.name || state.adminName;
      if (railName) railName.textContent = state.adminName;
    }
  }

  async function openProfileView() {
    try {
      const account = await API.adminAccount();
      renderProfile(account);
    } catch (error) {
      handleApiError(error, "Could not load your profile.");
    }
  }

  function renderProfile(account) {
    updateAvatar(account);
    $("#profile-name").value = account.name || state.adminName;
    $("#profile-username").value = account.username || "";
    $("#profile-created").value = account.createdAt
      ? new Date(`${account.createdAt}Z`).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })
      : "-";
    $("#profile-error").textContent = "";
    $("#password-error").textContent = "";
    ["profile-current", "profile-new", "profile-confirm"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  }

  function bindProfile() {
    $("#profile-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorEl = $("#profile-error");
      const button = $("#profile-save");
      errorEl.textContent = "";
      button.disabled = true;
      try {
        const result = await API.adminUpdateAccount({ name: $("#profile-name").value.trim() });
        state.adminName = result.name;
        sessionStorage.setItem(CFG.STORAGE.ADMIN_NAME, state.adminName);
        updateAvatar({ name: result.name });
        const nameBadge = $("#profile-name");
        if (nameBadge) nameBadge.value = result.name;
        showToast("Profile saved.");
        setView("profile");
      } catch (error) {
        errorEl.textContent = error.message || "Could not save your profile.";
      } finally {
        button.disabled = false;
      }
    });

    $("#profile-form")?.addEventListener("reset", async () => {
      try { renderProfile(await API.adminAccount()); } catch {}
    });

    $("#password-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorEl = $("#password-error");
      const button = $("#password-save");
      errorEl.textContent = "";
      const next = $("#profile-new").value;
      if (next !== $("#profile-confirm").value) {
        errorEl.textContent = "The new passwords do not match.";
        return;
      }
      button.disabled = true;
      try {
        const result = await API.adminUpdateAccount({
          currentPassword: $("#profile-current").value,
          newPassword: next
        });
        // The server rotated the session cookie itself (all old sessions died).
        showToast("Password updated.");
        ["profile-current", "profile-new", "profile-confirm"].forEach((id) => { document.getElementById(id).value = ""; });
      } catch (error) {
        errorEl.textContent = error.message || "Could not change the password.";
      } finally {
        button.disabled = false;
      }
    });

    $("#password-form")?.addEventListener("reset", () => {
      $("#password-error").textContent = "";
    });

    $("#profile-logout")?.addEventListener("click", () => signOut());
  }

  function handleApiError(error, fallback = "Something went wrong.") {
    if (error?.status === 401) {
      redirectToLogin();
      return true;
    }
    showToast(error?.message || fallback, "error");
    return false;
  }

  function bindShell() {
    $("#drawer-logout")?.addEventListener("click", () => signOut());

    // Mobile drawer: same sidebar element, one navigation system.
    const scrim = $("#drawer-scrim");
    const setDrawer = (open) => {
      document.body.classList.toggle("drawer-open", open);
      if (scrim) scrim.hidden = !open;
      $("#nav-toggle")?.setAttribute("aria-expanded", String(open));
      // Lock background scrolling only while the drawer covers the page.
      document.body.style.overflow = open ? "hidden" : "";
    };
    const drawerOpen = () => document.body.classList.contains("drawer-open");

    $("#nav-toggle")?.addEventListener("click", () => setDrawer(!drawerOpen()));
    $("#drawer-close")?.addEventListener("click", () => setDrawer(false));
    scrim?.addEventListener("click", () => setDrawer(false));
    window.addEventListener("resize", () => {
      if (window.innerWidth > 720 && drawerOpen()) setDrawer(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawerOpen()) setDrawer(false);
    });
    // Expose for setView: choosing a section closes the drawer immediately.
    document.addEventListener("admin:set-view", () => setDrawer(false));

    $("#refresh-button")?.addEventListener("click", refreshAll);
    startOrderPolling();

    $$(".sidebar-link[data-view]").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    document.addEventListener("click", (event) => {
      const jump = event.target.closest("[data-go-view]");
      if (jump) setView(jump.dataset.goView);
    });
  }

  function setView(view) {
    document.dispatchEvent(new CustomEvent("admin:set-view"));
    state.view = ["insights", "orders", "customers", "menu", "profit", "profile"].includes(view) ? view : "insights";
    // Remember the section so storefront round trips and reloads come back here.
    sessionStorage.setItem(VIEW_KEY, state.view);
    const copy = {
      insights: {
        kicker: "OVERVIEW",
        title: "The kitchen at a glance."
      },
      orders: {
        kicker: "ORDERS",
        title: "Every craving, in motion."
      },
      customers: {
        kicker: "CUSTOMERS",
        title: "Everyone who came for a craving."
      },
      menu: {
        kicker: "MENU",
        title: "Keep the cravings current."
      },
      profit: {
        kicker: "PROFIT",
        title: "Simple numbers. Real money."
      },
      profile: {
        kicker: "ACCOUNT",
        title: "Your kitchen profile."
      }
    }[state.view];

    if (els.kicker) els.kicker.textContent = copy.kicker;
    if (els.pageTitle) els.pageTitle.textContent = copy.title;

    $$(".sidebar-link[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === state.view);
    });
    $$("[data-view-panel]").forEach((panel) => {
      panel.hidden = panel.id !== `view-${state.view}`;
    });

    if (state.view === "profile") openProfileView();
    if (state.view === "profit") loadProfit();
    if (state.view === "customers") loadCustomers();
  }

  /* ------------------------------------------------------------------------
     Data loading
     ------------------------------------------------------------------------ */

  async function loadData(options = {}) {
    try {
      const [overview, menu, orders, settings, queue] = await Promise.all([
        API.adminOverview(),
        API.adminMenu(),
        API.adminOrders(),
        API.adminSettings().catch(() => null),
        API.adminOrderQueue().catch(() => null)
      ]);
      state.overview = overview;
      state.menu = menu;
      state.ready = true;
      if (settings) applyStoreSettings(settings);
      state.orders = Array.isArray(orders) ? orders : [];
      if (queue) state.orderQueue = queue;
      renderAll();
      if (!options.silent) {
        window.setTimeout(() => showToast("Kitchen board is up to date."), 250);
      }
    } catch (error) {
      // Polling failures stay quiet — one network blip must not spam toasts —
      // but an expired session still ends the poll by returning to sign-in.
      if (options.quiet) {
        if (error?.status === 401) {
          redirectToLogin();
        } else {
          console.debug("Kitchen board poll skipped:", error?.message || error);
        }
        return;
      }
      handleApiError(error, "Could not load the kitchen board.");
    }
  }

  // The kitchen crew leaves this tab open; fresh orders arrive on their own.
  function startOrderPolling() {
    setInterval(() => {
      if (!state.ready) return;
      loadData({ silent: true, quiet: true });
    }, 20000);
  }

  /* ------------------------------------------------------------------------
     Store status + delivery fee (admin-controlled storefront settings)
     ------------------------------------------------------------------------ */

  function applyStoreSettings(settings) {
    if (!settings) return;
    state.storeOpen = Boolean(settings.storeOpen);
    if (els.storeToggle) els.storeToggle.checked = state.storeOpen;
    if (els.storeLabel) els.storeLabel.textContent = state.storeOpen ? "Open" : "Closed";
    if (els.storeToggle) els.storeToggle.closest(".store-control")?.classList.toggle("is-closed", !state.storeOpen);
  }

  function bindStoreControl() {
    els.storeToggle?.addEventListener("change", async () => {
      const open = els.storeToggle.checked;
      els.storeToggle.disabled = true;
      try {
        applyStoreSettings(await API.adminSaveSettings({ storeOpen: open }));
        showToast(open ? "Store is open — customers can order again." : "Store is closed — new orders are blocked.");
      } catch (error) {
        els.storeToggle.checked = !open;
        showToast(error.message || "Could not change the store status.", "error");
      } finally {
        els.storeToggle.disabled = false;
      }
    });
  }

  async function refreshAll() {
    const button = $("#refresh-button");
    if (button) button.classList.add("rotating");
    try {
      await loadData({ silent: true });
      showToast("Kitchen board refreshed.");
    } finally {
      if (button) button.classList.remove("rotating");
    }
  }

  function renderAll() {
    renderInsights();
    renderMenu();
    renderOrders();
    const active = state.overview?.stats?.activeOrders || 0;
    if (els.sidebarCount) {
      els.sidebarCount.textContent = String(active);
      els.sidebarCount.hidden = active === 0;
    }
  }

  /* ------------------------------------------------------------------------
     Insights
     ------------------------------------------------------------------------ */

  function renderInsights() {
    if (!state.overview) return;
    const { stats, salesByDay, bestSellers, recentOrders } = state.overview;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "GOOD MORNING" : hour < 18 ? "GOOD AFTERNOON" : "GOOD EVENING";

    $("#insight-greeting").textContent = `${greeting}, KITCHEN CREW`;
    $("#insight-headline").textContent = stats.activeOrders
      ? `${stats.activeOrders} ${stats.activeOrders === 1 ? "craving is" : "cravings are"} moving right now.`
      : "Here's how the night is going.";

    $("#stat-revenue").textContent = money(stats.revenue);
    $("#stat-orders").textContent = String(stats.orders);
    $("#stat-average").textContent = money(stats.average);
    $("#stat-active").textContent = String(stats.activeOrders);
    $("#best-seller-note").textContent = stats.bestSeller ? stats.bestSeller.name : "No sales yet";

    renderChart(salesByDay || []);
    renderBestSellers(bestSellers || []);
    renderRecent(recentOrders || []);
  }

  function shortMoney(value) {
    const amount = Number(value) || 0;
    if (amount >= 1000) return `₱${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`;
    return `₱${Math.round(amount)}`;
  }

  function renderChart(days) {
    const container = $("#sales-chart");
    if (!container) return;
    if (!days.length) {
      container.innerHTML = `<div class="panel-empty"><strong>No sales yet</strong><p>The rhythm shows up after the first order.</p></div>`;
      return;
    }

    const max = Math.max(...days.map((day) => Number(day.revenue) || 0), 1);
    container.innerHTML = days.map((day, index) => {
      const value = Number(day.revenue) || 0;
      const height = Math.max(3, Math.round((value / max) * 100));
      const today = index === days.length - 1;
      return `
        <div class="chart-column${today ? " is-today" : ""}" title="${esc(day.label)}: ${money(value)} &middot; ${day.orders} orders">
          <span class="chart-value">${value ? shortMoney(value) : ""}</span>
          <div class="chart-track"><span class="chart-fill" style="height:${height}%"></span></div>
          <span class="chart-label">${esc(day.label)}</span>
        </div>
      `;
    }).join("");
  }

  function renderBestSellers(items) {
    const container = $("#best-sellers");
    if (!container) return;
    if (!items.length) {
      container.innerHTML = `<div class="panel-empty"><strong>No best sellers yet</strong><p>Place a few sample orders to see what Madapdap loves.</p></div>`;
      return;
    }

    container.innerHTML = items.map((item, index) => `
      <div class="best-row">
        <span class="best-rank">${String(index + 1).padStart(2, "0")}</span>
        <img src="${esc(window.resolveMenuImage(item.imageKey))}" alt="">
        <span class="best-info">
          <strong>${esc(item.name)}</strong>
          <small>${money(item.price)} &middot; ${money(item.revenue)} revenue</small>
        </span>
        <span class="best-sold"><strong>${item.sold}</strong><small>sold</small></span>
      </div>
    `).join("");
  }

  function orderDate(value) {
    const date = new Date(String(value || "").replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return "Just now";
    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function renderRecent(orders) {
    const container = $("#recent-orders");
    if (!container) return;
    if (!orders.length) {
      container.innerHTML = `<div class="panel-empty"><strong>No orders yet</strong><p>When a craving comes in, it lands here.</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="recent-row head">
        <span>Order</span>
        <span>Customer</span>
        <span>Status</span>
        <span style="text-align:right">Total</span>
        <span style="text-align:right">Items</span>
      </div>
      ${orders.slice(0, 7).map((order) => `
        <div class="recent-row">
          <span class="recent-order-number">
            <strong>${esc(order.orderNumber)}</strong>
            <small>${esc(orderDate(order.createdAt))}</small>
          </span>
          <span class="recent-customer">
            <strong>${esc(order.customer)}</strong>
            <small>${esc(order.barangay)}</small>
          </span>
          <span><span class="status-pill status-${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</span></span>
          <span class="recent-total">${money(order.total)}</span>
          <span class="recent-items">${order.items.reduce((total, item) => total + item.quantity, 0)} pcs</span>
        </div>
      `).join("")}
    `;
  }

  /* ------------------------------------------------------------------------
     Menu studio
     ------------------------------------------------------------------------ */

  function ensureCategoryFilter() {
    if (!els.categoryFilter || !state.menu) return;
    const categories = state.menu.categories || [];
    const current = state.category;
    els.categoryFilter.innerHTML = `
      <option value="all">All sections</option>
      ${categories.map((category) => `<option value="${category.id}">${esc(category.name)}</option>`).join("")}
    `;
    els.categoryFilter.value = categories.some((category) => String(category.id) === current) ? current : "all";
    state.category = els.categoryFilter.value;
  }

  function renderMenu() {
    if (!state.menu || !els.menuList) return;
    ensureCategoryFilter();

    const allItems = state.menu.items || [];
    const query = A.normalize(state.menuQuery);
    const filtered = allItems.filter((item) => {
      const categoryMatch = state.category === "all" || String(item.categoryId) === state.category;
      if (!categoryMatch) return false;
      if (!query) return true;
      const haystack = A.normalize(`${item.name} ${item.description} ${item.categoryName} ${(item.tags || []).join(" ")}`);
      return haystack.includes(query);
    });

    if (els.menuCount) {
      els.menuCount.textContent = `${filtered.length} of ${allItems.length} dishes`;
    }

    if (!filtered.length) {
      els.menuList.innerHTML = `
        <div class="menu-empty">
          <span>${icon("search")}</span>
          <strong>No dishes found.</strong>
          <p>Try a different word or choose another section.</p>
        </div>
      `;
      return;
    }

    els.menuList.innerHTML = `
      <div class="menu-table-head">
        <span>Dish</span>
        <span>Section</span>
        <span>Price</span>
        <span>Sold</span>
        <span>On the menu</span>
        <span></span>
      </div>
      ${filtered.map((item) => `
        <div class="menu-row${item.isAvailable ? "" : " is-unavailable"}" data-row-id="${item.id}">
          <div class="menu-item-cell">
            <img class="menu-thumb" src="${esc(window.resolveMenuImage(item.imageKey))}" alt="">
            <div class="menu-item-copy">
              <strong>${esc(item.name)}</strong>
              <small>${esc(item.description)}</small>
              ${item.badge ? `<div class="menu-badge-line"><span>${esc(item.badge)}</span>${item.isFeatured ? "<span>Featured</span>" : ""}</div>` : (item.isFeatured ? `<div class="menu-badge-line"><span>Featured</span></div>` : "")}
            </div>
          </div>
          <div class="menu-section-cell">${esc(item.categoryName)}</div>
          <div class="menu-price-cell">${money(item.price)}</div>
          <div class="menu-sold-cell"><strong>${item.sold || 0}</strong> ordered</div>
          <div class="menu-availability-cell">
            <label class="availability" title="Show this dish on the storefront">
              <input type="checkbox" data-availability="${item.id}" ${item.isAvailable ? "checked" : ""}>
              <span class="availability-track"></span>
              <small>${item.isAvailable ? "On" : "Off"}</small>
            </label>
          </div>
          <div class="menu-edit-cell">
            <button type="button" class="menu-edit-btn" data-edit="${item.id}" aria-label="Edit ${esc(item.name)}">
              ${icon("edit")} <span>Edit</span>
            </button>
          </div>
        </div>
      `).join("")}
    `;
  }

  function bindMenuStudio() {
    const debounced = A.debounce(() => {
      state.menuQuery = els.menuSearch.value.trim();
      renderMenu();
    }, 140);

    els.menuSearch?.addEventListener("input", debounced);

    els.categoryFilter?.addEventListener("change", () => {
      state.category = els.categoryFilter.value;
      renderMenu();
    });

    $("#add-dish")?.addEventListener("click", () => openEditor(null));

    els.menuList?.addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit]");
      if (edit) openEditor(Number(edit.dataset.edit));
    });

    els.menuList?.addEventListener("change", async (event) => {
      const toggle = event.target.closest("[data-availability]");
      if (!toggle) return;
      const id = Number(toggle.dataset.availability);
      const item = state.menu?.items.find((entry) => entry.id === id);
      if (!item) return;

      const next = toggle.checked;
      toggle.disabled = true;
      try {
        await API.adminSetAvailability(id, next);
        item.isAvailable = next;
        const row = toggle.closest(".menu-row");
        row?.classList.toggle("is-unavailable", !next);
        const label = $("small", toggle.closest(".availability"));
        if (label) label.textContent = next ? "On" : "Off";
        showToast(`${item.name} is now ${next ? "on" : "off"} the storefront.`);
      } catch (error) {
        toggle.checked = !next;
        handleApiError(error, "Could not update availability.");
      } finally {
        toggle.disabled = false;
      }
    });
  }

  /* ------------------------------------------------------------------------
     Dish editor
     ------------------------------------------------------------------------ */

  function cloneGroups(groups) {
    try {
      return JSON.parse(JSON.stringify(groups || []));
    } catch {
      return [];
    }
  }

  function choicesText(choices) {
    return (Array.isArray(choices) ? choices : []).map((choice) => {
      if (typeof choice === "string") return choice;
      const name = choice?.name || "";
      const price = Number(choice?.price) || 0;
      return price > 0 ? `${name} | ${price}` : name;
    }).join("\n");
  }

  function imageOptions(selectedKey) {
    const library = window.MK_IMAGE_LIBRARY || [];
    return library.map((entry) => `
      <option value="${esc(entry.key)}" ${entry.key === selectedKey ? "selected" : ""}>${esc(entry.label)}</option>
    `).join("");
  }

  function openEditor(id = null) {
    if (!state.menu) return;
    const item = id ? state.menu.items.find((entry) => entry.id === id) : null;
    if (id && !item) {
      showToast("That dish could not be found. Refresh the board.", "error");
      return;
    }

    state.editingId = item?.id || null;
    // Baseline for the save-confirmation step: the name and price the dish
    // had when the editor opened.
    state.editingOriginal = item ? { name: item.name, price: Number(item.price) } : null;
    state.editorGroups = cloneGroups(item?.optionGroups || []);
    els.editorTitle.textContent = item ? "Edit dish details" : "Add a new dish";
    els.editorBody.innerHTML = editorBodyHtml(item);
    els.editorError.textContent = "";
    els.editorSave.textContent = item ? "Save changes" : "Add to the menu";
    if (els.editorDelete) els.editorDelete.hidden = !item;
    els.editorModal.classList.add("is-open");
    els.editorModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
    updateImagePreview();
    window.setTimeout(() => $("#edit-name")?.focus(), 100);
  }

  function editorBodyHtml(item) {
    const categories = state.menu.categories || [];
    const library = window.MK_IMAGE_LIBRARY || [];
    const rawImage = item?.imageKey || "flavored-wings";
    const isCustom = rawImage && !library.some((entry) => entry.key === rawImage);
    const selectedImage = isCustom ? "__custom" : rawImage;
    const defaultCategory = categories[0]?.id || "";

    return `
      <div class="editor-grid">
        <label class="admin-field span-2">
          <span>Dish name</span>
          <input id="edit-name" type="text" maxlength="120" value="${esc(item?.name || "")}" placeholder="e.g. 6pcs Wings with Flavor" required>
        </label>

        <label class="admin-field">
          <span>Menu section</span>
          <select id="edit-category">
            ${categories.map((category) => `
              <option value="${category.id}" ${(item?.categoryId || defaultCategory) === category.id ? "selected" : ""}>${esc(category.name)}</option>
            `).join("")}
          </select>
        </label>

        <label class="admin-field">
          <span>Price (₱)</span>
          <input id="edit-price" type="number" min="0" step="1" value="${item ? Number(item.price) : ""}" placeholder="169" required>
        </label>

        <label class="admin-field span-2">
          <span>Short description</span>
          <textarea id="edit-description" maxlength="400" placeholder="What makes this craving special?">${esc(item?.description || "")}</textarea>
        </label>

        <div class="admin-field span-2">
          <span>Photo</span>
          <select id="edit-image">
            ${imageOptions(selectedImage)}
            <option value="__custom" ${selectedImage === "__custom" ? "selected" : ""}>Custom image URL...</option>
          </select>
        </div>

        <label class="admin-field span-2" id="edit-image-url-wrap" ${selectedImage === "__custom" ? "" : "hidden"}>
          <span>Image URL or path</span>
          <input id="edit-image-url" type="text" value="${isCustom ? esc(rawImage) : ""}" placeholder="assets/images/my-photo.jpg or https://...">
        </label>

        <div class="image-preview-row span-2">
          <img id="edit-image-preview" src="${esc(window.resolveMenuImage(rawImage))}" alt="Dish preview">
          <p><strong>Photo preview</strong><small>Use a file from assets/images or paste a full image URL. Photos are stored separately from the menu logic.</small></p>
        </div>

        <label class="admin-field">
          <span>Badge <small>(optional)</small></span>
          <input id="edit-badge" type="text" maxlength="40" value="${esc(item?.badge || "")}" placeholder="FAN FAVORITE">
        </label>

        <label class="admin-field">
          <span>Search tags <small>comma separated</small></span>
          <input id="edit-tags" type="text" value="${esc((item?.tags || []).join(", "))}" placeholder="wings, chicken, spicy">
        </label>

        <label class="inline-check">
          <input type="checkbox" id="edit-available" ${item?.isAvailable === false ? "" : "checked"}>
          Show on the storefront
        </label>
        <label class="inline-check">
          <input type="checkbox" id="edit-featured" ${item?.isFeatured ? "checked" : ""}>
          Mark as a featured craving
        </label>
      </div>

      <div class="editor-section-title">
        <div><h3>Choices & flavors</h3><p>These are the options customers see before adding the dish.</p></div>
        <button type="button" class="admin-btn admin-btn-ghost" id="add-group">${icon("plus")} Add group</button>
      </div>
      <div class="group-list" id="group-list">
        ${state.editorGroups.length ? state.editorGroups.map((group, index) => groupCardHtml(group, index)).join("") : `
          <div class="panel-empty"><strong>No choices needed</strong><p>Leave this empty for dishes that are added as-is.</p></div>
        `}
      </div>
    `;
  }

  function groupCardHtml(group, index) {
    const type = group.type || "radio";
    const required = group.required !== false;
    return `
      <div class="group-card" data-group-index="${index}">
        <div class="group-card-head">
          <strong>Group ${index + 1}</strong>
          <button type="button" class="group-remove" data-remove-group="${index}">${icon("trash")} Remove</button>
        </div>
        <div class="group-grid">
          <label class="admin-field">
            <span>Key</span>
            <input class="group-key" type="text" value="${esc(group.key || "")}" placeholder="flavors">
          </label>
          <label class="admin-field">
            <span>Label shown to customer</span>
            <input class="group-label" type="text" value="${esc(group.label || "")}" placeholder="Choose your flavor(s)">
          </label>
          <label class="admin-field">
            <span>Type</span>
            <select class="group-type">
              <option value="flavors" ${type === "flavors" ? "selected" : ""}>Flavors</option>
              <option value="radio" ${type === "radio" ? "selected" : ""}>Pick one</option>
              <option value="checkbox" ${type === "checkbox" ? "selected" : ""}>Add-ons</option>
            </select>
          </label>
          <label class="admin-field">
            <span>Max</span>
            <input class="group-max" type="number" min="0" step="1" value="${Number(group.max) || ""}" placeholder="2">
          </label>
          <label class="admin-field">
            <span>Included</span>
            <input class="group-included" type="number" min="0" step="1" value="${Number(group.included) || 0}">
          </label>
          <label class="admin-field">
            <span>Extra ₱</span>
            <input class="group-extra" type="number" min="0" step="1" value="${Number(group.extraPrice) || 0}">
          </label>
          <label class="inline-check group-check">
            <input class="group-required" type="checkbox" ${required ? "checked" : ""}> Required
          </label>
          <label class="admin-field span-2 field-extra">
            <span>Choices <small>one per line &middot; add a price with | e.g. Extra rice | 15</small></span>
            <textarea class="group-choices" placeholder="Buffalo&#10;Soy Garlic&#10;Cheese&#10;Garlic Parmesan">${esc(choicesText(group.choices))}</textarea>
          </label>
        </div>
      </div>
    `;
  }

  function bindEditor() {
    els.editorModal?.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-editor]") || event.target.closest("#editor-close") || event.target.closest("#editor-cancel")) {
        closeEditor();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.editorModal?.classList.contains("is-open")) closeEditor();
    });

    els.editorBody?.addEventListener("click", (event) => {
      if (event.target.closest("#add-group")) {
        state.editorGroups = syncEditorGroups();
        const taken = new Set(state.editorGroups.map((group) => group.key));
        let number = state.editorGroups.length + 1;
        let key = `flavors${number}`;
        while (taken.has(key)) {
          number += 1;
          key = `flavors${number}`;
        }
        state.editorGroups.push({
          key,
          label: "Choose your flavor(s)",
          type: "flavors",
          required: true,
          max: 2,
          included: 1,
          extraPrice: 10,
          choices: ["Buffalo", "Soy Garlic", "Cheese", "Garlic Parmesan"]
        });
        renderEditorGroups();
        return;
      }

      const remove = event.target.closest("[data-remove-group]");
      if (remove) {
        state.editorGroups = syncEditorGroups();
        state.editorGroups.splice(Number(remove.dataset.removeGroup), 1);
        renderEditorGroups();
      }
    });

    els.editorBody?.addEventListener("change", (event) => {
      if (event.target.id === "edit-image") updateImagePreview();
    });

    els.editorBody?.addEventListener("input", (event) => {
      if (event.target.id === "edit-image-url") updateImagePreview();
    });

    $("#edit-image-preview")?.addEventListener("error", (event) => {
      event.target.src = window.resolveMenuImage("flavored-wings");
    });

    els.editorForm?.addEventListener("submit", saveEditor);
    els.editorDelete?.addEventListener("click", removeEditorDish);
  }

  function renderEditorGroups() {
    const container = $("#group-list");
    if (!container) return;
    container.innerHTML = state.editorGroups.length
      ? state.editorGroups.map((group, index) => groupCardHtml(group, index)).join("")
      : `<div class="panel-empty"><strong>No choices needed</strong><p>Leave this empty for dishes that are added as-is.</p></div>`;
  }

  function updateImagePreview() {
    const select = $("#edit-image");
    const urlWrap = $("#edit-image-url-wrap");
    const urlInput = $("#edit-image-url");
    const preview = $("#edit-image-preview");
    if (!select || !preview) return;

    const custom = select.value === "__custom";
    if (urlWrap) urlWrap.hidden = !custom;
    const source = custom ? urlInput?.value.trim() : select.value;
    preview.src = source ? window.resolveMenuImage(source) : window.resolveMenuImage("flavored-wings");
  }

  function parseChoices(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [namePart, pricePart] = line.split("|");
        const name = String(namePart || "").trim().slice(0, 80);
        const price = Number(String(pricePart || "").replace(/[^\d.]/g, "")) || 0;
        if (!name) return null;
        return price > 0 ? { name, price } : name;
      })
      .filter(Boolean);
  }

  function syncEditorGroups() {
    return $$(".group-card", els.editorBody || document).map((card) => {
      const group = {
        key: $(".group-key", card)?.value.trim() || "",
        label: $(".group-label", card)?.value.trim() || "",
        type: $(".group-type", card)?.value || "radio",
        required: Boolean($(".group-required", card)?.checked),
        max: Number($(".group-max", card)?.value) || 0,
        included: Number($(".group-included", card)?.value) || 0,
        extraPrice: Number($(".group-extra", card)?.value) || 0,
        choices: parseChoices($(".group-choices", card)?.value)
      };
      return group;
    }).filter((group) => group.key);
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (state.busy) return;

    const name = $("#edit-name")?.value.trim() || "";
    const description = $("#edit-description")?.value.trim() || "";
    const price = Number($("#edit-price")?.value);
    const categoryId = Number($("#edit-category")?.value);
    const badge = $("#edit-badge")?.value.trim() || "";
    const tags = ($("#edit-tags")?.value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const imageSelect = $("#edit-image")?.value || "flavored-wings";
    const imageKey = imageSelect === "__custom" ? ($("#edit-image-url")?.value.trim() || "flavored-wings") : imageSelect;
    const isAvailable = Boolean($("#edit-available")?.checked);
    const isFeatured = Boolean($("#edit-featured")?.checked);

    if (!name) {
      els.editorError.textContent = "Give the dish a name.";
      $("#edit-name")?.focus();
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      els.editorError.textContent = "Enter a valid price.";
      $("#edit-price")?.focus();
      return;
    }
    if (!categoryId) {
      els.editorError.textContent = "Choose a menu section.";
      return;
    }

    state.editorGroups = syncEditorGroups();
    const payload = {
      name,
      description,
      price,
      categoryId,
      imageKey,
      badge,
      tags,
      optionGroups: state.editorGroups,
      isAvailable,
      isFeatured
    };

    const wasEditing = Boolean(state.editingId);
    const original = state.editingOriginal;

    // Launch requirement: edits that change the name or the price get one
    // confirmation step showing the old and new values before anything saves.
    if (wasEditing && original && (name !== original.name || price !== original.price)) {
      showSaveConfirm({ original, name, price },
        () => performSave(payload, wasEditing),
        () => {
          $("#edit-name").value = original.name;
          $("#edit-price").value = original.price;
          showToast("Changes cancelled — the old name and price were restored.");
        });
      return;
    }
    await performSave(payload, wasEditing);
  }

  function showSaveConfirm({ original, name, price }, proceed, cancel) {
    const scrim = document.createElement("div");
    scrim.className = "save-confirm-scrim";
    const rows = [];
    if (name !== original.name) {
      rows.push(`<div class="confirm-row"><span>Name</span><b class="old">${esc(original.name)}</b><span class="arr">→</span><b class="new">${esc(name)}</b></div>`);
    }
    if (price !== original.price) {
      rows.push(`<div class="confirm-row"><span>Price</span><b class="old">${money(original.price)}</b><span class="arr">→</span><b class="new">${money(price)}</b></div>`);
    }
    scrim.innerHTML = `
      <div class="save-confirm-card" role="dialog" aria-modal="true" aria-labelledby="save-confirm-title">
        <p class="confirm-kicker">CONFIRM CHANGES</p>
        <h3 id="save-confirm-title">Save changes to “${esc(original.name)}”?</h3>
        <div class="confirm-rows">${rows.join("")}</div>
        <p class="confirm-note">The storefront updates the moment this is saved.</p>
        <div class="confirm-actions">
          <button type="button" class="admin-btn admin-btn-ghost" id="save-cancel">Cancel</button>
          <button type="button" class="admin-btn admin-btn-primary" id="save-confirm">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(scrim);

    const confirmBtn = scrim.querySelector("#save-confirm");
    const cancelBtn = scrim.querySelector("#save-cancel");
    const close = () => scrim.remove();
    const onConfirm = async () => {
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      confirmBtn.textContent = "Saving...";
      close();
      await proceed();
    };
    const onCancel = () => {
      close();
      cancel();
    };
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    scrim.addEventListener("click", (event) => {
      if (event.target === scrim) onCancel();
    });
    // Capture phase: Escape here must cancel the dialog, not close the whole
    // editor (the editor's own Escape handler listens on the document).
    scrim.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    }, true);
    window.setTimeout(() => confirmBtn?.focus(), 60);
  }

  async function performSave(payload, wasEditing) {
    state.busy = true;
    els.editorSave.disabled = true;
    els.editorError.textContent = "";
    els.editorSave.textContent = "Saving...";

    try {
      if (wasEditing) await API.adminUpdateItem(state.editingId, payload);
      else await API.adminCreateItem(payload);

      closeEditor();
      const menu = await API.adminMenu();
      state.menu = menu;
      renderMenu();
      showToast(wasEditing ? "Dish updated. The storefront is live." : "New dish added to the menu.");
    } catch (error) {
      if (!handleApiError(error, "Could not save that dish.")) {
        els.editorError.textContent = error.message || "Could not save that dish.";
      }
    } finally {
      state.busy = false;
      els.editorSave.disabled = false;
      els.editorSave.textContent = wasEditing ? "Save changes" : "Add to the menu";
    }
  }

  async function removeEditorDish() {
    if (!state.editingId || state.busy) return;
    const item = state.menu?.items?.find((entry) => entry.id === state.editingId);
    const name = item?.name || "this dish";
    if (!window.confirm(`Remove "${name}" from the menu? Past orders keep their record.`)) return;

    state.busy = true;
    if (els.editorDelete) els.editorDelete.disabled = true;
    els.editorError.textContent = "";

    try {
      const result = await API.adminDeleteItem(state.editingId);
      closeEditor();
      const menu = await API.adminMenu();
      state.menu = menu;
      renderMenu();
      showToast(result?.message || "Dish removed from the menu.");
    } catch (error) {
      if (!handleApiError(error, "Could not remove that dish.")) {
        els.editorError.textContent = error.message || "Could not remove that dish.";
      }
    } finally {
      state.busy = false;
      if (els.editorDelete) els.editorDelete.disabled = false;
    }
  }

  function closeEditor(silent = false) {
    if (!els.editorModal || silent) {
      els.editorModal?.classList.remove("is-open");
      els.editorModal?.setAttribute("aria-hidden", "true");
      document.body.classList.remove("no-scroll");
      if (silent && els.editorBody) els.editorBody.innerHTML = "";
      state.editingId = null;
      state.editingOriginal = null;
      state.editorGroups = [];
      return;
    }
    els.editorModal.classList.remove("is-open");
    els.editorModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    state.editingId = null;
    state.editingOriginal = null;
    state.editorGroups = [];
    window.setTimeout(() => {
      if (!els.editorModal.classList.contains("is-open")) els.editorBody.innerHTML = "";
    }, 260);
  }

  /* ------------------------------------------------------------------------
     Order flow
     ------------------------------------------------------------------------ */

  function renderOrders() {
    if (!els.ordersList) return;
    if (els.orderStatusFilter) els.orderStatusFilter.value = state.orderStatus;
    renderQueueHead();

    const orders = state.orders.filter((order) => {
      if (state.orderStatus === "all") return true;
      return order.status === state.orderStatus;
    });

    if (!orders.length) {
      els.ordersList.innerHTML = `
        <div class="panel empty-orders" style="grid-column:1/-1">
          <div class="panel-empty">
            <strong>No orders in this lane.</strong>
            <p>${state.orderStatus === "all" ? "When the first craving arrives, it will appear here." : "Try another status or show all orders."}</p>
          </div>
        </div>
      `;
      return;
    }

    els.ordersList.innerHTML = orders.map((order) => {
      const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
      const shownItems = order.items.slice(0, 4);
      const extra = order.items.length - shownItems.length;
      return `
        <article class="order-card status-${esc(order.status)}">
          <header class="order-card-head">
            <div class="order-number">
              <strong>${esc(order.orderNumber)}</strong>
              <small>${esc(orderDate(order.createdAt))} &middot; ${itemCount} ${itemCount === 1 ? "item" : "items"}</small>
            </div>
            <span class="status-pill status-${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</span>
            ${order.adminTest ? `<span class="status-pill order-test-pill" title="Placed by the admin from the storefront preview">Admin test</span>` : ""}
            <div class="order-total">
              <small>Total</small>
              <strong>${money(order.total)}</strong>
            </div>
          </header>
          <div class="order-card-body">
            <div class="order-customer">
              <strong>${icon("phone")} ${esc(order.customer)}</strong>
              <small>${esc(order.phone)} &middot; ${esc(order.barangay)}</small>
              <small>${esc(order.address)}${order.landmark ? ` &middot; ${esc(order.landmark)}` : ""}</small>
            </div>
            <div class="order-items">
              ${shownItems.map((item) => `
                <div class="order-item-line">
                  <span><b>${item.quantity}x</b> ${esc(item.name)}${item.optionsText ? `<br><span class="order-options">${esc(item.optionsText)}</span>` : ""}</span>
                  <span>${money(item.lineTotal)}</span>
                </div>
              `).join("")}
              ${extra > 0 ? `<div class="order-item-line"><span>+ ${extra} more</span><span></span></div>` : ""}
            </div>
            ${order.notes ? `<p class="order-customer"><small><strong style="font-size:8px">Note:</strong> ${esc(order.notes)}</small></p>` : ""}
          </div>
          <footer class="order-card-foot">
            <div class="order-meta">
              <span>${order.paymentMethod === "gcash" ? "GCash" : "Cash on delivery"}</span>
              <span>Subtotal ${money(order.subtotal)}</span>
              <span>${order.deliveryFeeSet ? `Delivery ${money(order.deliveryFee)} · Total ${money(order.total)}` : "Delivery fee not set"}</span>
            </div>
            <form class="order-fee" data-order-fee="${order.id}">
              ${order.status === "cancelled" ? `<span class="order-fee-skip">Cancelled — no fee needed</span>` : feeControlFor(order)}
            </form>
            <div class="order-status-select">
              <select data-order-status="${order.id}" data-status="${esc(order.status)}" aria-label="Update status for ${esc(order.orderNumber)}">
                ${!SELECTABLE_STATUSES.includes(order.status) ? `<option value="${esc(order.status)}" selected disabled>${esc(STATUS_LABELS[order.status] || order.status)}</option>` : ""}
                ${SELECTABLE_STATUSES.map((value) => `
                  <option value="${value}" ${order.status === value ? "selected" : ""}>${STATUS_LABELS[value]}</option>
                `).join("")}
              </select>
              ${icon("chevron")}
            </div>
          </footer>
        </article>
      `;
    }).join("");
  }

  // Fixed fee options: ₱10/15/20, and orders ₱400+ are free (no selector).
  // FIFO kitchen queue head: the oldest working order, straight from
  // /api/admin/orders-queue. "Move to preparing" reuses the status PATCH.
  function renderQueueHead() {
    if (!els.queueHead) return;
    const next = state.orderQueue?.nextUp || null;
    const waiting = state.orderQueue?.queue?.length || 0;
    if (!next) {
      els.queueHead.innerHTML = `
        <div class="queue-head is-empty">
          <span class="queue-head-label">${icon("clock")} Next up to cook</span>
          <p class="panel-empty">The kitchen queue is clear — no working orders right now.</p>
        </div>`;
      return;
    }
    els.queueHead.innerHTML = `
      <div class="queue-head">
        <div class="queue-head-main">
          <span class="queue-head-label">${icon("clock")} Next up to cook &middot; ${waiting} waiting</span>
          <strong>${esc(next.orderNumber)}</strong>
          <small>${esc(next.customer)} &middot; ${next.itemCount} ${next.itemCount === 1 ? "item" : "items"} &middot; waiting ${next.ageMinutes} min</small>
        </div>
        <span class="status-pill status-${esc(next.status)}">${esc(STATUS_LABELS[next.status] || next.status)}</span>
        ${next.status === "preparing"
          ? `<span class="queue-head-note">Already in the kitchen</span>`
          : `<button type="button" class="admin-btn admin-btn-primary admin-btn-sm" data-queue-advance="${next.id}">Move to preparing</button>`}
      </div>`;
  }

  function feeControlFor(order) {
    const free = Number(order.subtotal) >= 400 || (order.deliveryFeeSet && Number(order.deliveryFee) === 0);
    if (free) {
      return `<select disabled aria-label="Delivery fee for ${esc(order.orderNumber)}"><option>Free delivery</option></select>`;
    }
    const current = order.deliveryFeeSet ? Number(order.deliveryFee) : "";
    return `
      <label class="admin-field">
        <span>Delivery fee</span>
        <select name="fee" aria-label="Delivery fee for ${esc(order.orderNumber)}" required>
          <option value="" ${current === "" ? "selected" : ""} disabled>To be confirmed</option>
          ${[10, 15, 20].map((fee) => `<option value="${fee}" ${current === fee ? "selected" : ""}>₱${fee}</option>`).join("")}
        </select>
      </label>
      <button type="submit" class="admin-btn admin-btn-ghost admin-btn-sm">${order.deliveryFeeSet ? "Update" : "Set fee"}</button>`;
  }

  function bindOrders() {
    els.orderStatusFilter?.addEventListener("change", () => {
      state.orderStatus = els.orderStatusFilter.value;
      renderOrders();
    });

    // Queue head: one tap moves the oldest working order to preparing.
    els.queueHead?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-queue-advance]");
      if (!button) return;
      const id = Number(button.dataset.queueAdvance);
      button.disabled = true;
      try {
        const updated = await API.adminUpdateOrderStatus(id, "preparing");
        const order = state.orders.find((entry) => entry.id === id);
        if (order) order.status = updated.status;
        state.orderQueue = await API.adminOrderQueue().catch(() => state.orderQueue);
        renderOrders();
        showToast(`${updated.orderNumber} is now Preparing.`);
      } catch (error) {
        button.disabled = false;
        handleApiError(error, "Could not move that order.");
      }
    });

    // Per-order delivery fee: fixed options, ₱400+ orders are already free.
    els.ordersList?.addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-order-fee]");
      if (!form) return;
      event.preventDefault();
      const id = Number(form.dataset.orderFee);
      const order = state.orders.find((entry) => entry.id === id);
      const select = form.querySelector("select[name='fee']");
      if (!order || !select) return;
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        const updated = await API.adminSetDeliveryFee(id, select.value === "" ? null : Number(select.value));
        Object.assign(order, updated);
        renderOrders();
        showToast(`Delivery fee for ${order.orderNumber} saved. New total ${money(order.total)}.`);
      } catch (error) {
        button.disabled = false;
        handleApiError(error, "Could not save the delivery fee.");
      }
    });

    els.ordersList?.addEventListener("change", async (event) => {
      const select = event.target.closest("[data-order-status]");
      if (!select) return;
      const id = Number(select.dataset.orderStatus);
      const status = select.value;
      const order = state.orders.find((entry) => entry.id === id);
      if (!order) return;
      try {
        const updated = await API.adminUpdateOrderStatus(id, status);
        order.status = updated.status;
        // Keep the FIFO "Next up to cook" card honest right away instead of
        // waiting for the next 20-second poll.
        state.orderQueue = await API.adminOrderQueue().catch(() => state.orderQueue);
        renderOrders();
        showToast(`${order.orderNumber} is now ${STATUS_LABELS[updated.status] || updated.status}.`);
      } catch (error) {
        renderOrders();
        handleApiError(error, "Could not move that order.");
      }
    });
  }

  /* ------------------------------------------------------------------------
     Toasts
     ------------------------------------------------------------------------ */

  /* ------------------------------------------------------------------------ */
  /* Profit analytics                                                          */
  /* ------------------------------------------------------------------------ */

async function loadProfit(force = false) {
    if (!state.ready) return;
    try {
      const { from, to } = profitRange();
      const data = await API.adminAnalytics(state.profitMode, from, to);
      state.profit = data;
      state.profitLoaded = true;
      renderProfit();
      await renderExpenses();
      renderCostEditor();
    } catch (error) {
      handleApiError(error, "Could not load the profit analytics.");
    }
  }

  // Local YYYY-MM-DD for the admin machine, matching the server-side date keys.
  function localDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function isoShiftDay(iso, delta) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const PROFIT_FILTERS = [
    ["today", "Today"],
    ["yesterday", "Yesterday"],
    ["7", "Last 7 Days"],
    ["14", "Last 14 Days"]
  ];

  // Filters map to absolute from/to; the 14-day cap is enforced server-side.
  function profitRange() {
    const today = localDateKey();
    const map = {
      today: [today, today],
      yesterday: [isoShiftDay(today, -1), isoShiftDay(today, -1)],
      "7": [isoShiftDay(today, -6), today],
      "14": [isoShiftDay(today, -13), today]
    };
    const picked = map[state.profitFilter] || map["14"];
    return { from: picked[0], to: picked[1] };
  }

  function profitCard(label, section, hint) {
    const estimated = section.estimated
      ? `<em class="profit-estimated" title="Some dishes have no product cost recorded yet, so this is an estimate">Estimated</em>`
      : "";
    return `
      <article class="stat-card">
        <div class="stat-head"><span>${esc(label)}</span><span class="stat-icon"><svg><use href="#i-trend"/></svg></span></div>
        <strong>${money(section.profit)}</strong>
        ${estimated}
        <p><span class="stat-dot"></span> ${hint}</p>
      </article>
    `;
  }

  // One grouped column per day: revenue, expenses, profit. CSS tooltip on
  // hover/focus; the whole group is focusable so keyboard users get it too.
  function renderProfitChart(container, days, todayIso) {
    if (!container) return;
    if (!days.length) {
      container.innerHTML = `<p class="profit-empty">No delivered orders in this period yet.</p>`;
      return;
    }
    const max = Math.max(...days.map((d) => Math.max(d.revenue, d.expenses, Math.abs(d.profit))), 1);
    const shown = days.slice(-14);
    container.innerHTML = `<div class="profit-chart-row">${shown.map((d) => {
      const h = (v) => Math.max(Math.round((v / max) * 100), v > 0 ? 4 : 0);
      const label = d.day.slice(5);
      return `
      <div class="profit-group${d.day === todayIso ? " is-today" : ""}" tabindex="0">
        ${d.day === todayIso ? `<span class="profit-bar-today">Today</span>` : ""}
        <div class="profit-group-bars">
          <div class="profit-bar-wrap"><i class="mini-bar revenue" style="height:${h(d.revenue)}%"></i></div>
          <div class="profit-bar-wrap"><i class="mini-bar expenses" style="height:${h(d.expenses)}%"></i></div>
          <div class="profit-bar-wrap"><i class="mini-bar profit${d.profit < 0 ? " is-neg" : ""}" style="height:${h(Math.abs(d.profit))}%"></i></div>
        </div>
        <span class="profit-bar-tip"><b>${label}</b><i>Revenue: ${money(d.revenue)}</i><i>Expenses: ${money(d.expenses)}</i><i>Profit: ${money(d.profit)}</i></span>
        <small>${label}</small>
      </div>`;
    }).join("")}</div>`;
  }

  function renderProfit() {
    const data = state.profit;
    if (!data || !data.cards) return;
    const cards = $("#profit-cards");
    if (cards) {
      cards.innerHTML = [
        profitCard("Today's Profit", data.cards.today, "Delivered today"),
        profitCard("Yesterday's Profit", data.cards.yesterday, "Delivered yesterday"),
        profitCard("Last 7 Days' Profit", data.cards.week7, "Last 7 days incl. today"),
        profitCard("Last 14 Days' Profit", data.cards.week14, "Last 14 days incl. today")
      ].join("");
    }

    const pills = $("#profit-filter");
    if (pills) {
      pills.innerHTML = PROFIT_FILTERS.map(([value, labelText]) =>
        `<button type="button" class="profit-pill${state.profitFilter === value ? " is-active" : ""}" data-profit-filter="${value}">${esc(labelText)}</button>`
      ).join("");
    }

    renderProfitChart($("#profit-chart"), data.range.days || [], data.todayIso);
  }

  async function renderExpenses() {
    const list = $("#expense-list");
    if (!list) return;
    try {
      const expenses = await API.adminExpenses(state.profitMode);
      const rows = (Array.isArray(expenses) ? expenses : []).map((expense) => `
        <div class="expense-row${expense.isDemo ? " is-demo" : ""}">
          <div><strong>${esc(expense.label)}</strong><small>${expense.spentOn}${expense.isDemo ? " &middot; demo" : ""}</small></div>
          <span class="expense-amount">-${money(expense.amount)}</span>
          <button type="button" class="admin-icon-btn" data-expense-del="${expense.id}" aria-label="Delete ${esc(expense.label)}"><svg><use href="#i-trash"/></svg></button>
        </div>
      `).join("");
      list.innerHTML = rows || `<p class="profit-empty">No expenses recorded for this view.</p>`;
    } catch (error) {
      handleApiError(error, "Could not load the expenses.");
    }
  }

  function renderCostEditor() {
    const editor = $("#cost-editor");
    if (!editor || !state.menu) return;
    const items = Array.isArray(state.menu) ? state.menu : state.menu.items || [];
    editor.innerHTML = items.map((item) => `
      <div class="cost-row" data-cost-item="${item.id}">
        <label><strong>${esc(item.name)}</strong><small>sells ${money(item.price)}</small></label>
        <div class="cost-input-wrap">
          <span>₱</span>
          <input type="number" min="0" step="0.01" value="${Number(item.costPrice ?? item.cost_price ?? 0)}"
                 data-cost-input="${item.id}" aria-label="Cost of ${esc(item.name)}">
        </div>
        <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" data-cost-save="${item.id}">Save cost</button>
      </div>
    `).join("") || `<p class="profit-empty">Menu is empty.</p>`;
  }

  function bindProfit() {
    $("#profit-mode")?.addEventListener("change", async (event) => {
      state.profitMode = event.target.value;
      state.profitFrom = "";
      state.profitTo = "";
      await loadProfit(true);
    });

    $("#profit-filter")?.addEventListener("click", async (event) => {
      const pill = event.target.closest("[data-profit-filter]");
      if (!pill || pill.classList.contains("is-active")) return;
      state.profitFilter = pill.dataset.profitFilter;
      await loadProfit(true);
    });

    $("#profit-seed-demo")?.addEventListener("click", async () => {
      try {
        await API.adminSeedDemo(true);
        showToast("Demo data seeded. See it in Profit → demo mode.");
        state.overview = null;
        await loadData({ silent: true });
        await loadProfit(true);
      } catch (error) {
        showToast(error?.message || "Could not seed demo data.", "error");
      }
    });

    $("#profit-clear-demo")?.addEventListener("click", async () => {
      try {
        await API.adminClearDemo();
        showToast("Demo data cleared.");
        state.overview = null;
        await loadData({ silent: true });
        await loadProfit(true);
      } catch (error) {
        showToast(error?.message || "Could not clear demo data.", "error");
      }
    });

    $("#expense-add")?.addEventListener("click", async () => {
      const label = $("#expense-label")?.value?.trim();
      const amount = Number($("#expense-amount")?.value);
      const spentOn = $("#expense-date")?.value || "";
      const button = $("#expense-add");
      if (!label || !Number.isFinite(amount) || amount <= 0) {
        showToast("Give the expense a name and an amount.", "error");
        return;
      }
      button && (button.disabled = true);
      try {
        await API.adminAddExpense({ label, amount, spentOn });
        if ($("#expense-label")) $("#expense-label").value = "";
        if ($("#expense-amount")) $("#expense-amount").value = "";
        await renderExpenses();
        await loadProfit(true);
        showToast("Expense added.");
      } catch (error) {
        showToast(error?.message || "Could not add the expense.", "error");
      } finally {
        button && (button.disabled = false);
      }
    });

    $("#expense-list")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-expense-del]");
      if (!button) return;
      try {
        await API.adminDeleteExpense(button.dataset.expenseDel);
        await renderExpenses();
        await loadProfit(true);
      } catch (error) {
        showToast(error?.message || "Could not delete the expense.", "error");
      }
    });

    $("#cost-editor")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-cost-save]");
      if (!button) return;
      const id = button.dataset.costSave;
      const input = $(`input[data-cost-input="${id}"]`);
      const cost = Number(input?.value);
      if (!Number.isFinite(cost) || cost < 0) {
        showToast("Enter a valid product cost.", "error");
        return;
      }
      button.disabled = true;
      try {
        await API.adminSetCost(id, cost);
        if (state.menu) {
          const items = Array.isArray(state.menu) ? state.menu : state.menu.items || [];
          const item = items.find((i) => String(i.id) === String(id));
          if (item) item.costPrice = cost;
        }
        await loadProfit(true);
        showToast("Product cost saved.");
      } catch (error) {
        showToast(error?.message || "Could not save the product cost.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  /* ------------------------------------------------------------------------
     Customer records - built from real orders, grouped per phone number.
     ------------------------------------------------------------------------ */

  async function loadCustomers() {
    if (!state.ready) return;
    const list = $("#customer-list");
    try {
      const [data, orders] = await Promise.all([
        API.adminCustomers(state.profitMode),
        API.adminOrders().catch(() => state.orders)
      ]);
      state.customers = Array.isArray(data) ? data : [];
      // Cache for the per-customer order history drill-down.
      state.orders = Array.isArray(orders) ? orders : state.orders;
      renderCustomers(list);
    } catch (error) {
      if (list) list.innerHTML = `<p class="panel-empty">Could not load the customer records.</p>`;
      handleApiError(error, "Could not load the customer records.");
    }
  }

  function renderCustomers(list) {
    const target = list || $("#customer-list");
    if (!target) return;
    const query = state.customerQuery.trim().toLowerCase();
    const rows = state.customers.filter((customer) =>
      !query || String(customer.name || "").toLowerCase().includes(query) || String(customer.phone).includes(query)
    );
    if (!rows.length) {
      target.innerHTML = `<p class="panel-empty">${query ? "No customer matches that search." : "No orders yet, so no customer records."}</p>`;
      return;
    }
    target.innerHTML = rows.map((customer) => {
      const open = state.expandedCustomer === customer.phone;
      const history = open
        ? state.orders.filter((order) => order.phone === customer.phone).map((order) => `
            <div class="customer-order">
              <span><strong>${esc(order.orderNumber)}</strong><small>${esc(orderDate(order.createdAt))}</small></span>
              <span class="status-pill status-${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</span>
              <span class="customer-order-total">${money(order.total)}</span>
            </div>`).join("") || `<p class="panel-empty">No orders cached for this phone.</p>`
        : "";
      return `
      <article class="customer-row${open ? " is-open" : ""}">
        <button type="button" class="customer-toggle" data-customer-toggle="${esc(customer.phone)}" aria-expanded="${open}">
          <span class="customer-name"><strong>${esc(customer.name)}</strong><small>${esc(customer.barangay || "")}</small></span>
          <span class="customer-phone">${esc(customer.phone)}</span>
          <span class="customer-stats">
            <b>${customer.orders}</b> orders
            <small>${customer.openOrders ? `${customer.openOrders} open` : "all closed"}</small>
          </span>
          <span class="customer-revenue">${money(customer.deliveredRevenue)}</span>
          <small>${esc(customer.lastOrder || "")}</small>
          <span class="customer-chevron" aria-hidden="true">${open ? "Close" : "History"}</span>
        </button>
        ${open ? `<div class="customer-history">${history}
          <div class="customer-danger">
            ${state.confirmDeletePhone === customer.phone && customer.customerId ? `
              <form class="customer-danger-confirm" data-customer-confirm-form="${esc(customer.phone)}">
                <span>Type <b>DELETE</b> to remove <b>${esc(customer.name)}</b>. Their orders stay in revenue history.</span>
                <input type="text" class="admin-inline-input" data-customer-confirm-input maxlength="10" placeholder="DELETE" autocomplete="off" aria-label="Type DELETE to confirm">
                <button type="submit" class="admin-btn admin-btn-danger admin-btn-sm">Delete customer</button>
                <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-customer-cancel>Cancel</button>
              </form>` : `
              <button type="button" class="admin-btn admin-btn-danger admin-btn-sm" data-customer-delete="${esc(customer.phone)}"${customer.customerId ? "" : " disabled title=\"No account row found\""}>${icon("trash")} Remove record</button>`}
          </div>
        </div>` : ""}
      </article>`;
    }).join("");
  }

  function bindCustomers() {
    $("#customer-search")?.addEventListener("input", (event) => {
      state.customerQuery = event.target.value || "";
      renderCustomers();
    });

    $("#customer-list")?.addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-customer-toggle]");
      if (toggle) {
        const phone = toggle.dataset.customerToggle;
        state.expandedCustomer = state.expandedCustomer === phone ? null : phone;
        renderCustomers();
        return;
      }
      // Typed confirmation before an account removal: one click only opens
      // the form, the DELETE keyword on submit is what really deletes.
      const del = event.target.closest("[data-customer-delete]");
      if (del && !del.disabled) {
        state.confirmDeletePhone = del.dataset.customerDelete;
        state.expandedCustomer = state.confirmDeletePhone;
        renderCustomers();
        return;
      }
      if (event.target.closest("[data-customer-cancel]")) {
        state.confirmDeletePhone = null;
        renderCustomers();
      }
    });

    $("#customer-list")?.addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-customer-confirm-form]");
      if (!form) return;
      event.preventDefault();
      const phone = form.dataset.customerConfirmForm;
      const input = form.querySelector("[data-customer-confirm-input]");
      if (String(input?.value || "").trim() !== "DELETE") {
        showToast("Type DELETE exactly to confirm.", "error");
        return;
      }
      const customer = state.customers.find((entry) => entry.phone === phone);
      if (!customer?.customerId) {
        showToast("No account row found for this record.", "error");
        return;
      }
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        const result = await API.adminDeleteCustomer(customer.customerId);
        state.confirmDeletePhone = null;
        state.expandedCustomer = null;
        await loadCustomers();
        showToast(`Customer removed. ${result.ordersKept} ${result.ordersKept === 1 ? "order" : "orders"} kept in revenue history.`);
      } catch (error) {
        button.disabled = false;
        handleApiError(error, "Could not remove that customer.");
      }
    });
  }

  function showToast(message, type = "success") {
    if (!els.toastStack) return;
    const toast = document.createElement("div");
    toast.className = `admin-toast${type === "error" ? " is-error" : ""}`;
    toast.innerHTML = `<span>${icon(type === "error" ? "close" : "check")}</span><p>${esc(message)}</p>`;
    els.toastStack.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 240);
    }, 3000);
  }
})();



