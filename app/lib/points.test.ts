import { describe, it, expect } from "vitest";
import { calculatePoints } from "./points";

describe("calculatePoints", () => {
  it("should give max points for exact score (standard)", () => {
    expect(calculatePoints(2, 1, 2, 1, "standard")).toBe(3);
  });

  it("should give 1 point for correct result (standard)", () => {
    expect(calculatePoints(3, 0, 2, 1, "standard")).toBe(1); // home win
  });

  it("should give 0 for wrong result (standard)", () => {
    expect(calculatePoints(2, 0, 0, 1, "standard")).toBe(0);
  });

  it("should handle draw correctly", () => {
    expect(calculatePoints(1, 1, 0, 0, "standard")).toBe(1); // both draws
    expect(calculatePoints(2, 2, 2, 2, "standard")).toBe(3); // exact draw
  });

  it("should use strict scheme", () => {
    expect(calculatePoints(2, 1, 2, 1, "strict")).toBe(5);
    expect(calculatePoints(3, 0, 2, 1, "strict")).toBe(1);
  });

  it("should use souple scheme", () => {
    expect(calculatePoints(2, 1, 2, 1, "souple")).toBe(3);
    expect(calculatePoints(3, 0, 2, 1, "souple")).toBe(2);
    expect(calculatePoints(0, 1, 2, 0, "souple")).toBe(1);
  });

  it("should fallback to standard for unknown scheme", () => {
    expect(calculatePoints(2, 1, 2, 1, "unknown")).toBe(3);
  });
});
