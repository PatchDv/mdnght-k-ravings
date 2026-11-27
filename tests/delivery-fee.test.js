import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { resolveDeliveryFee } from "../backend/utils/pricing.js";

describe("delivery fee", () => {
  it("offers only 10, 15, 20 under the free threshold", () => {
    for (const fee of [10, 15, 20]) {
      const result = resolveDeliveryFee(399, fee);
      assert.equal(result.ok, true);
      assert.equal(result.fee, fee);
      assert.equal(result.free, false);
    }
  });

  it("rejects any other amount under the threshold", () => {
    for (const bad of [0, 5, 12, 20.5, 21, "18", 100, 10000, -10, Number.NaN]) {
      assert.equal(resolveDeliveryFee(250, bad).ok, false, `fee ${bad} must be rejected`);
    }
  });

  it("is free at 400 and above regardless of the requested fee", () => {
    for (const subtotal of [400, 400.5, 1200]) {
      for (const requested of [0, 10, 15, 20, 999]) {
        const result = resolveDeliveryFee(subtotal, requested);
        assert.equal(result.ok, true);
        assert.equal(result.fee, 0);
        assert.equal(result.free, true);
      }
    }
  });

  it("rejects a nonsense subtotal", () => {
    assert.equal(resolveDeliveryFee(-1, 10).ok, false);
    assert.equal(resolveDeliveryFee("abc", 10).ok, false);
  });
});
