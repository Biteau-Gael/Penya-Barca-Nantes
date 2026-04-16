import { redis } from "./redis.server";
import { AppError } from "./errors.server";

interface RateLimitOptions {
  key: string;
  maxAttempts: number;
  windowSeconds: number;
}

const RATE_LIMIT_SCRIPT = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return current
`;

export async function checkRateLimit({
  key,
  maxAttempts,
  windowSeconds,
}: RateLimitOptions): Promise<void> {
  const redisKey = `rate-limit:${key}`;
  const current = await redis.eval(RATE_LIMIT_SCRIPT, 1, redisKey, windowSeconds) as number;

  if (current > maxAttempts) {
    throw new AppError(
      "RATE_LIMIT_EXCEEDED",
      "Trop de tentatives. Veuillez réessayer plus tard.",
      429,
    );
  }
}
