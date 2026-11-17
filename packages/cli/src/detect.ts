import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export class InitError extends Error {
  override name = "InitError";
}

export interface NextApp {
  /** "src/" when the app lives under src/, otherwise "". Prefixes every app path. */
  src: "" | "src/";
  packageManager: "pnpm" | "yarn" | "bun" | "npm";
}

/** Finds a Next.js App Router project in `dir`, or explains why it is not one. */
export async function detectNextApp(dir: string): Promise<NextApp> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  } catch {
    throw new InitError(`No package.json in ${dir}. Run this from your Next.js app's root.`);
  }
  if (!pkg.dependencies?.next && !pkg.devDependencies?.next) {
    throw new InitError("`next` is not a dependency. totalmod v0.1 supports Next.js apps only.");
  }

  let src: NextApp["src"];
  if (await isDir(join(dir, "app"))) src = "";
  else if (await isDir(join(dir, "src", "app"))) src = "src/";
  else if ((await isDir(join(dir, "pages"))) || (await isDir(join(dir, "src", "pages")))) {
    throw new InitError("Found the Pages Router only. totalmod v0.1 needs the App Router (app/).");
  } else {
    throw new InitError("No app/ or src/app/ directory. totalmod v0.1 needs the App Router.");
  }

  return { src, packageManager: await detectPackageManager(dir) };
}

async function detectPackageManager(dir: string): Promise<NextApp["packageManager"]> {
  const lockfiles: [string, NextApp["packageManager"]][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ];
  for (const [file, manager] of lockfiles) {
    if (await exists(join(dir, file))) return manager;
  }
  return "npm";
}

async function isDir(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

export async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}
