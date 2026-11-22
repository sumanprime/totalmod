// Build step: puts a ready-to-install copy of examples/demo-notes in demo/, which ships in the npm
// package for `npx totalmod demo`.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { copyDemoApp } from "../src/demo.ts";

const cli = join(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(cli, "package.json"), "utf8")) as {
  version: string;
};
const out = join(cli, "demo");
rmSync(out, { recursive: true, force: true });
await copyDemoApp(join(cli, "../../examples/demo-notes"), out, version);
console.log(`demo app bundled into ${out}`);
