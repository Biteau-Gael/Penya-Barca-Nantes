import { describe, it, expect } from "vitest";
import { registerSchema, loginSchema, updateProfileSchema } from "./user";

const validData = {
  email: "karim@example.com",
  pseudo: "Karim_FCB",
  password: "SecurePass1",
  confirmPassword: "SecurePass1",
  gdprConsent: true as const,
};

describe("registerSchema", () => {
  it("should accept valid registration data", () => {
    const result = registerSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should reject invalid email", () => {
    const result = registerSchema.safeParse({ ...validData, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("should reject pseudo shorter than 3 chars", () => {
    const result = registerSchema.safeParse({ ...validData, pseudo: "ab" });
    expect(result.success).toBe(false);
  });

  it("should reject pseudo longer than 30 chars", () => {
    const result = registerSchema.safeParse({ ...validData, pseudo: "a".repeat(31) });
    expect(result.success).toBe(false);
  });

  it("should reject pseudo with special characters", () => {
    const result = registerSchema.safeParse({ ...validData, pseudo: "user@name!" });
    expect(result.success).toBe(false);
  });

  it("should accept pseudo with underscores and dashes", () => {
    const result = registerSchema.safeParse({ ...validData, pseudo: "user_name-123" });
    expect(result.success).toBe(true);
  });

  it("should reject password shorter than 8 chars", () => {
    const result = registerSchema.safeParse({
      ...validData,
      password: "Short1",
      confirmPassword: "Short1",
    });
    expect(result.success).toBe(false);
  });

  it("should reject password without uppercase", () => {
    const result = registerSchema.safeParse({
      ...validData,
      password: "nouppercase1",
      confirmPassword: "nouppercase1",
    });
    expect(result.success).toBe(false);
  });

  it("should reject password without digit", () => {
    const result = registerSchema.safeParse({
      ...validData,
      password: "NoDigitHere",
      confirmPassword: "NoDigitHere",
    });
    expect(result.success).toBe(false);
  });

  it("should reject mismatched passwords", () => {
    const result = registerSchema.safeParse({
      ...validData,
      confirmPassword: "DifferentPass1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("confirmPassword");
    }
  });

  it("should reject when GDPR consent is false", () => {
    const result = registerSchema.safeParse({ ...validData, gdprConsent: false });
    expect(result.success).toBe(false);
  });

  it("should reject when GDPR consent is missing", () => {
    const { gdprConsent, ...noConsent } = validData;
    const result = registerSchema.safeParse(noConsent);
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("should accept valid login data", () => {
    const result = loginSchema.safeParse({ email: "karim@example.com", password: "MyPass123" });
    expect(result.success).toBe(true);
  });

  it("should reject invalid email", () => {
    const result = loginSchema.safeParse({ email: "not-email", password: "MyPass123" });
    expect(result.success).toBe(false);
  });

  it("should reject empty password", () => {
    const result = loginSchema.safeParse({ email: "karim@example.com", password: "" });
    expect(result.success).toBe(false);
  });

  it("should reject missing email", () => {
    const result = loginSchema.safeParse({ password: "MyPass123" });
    expect(result.success).toBe(false);
  });
});

describe("updateProfileSchema", () => {
  it("should accept a valid pseudo", () => {
    const result = updateProfileSchema.safeParse({ pseudo: "Karim_FCB" });
    expect(result.success).toBe(true);
  });

  it("should reject pseudo shorter than 3 chars", () => {
    const result = updateProfileSchema.safeParse({ pseudo: "ab" });
    expect(result.success).toBe(false);
  });

  it("should reject pseudo with special characters", () => {
    const result = updateProfileSchema.safeParse({ pseudo: "user@name!" });
    expect(result.success).toBe(false);
  });

  it("should accept pseudo with dashes and underscores", () => {
    const result = updateProfileSchema.safeParse({ pseudo: "mon-pseudo_123" });
    expect(result.success).toBe(true);
  });
});
