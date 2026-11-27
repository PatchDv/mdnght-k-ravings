/**
 * MDNGHT K-RAVINGS — storefront
 * Profile onboarding, menu rendering, search/sort, cart, checkout, profile.
 */
(function () {
  "use strict";

  const CFG = window.MK_CONFIG;
  const A = window.MKAlgorithms;
  const API = window.MK_API;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  // The gate asks the server who is browsing (async), so keep the page hidden
  // until it answers — a logged-out visitor must not see the store flash by.
  document.documentElement.classList.add("auth-pending");

  // Signed-in gate. The server decides who is browsing: a customer Bearer
  // token, or a valid admin cookie (which never reaches this script) for the
  // storefront preview. Always asked fresh — storage may hold a stale profile,
  // and only the server knows about the admin session.
  async function ensureStorefrontSession() {
    try {
      const session = await API.customerSession();
      if (session?.role === "admin") {
        state.profile = session.profile;
        document.body.classList.add("admin-shopper");
        bindAdminReturn();
        return true;
      }
      if (session?.role === "customer") {
        state.profile = { ...session.profile, role: "customer" };
        writeStorage(CFG.STORAGE.PROFILE, state.profile);
        return true;
      }
    } catch {
      /* Server unreachable: treat as signed out; the caller redirects. */
    }
    return false;
  }

  // Back to Admin: visible only to signed-in admins. The secret path is
  // fetched from the server on tap (requireAdmin), so the page source never
  // contains it and customers/logged-out visitors get no button at all.
  function bindAdminReturn() {
    const button = $("#admin-return");
    if (!button || button.dataset.bound) return;
    button.dataset.bound = "1";
    button.hidden = false;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const door = await API.adminDoor();
        window.location.assign(door?.path || "/");
      } catch {
        button.disabled = false;
        showToast("Could not reach the admin board. Please sign in there again.", "error");
      }
    });
  }

  const icon = (name, className = "") =>
    `<svg${className ? ` class="${className}"` : ""} aria-hidden="true"><use href="#i-${name}"/></svg>`;

  const money = (value) => A.formatPeso(value);
  const esc = (value) => A.escapeHtml(value);
  const image = (itemOrKey) =>
    window.resolveItemImage ? window.resolveItemImage(itemOrKey) : window.resolveMenuImage(itemOrKey);
  const imageFallback = (itemOrKey) => {
    if (itemOrKey && typeof itemOrKey === "object") {
      if (itemOrKey.categorySlug === "trays-bilao") return window.MK_IMAGES?.["tray"] || "assets/images/wings-banban.jpg";
      if (itemOrKey.categorySlug === "silog-meals") return window.MK_IMAGES?.["porkchop-silog"] || "assets/images/silog-pork.jpg";
    }
    return window.MK_FALLBACK_IMAGE || "assets/images/wings.jpg";
  };

  function readStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Storage can be full or blocked; the app still works for this visit. */
    }
  }

  function readObjectStorage(key) {
    const value = readStorage(key, null);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  // Older versions of the site (or hand-edited storage) can leave a cart/order
  // shape we no longer understand. Clean it up instead of letting one bad key
  // break the whole storefront before the menu can load.
  function sanitizeCart(lines) {
    return lines
      .filter((line) => line && typeof line === "object")
      .map((line, index) => {
        const menuItemId = Number(line.menuItemId);
        const quantity = Math.max(1, Math.floor(Number(line.quantity) || 1));
        const unitPrice = Number(line.unitPrice);
        if (!Number.isFinite(menuItemId) || menuItemId <= 0) return null;
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
        return {
          key: String(line.key || `line-${menuItemId}-${index}`),
          menuItemId,
          name: String(line.name || "Saved craving"),
          imageKey: String(line.imageKey || "default"),
          categoryName: String(line.categoryName || ""),
          basePrice: Number(line.basePrice) || unitPrice,
          unitPrice,
          quantity,
          selectedOptions:
            line.selectedOptions && typeof line.selectedOptions === "object"
              ? line.selectedOptions
              : {},
          optionsText: String(line.optionsText || "")
        };
      })
      .filter(Boolean);
  }

  function sanitizeOrders(orders) {
    return orders
      .filter((order) => order && typeof order === "object" && order.orderNumber)
      .map((order) => {
        const items = Array.isArray(order.items)
          ? order.items
              .filter((item) => item && typeof item === "object")
              .map((item) => ({
                name: String(item.name || "Item"),
                quantity: Math.max(1, Number(item.quantity) || 1)
              }))
          : [];
        const itemCount =
          Number(order.itemCount) || items.reduce((total, item) => total + item.quantity, 0);
        return {
          ...order,
          orderNumber: String(order.orderNumber),
          total: Number(order.total) || 0,
          subtotal: Number(order.subtotal) || 0,
          // null means the admin has not quoted the delivery fee yet.
          deliveryFee: order.deliveryFee === null || order.deliveryFee === undefined ? null : Number(order.deliveryFee) || 0,
          deliveryFeeSet: order.deliveryFeeSet === undefined ? order.deliveryFee !== null : Boolean(order.deliveryFeeSet),
          status: typeof order.status === "string" ? order.status : "pending",
          itemCount,
          items
        };
      })
      .slice(0, 20);
  }

  const state = {
    categories: [],
    items: [],
    itemMap: new Map(),
    profile: readObjectStorage(CFG.STORAGE.PROFILE),
    // Cart and order history live on the server per customer account; the
    // shared-guest localStorage cart from older builds is gone.
    cart: [],
    orders: [],
    query: "",
    filter: "all",
    sort: "recommended",
    itemModal: null,
    menuError: false,
    checkoutBusy: false,
    profileRefreshing: false,
    storeOpen: true
  };

  const els = {};

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  // The delivery-area select is defined in config.js but the options must be
  // rendered — without this the details form dead-ends with an empty dropdown.
  function populateBarangays() {
    if (!els.barangay) return;
    const list = window.MK_CONFIG.BARANGAYS || [];
    els.barangay.innerHTML = [
      `<option value="">Select your barangay</option>`,
      ...list.map((entry) => `<option value="${esc(entry.name)}">${esc(entry.name)}</option>`)
    ].join("");
  }

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    const signedIn = await ensureStorefrontSession();
    document.documentElement.classList.remove("auth-pending");
    if (!signedIn) {
      location.replace("login.html");
      return;
    }
    const setupSteps = [
      cacheElements,
      populateBarangays,
      showGridPlaceholders,
      applyProfileToChrome,
      bindGlobalEvents,
      bindWelcome,
      bindMenuControls,
      bindOverlays,
      bindItemModal,
      bindCart,
      bindCheckout,
      bindProfile,
      bindBottomNav,
      renderCartBadges,
      renderProfile,
      setFooterYear,
      openWelcomeIfNeeded,
      startAvailabilitySync,
      startStoreSync
    ];

    setupSteps.forEach((step) => {
      try {
        step();
      } catch (error) {
        console.error(`Storefront setup step "${step.name}" failed:`, error);
      }
    });

    // The menu load must always run, even if another setup step failed.
    try {
      await loadMenu();
    } catch (error) {
      console.error("Menu load failed:", error);
    }

    await loadAccountData();
  }

  // Pull this account's cart and order history from the server. Everything
  // below the sign-in screen belongs to exactly one customer ID.
  async function loadAccountData() {
    try {
      const [cart, orders] = await Promise.all([API.customerCart(), API.customerOrders()]);
      state.cart = Array.isArray(cart) ? sanitizeCart(cart) : [];
      state.orders = sanitizeOrders(Array.isArray(orders) ? orders : []);
      rememberSavedCart(state.cart);
      renderCartBadges(false);
      renderCart();
      renderProfile();
    } catch (error) {
      if (error.status === 401) {
        location.replace("login.html");
        return;
      }
      showToast("Could not load your saved cart.", "error");
    }
  }

  function openWelcomeIfNeeded() {
    // Login page owns sign-in now; the welcome screen is only the details
    // editor. Admins are never asked: their storefront orders are test orders
    // and the server files them without a delivery address.
    if (els.welcome) {
      els.welcome.hidden = true;
      document.body.classList.remove("welcome-open");
    }
  }

  // Before the menu arrives, keep every section visibly "alive" with shimmer
  // placeholders instead of blank grids. renderMenu() replaces them when the
  // real dishes are ready.
  function showGridPlaceholders() {
    $$(".menu-section").forEach((section) => {
      const grid = $(`.menu-grid`, section);
      if (!grid || grid.childElementCount || grid.classList.contains("has-placeholder")) return;
      grid.classList.add("has-placeholder");
      const skeleton = (count) =>
        Array.from({ length: count }, () => `
          <div class="skeleton-card" aria-hidden="true">
            <span class="skeleton-media"></span>
            <span class="skeleton-line"></span>
            <span class="skeleton-line short"></span>
            <span class="skeleton-chip"></span>
          </div>
        `).join("");
      const count = section.classList.contains("section-silog") ? 3 : 4;
      grid.innerHTML = skeleton(count);
    });
  }

  function cacheElements() {
    els.loader = $("#site-loader");
    els.welcome = $("#welcome-screen");
    els.welcomeForm = $("#welcome-form");
    els.welcomeClose = $("#welcome-close");
    els.welcomeError = $("#welcome-error");
    els.firstName = $("#first-name");
    els.lastName = $("#last-name");
    els.barangay = $("#barangay-select");
    els.welcomeAddress = $("#welcome-address");
    els.welcomeLandmark = $("#welcome-landmark");
    els.headerLocation = $("#header-location");
    els.mobileHeaderLocation = $("#mobile-header-location");
    els.profileInitials = $("#profile-initials");
    els.adminShopBadge = $("#admin-shop-badge");
    els.cartButton = $("#cart-button");
    els.cartBadge = $("#cart-badge");
    els.searchForm = $("#header-search-form");
    els.searchInput = $("#menu-search");
    els.searchClear = $("#search-clear");
    els.searchSuggestions = $("#search-suggestions");
    // nav-toggle/mobile-nav are gone (merged into the top bar); any leftover
    // references resolve to undefined and stay null-safe.
    els.scrollProgress = $("#scroll-progress");
    els.backToTop = $("#back-to-top");
    els.sortSelect = $("#sort-select");
    els.filterPills = $("#filter-pills");
    els.resultSummary = $("#result-summary");
    els.menuStatus = $("#menu-status");
    els.itemModal = $("#item-modal");
    els.itemModalBody = $("#item-modal-body");
    els.cartDrawer = $("#cart-drawer");
    els.cartBody = $("#cart-body");
    els.cartFooter = $("#cart-footer");
    els.profileDrawer = $("#profile-drawer");
    els.profileBody = $("#profile-body");
    els.checkoutModal = $("#checkout-modal");
    els.checkoutBody = $("#checkout-body");
    els.scrim = $("#screen-scrim");
    els.toastStack = $("#toast-stack");
  }

  function hideLoader() {
    if (els.loader) els.loader.classList.add("is-hidden");
  }

  function setFooterYear() {
    const year = $("#footer-year");
    if (year) year.textContent = new Date().getFullYear();
  }

  /* ------------------------------------------------------------------------
     Profile / welcome
     ------------------------------------------------------------------------ */

  function shortBarangay(name) {
    if (!name) return "Madapdap";
    return String(name).replace(/\s*\(.*?\)\s*/g, "").trim() || "Madapdap";
  }

  function initials(profile) {
    if (!profile) return "MK";
    return `${String(profile.firstName || "M").charAt(0)}${String(profile.lastName || "K").charAt(0)}`.toUpperCase();
  }

  function applyProfileToChrome() {
    // Location chip was removed from the header; the avatar still reflects the account.
    const isAdmin = state.profile?.role === "admin";
    if (els.adminShopBadge) els.adminShopBadge.hidden = !isAdmin;
    if (state.profile) {
      if (els.profileInitials) els.profileInitials.textContent = initials(state.profile);
      document.title = isAdmin
        ? "Storefront preview | MDNGHT K-RAVINGS"
        : `${state.profile.firstName}'s cravings | MDNGHT K-RAVINGS`;
    } else if (els.profileInitials) {
      els.profileInitials.textContent = "MK";
    }
  }

  function openWelcome(edit = true) {
    if (!els.welcome) return;
    closeMobileNav();
    closeAllOverlays({ keepScrim: false, silent: true });
    els.welcome.hidden = false;
    document.body.classList.add("welcome-open");
    if (state.profile) {
      els.firstName.value = state.profile.firstName || "";
      els.lastName.value = state.profile.lastName || "";
      els.barangay.value = state.profile.barangay || "";
      els.welcomeAddress.value = state.profile.address || "";
      els.welcomeLandmark.value = state.profile.landmark || "";
      els.welcomeClose.hidden = false;
    } else {
      els.welcomeClose.hidden = true;
    }
    els.welcomeError.textContent = "";
    window.setTimeout(() => (edit ? els.firstName : els.firstName).focus(), 80);
  }

  function closeWelcome() {
    if (!state.profile || !els.welcome) return;
    els.welcome.hidden = true;
    document.body.classList.remove("welcome-open");
    syncBodyLock();
  }

  function bindWelcome() {
    if (!els.welcomeForm) return;

    els.welcomeClose?.addEventListener("click", closeWelcome);

    els.welcomeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const firstName = els.firstName.value.trim();
      const lastName = els.lastName.value.trim();
      const barangay = els.barangay.value;
      const address = els.welcomeAddress.value.trim();
      const landmark = els.welcomeLandmark.value.trim();

      if (!firstName) {
        els.welcomeError.textContent = "Please add your first name.";
        els.firstName.focus();
        return;
      }
      if (!lastName) {
        els.welcomeError.textContent = "Please add your last name.";
        els.lastName.focus();
        return;
      }
      if (!barangay) {
        els.welcomeError.textContent = "Please choose the barangay we should deliver to.";
        els.barangay.focus();
        return;
      }
      if (address.length < 10) {
        els.welcomeError.textContent = "Enter your complete delivery address (block, lot, phase, street, barangay).";
        els.welcomeAddress.focus();
        return;
      }

      const submit = $("button[type='submit']", els.welcomeForm);
      if (submit) submit.disabled = true;
      try {
        // The account row is the source of truth for checkout, so save there
        // first; the local copy is just a cache for instant rendering.
        let saved = { firstName, lastName, barangay, address, landmark };
        // Customers persist to their account row; the admin preview persists
        // to its own server-side storefront settings.
        if (localStorage.getItem(CFG.STORAGE.CUSTOMER_TOKEN) || state.profile?.role === "admin") {
          saved = await API.customerUpdateProfile(saved);
        }
        state.profile = {
          ...(state.profile || {}),
          ...saved,
          updatedAt: new Date().toISOString()
        };
        writeStorage(CFG.STORAGE.PROFILE, state.profile);
        applyProfileToChrome();
        els.welcomeError.textContent = "";
        els.welcome.hidden = true;
        document.body.classList.remove("welcome-open");
        syncBodyLock();
        renderProfile();
        showToast(`Salamat, ${firstName}! Your cravings are ready.`, "success");
      } catch (error) {
        els.welcomeError.textContent = error.message || "Could not save your details. Please try again.";
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  /* ------------------------------------------------------------------------
     Menu loading and rendering
     ------------------------------------------------------------------------ */

  async function loadMenu() {
    state.menuError = false;
    try {
      const data = await API.getMenu();
      state.categories = Array.isArray(data?.categories) ? data.categories : [];
      state.items = [];

      state.categories.forEach((category) => {
        (category.items || []).forEach((item) => {
          const normalized = {
            ...item,
            categorySlug: category.slug,
            categoryName: category.name,
            displayOrder: Number(item.displayOrder) || 0,
            sortIndex: Number(item.displayOrder) || 0,
            price: Number(item.price) || 0,
            tags: Array.isArray(item.tags) ? item.tags : [],
            optionGroups: Array.isArray(item.optionGroups) ? item.optionGroups : []
          };
          state.items.push(normalized);
          state.itemMap.set(normalized.id, normalized);
        });
      });

      renderMenu();
    } catch (error) {
      console.error("Menu load failed:", error);
      state.menuError = true;
      renderMenuError(error);
      showToast("We couldn't load the menu. Please check the kitchen server.", "error");
    }
  }

  function renderMenuError(error) {
    $$(".menu-section").forEach((section) => {
      const grid = $(`.menu-grid`, section);
      if (grid) grid.innerHTML = "";
    });
    if (!els.menuStatus) return;
    const heading = $("h3", els.menuStatus);
    const copy = $("p", els.menuStatus);
    const action = $("#clear-filters", els.menuStatus);
    if (heading) heading.textContent = "The kitchen signal dropped.";
    if (copy) copy.textContent = error?.message || "Please try loading the menu again.";
    if (action) action.textContent = "Try again";
    els.menuStatus.hidden = false;
  }

  /* Availability lives with the kitchen, not this device: a light poll keeps
     sold-out dishes current on an open storefront without a page reload. The
     backend re-validates every line at order time, so this is presentation. */
  function availabilitySignature() {
    return state.items.map((item) => `${item.id}:${item.isAvailable ? 1 : 0}`).join(",");
  }

  async function refreshMenuAvailability() {
    if (document.hidden || state.menuError || !state.items.length) return;
    const before = availabilitySignature();
    try {
      const data = await API.getMenu();
      (data?.categories || []).forEach((category) => {
        (category.items || []).forEach((item) => {
          const known = state.itemMap.get(item.id);
          if (known) known.isAvailable = Boolean(item.isAvailable);
        });
      });
      if (availabilitySignature() !== before) {
        renderMenu();
        const modal = state.itemModal;
        if (modal && !modal.item.isAvailable && els.itemModal?.classList.contains("is-open")) {
          closeItemModal(true);
          showToast(`${modal.item.name} is no longer available.`, "error");
        }
      }
    } catch {
      /* silent: the next poll cycle retries */
    }
  }

  function startAvailabilitySync() {
    if (window.__mkAvailabilityTimer) return;
    window.__mkAvailabilityTimer = setInterval(refreshMenuAvailability, 30000);
    // Coming back to the tab (app switch back, tab focus) shows current stock.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshMenuAvailability();
    });
  }

  // Store open/closed, straight from the admin's settings.
  function startStoreSync() {
    refreshStoreStatus();
    if (window.__mkStoreTimer) return;
    window.__mkStoreTimer = setInterval(refreshStoreStatus, 30000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshStoreStatus();
    });
  }

  async function refreshStoreStatus() {
    try {
      const data = await API.getStoreStatus();
      applyStoreStatus(Boolean(data.open));
    } catch {
      // Keep the last known state; ordering stays governed by the server anyway.
    }
  }

  function applyStoreStatus(open) {
    const changed = state.storeOpen !== open;
    state.storeOpen = open;
    document.body.classList.toggle("store-closed", !open);
    const banner = $("#store-closed-banner");
    if (banner) banner.hidden = open;
    if (changed) {
      renderCart();
      renderMenu();
    }
  }

  function storeClosedNotice() {
    showToast("The store is currently closed. Ordering is unavailable right now.", "info");
  }

  function renderMenu() {
    if (state.menuError) return;

    const searched = state.query ? A.searchMenu(state.items, state.query) : [...state.items];
    let totalVisible = 0;

    // If the server returned no categories at all, drop the placeholders and
    // tell the truth instead of reusing the search copy.
    if (!state.categories.length) {
      $$(".menu-section").forEach((section) => {
        const grid = $(`.menu-grid`, section);
        if (grid) grid.innerHTML = "";
      });
      if (els.menuStatus) {
        const heading = $("h3", els.menuStatus);
        const copy = $("p", els.menuStatus);
        const action = $("#clear-filters", els.menuStatus);
        if (heading) heading.textContent = "The menu is empty.";
        if (copy) copy.textContent = "The kitchen hasn't added any dishes yet. Come back soon!";
        if (action) action.textContent = "Refresh menu";
        els.menuStatus.hidden = false;
      }
      syncFilterPills();
      updateSearchChrome();
      return;
    }

    state.categories.forEach((category) => {
      const section = $(`#${category.slug}`);
      const grid = $(`#grid-${category.slug}`);
      if (!section || !grid) return;

      const categoryMatches = searched.filter((item) => item.categorySlug === category.slug);
      const filterMismatch = state.filter !== "all" && state.filter !== category.slug;
      const visible = filterMismatch ? [] : A.sortMenu(categoryMatches, state.sort);

      totalVisible += visible.length;
      section.classList.toggle("is-filtered-out", filterMismatch || visible.length === 0);
      grid.classList.remove("has-placeholder");
      grid.innerHTML = visible.map((item, index) => menuCardHtml(item, index)).join("");
    });

    syncFilterPills();
    updateSearchChrome();

    if (els.menuStatus) {
      const heading = $("h3", els.menuStatus);
      const copy = $("p", els.menuStatus);
      const action = $("#clear-filters", els.menuStatus);
      if (heading) heading.textContent = "We couldn't find that craving.";
      if (copy) copy.textContent = "Try a shorter word like “wings”, “cheese”, or “silog”.";
      if (action) action.textContent = "Show everything";
      els.menuStatus.hidden = totalVisible > 0;
    }

    if (els.resultSummary) {
      if (state.query) {
        els.resultSummary.innerHTML = `<strong>${totalVisible}</strong> ${totalVisible === 1 ? "craving" : "cravings"} found`;
      } else if (state.filter !== "all") {
        els.resultSummary.innerHTML = `<strong>${totalVisible}</strong> ${totalVisible === 1 ? "dish" : "dishes"} in this section`;
      } else {
        els.resultSummary.innerHTML = `<strong>${totalVisible}</strong> dishes on the menu`;
      }
    }
  }

  function menuCardHtml(item, index) {
    const badgeClass = ["FAN FAVORITE", "BARKADA PICK", "CROWD PLEASER"].includes(item.badge)
      ? " card-badge badge-yellow"
      : "card-badge";
    const chips = cardChips(item);
    const isSpicy = item.tags.some((tag) => String(tag).toLowerCase().includes("spicy"));

    // Sold-out dishes stay on the board, dimmed, but cannot be ordered.
    if (!item.isAvailable) {
      return `
        <article class="menu-card is-unavailable" data-item-id="${item.id}" style="animation-delay:${Math.min(index * 35, 280)}ms">
          <div class="menu-card-media">
            <img src="${esc(image(item))}" alt="${esc(item.name)}" loading="lazy" data-fallback="${esc(imageFallback(item))}">
            <span class="card-unavailable-label">Currently unavailable</span>
          </div>
          <div class="menu-card-body">
            <p class="card-topline">${esc(item.categoryName)}</p>
            <div class="card-title-row">
              <h3>${esc(item.name)}</h3>
              <span class="card-price">${money(item.price)}<small>per order</small></span>
            </div>
            <p class="card-desc">${esc(item.description)}</p>
            <div class="card-footer">
              <button type="button" class="card-add" disabled aria-label="${esc(item.name)} is currently unavailable">
                Not available ${icon("close")}
              </button>
            </div>
          </div>
        </article>
      `;
    }

    return `
      <article class="menu-card" data-item-id="${item.id}" style="animation-delay:${Math.min(index * 35, 280)}ms">
        <button type="button" class="menu-card-media" data-open-item="${item.id}" aria-label="View ${esc(item.name)}">
          <img src="${esc(image(item))}" alt="${esc(item.name)}" loading="lazy" data-fallback="${esc(imageFallback(item))}">
          ${item.badge ? `<span class="${badgeClass}">${esc(item.badge)}</span>` : ""}
          <span class="card-quick">View details ${icon("arrow")}</span>
        </button>
        <div class="menu-card-body">
          <p class="card-topline">${esc(item.categoryName)}</p>
          <div class="card-title-row">
            <h3>${esc(item.name)}</h3>
            <span class="card-price">${money(item.price)}<small>${item.optionGroups.length ? "base price" : "per order"}</small></span>
          </div>
          <p class="card-desc">${esc(item.description)}</p>
          <div class="card-meta">
            ${isSpicy ? `<span class="card-meta-hot">Spicy</span>` : ""}
            ${chips.map((chip) => `<span>${esc(chip)}</span>`).join("")}
          </div>
          <div class="card-footer">
            <button type="button" class="card-add" data-open-item="${item.id}">
              ${item.optionGroups.length ? "Choose options" : "Add to order"} ${icon("plus")}
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function cardChips(item) {
    const chips = [];
    item.optionGroups.forEach((group) => {
      if (group.type === "flavors") chips.push(`Choose up to ${group.max || 1}`);
      else if (group.type === "checkbox") chips.push("Add-ons available");
      else if (group.label) chips.push(String(group.label).replace(/^choose your /i, "").replace(/^choose /i, ""));
    });
    if (!chips.length) chips.push(...item.tags.slice(0, 2));
    return chips.slice(0, 3);
  }

  function updateSearchChrome() {
    if (els.searchClear) els.searchClear.hidden = !state.query;
    if (els.searchInput && els.searchInput.value !== state.query) els.searchInput.value = state.query;
  }

  function syncFilterPills() {
    $$(".filter-pill", els.filterPills || document).forEach((pill) => {
      pill.classList.toggle("is-active", pill.dataset.filter === state.filter);
    });
  }

  // The controls moved into the sticky top bar; the menu itself starts at the
  // first section.
  function scrollToMenu() {
    $("#korean-cravings")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setFilter(filter, options = {}) {
    state.filter = filter || "all";
    syncFilterPills();
    renderMenu();
    if (options.scroll) scrollToMenu();
  }

  function setQuery(query, options = {}) {
    state.query = String(query || "");
    if (els.searchInput) els.searchInput.value = state.query;
    renderMenu();
    hideSearchSuggestions();
    if (options.scroll) {
      scrollToMenu();
      els.searchInput?.focus({ preventScroll: true });
    }
  }

  function suggestItemHtml(item) {
    return `
      <button type="button" class="suggest-item" data-suggest-item="${item.id}" role="option">
        <span class="suggest-thumb">
          <img src="${esc(image(item))}" alt="" loading="lazy" data-fallback="${esc(imageFallback(item))}">
        </span>
        <span class="suggest-info">
          <strong>${esc(item.name)}</strong>
          <small>${esc(item.categoryName)}</small>
        </span>
        <span class="suggest-price">${money(item.price)}</span>
      </button>
    `;
  }

  function searchSuggestionsHtml() {
    if (!els.searchSuggestions) return;
    const query = String(els.searchInput?.value || "").trim();

    if (!state.items.length) {
      els.searchSuggestions.innerHTML = `<p class="suggest-empty">Loading today’s menu…</p>`;
      return;
    }

    if (!query) {
      els.searchSuggestions.innerHTML = `
        <div class="suggest-head"><span>Quick searches</span><svg><use href="#i-search"/></svg></div>
        <div class="suggest-chips">
          ${["wings", "kimbap", "cheese", "silog", "trays"]
            .map((term) => `<button type="button" class="suggest-chip" data-suggest-query="${term}">${term}</button>`)
            .join("")}
        </div>
      `;
      return;
    }

    const results = A.searchMenu(state.items, query);
    if (!results.length) {
      els.searchSuggestions.innerHTML = `
        <p class="suggest-empty">No match for “${esc(query)}”. Try “wings”, “cheese”, or “silog”.</p>
      `;
      return;
    }

    els.searchSuggestions.innerHTML = `
      <div class="suggest-head"><span>${results.length} match${results.length === 1 ? "" : "es"}</span><small>Tap to view</small></div>
      ${results.slice(0, 5).map((item) => suggestItemHtml(item)).join("")}
      ${results.length > 5 ? `<button type="button" class="suggest-all" data-suggest-all>See all ${results.length} results ${icon("arrow")}</button>` : ""}
    `;
  }

  function renderSearchSuggestions() {
    if (!els.searchSuggestions || !els.searchForm) return;
    searchSuggestionsHtml();
    els.searchSuggestions.hidden = false;
    els.searchSuggestions.classList.add("is-open");
    els.searchInput?.setAttribute("aria-expanded", "true");
    if (els.searchClear) els.searchClear.hidden = !String(els.searchInput?.value || "").trim();
  }

  function hideSearchSuggestions() {
    if (!els.searchSuggestions) return;
    els.searchSuggestions.hidden = true;
    els.searchSuggestions.classList.remove("is-open");
    els.searchInput?.setAttribute("aria-expanded", "false");
  }

  function bindMenuControls() {
    const applyQuery = (value, options = {}) => {
      state.query = String(value || "").trim();
      if (els.searchInput) els.searchInput.value = value;
      renderMenu();
      hideSearchSuggestions();
      if (options.scroll) {
        scrollToMenu();
        if (options.focus) els.searchInput?.focus({ preventScroll: true });
      }
    };

    const debounced = A.debounce(() => {
      state.query = els.searchInput.value.trim();
      renderMenu();
      renderSearchSuggestions();
    }, 120);

    els.searchInput?.addEventListener("input", debounced);
    els.searchInput?.addEventListener("focus", renderSearchSuggestions);

    els.searchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        applyQuery("");
        hideSearchSuggestions();
        els.searchInput.blur();
        return;
      }

      const items = $$("[data-suggest-item]", els.searchSuggestions || document);
      if (!items.length) return;
      const current = items.findIndex((item) => item.classList.contains("is-highlighted"));

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = event.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
        items.forEach((item) => item.classList.remove("is-highlighted"));
        items[next].classList.add("is-highlighted");
        items[next].scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && current >= 0) {
        event.preventDefault();
        items[current].click();
      }
    });

    els.searchForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      applyQuery(els.searchInput.value, { scroll: true, focus: true });
    });

    els.searchClear?.addEventListener("click", () => {
      applyQuery("");
      els.searchInput?.focus();
    });

    // Keep the input focused while a suggestion is tapped on mobile.
    els.searchSuggestions?.addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) event.preventDefault();
    });

    els.searchSuggestions?.addEventListener("click", (event) => {
      const itemButton = event.target.closest("[data-suggest-item]");
      if (itemButton) {
        hideSearchSuggestions();
        openItem(itemButton.dataset.suggestItem);
        return;
      }
      const queryButton = event.target.closest("[data-suggest-query]");
      if (queryButton) {
        applyQuery(queryButton.dataset.suggestQuery, { scroll: true, focus: true });
        return;
      }
      if (event.target.closest("[data-suggest-all]")) {
        applyQuery(els.searchInput.value, { scroll: true, focus: true });
      }
    });

    document.addEventListener("click", (event) => {
      if (!els.searchForm?.contains(event.target)) hideSearchSuggestions();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !event.target.closest("input, textarea, select")) {
        event.preventDefault();
        els.searchInput?.focus();
        els.searchInput?.select();
      }
    });

    els.sortSelect?.addEventListener("change", () => {
      state.sort = els.sortSelect.value;
      renderMenu();
    });

    els.filterPills?.addEventListener("click", (event) => {
      const pill = event.target.closest("[data-filter]");
      if (pill) setFilter(pill.dataset.filter, { scroll: true });
    });

    $("#clear-filters")?.addEventListener("click", () => {
      if (state.menuError) {
        loadMenu();
        return;
      }
      state.filter = "all";
      applyQuery("");
    });

    $$(".shortcut-card").forEach((card) => {
      card.addEventListener("click", () => {
        const shortcut = card.dataset.shortcut;
        if (shortcut === "wings") {
          state.filter = "korean-cravings";
          state.query = "wings";
        } else if (shortcut === "trays") {
          state.filter = "trays-bilao";
          state.query = "";
        } else if (shortcut === "kimbap") {
          state.filter = "all";
          state.query = "kimbap";
        } else if (shortcut === "silog") {
          state.filter = "silog-meals";
          state.query = "";
        }
        if (els.searchInput) els.searchInput.value = state.query;
        renderMenu();
        hideSearchSuggestions();
        scrollToMenu();
      });
    });
  }

  /* ------------------------------------------------------------------------
     Item customizer
     ------------------------------------------------------------------------ */

  function openItem(id) {
    const item = state.itemMap.get(Number(id));
    if (!item) return;

    closeAllOverlays({ keepScrim: true, silent: true });
    state.itemModal = {
      item,
      quantity: 1,
      selected: {},
      unavailable: !item.isAvailable
    };
    item.optionGroups.forEach((group) => {
      state.itemModal.selected[group.key] = group.type === "flavors" || group.type === "checkbox" ? [] : "";
    });

    els.itemModalBody.innerHTML = itemModalHtml(item);
    els.itemModal.classList.add("is-open");
    els.itemModal.setAttribute("aria-hidden", "false");
    syncBodyLock();
    refreshItemModal();
    window.setTimeout(() => $("#item-modal-close")?.focus(), 60);
  }

  function itemModalHtml(item) {
    const hasGroups = item.optionGroups.length > 0;
    const off = !item.isAvailable;
    return `
      <div class="item-modal-grid">
        <div class="item-media">
          <img src="${esc(image(item))}" alt="${esc(item.name)}" data-fallback="${esc(imageFallback(item))}">
          ${item.badge ? `<span class="item-media-badge">${esc(item.badge)}</span>` : ""}
          <span class="item-media-note">${icon("scooter")} Made fresh · ${esc(CFG.DELIVERY_ETA)} delivery</span>
        </div>
        <div class="item-modal-info">
          <p class="modal-kicker">${esc(item.categoryName)}</p>
          <h2 id="item-modal-title">${esc(item.name)}</h2>
          <p class="item-modal-desc">${esc(item.description)}</p>
          ${off ? `<p class="option-error" id="unavailable-note" role="alert">This dish is off the board right now — check back soon.</p>` : ""}
          <div class="modal-price-row">
            <strong id="modal-unit-price">${money(item.price)}</strong>
            <span>${hasGroups ? "current price · options included" : "per order"}</span>
          </div>
          <form id="item-options-form" novalidate>
            ${!off ? `${hasGroups ? item.optionGroups.map((group) => optionGroupHtml(group)).join("") : `<p class="option-group-note">No choices needed — we’ll prepare this just the way it is.</p>`}` : ""}
            <p class="option-error" id="option-error" role="alert"></p>
            <div class="modal-buy-row">
              <div class="qty-stepper" aria-label="Quantity">
                <button type="button" data-qty-action="dec" aria-label="Decrease quantity" ${off ? "disabled" : ""}>${icon("minus")}</button>
                <span id="modal-quantity">1</span>
                <button type="button" data-qty-action="inc" aria-label="Increase quantity" ${off ? "disabled" : ""}>${icon("plus")}</button>
              </div>
              <button type="submit" class="modal-add" id="modal-add-button" ${off ? "disabled" : ""}>
                <span>${off ? "Not available" : "Add to order"}</span>
                <strong id="modal-total">${money(item.price)}</strong>
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function choiceList(group) {
    return (Array.isArray(group.choices) ? group.choices : [])
      .map((choice) => {
        if (typeof choice === "string") return { name: choice, price: 0 };
        return { name: String(choice?.name || ""), price: Number(choice?.price) || 0 };
      })
      .filter((choice) => choice.name);
  }

  function optionGroupHtml(group) {
    const choices = choiceList(group);
    const selected = state.itemModal?.selected?.[group.key];
    const type = group.type || "radio";
    const required = group.required ? "<em>Required</em>" : "";
    const max = Number(group.max) || 0;
    const included = Number(group.included) || 0;
    const extraPrice = Number(group.extraPrice) || 0;

    let note = "";
    if (type === "flavors") {
      note = `First ${included} ${included === 1 ? "flavor is" : "flavors are"} included${extraPrice > 0 ? ` · +${money(extraPrice)} per extra flavor` : ""}.`;
    } else if (group.type === "checkbox" && max) {
      note = `Choose up to ${max} add-ons.`;
    }

    const choicesHtml = choices.map((choice) => {
      const checked = Array.isArray(selected)
        ? selected.includes(choice.name)
        : selected === choice.name;
      const classes = [
        "option-choice",
        type === "checkbox" ? "is-checkbox" : "",
        checked ? "is-selected" : ""
      ].filter(Boolean).join(" ");

      return `
        <label class="${classes}">
          <input
            type="${type === "radio" ? "radio" : "checkbox"}"
            name="option-${esc(group.key)}"
            value="${esc(choice.name)}"
            data-option-choice="${esc(group.key)}"
            ${checked ? "checked" : ""}
          >
          <span class="choice-dot"></span>
          <span class="choice-name">${esc(choice.name)}</span>
          ${choice.price > 0 ? `<span class="choice-price">+${money(choice.price)}</span>` : ""}
        </label>
      `;
    }).join("");

    return `
      <div class="option-group" data-group-key="${esc(group.key)}" data-group-type="${esc(type)}" data-group-max="${max}" data-group-included="${included}" data-group-extra="${extraPrice}">
        <div class="option-group-head">
          <h3>${esc(group.label || "Your choice")} ${required}</h3>
          <small>${type === "flavors" ? `Choose up to ${max || 1}` : type === "checkbox" && max ? `Up to ${max}` : group.required ? "Choose one" : "Optional"}</small>
        </div>
        ${note ? `<p class="option-group-note">${esc(note)}</p>` : ""}
        <div class="option-grid">${choicesHtml}</div>
      </div>
    `;
  }

  function refreshItemModal() {
    if (!state.itemModal) return;
    const { item, selected, quantity } = state.itemModal;

    $$(".option-group", els.itemModalBody).forEach((groupEl) => {
      const key = groupEl.dataset.groupKey;
      const type = groupEl.dataset.groupType;
      const max = Number(groupEl.dataset.groupMax) || 0;
      const pick = state.itemModal.selected[key];
      const isArray = Array.isArray(pick);
      let atLimit = false;

      if ((type === "flavors" || type === "checkbox") && max > 0) {
        atLimit = pick.length >= max;
      }

      $$(".option-choice", groupEl).forEach((label) => {
        const input = $("input", label);
        const checked = isArray ? pick.includes(input.value) : pick === input.value;
        label.classList.toggle("is-selected", checked);
        const locked = atLimit && !checked && input.type === "checkbox";
        label.classList.toggle("is-locked", locked);
        input.disabled = locked;
      });
    });

    const pricing = calculateSelections(item, selected);
    const unitEl = $("#modal-unit-price");
    const totalEl = $("#modal-total");
    const qtyEl = $("#modal-quantity");
    if (unitEl) unitEl.textContent = money(pricing.unitPrice);
    if (totalEl) totalEl.textContent = money(pricing.unitPrice * quantity);
    if (qtyEl) qtyEl.textContent = String(quantity);
  }

  function calculateSelections(item, selected = {}) {
    let unitPrice = Number(item.price) || 0;
    const summary = [];

    for (const group of item.optionGroups || []) {
      const choices = choiceList(group);
      const allowed = choices.map((choice) => choice.name);
      const type = group.type || "radio";
      const raw = selected[group.key];

      if (type === "flavors" || type === "checkbox") {
        const picked = Array.isArray(raw) ? [...new Set(raw.filter((entry) => allowed.includes(entry)))] : [];

        if (type === "flavors") {
          const included = Math.max(0, Number(group.included) || 0);
          const extraPrice = Math.max(0, Number(group.extraPrice) || 0);
          unitPrice += Math.max(0, picked.length - included) * extraPrice;
          if (picked.length) summary.push(`${picked.length > 1 ? "Flavors" : "Flavor"}: ${picked.join(" + ")}`);
        } else {
          for (const entry of picked) {
            const choice = choices.find((candidate) => candidate.name === entry);
            unitPrice += Number(choice?.price) || 0;
          }
          if (picked.length) summary.push(`Extras: ${picked.join(", ")}`);
        }
      } else {
        const picked = typeof raw === "string" && allowed.includes(raw) ? raw : "";
        const choice = choices.find((candidate) => candidate.name === picked);
        unitPrice += Number(choice?.price) || 0;
        if (picked) summary.push(`${group.label || "Choice"}: ${picked}`);
      }
    }

    return {
      unitPrice: Math.round(unitPrice * 100) / 100,
      optionsText: summary.join(" • ")
    };
  }

  function handleOptionChange(event) {
    const input = event.target.closest("[data-option-choice]");
    if (!input || !state.itemModal) return;
    const key = input.dataset.optionChoice;

    if (input.type === "checkbox") {
      const current = new Set(state.itemModal.selected[key] || []);
      if (input.checked) current.add(input.value);
      else current.delete(input.value);

      const groupEl = input.closest(".option-group");
      const max = Number(groupEl?.dataset.groupMax) || 0;
      if (max > 0 && current.size > max) {
        current.delete(input.value);
        input.checked = false;
        showToast(`You can choose up to ${max} for this option.`, "info");
      }
      state.itemModal.selected[key] = [...current];
    } else {
      state.itemModal.selected[key] = input.value;
    }

    const error = $("#option-error");
    if (error) error.textContent = "";
    refreshItemModal();
  }

  function validateItemSelection(item, selected) {
    for (const group of item.optionGroups || []) {
      const type = group.type || "radio";
      const raw = selected[group.key];
      const count = Array.isArray(raw) ? raw.length : raw ? 1 : 0;
      if (group.required && count === 0) {
        return `Please choose ${String(group.label || "an option").toLowerCase()}.`;
      }
      const max = Number(group.max) || 0;
      if (group.exact && count !== max) {
        return `Please choose exactly ${max} flavor${max === 1 ? "" : "s"} for “${group.label}”.`;
      }
      if (max > 0 && Array.isArray(raw) && raw.length > max) {
        return `You can choose up to ${max} for “${group.label}”.`;
      }
    }
    return "";
  }

  function bindItemModal() {
    els.itemModal?.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-item]") || event.target.closest("#item-modal-close")) {
        closeItemModal();
      }
    });

    els.itemModalBody?.addEventListener("change", handleOptionChange);

    els.itemModalBody?.addEventListener("click", (event) => {
      const qtyButton = event.target.closest("[data-qty-action]");
      if (!qtyButton || !state.itemModal) return;
      if (qtyButton.dataset.qtyAction === "inc") {
        state.itemModal.quantity = Math.min(20, state.itemModal.quantity + 1);
      } else {
        state.itemModal.quantity = Math.max(1, state.itemModal.quantity - 1);
      }
      refreshItemModal();
    });

    els.itemModalBody?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!state.itemModal) return;
      const { item, selected, quantity } = state.itemModal;
      // Disabled button already blocks taps; guard for stale submissions too.
      if (!item.isAvailable) return;
      const error = validateItemSelection(item, selected);
      if (error) {
        const errorEl = $("#option-error");
        if (errorEl) errorEl.textContent = error;
        return;
      }

      addToCart(item, selected, quantity);
      closeItemModal();
    });
  }

  function closeItemModal(silent = false) {
    if (!els.itemModal) return;
    els.itemModal.classList.remove("is-open");
    els.itemModal.setAttribute("aria-hidden", "true");
    state.itemModal = null;
    syncBodyLock();
    if (!silent) hideScrimIfUnused();
    window.setTimeout(() => {
      if (!els.itemModal.classList.contains("is-open")) els.itemModalBody.innerHTML = "";
    }, 280);
  }

  /* ------------------------------------------------------------------------
     Cart
     ------------------------------------------------------------------------ */

  function cartSubtotal() {
    return Math.round(state.cart.reduce((total, line) => total + line.unitPrice * line.quantity, 0) * 100) / 100;
  }

  function cartCount() {
    return state.cart.reduce((total, line) => total + line.quantity, 0);
  }

  function cartTotals() {
    const subtotal = cartSubtotal();
    // The admin quotes delivery per order after it is placed, so checkout
    // charges the subtotal and the fee shows as pending until then.
    return {
      subtotal,
      deliveryFee: null,
      total: subtotal
    };
  }

  function selectionKey(item, selected) {    const parts = Object.keys(selected || {}).sort().map((key) => {
      const value = selected[key];
      const normalized = Array.isArray(value) ? [...value].sort().join("+") : String(value || "");
      return `${key}=${normalized}`;
    });
    return `${item.id}|${parts.join("|")}`;
  }

  function addToCart(item, selected, quantity = 1, options = {}) {
    if (!state.storeOpen) {
      storeClosedNotice();
      return;
    }
    const pricing = calculateSelections(item, selected);
    const key = selectionKey(item, selected);
    const existing = state.cart.find((line) => line.key === key);

    if (existing) {
      existing.quantity = Math.min(20, existing.quantity + quantity);
    } else {
      state.cart.push({
        key,
        menuItemId: item.id,
        name: item.name,
        imageKey: item.imageKey,
        categoryName: item.categoryName,
        basePrice: Number(item.price) || 0,
        unitPrice: pricing.unitPrice,
        quantity: Math.max(1, Number(quantity) || 1),
        selectedOptions: selected,
        optionsText: pricing.optionsText
      });
    }

    // Immediate feedback: counter and cart update now, no fly/bounce effects.
    renderCartBadges();
    renderCart();
    queueCartItem();
    // K-Bot batches several lines at once and shows one summary toast.
    if (!options.silent) showToast("Successfully added to your cart!", "success");
  }

  let cartSaveTimer = null;
  // Last cart state the server confirmed. Used to roll back optimistic
  // updates when a save fails (e.g. offline), per the faster-cart spec.
  let lastSavedCart = null;

  function rememberSavedCart(lines) {
    lastSavedCart = JSON.parse(JSON.stringify(Array.isArray(lines) ? lines : []));
  }

  // Debounced replace-all save: the server is the source of truth for carts.
  // UI already updated optimistically by addToCart/saveCart; coalesced into
  // one PUT per burst of edits.
  function queueCartItem() {
    clearTimeout(cartSaveTimer);
    cartSaveTimer = window.setTimeout(async () => {
      try {
        const saved = await API.customerSaveCart(sanitizeCart(state.cart));
        rememberSavedCart(Array.isArray(saved) ? saved : state.cart);
      } catch (error) {
        if (error.status === 401) {
          location.replace("login.html");
          return;
        }
        // Optimistic update failed: put the cart back to the last server-synced state.
        if (lastSavedCart) {
          state.cart = JSON.parse(JSON.stringify(lastSavedCart));
          renderCartBadges();
          renderCart();
        }
        showToast("Could not save your cart right now. Your cart was restored.", "error");
      }
    }, 350);
  }

  function saveCart() {
    renderCartBadges();
    renderCart();
    queueCartItem();
  }

  function renderCartBadges() {
    const count = cartCount();
    if (els.cartBadge) {
      els.cartBadge.textContent = String(count);
      els.cartBadge.hidden = count === 0;
    }
    if (els.cartButton) {
      els.cartButton.classList.toggle("has-items", count > 0);
    }
  }

  function renderCart() {
    if (!els.cartBody || !els.cartFooter) return;

    if (!state.cart.length) {
      // My Order with an empty cart still shows the latest order's status.
      const latest = state.orders[0];
      els.cartBody.innerHTML = `
        <div class="empty-state">
          <span class="empty-illustration">${icon("bag")}</span>
          <h3>Your order is empty.</h3>
          <p>Your next favorite craving is a few taps away. Wings, kimbap, or silog?</p>
          <button type="button" class="btn btn-secondary" data-empty-browse>Browse the menu ${icon("arrow")}</button>
          ${latest ? `
            <div class="cart-latest-order">
              <span>Last order ${esc(latest.orderNumber)}</span>
              <span class="history-status status-${esc(latest.status)}">${esc(statusLabel(latest.status))}</span>
            </div>
          ` : ""}
        </div>
      `;
      els.cartFooter.innerHTML = "";
      return;
    }

    const totals = cartTotals();

    els.cartBody.innerHTML = `
      <div class="cart-list">
        ${state.cart.map((line) => `
          <article class="cart-line" data-line-key="${esc(line.key)}">
            <div class="cart-line-image">
              <img src="${esc(image(line))}" alt="${esc(line.name)}" data-fallback="${esc(imageFallback(line))}">
            </div>
            <div class="cart-line-main">
              <div class="cart-line-top">
                <h3>${esc(line.name)}</h3>
                <span class="cart-line-price">${money(line.unitPrice * line.quantity)}</span>
              </div>
              ${line.optionsText ? `<p class="cart-line-options">${esc(line.optionsText)}</p>` : ""}
              <div class="cart-line-bottom">
                <div class="qty-stepper" aria-label="Quantity for ${esc(line.name)}">
                  <button type="button" data-cart-action="dec" data-key="${esc(line.key)}" aria-label="Decrease quantity">${icon("minus")}</button>
                  <span>${line.quantity}</span>
                  <button type="button" data-cart-action="inc" data-key="${esc(line.key)}" aria-label="Increase quantity">${icon("plus")}</button>
                </div>
                <button type="button" class="cart-remove" data-cart-action="remove" data-key="${esc(line.key)}" aria-label="Remove ${esc(line.name)}">${icon("trash")}</button>
              </div>
            </div>
          </article>
        `).join("")}
      </div>
    `;

    els.cartFooter.innerHTML = `
      <div class="cart-delivery">
        <p>
          <span>Delivery fee is set per order by the admin. Free for orders of ₱400 or more.</span>
          <strong>To be confirmed</strong>
        </p>
      </div>
      <div class="cart-totals">
        <div><span>Subtotal</span><span>${money(totals.subtotal)}</span></div>
        <div>
          <span>Delivery fee</span>
          <span class="pending-fee">To be confirmed by admin</span>
        </div>
        <div class="total"><span>Total before delivery</span><strong>${money(totals.subtotal)}</strong></div>
      </div>
      <button type="button" class="btn btn-primary btn-full btn-large" id="cart-checkout">
        Checkout · ${money(totals.subtotal)} ${icon("arrow")}
      </button>
      <p class="secure-note" style="margin-top:9px">${icon("lock")} Cash on delivery · delivered around Mabalacat</p>
    `;
  }

  function updateCartLine(key, action) {
    const index = state.cart.findIndex((line) => line.key === key);
    if (index === -1) return;

    if (action === "inc") {
      state.cart[index].quantity = Math.min(20, state.cart[index].quantity + 1);
    } else if (action === "dec") {
      if (state.cart[index].quantity <= 1) state.cart.splice(index, 1);
      else state.cart[index].quantity -= 1;
    } else if (action === "remove") {
      state.cart.splice(index, 1);
    }

    saveCart();
  }

  function bindCart() {
    $("#cart-button")?.addEventListener("click", () => openCart());
    $("#cart-close")?.addEventListener("click", () => closeCart());

    els.cartBody?.addEventListener("click", (event) => {
      if (event.target.closest("[data-empty-browse]")) {
        closeCart();
        $("#korean-cravings")?.scrollIntoView({ behavior: "smooth" });
        return;
      }

      const actionButton = event.target.closest("[data-cart-action]");
      if (!actionButton) return;
      updateCartLine(actionButton.dataset.key, actionButton.dataset.cartAction);
    });

    els.cartFooter?.addEventListener("click", (event) => {
      if (event.target.closest("#cart-checkout")) openCheckout();
    });
  }

  function openCart() {
    closeMobileNav();
    closeItemModal(true);
    closeCheckout(true);
    closeProfile(true);
    renderCart();
    els.cartDrawer.classList.add("is-open");
    els.cartDrawer.setAttribute("aria-hidden", "false");
    showScrim();
    syncBodyLock();
  }

  function closeCart(silent = false) {
    if (!els.cartDrawer) return;
    els.cartDrawer.classList.remove("is-open");
    els.cartDrawer.setAttribute("aria-hidden", "true");
    syncBodyLock();
    if (!silent) hideScrimIfUnused();
    // Closing My Order returns the bottom bar to Home.
    setBottomNavActive("home");
  }

  /* ------------------------------------------------------------------------
     Checkout
     ------------------------------------------------------------------------ */

  function openCheckout() {
    closeMobileNav();
    if (!state.storeOpen) {
      storeClosedNotice();
      return;
    }
    if (!state.profile) {
      openWelcome(false);
      showToast("Tell us your name and barangay first.", "info");
      return;
    }
    if (!state.cart.length) {
      showToast("Add a craving to your order first.", "info");
      return;
    }
    // Checkout needs an identity: a customer session, or the admin's own
    // server-side storefront preview (which has no customer token).
    if (!localStorage.getItem(CFG.STORAGE.CUSTOMER_TOKEN) && state.profile?.role !== "admin") {
      showToast("Sign in as a customer to place an order.", "info");
      return;
    }

    closeItemModal(true);
    closeCart(true);
    closeProfile(true);
    state.checkoutBusy = false;
    renderCheckoutForm();
    els.checkoutModal.classList.add("is-open");
    els.checkoutModal.setAttribute("aria-hidden", "false");
    showScrim();
    syncBodyLock();
    window.setTimeout(() => $("#co-notes")?.focus(), 120);
  }

  function renderCheckoutForm() {
    const profile = state.profile || {};
    const totals = cartTotals();
    const previewItems = state.cart.slice(0, 4);
    const extraCount = state.cart.length - previewItems.length;
    const addressLine = [profile.address, profile.landmark].filter(Boolean).join(" · ");
    const isAdminPreview = profile.role === "admin";
    // Admin test orders skip the delivery-address requirement entirely.
    const missingAddress = !isAdminPreview && String(profile.address || "").trim().length < 4;

    els.checkoutBody.innerHTML = `
      <div class="checkout-grid">
        <div class="checkout-form-side">
          <p class="modal-kicker">SECURE CHECKOUT</p>
          <h2 id="checkout-title" class="checkout-title">Almost there.</h2>
          <p class="checkout-sub">${isAdminPreview ? "Test order — it lands on the kitchen board flagged as an admin test." : "We'll deliver to the details saved on your account."}</p>
          <div class="delivering-to">
            <div class="delivering-to-head">
              <span>Delivering to</span>
              <button type="button" class="profile-edit-link" id="checkout-edit-profile">Update in Profile</button>
            </div>
            <strong>${esc(profile.firstName || "")} ${esc(profile.lastName || "")}</strong>
            <p>${esc(profile.phone || "")}</p>
            <p>${addressLine ? esc(addressLine) : (isAdminPreview ? "Admin test order — no delivery address needed." : "No delivery address saved yet.")}</p>
          </div>
          <form id="checkout-form" class="checkout-fields" novalidate>
            <label class="field"><span>Notes for the kitchen <small style="color:var(--muted-soft);font-weight:600">(optional)</small></span><textarea id="co-notes" name="notes" placeholder="Extra sauce, no chili, call when outside…"></textarea></label>
            <div class="field"><span>Payment method</span>
              <div class="payment-choice is-selected">
                <span class="pay-icon">₱</span>
                <strong>Cash on Delivery</strong>
              </div>
              <p class="payment-note">Pay the rider in cash when your order arrives.</p>
            </div>
            <p class="checkout-notice" role="note">Delivery fee depends on your location and is set by the admin per order. Free delivery for orders of ₱400 or more.</p>
            ${missingAddress ? `<p class="checkout-notice" role="alert">Add your complete delivery address in your Profile before placing an order.</p>` : ""}
            <p class="form-error" id="checkout-error" role="alert"></p>
            <button type="submit" class="checkout-submit" id="place-order" ${missingAddress ? "disabled" : ""}>
              Place my order · ${money(totals.subtotal)} + delivery
            </button>
            <p class="secure-note">${icon("lock")} Your details come from your account — no retyping.</p>
          </form>
        </div>
        <aside class="checkout-aside">
          <h3>Your order</h3>
          <div class="checkout-mini-list">
            ${previewItems.map((line) => `
              <div class="checkout-mini-line">
                <span><b>${line.quantity}×</b> ${esc(line.name)}</span>
                <span>${money(line.unitPrice * line.quantity)}</span>
              </div>
            `).join("")}
            ${extraCount > 0 ? `<div class="checkout-mini-line"><span>+ ${extraCount} more ${extraCount === 1 ? "item" : "items"}</span><span></span></div>` : ""}
          </div>
          <div class="checkout-summary">
            <div><span>Subtotal</span><span>${money(totals.subtotal)}</span></div>
            <div><span>Delivery fee</span><span class="pending-fee">To be confirmed by admin</span></div>
            <div class="total"><span>Total before delivery</span><strong>${money(totals.subtotal)}</strong></div>
          </div>
          <div class="checkout-promise">
            ${icon("clock")}
            <span>Cooked fresh after you order. Estimated arrival in <strong>30–45 minutes</strong>.</span>
          </div>
        </aside>
      </div>
    `;
  }

  async function placeOrder(event) {
    event.preventDefault();
    if (state.checkoutBusy) return;

    const notes = $("#co-notes")?.value.trim() || "";
    const errorEl = $("#checkout-error");
    const button = $("#place-order");
    if (!state.storeOpen) {
      showToast("The store is currently closed. Ordering is unavailable right now.", "error");
      return;
    }

    errorEl.textContent = "";
    state.checkoutBusy = true;
    if (button) {
      button.disabled = true;
      button.textContent = "Sending to the kitchen…";
    }

    try {
      // Identity, address and the payment method all come from the server's
      // copy of the account; only the cart and the kitchen note are sent.
      const order = await API.createOrder({
        notes,
        paymentMethod: "cash",
        items: state.cart.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          selectedOptions: line.selectedOptions
        }))
      });

      const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
      state.orders.unshift({
        orderNumber: order.orderNumber,
        total: order.total,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        status: order.status,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
        itemCount,
        items: order.items.map((item) => ({ name: item.name, quantity: item.quantity }))
      });
      state.orders = state.orders.slice(0, 20);

      state.cart = [];
      renderCartBadges();
      renderCart();
      renderProfile();
      applyProfileToChrome();
      showOrderSuccess(order);
      showToast("Order placed! The kitchen is on it.", "success");
    } catch (error) {
      if (errorEl) errorEl.textContent = error.message || "We couldn't place your order. Please try again.";
      if (button) {
        button.disabled = false;
        button.textContent = `Place my order · ${money(cartTotals().subtotal)} + delivery`;
      }
    } finally {
      state.checkoutBusy = false;
    }
  }

  function showOrderSuccess(order) {
    els.checkoutBody.innerHTML = `
      <div class="order-success">
        <span class="success-mark">${icon("check")}</span>
        <h2>Order received!</h2>
        <p>Salamat, ${esc(order.firstName)}! Your food is being prepared fresh. Keep your phone nearby — the rider may call.</p>
        <div class="order-ticket">
          <div><small>Order number</small><strong>${esc(order.orderNumber)}</strong></div>
          <div><small>Estimated arrival</small><strong>30–45 min</strong></div>
          <div><small>Subtotal</small><strong>${money(order.subtotal)}</strong></div>
          <div><small>Delivery fee</small><strong>${order.deliveryFeeSet ? (Number(order.deliveryFee) === 0 ? "Free" : money(order.deliveryFee)) : "To be confirmed by admin"}</strong></div>
          ${order.deliveryFeeSet ? `<div><small>Total</small><strong>${money(order.total)}</strong></div>` : ""}
        </div>
        <p class="secure-note">Delivery fee depends on your location and is set by the admin per order. Free delivery for orders of ₱400 or more. You will see the final total in your order history.</p>
        <div class="success-actions">
          <button type="button" class="btn btn-secondary" data-success="menu">Order more ${icon("arrow")}</button>
          <button type="button" class="btn btn-ghost" data-success="profile">View my order</button>
        </div>
      </div>
    `;
    els.checkoutBody.scrollTop = 0;
  }

  function bindCheckout() {
    $("#checkout-close")?.addEventListener("click", () => closeCheckout());
    els.checkoutModal?.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-checkout]") || event.target.closest("#checkout-close")) {
        closeCheckout();
        return;
      }
      if (event.target.closest("#checkout-edit-profile")) {
        closeCheckout();
        openProfile();
        return;
      }
      const action = event.target.closest("[data-success]");
      if (action) {
        if (action.dataset.success === "profile") {
          closeCheckout();
          openProfile();
        } else {
          closeCheckout();
          scrollToMenu();
        }
      }
    });

    els.checkoutModal?.addEventListener("submit", (event) => {
      if (event.target.id === "checkout-form") placeOrder(event);
    });
  }

  function closeCheckout(silent = false) {
    if (!els.checkoutModal) return;
    els.checkoutModal.classList.remove("is-open");
    els.checkoutModal.setAttribute("aria-hidden", "true");
    state.checkoutBusy = false;
    syncBodyLock();
    if (!silent) hideScrimIfUnused();
    window.setTimeout(() => {
      if (!els.checkoutModal.classList.contains("is-open")) els.checkoutBody.innerHTML = "";
    }, 300);
  }

  /* ------------------------------------------------------------------------
     Profile drawer
     ------------------------------------------------------------------------ */

  function formatOrderDate(value) {
    const date = new Date(String(value || "").replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return "Just now";
    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function statusLabel(status) {
    const labels = {
      pending: "Pending",
      confirmed: "Confirmed",
      preparing: "Preparing",
      delivering: "On the way",
      delivered: "Delivered",
      cancelled: "Cancelled",
      // Legacy rows only: kept for correct history labels.
      completed: "Completed"
    };
    return labels[status] || "Pending";
  }

  function renderProfile() {
    if (!els.profileBody) return;

    if (!state.profile) {
      els.profileBody.innerHTML = `
        <div class="empty-state">
          <span class="empty-illustration">${icon("user")}</span>
          <h3>No details yet.</h3>
          <p>Add your name and delivery barangay so we know where to send the good stuff.</p>
          <button type="button" class="btn btn-secondary" data-profile-action="start">Set my details ${icon("arrow")}</button>
        </div>
      `;
      return;
    }

    const profile = state.profile;
    const addressLine = [profile.address, profile.landmark].filter(Boolean).join(" · ");

    els.profileBody.innerHTML = `
      <div class="profile-hero">
        <span class="profile-avatar">${esc(initials(profile))}</span>
        <div>
          <strong>${esc(profile.firstName)} ${esc(profile.lastName)}</strong>
          <small>${icon("pin")} ${esc(profile.barangay || "Mabalacat City, Pampanga")}${profile.phone && profile.role !== "admin" ? ` · ${esc(profile.phone)}` : ""}</small>
          ${profile.role === "admin" ? `<small class="profile-admin-note">${icon("lock")} Admin preview · orders placed here are marked as test</small>` : ""}
        </div>
      </div>

      <section class="profile-section">
        <div class="profile-section-head">
          <h3>Delivery details</h3>
          <button type="button" class="profile-edit-link" data-profile-action="edit">Edit</button>
        </div>
        <div class="profile-detail-card">
          ${profile.role === "admin" ? `
            <div class="profile-detail-row"><span>Mode</span><strong>Storefront preview — test orders</strong></div>
            <div class="profile-detail-row"><span>Address</span><strong>${addressLine ? esc(addressLine) : "Not needed for test orders"}</strong></div>
          ` : `
            <div class="profile-detail-row"><span>Location</span><strong>${esc(profile.barangay || "Mabalacat City, Pampanga")}</strong></div>
            <div class="profile-detail-row"><span>Address</span><strong>${addressLine ? esc(addressLine) : "Add this at checkout"}</strong></div>
            <div class="profile-detail-row"><span>Mobile</span><strong>${profile.phone ? esc(profile.phone) : "Add this at checkout"}</strong></div>
          `}
        </div>
      </section>

      <section class="profile-section" id="profile-orders">
        <div class="profile-section-head">
          <h3>Your recent orders</h3>
          <span style="color:var(--muted-soft);font-size:8px;font-weight:700">${state.orders.length} saved</span>
        </div>
        ${state.orders.length ? `
          <div class="order-history">
            ${state.orders.slice(0, 6).map((order) => `
              <article class="history-card">
                <div class="history-top">
                  <strong>${esc(order.orderNumber)}</strong>
                  <span class="history-status status-${esc(order.status)}">${esc(statusLabel(order.status))}</span>
                </div>
                <p>${esc(formatOrderDate(order.createdAt))} · ${order.itemCount || 0} ${order.itemCount === 1 ? "item" : "items"} · Subtotal <strong>${money(order.subtotal)}</strong></p>
                <p class="history-fee">${order.deliveryFeeSet
                  ? `Delivery ${money(order.deliveryFee)} · Total <strong>${money(order.total)}</strong>`
                  : `Delivery fee to be confirmed by admin · Total before delivery <strong>${money(order.subtotal)}</strong>`}</p>
              </article>
            `).join("")}
          </div>
        ` : `
          <div class="profile-empty">No orders yet. Your first craving is waiting in the menu.</div>
        `}
      </section>

      <div class="profile-actions">
        <button type="button" class="btn btn-primary" data-profile-action="order">Start a new order ${icon("arrow")}</button>
        <button type="button" class="btn btn-ghost" data-profile-action="edit">Update my details</button>
        <button type="button" class="btn btn-ghost profile-signout" data-profile-action="signout">Sign out</button>
      </div>
    `;
  }

  function bindProfile() {
    $("#profile-button")?.addEventListener("click", openProfile);
    $("#footer-profile")?.addEventListener("click", openProfile);
    $("#profile-close")?.addEventListener("click", () => closeProfile());

    els.profileBody?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-profile-action]");
      if (!action) return;
      const type = action.dataset.profileAction;
      if (type === "edit") {
        closeProfile();
        openWelcome(true);
      } else if (type === "start") {
        closeProfile();
        openWelcome(false);
      } else if (type === "order") {
        closeProfile();
        scrollToMenu();
      } else if (type === "signout") {
        // An admin's preview identity lives in the server cookie, so signing
        // out here must end the admin session too — await it, or the redirect
        // cancels the request and the admin stays signed in.
        if (state.profile?.role === "admin") {
          try { await API.adminLogout(); } catch { /* cookie may already be gone */ }
        }
        localStorage.removeItem(CFG.STORAGE.PROFILE);
        localStorage.removeItem(CFG.STORAGE.CUSTOMER_TOKEN);
        state.profile = null;
        state.cart = [];
        state.orders = [];
        renderCartBadges(false);
        renderCart();
        closeProfile(true);
        location.href = "login.html";
      }
    });
  }

  function openProfile() {
    closeMobileNav();
    closeItemModal(true);
    closeCart(true);
    closeCheckout(true);
    renderProfile();
    els.profileDrawer.classList.add("is-open");
    els.profileDrawer.setAttribute("aria-hidden", "false");
    showScrim();
    setBottomNavActive("profile");
    syncBodyLock();
    refreshProfileOrders();
  }

  function closeProfile(silent = false) {
    if (!els.profileDrawer) return;
    els.profileDrawer.classList.remove("is-open");
    els.profileDrawer.setAttribute("aria-hidden", "true");
    syncBodyLock();
    if (!silent) hideScrimIfUnused();
    // The drawer closing returns the bottom bar to Home.
    setBottomNavActive("home");
  }

  async function refreshProfileOrders() {
    if (state.profileRefreshing || !state.profile) return;
    if (!localStorage.getItem(CFG.STORAGE.CUSTOMER_TOKEN)) return;
    state.profileRefreshing = true;
    try {
      const fresh = sanitizeOrders(await API.customerOrders());
      state.orders = fresh;
      if (els.profileDrawer?.classList.contains("is-open")) renderProfile();
    } catch {
      /* History refresh is a bonus; the saved list remains visible. */
    } finally {
      state.profileRefreshing = false;
    }
  }

  /* ------------------------------------------------------------------------
     Mobile bottom navigation (phones): Home / Search / My Order / Profile.
     Single bar — on phones it replaces the hamburger drawer entirely.
     ------------------------------------------------------------------------ */

  function setBottomNavActive(name) {
    document.querySelectorAll("#bottom-nav [data-bnav]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.bnav === name);
    });
  }

  function bindBottomNav() {
    $("#bottom-nav")?.addEventListener("click", (event) => {
      const target = event.target.closest("[data-bnav]");
      if (!target) return;
      const action = target.dataset.bnav;

      if (action === "home") {
        closeItemModal(true);
        closeCart(true);
        closeProfile(true);
        closeCheckout(true);
        $("#home")?.scrollIntoView({ behavior: "smooth" });
      } else if (action === "search") {
        closeItemModal(true);
        closeCart(true);
        closeProfile(true);
        scrollToMenu();
        els.searchInput?.focus({ preventScroll: true });
      } else if (action === "orders") {
        // My Order: the customer's current cart plus checkout, the same drawer
        // the header cart button opens (its empty state shows the latest
        // order's status).
        closeItemModal(true);
        closeProfile(true);
        closeCheckout(true);
        openCart();
      } else if (action === "profile") {
        openProfile();
        els.profileBody?.scrollTo({ top: 0, behavior: "smooth" });
      }

      setBottomNavActive(action);
    });
  }

  /* ------------------------------------------------------------------------
     Overlay helpers
     ------------------------------------------------------------------------ */

  function isAnyOverlayOpen() {
    return Boolean(
      els.itemModal?.classList.contains("is-open") ||
      els.cartDrawer?.classList.contains("is-open") ||
      els.profileDrawer?.classList.contains("is-open") ||
      els.checkoutModal?.classList.contains("is-open")
    );
  }

  function syncBodyLock() {
    document.body.classList.toggle("no-scroll", isAnyOverlayOpen());
  }

  function showScrim() {
    if (!els.scrim) return;
    els.scrim.hidden = false;
    window.requestAnimationFrame(() => els.scrim.classList.add("is-visible"));
  }

  function hideScrimIfUnused() {
    if (!els.scrim || isAnyOverlayOpen()) return;
    els.scrim.classList.remove("is-visible");
    window.setTimeout(() => {
      if (!isAnyOverlayOpen()) els.scrim.hidden = true;
    }, 250);
  }

  function closeAllOverlays(options = {}) {
    closeItemModal(true);
    closeCart(true);
    closeProfile(true);
    closeCheckout(true);
    if (!options.keepScrim) hideScrimIfUnused();
  }

  function bindOverlays() {
    els.scrim?.addEventListener("click", () => {
      if (els.cartDrawer?.classList.contains("is-open")) closeCart();
      if (els.profileDrawer?.classList.contains("is-open")) closeProfile();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (els.itemModal?.classList.contains("is-open")) {
        closeItemModal();
      } else if (els.checkoutModal?.classList.contains("is-open")) {
        closeCheckout();
      } else if (els.cartDrawer?.classList.contains("is-open")) {
        closeCart();
      } else if (els.profileDrawer?.classList.contains("is-open")) {
        closeProfile();
      }
    });
  }

  /* ------------------------------------------------------------------------
     Navigation: the top bar carries brand, menu pills, search, cart, and
     profile; phones also get the bottom bar. The old hamburger duplicated the
     pills and is gone.
     ------------------------------------------------------------------------ */

  function closeMobileNav() {
    /* No-op: the hamburger was merged into the top bar. Kept because several
       overlay-open helpers call it. */
  }

  function bindGlobalEvents() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-item]");
      if (trigger) {
        event.preventDefault();
        openItem(trigger.dataset.openItem);
      }
    });

    // Any image that fails to load falls back to a relevant local food photo.
    document.addEventListener("error", (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (img.dataset.fallbackApplied === "1") {
        img.classList.add("is-broken");
        return;
      }
      img.dataset.fallbackApplied = "1";
      const fallback = img.dataset.fallback || window.MK_FALLBACK_IMAGE || "assets/images/wings.jpg";
      if (img.getAttribute("src") !== fallback) img.src = fallback;
    }, true);

    els.backToTop?.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Dynamic chrome: shadow + reading progress + back-to-top.
    const header = $(".site-header");
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const scrolled = window.scrollY > 10;
        header?.classList.toggle("is-scrolled", scrolled);
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        if (els.scrollProgress) els.scrollProgress.style.transform = `scaleX(${ratio})`;
        if (els.backToTop) els.backToTop.hidden = window.scrollY < 700;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // Reveal headings and service steps as they enter the viewport.
    if ("IntersectionObserver" in window) {
      const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: .08 });
      $$(".section-heading, .service-intro, .service-list article, .footer-brand, .footer-links")
        .forEach((element) => {
          element.classList.add("reveal");
          revealObserver.observe(element);
        });
    }

    // Cart and order history are server-owned per account now, so there is no
    // cross-tab localStorage mirroring to keep in step.
  }

  /* ------------------------------------------------------------------------
     Toasts
     ------------------------------------------------------------------------ */

  function showToast(message, type = "success") {
    if (!els.toastStack) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const iconName = type === "error" ? "close" : type === "info" ? "spark" : "check";
    toast.innerHTML = `<span class="toast-icon">${icon(iconName)}</span><span>${esc(message)}</span>`;
    els.toastStack.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 260);
    }, 3200);
  }

  /* ------------------------------------------------------------------------
     Public API (used by the voice guide)
     ------------------------------------------------------------------------ */

  window.MK = {
    state,
    openItem,
    addToCart,
    openCart,
    closeCart,
    openCheckout,
    openProfile,
    openWelcome,
    showToast,
    setFilter,
    setQuery,
    renderMenu,
    money,
    searchItems(query, limit = 4) {
      if (!String(query || "").trim()) return [];
      return A.searchMenu(state.items, query).slice(0, limit);
    },
    // K-Bot voice ordering hooks. It quotes a line with the SAME pricing the
    // cart uses, then commits confirmed lines through addToCart — so voice
    // orders behave exactly like manual ones.
    quoteLine(item, selected) {
      const pricing = calculateSelections(item, selected);
      return { unitPrice: pricing.unitPrice, optionsText: pricing.optionsText, key: selectionKey(item, selected) };
    },
    commitVoiceLines(lines) {
      (Array.isArray(lines) ? lines : []).forEach((line) => {
        addToCart(line.item, line.selected, line.quantity, { silent: true });
      });
      if (lines.length) showToast("Voice order added to My Order.", "success");
    },
    voiceRemoveLine(key) {
      const index = state.cart.findIndex((line) => line.key === key);
      if (index < 0) return false;
      state.cart.splice(index, 1);
      renderCartBadges();
      renderCart();
      queueCartItem();
      return true;
    },
    voiceSetQty(key, qty) {
      const line = state.cart.find((entry) => entry.key === key);
      if (!line) return false;
      line.quantity = Math.max(1, Math.min(20, Math.floor(Number(qty) || 1)));
      renderCartBadges();
      renderCart();
      queueCartItem();
      return true;
    },
    cartTotals,
    cartCount
  };
})();

