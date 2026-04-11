import { describe, it, expect } from "vitest";
import { predictionSchema } from "./prediction";

describe("predictionSchema", () => {
  it("should accept valid prediction", () => {
    const result = predictionSchema.safeParse({ matchId: "abc", homeScore: "2", awayScore: "1" });
    expect(result.success).toBe(true);
  });

  it("should accept score of 0", () => {
    const result = predictionSchema.safeParse({ matchId: "abc", homeScore: "0", awayScore: "0" });
    expect(result.success).toBe(true);
  });

  it("should reject negative scores", () => {
    const result = predictionSchema.safeParse({ matchId: "abc", homeScore: "-1", awayScore: "0" });
    expect(result.success).toBe(false);
  });

  it("should reject scores over 99", () => {
    const result = predictionSchema.safeParse({ matchId: "abc", homeScore: "100", awayScore: "0" });
    expect(result.success).toBe(false);
  });

  it("should reject missing matchId", () => {
    const result = predictionSchema.safeParse({ matchId: "", homeScore: "1", awayScore: "0" });
    expect(result.success).toBe(false);
  });

  it("should coerce string scores to numbers", () => {
    const result = predictionSchema.safeParse({ matchId: "abc", homeScore: "3", awayScore: "2" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.homeScore).toBe(3);
      expect(result.data.awayScore).toBe(2);
    }
  });
});
