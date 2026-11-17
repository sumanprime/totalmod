// Production-mode server for e2e: apply migrations, then `next start`. Plain node, no shell, so
// pglite-server can run it on any OS.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

await import("./migrate.ts");

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "start"], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 1));
