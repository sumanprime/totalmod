// Vercel's build step (it runs `vercel-build` when a package defines one). The demo app migrates its
// database first; the mock-mode preview project has no database, so it only builds.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { getMode } from "../lib/mode.ts";

if (getMode() === "production") await import("./migrate.ts");

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const { status } = spawnSync(process.execPath, [next, "build"], { stdio: "inherit" });
process.exit(status ?? 1);
