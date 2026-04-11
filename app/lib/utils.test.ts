import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("should merge class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("should handle conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("should merge tailwind classes correctly", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("should handle empty inputs", () => {
    expect(cn()).toBe("");
  });
});
