import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { seed } from "../../seed/mock";
import { installMockGuard, MockModeViolation } from "../mock-guard";
import { getMode } from "../mode";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const migrationsFolder = join(process.cwd(), "migrations");

// One database per server process; survives dev-server hot reloads.
const cache = globalThis as typeof globalThis & { __demoNotesDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  cache.__demoNotesDb ??= getMode() === "mock" ? createMockDb() : createProductionDb();
  return cache.__demoNotesDb;
}

/** In-memory PGlite with the real migrations and the mock seed. Nothing leaves the process. */
export async function createMockDb(): Promise<Db> {
  installMockGuard();
  const client = new PGlite();
  const db = drizzlePglite({ client, schema });
  await migrate(db, { migrationsFolder });
  await seed(db);
  return db;
}

/** Postgres from DATABASE_URL. Refuses to run in mock mode, whatever the env says. */
export async function createProductionDb(): Promise<Db> {
  if (getMode() === "mock") {
    throw new MockModeViolation("Refusing to connect to a non-PGlite database in mock mode.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Set it, or run with TOTALMOD_MODE=mock.");
  }
  const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  return drizzlePostgres({ client, schema });
}
