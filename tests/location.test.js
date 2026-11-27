import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isValidLocation, BARANGAYS, DEFAULT_BARANGAY } from "../backend/config/location.js";

const ok = (overrides = {}) => ({
  country: "Philippines",
  province: "Pampanga",
  city: "Mabalacat",
  barangay: "Madapdap",
  ...overrides
});

describe("location", () => {
  it("accepts every supported barangay", () => {
    for (const barangay of BARANGAYS) {
      assert.equal(isValidLocation(ok({ barangay })), true, barangay);
    }
  });

  it("defaults to Madapdap", () => {
    assert.equal(DEFAULT_BARANGAY, "Madapdap");
    assert.equal(isValidLocation(ok()), true);
  });

  it("accepts case and spacing variants", () => {
    assert.equal(isValidLocation(ok({ city: "mabalacat city", barangay: "  DAU " })), true);
    assert.equal(isValidLocation(ok({ barangay: "Dapdap (Madapdap Resettlement)" })), true);
  });

  it("rejects outside city, province, country", () => {
    assert.equal(isValidLocation(ok({ city: "Angeles" })), false);
    assert.equal(isValidLocation(ok({ province: "Tarlac" })), false);
    assert.equal(isValidLocation(ok({ country: "Canada" })), false);
  });

  it("rejects unsupported barangay and incomplete data", () => {
    assert.equal(isValidLocation(ok({ barangay: "Claire" })), false);
    assert.equal(isValidLocation({ city: "Mabalacat" }), false);
    assert.equal(isValidLocation(null), false);
  });
});
