import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "~/db/client";
import { redis } from "./redis.server";
import { logger } from "./logger.server";
import { getEnv } from "~/config/env.server";

const env = getEnv();

export const auth = betterAuth({
  basePath: "/api/auth",
  trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      pseudo: {
        type: "string",
        required: false,
      },
      role: {
        type: "string",
        defaultValue: "member",
      },
      avatarUrl: {
        type: "string",
        required: false,
      },
      gdprConsent: {
        type: "boolean",
        defaultValue: false,
      },
      welcomeShown: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  secondaryStorage: {
    get: async (key) => {
      const value = await redis.get(key);
      return value ?? null;
    },
    set: async (key, value, ttl) => {
      if (ttl) {
        await redis.set(key, value, "EX", ttl);
      } else {
        await redis.set(key, value);
      }
    },
    delete: async (key) => {
      await redis.del(key);
    },
  },
  logger: {
    disabled: false,
    level: "error",
  },
});

export type Session = typeof auth.$Infer.Session;
