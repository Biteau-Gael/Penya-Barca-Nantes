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

  // Atomic INCR + EXPIRE via pipeline to avoid a race condition where the
  // TTL is never set if the process crashes between the two commands.
  const pipeline = redis.pipeline();
  pipeline.incr(redisKey);
  pipeline.expire(redisKey, windowSeconds, "NX");
  const results = await pipeline.exec();
  const current = (results?.[0]?.[1] as number) ?? 0;

  if (current > maxAttempts) {
    throw new AppError(
      "RATE_LIMIT_EXCEEDED",
      "Trop de tentatives. Veuillez réessayer plus tard.",
      429,
    );
  }
}
