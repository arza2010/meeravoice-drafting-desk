import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getEnv } from "@/lib/env";
import * as schema from "@/lib/db/schema";

let cachedPool: Pool | undefined;
let cachedDb: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Standard `pg` over the Node runtime (this app never runs on Edge), rather
 * than the Neon HTTP driver: it works identically against Neon in
 * production and against any local/embedded Postgres for tests and evals,
 * and it supports real transactions if we ever need one.
 */
export function getDb() {
  if (cachedDb) return cachedDb;
  cachedPool = new Pool({ connectionString: getEnv().DATABASE_URL });
  cachedDb = drizzle(cachedPool, { schema });
  return cachedDb;
}

/** Closes the pooled connection. Used by scripts/evals that tear down a scratch database. */
export async function closeDb(): Promise<void> {
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = undefined;
    cachedDb = undefined;
  }
}
