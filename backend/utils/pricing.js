const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function choiceName(choice) {
  return typeof choice === "string" ? choice : String(choice?.name ?? "");
}

function choicePrice(choice) {
  return typeof choice === "object" && choice !== null ? Number(choice.price) || 0 : 0;
}

/**
 * Validates a customer's selections and recalculates the price from trusted
 * menu data. The browser never gets to decide how much an item costs.
 */
export function calculateItemPricing(item, selectedOptions = {}) {
  const groups = parseJson(item.option_groups, []);
  const options = selectedOptions && typeof selectedOptions === "object" ? selectedOptions : {};
  const cleanSelections = {};
  const summary = [];
  let optionTotal = 0;

  for (const group of groups) {
    if (!group || !group.key) continue;
    const type = group.type || "radio";
    const raw = options[group.key];

    if (type === "flavors") {
      const choices = Array.isArray(group.choices) ? group.choices.map(choiceName) : [];
      const selected = Array.isArray(raw) ? [...new Set(raw.filter((entry) => choices.includes(entry)))] : [];
      const maximum = Number(group.max) || 1;

      if (group.exact && selected.length !== maximum) {
        throw new Error(`Please choose exactly ${maximum} flavors for this item.`);
      }
      if (selected.length > maximum) {
        throw new Error(`You can choose up to ${maximum} flavors for this item.`);
      }
      if (group.required && selected.length === 0) {
        throw new Error(`Please choose ${String(group.label || "a flavor").toLowerCase()}.`);
      }

      const included = Math.max(0, Number(group.included) || 0);
      const extraPrice = Math.max(0, Number(group.extraPrice) || 0);
      const extraFlavors = Math.max(0, selected.length - included);
      optionTotal += extraFlavors * extraPrice;

      if (selected.length) {
        cleanSelections[group.key] = selected;
        summary.push(`${selected.length > 1 ? "Flavors" : "Flavor"}: ${selected.join(" + ")}`);
      }
      continue;
    }

    if (type === "checkbox") {
      const choices = Array.isArray(group.choices) ? group.choices : [];
      const allowed = choices.map(choiceName);
      const selected = Array.isArray(raw) ? [...new Set(raw.filter((entry) => allowed.includes(entry)))] : [];

      if (group.max && selected.length > Number(group.max)) {
        throw new Error(`You can choose up to ${group.max} add-ons.`);
      }

      if (selected.length) {
        cleanSelections[group.key] = selected;
        const labels = [];
        for (const entry of selected) {
          const choice = choices.find((candidate) => choiceName(candidate) === entry);
          optionTotal += choicePrice(choice);
          labels.push(entry);
        }
        summary.push(`Extras: ${labels.join(", ")}`);
      }
      continue;
    }

    const choices = Array.isArray(group.choices) ? group.choices : [];
    const allowed = choices.map(choiceName);
    const selected = typeof raw === "string" && allowed.includes(raw) ? raw : "";

    if (group.required && !selected) {
      throw new Error(`Please choose ${String(group.label || "an option").toLowerCase()}.`);
    }

    if (selected) {
      const choice = choices.find((candidate) => choiceName(candidate) === selected);
      optionTotal += choicePrice(choice);
      cleanSelections[group.key] = selected;
      summary.push(`${group.label || "Choice"}: ${selected}`);
    }
  }

  return {
    unitPrice: roundMoney(Number(item.price) + optionTotal),
    options: cleanSelections,
    optionsText: summary.join(" • "),
    optionTotal: roundMoney(optionTotal)
  };
}

export function readableOrderItems(items) {
  return items.map((item) => ({
    ...item,
    lineTotal: roundMoney(item.lineTotal)
  }));
}

// Delivery pricing: fixed options for orders under ₱400; ₱400+ is always free.
// Used by the admin fee endpoint and new-order creation so the browser cannot
// pick an amount the kitchen did not offer.
export const DELIVERY_FEE_OPTIONS = [10, 15, 20];
export const FREE_DELIVERY_THRESHOLD = 400;

// Menu Studio price bounds: a dish must cost real money and a typo must not
// list a tray at a million pesos. Used by the create and update endpoints.
export function isValidMenuPrice(value) {
  return Number.isFinite(value) && value > 0 && value <= 100000;
}

export function resolveDeliveryFee(subtotal, requested) {
  const amount = Number(subtotal);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "This order has an invalid subtotal." };
  }
  if (amount >= FREE_DELIVERY_THRESHOLD) {
    return { ok: true, fee: 0, free: true };
  }
  const fee = Number(requested);
  if (!DELIVERY_FEE_OPTIONS.includes(fee)) {
    return { ok: false, error: "Delivery fee must be ₱10, ₱15, or ₱20." };
  }
  return { ok: true, fee, free: false };
}
