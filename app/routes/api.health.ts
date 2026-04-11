import { pool } from "~/db/client";
import { redis } from "~/lib/server/redis.server";
import { logger } from "~/lib/server/logger.server";

interface ServiceStatus {
  app: "ok" | "error";
  db: "ok" | "error";
  redis: "ok" | "error";
}

export async function loader() {
  const services: ServiceStatus = {
    app: "ok",
    db: "error",
    redis: "error",
  };

  // Check PostgreSQL
  try {
    await pool.query("SELECT 1");
    services.db = "ok";
  } catch (error) {
    logger.error({ error, action: "health-check-db" }, "Database health check failed");
  }

  // Check Redis
  try {
    const pong = await redis.ping();
    if (pong === "PONG") {
      services.redis = "ok";
    }
  } catch (error) {
    logger.error({ error, action: "health-check-redis" }, "Redis health check failed");
  }

  const allHealthy = services.db === "ok" && services.redis === "ok";

  logger.info({ services, healthy: allHealthy, action: "health-check" }, "Health check completed");

  return new Response(
    JSON.stringify({
      status: allHealthy ? "ok" : "degraded",
      services,
      timestamp: new Date().toISOString(),
    }),
    {
      status: allHealthy ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    }
  );
}
