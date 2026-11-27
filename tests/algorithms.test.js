globalThis.window = {};

const menu = [
  { id: 3, name: "Spicy Tteokbokki Rice Cake", categoryName: "Your Korean Cravings Provider" },
  { id: 1, name: "Cheese Kimbap 10pcs", categoryName: "Your Korean Cravings Provider" },
  { id: 2, name: "Cheesy Fries", categoryName: "Your Korean Cravings Provider" }
];

const { describe, it } = await import("node:test");
const assert = await import("node:assert/strict");

await import("../frontend/js/algorithms.js");
const algorithms = globalThis.window.MKAlgorithms;

describe("menu algorithms", () => {
  it("sorts dishes by normalized name using merge sort", () => {
    const names = algorithms.sortMenu(menu, "name-asc").map((item) => item.name);
    assert.deepEqual(names, ["Cheese Kimbap 10pcs", "Cheesy Fries", "Spicy Tteokbokki Rice Cake"]);
  });

  it("binary-searches an exact product name", () => {
    const result = algorithms.searchExact(menu, "Cheese Kimbap 10pcs");
    assert.equal(Array.isArray(result), true);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 1);
  });

  it("linear-searches a partial product name", () => {
    const result = algorithms.searchPartial(menu, "kimbap");
    assert.deepEqual(result.map((item) => item.id), [1]);
  });
});
