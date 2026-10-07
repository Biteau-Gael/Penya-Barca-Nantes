import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  AUTH_SECRET: z.string().min(16),
  LOG_LEVEL: z
    .enum(["error", "warn", "info", "debug"])
    .default("info"),
  API_FOOTBALL_KEY: z.string().optional(),
  APP_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  return envSchema.parse(process.env);
}
