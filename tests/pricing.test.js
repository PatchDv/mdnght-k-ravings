import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { calculateItemPricing } from "../backend/utils/pricing.js";

const exactTray = (selectedCount) => ({
  price: 449,
  option_groups: JSON.stringify([
    {
      key: "flavors",
      label: "Choose exactly 2 flavors",
      type: "flavors",
      required: true,
      exact: true,
      max: 2,
      included: 2,
      extraPrice: 0,
      choices: ["Buffalo", "Soy Garlic", "Cheese", "Garlic Parmesan"]
    }
  ]),
  selected: { flavors: ["Buffalo", "Soy Garlic", "Cheese", "Garlic Parmesan"].slice(0, selectedCount) }
});

const extraFlavor = (selectedCount) => ({
  price: 169,
  option_groups: JSON.stringify([
    {
      key: "flavors",
      label: "Choose your flavor(s)",
      type: "flavors",
      required: true,
      max: 4,
      included: 1,
      extraPrice: 10,
      choices: ["Buffalo", "Soy Garlic", "Cheese", "Garlic Parmesan"]
    }
  ]),
  selected: { flavors: ["Buffalo", "Soy Garlic", "Cheese", "Garlic Parmesan"].slice(0, selectedCount) }
});

const silog = (addons) => ({
  price: 129,
  option_groups: JSON.stringify([
    { key: "sauce", label: "Choose your sauce", type: "radio", required: true, choices: ["Buffalo", "Toyomansi", "Cheese", "Teriyaki"] },
    { key: "addons", label: "Make it extra", type: "checkbox", required: false, choices: [
      { name: "Extra rice", price: 15 },
      { name: "Chili garlic", price: 15 }
    ] }
  ]),
  selected: { sauce: "Toyomansi", addons }
});

describe("pricing", () => {
  it("accepts exactly two exact tray flavors at base price", () => {
    const { price, option_groups, selected } = exactTray(2);
    const result = calculateItemPricing({ price, option_groups }, selected);
    assert.equal(result.unitPrice, 449);
  });

  it("uses extra flavor pricing for flexible flavors", () => {
    const { price, option_groups, selected } = extraFlavor(3);
    assert.equal(calculateItemPricing({ price, option_groups }, selected).unitPrice, 189);
  });

  it("supports silog add-ons in any combination", () => {
    for (const addons of [[], ["Extra rice"], ["Extra rice", "Chili garlic"]]) {
      const { price, option_groups, selected } = silog(addons);
      const result = calculateItemPricing({ price, option_groups }, selected);
      assert.equal(result.unitPrice, 129 + addons.length * 15);
    }
  });

  it("rejects unsupported exact tray flavor counts", () => {
    for (const size of [0, 1, 3, 4]) {
      const { price, option_groups, selected } = exactTray(size);
      assert.throws(() => calculateItemPricing({ price, option_groups }, selected), /exactly 2/i);
    }
  });

  it("rejects too many flexible flavors", () => {
    const { price } = extraFlavor(4);
    const option_groups = JSON.stringify([
      {
        key: "flavors",
        label: "Choose up to 3",
        type: "flavors",
        required: true,
        max: 3,
        included: 1,
        extraPrice: 10,
        choices: ["Buffalo", "Soy Garlic", "Cheese", "Garlic Parmesan"]
      }
    ]);
    const selected = { flavors: ["Buffalo", "Soy Garlic", "Cheese", "Garlic Parmesan"] };
    assert.throws(() => calculateItemPricing({ price, option_groups }, selected), /up to 3/i);
  });

  it("rejects missing required radio option", () => {
    const { price, option_groups, selected } = silog(["Extra rice"]);
    assert.throws(
      () => calculateItemPricing({ price, option_groups }, { addons: selected.addons }),
      /choose/i
    );
  });
});

import { isValidMenuPrice } from "../backend/utils/pricing.js";

describe("menu price validation (launch: positive, sensible limits)", () => {
  it("accepts normal prices", () => {
    assert.equal(isValidMenuPrice(119), true);
    assert.equal(isValidMenuPrice(0.5), true);
    assert.equal(isValidMenuPrice(99999), true);
  });
  it("rejects zero, negatives, non-numbers and absurd amounts", () => {
    assert.equal(isValidMenuPrice(0), false);
    assert.equal(isValidMenuPrice(-1), false);
    assert.equal(isValidMenuPrice(Number.NaN), false);
    assert.equal(isValidMenuPrice("12"), false);
    assert.equal(isValidMenuPrice(100001), false);
  });
});
