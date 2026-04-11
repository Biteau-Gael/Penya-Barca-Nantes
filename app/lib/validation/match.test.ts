import { describe, it, expect } from "vitest";
import { createMatchSchema, updateMatchSchema } from "./match";

const futureDate = new Date(Date.now() + 86400000).toISOString();
const pastDate = new Date(Date.now() - 86400000).toISOString();

describe("createMatchSchema", () => {
  it("should accept valid match data", () => {
    const result = createMatchSchema.safeParse({
      opponent: "Real Madrid",
      competition: "Liga",
      matchDate: futureDate,
      venue: "home",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty opponent", () => {
    const result = createMatchSchema.safeParse({
      opponent: "",
      competition: "Liga",
      matchDate: futureDate,
      venue: "home",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid competition", () => {
    const result = createMatchSchema.safeParse({
      opponent: "Real Madrid",
      competition: "Ligue 1",
      matchDate: futureDate,
      venue: "home",
    });
    expect(result.success).toBe(false);
  });

  it("should reject past date", () => {
    const result = createMatchSchema.safeParse({
      opponent: "Real Madrid",
      competition: "Liga",
      matchDate: pastDate,
      venue: "home",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid venue", () => {
    const result = createMatchSchema.safeParse({
      opponent: "Real Madrid",
      competition: "Liga",
      matchDate: futureDate,
      venue: "neutral",
    });
    expect(result.success).toBe(false);
  });

  it("should accept all valid competitions", () => {
    for (const comp of ["Liga", "Champions League", "Copa del Rey", "Supercoupe", "Amical"]) {
      const result = createMatchSchema.safeParse({
        opponent: "Test",
        competition: comp,
        matchDate: futureDate,
        venue: "away",
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("updateMatchSchema", () => {
  it("should accept valid update data with id", () => {
    const result = updateMatchSchema.safeParse({
      id: "some-uuid",
      opponent: "Atlético Madrid",
      competition: "Champions League",
      matchDate: futureDate,
      venue: "away",
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing id", () => {
    const result = updateMatchSchema.safeParse({
      opponent: "Atlético Madrid",
      competition: "Champions League",
      matchDate: futureDate,
      venue: "away",
    });
    expect(result.success).toBe(false);
  });
});
