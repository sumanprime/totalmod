#!/usr/bin/env node
import { main } from "./cli.ts";

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  print: (line) => console.log(line),
});
