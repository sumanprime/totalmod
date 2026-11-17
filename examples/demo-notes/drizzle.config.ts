import { defineConfig } from "drizzle-kit";

// Migrations live in migrations/, which totalmod.config.yaml blocks from agent edits.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./migrations",
});
