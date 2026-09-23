import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * If DATABASE_URL is already set (CI with a real Postgres service, or a
 * developer pointing at their own Neon branch), we use it as-is and never
 * touch it. Otherwise we boot a throwaway local Postgres via embedded-postgres
 * so `npm run eval` and `npm run smoke` work with zero setup - it initialises
 * into a scratch data directory and is torn down at the end of the run.
 */
export async function ensureLocalDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  if (process.env.DATABASE_URL) {
    return { url: process.env.DATABASE_URL, stop: async () => {} };
  }

  const port = 55432;
  const dataDir = path.join(process.cwd(), ".embedded-postgres-eval-data");
  // Scratch directory: always start clean so a crashed previous run (which
  // skips the stop()/cleanup below) can't leave initdb refusing to start.
  fs.rmSync(dataDir, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "meeravoice",
    password: "meeravoice",
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("meeravoice");

  const url = `postgres://meeravoice:meeravoice@localhost:${port}/meeravoice`;
  process.env.DATABASE_URL = url;

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await pool.end();

  return {
    url,
    stop: async () => {
      await pg.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
