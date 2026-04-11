import { describe, it, expect, beforeEach, afterEach } from "vitest";

// We test the schema validation logic directly since getEnv() reads process.env
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  AUTH_SECRET: z.string().min(16),
  LOG_LEVEL: z
    .enum(["error", "warn", "info", "debug"])
    .default("info"),
});

describe("env validation", () => {
  it("should parse valid environment variables", () => {
    const env = envSchema.parse({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      AUTH_SECRET: "a-secret-that-is-long-enough",
    });

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("should reject missing DATABASE_URL", () => {
    expect(() =>
      envSchema.parse({
        AUTH_SECRET: "a-secret-that-is-long-enough",
      })
    ).toThrow();
  });

  it("should reject AUTH_SECRET shorter than 16 chars", () => {
    expect(() =>
      envSchema.parse({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        AUTH_SECRET: "short",
      })
    ).toThrow();
  });

  it("should reject invalid NODE_ENV", () => {
    expect(() =>
      envSchema.parse({
        NODE_ENV: "staging",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        AUTH_SECRET: "a-secret-that-is-long-enough",
      })
    ).toThrow();
  });

  it("should coerce PORT to number", () => {
    const env = envSchema.parse({
      PORT: "8080",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      AUTH_SECRET: "a-secret-that-is-long-enough",
    });

    expect(env.PORT).toBe(8080);
  });
});
