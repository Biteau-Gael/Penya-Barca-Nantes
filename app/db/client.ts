import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { getEnv } from "~/config/env.server";

const pool = new pg.Pool({
  connectionString: getEnv().DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export { pool };
