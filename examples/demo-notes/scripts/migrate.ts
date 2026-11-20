// Applies migrations/ to the production database: DATABASE_URL_UNPOOLED when set (Neon sets it;
// migrations need a direct connection, not the pooler), else DATABASE_URL.
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
await migrate(drizzle({ client }), {
  migrationsFolder: join(import.meta.dirname, "../migrations"),
});
await client.end();
console.log("Migrations applied.");
