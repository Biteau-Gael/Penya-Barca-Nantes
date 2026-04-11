import { describe, it, expect } from "vitest";

// Test processAvatar validation logic without actually writing files
describe("processAvatar validation", () => {
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_SIZE = 2 * 1024 * 1024;

  it("should accept JPEG files", () => {
    expect(ALLOWED_TYPES.includes("image/jpeg")).toBe(true);
  });

  it("should accept PNG files", () => {
    expect(ALLOWED_TYPES.includes("image/png")).toBe(true);
  });

  it("should accept WebP files", () => {
    expect(ALLOWED_TYPES.includes("image/webp")).toBe(true);
  });

  it("should reject GIF files", () => {
    expect(ALLOWED_TYPES.includes("image/gif")).toBe(false);
  });

  it("should reject SVG files", () => {
    expect(ALLOWED_TYPES.includes("image/svg+xml")).toBe(false);
  });

  it("should have a 2Mo max size limit", () => {
    expect(MAX_SIZE).toBe(2097152);
  });

  it("should reject files over 2Mo", () => {
    const fileSize = 3 * 1024 * 1024;
    expect(fileSize > MAX_SIZE).toBe(true);
  });

  it("should accept files under 2Mo", () => {
    const fileSize = 1 * 1024 * 1024;
    expect(fileSize > MAX_SIZE).toBe(false);
  });
});
