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
  // Atomic INCR+EXPIRE via Lua to avoid permanent lock if process crashes between the two calls
  const current = (await redis.eval(
    "local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return c",
    1,
    redisKey,
    windowSeconds,
  )) as number;

  if (current > maxAttempts) {
    throw new AppError(
      "RATE_LIMIT_EXCEEDED",
      "Trop de tentatives. Veuillez réessayer plus tard.",
      429,
    );
  }
}
