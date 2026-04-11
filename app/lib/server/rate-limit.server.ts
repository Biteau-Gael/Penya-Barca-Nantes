import { redis } from "./redis.server";
import { AppError } from "./errors.server";

interface RateLimitOptions {
  key: string;
  maxAttempts: number;
  windowSeconds: number;
}

export async function checkRateLimit({
  key,
  maxAttempts,
  windowSeconds,
}: RateLimitOptions): Promise<void> {
  const redisKey = `rate-limit:${key}`;
  const current = await redis.incr(redisKey);

  if (current === 1) {
    await redis.expire(redisKey, windowSeconds);
  }

  if (current > maxAttempts) {
    throw new AppError(
      "RATE_LIMIT_EXCEEDED",
      "Trop de tentatives. Veuillez réessayer plus tard.",
      429,
    );
  }
}
