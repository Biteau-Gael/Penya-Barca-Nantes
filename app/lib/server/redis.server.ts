import Redis from "ioredis";
import { getEnv } from "~/config/env.server";

export const redis = new Redis(getEnv().REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});
