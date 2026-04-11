import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Redis
vi.mock("./redis.server", () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

import { checkRateLimit } from "./rate-limit.server";
import { redis } from "./redis.server";
import { AppError } from "./errors.server";

const mockedRedis = vi.mocked(redis);

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should allow requests under the limit", async () => {
    mockedRedis.incr.mockResolvedValue(1);
    mockedRedis.expire.mockResolvedValue(1);

    await expect(
      checkRateLimit({ key: "test-ip", maxAttempts: 5, windowSeconds: 3600 }),
    ).resolves.toBeUndefined();
  });

  it("should set expiry on first request", async () => {
    mockedRedis.incr.mockResolvedValue(1);
    mockedRedis.expire.mockResolvedValue(1);

    await checkRateLimit({ key: "test-ip", maxAttempts: 5, windowSeconds: 3600 });

    expect(mockedRedis.expire).toHaveBeenCalledWith("rate-limit:test-ip", 3600);
  });

  it("should not set expiry on subsequent requests", async () => {
    mockedRedis.incr.mockResolvedValue(3);

    await checkRateLimit({ key: "test-ip", maxAttempts: 5, windowSeconds: 3600 });

    expect(mockedRedis.expire).not.toHaveBeenCalled();
  });

  it("should throw AppError when limit exceeded", async () => {
    mockedRedis.incr.mockResolvedValue(6);

    try {
      await checkRateLimit({ key: "test-ip", maxAttempts: 5, windowSeconds: 3600 });
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("RATE_LIMIT_EXCEEDED");
      expect((error as AppError).status).toBe(429);
    }
  });

  it("should allow exactly maxAttempts requests", async () => {
    mockedRedis.incr.mockResolvedValue(5);

    await expect(
      checkRateLimit({ key: "test-ip", maxAttempts: 5, windowSeconds: 3600 }),
    ).resolves.toBeUndefined();
  });
});
