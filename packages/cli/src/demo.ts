// `npx totalmod demo`: the whole loop on your machine in a few minutes, with no API key, GitHub
// repo or Vercel account. It copies the demo notes app, installs it from npm, builds it, and runs
// it twice: the app in scripted mode (the AI, GitHub and the build are simulated in-process) and
// its mock-data preview.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The demo's package name, so a second run can tell its own folder from someone else's. */
export const DEMO_NAME = "totalmod-demo";

/** What a trial run doesn't need: tests, e2e, local tooling and build output. */
const SKIP = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "e2e",
  "test",
  "test-results",
  "playwright-report",
  "scripts",
  "types",
  "playwright.config.ts",
  "vitest.config.ts",
  "ecosystem.config.cjs",
  "drizzle.config.ts",
  "next-env.d.ts",
  "tsconfig.tsbuildinfo",
  "README.md",
  "package.json",
]);

/** Next needs these to build a TypeScript app; in the repo they come from the root. */
const BUILD_TYPES = ["typescript", "@types/node", "@types/react", "@types/react-dom"];

const README = `# totalmod demo

A small notes app with [totalmod](https://github.com/sumanprime/totalmod) wired in, in scripted
mode: the interviewer's answers are canned, GitHub is faked in-process, and the "build" is a short
wait followed by the webhooks GitHub and Vercel would send. Every request becomes the same
word-count feature, which is already in the app behind a demo-only switch.

Run it again with \`npx totalmod demo\` from the folder above this one. Data lives in memory and is
gone when you stop it. Delete this folder to start over with a newer totalmod.

To add totalmod to your own app: \`npx totalmod init\`.
`;

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export class DemoError extends Error {}

/**
 * In the repo: examples/demo-notes, copied with `copyDemoApp`. Published: the ready-to-install
 * copy the build put next to dist/.
 */
function demoSource(): { path: string; ready: boolean } {
  const repo = new URL("../../../examples/demo-notes/", import.meta.url);
  if (existsSync(repo)) return { path: fileURLToPath(repo), ready: false };
  const bundled = new URL("../demo/", import.meta.url);
  if (existsSync(bundled)) return { path: fileURLToPath(bundled), ready: true };
  throw new DemoError("The demo app is missing from this install of totalmod.");
}

/**
 * The demo's package.json: the app's runtime dependencies, with workspace links pinned to this
 * release (all totalmod packages share one version), plus what Next needs to build TypeScript.
 */
export function demoManifest(app: Manifest, root: Manifest, version: string) {
  const dependencies = Object.fromEntries(
    Object.entries(app.dependencies ?? {}).map(([name, range]) => [
      name,
      range.startsWith("workspace:") ? version : range,
    ]),
  );
  const available = { ...root.devDependencies, ...app.devDependencies };
  const devDependencies = Object.fromEntries(
    BUILD_TYPES.flatMap((name) => (available[name] ? [[name, available[name]]] : [])),
  );
  return {
    name: DEMO_NAME,
    private: true,
    type: "module",
    scripts: { build: "next build", start: "next start" },
    dependencies,
    devDependencies,
  };
}

/** Copies the demo app from `from` (the repo's examples/demo-notes) into `to`, ready to install. */
export async function copyDemoApp(from: string, to: string, version: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    if (!SKIP.has(entry)) await cp(join(from, entry), join(to, entry), { recursive: true });
  }
  const app = JSON.parse(await readFile(join(from, "package.json"), "utf8")) as Manifest;
  const root = JSON.parse(await readFile(join(from, "../../package.json"), "utf8")) as Manifest;
  const manifest = demoManifest(app, root, version);
  await writeFile(join(to, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(to, "README.md"), README);
}

/** Puts the demo app in `dir`, unless a previous run already did. */
export async function prepareDemo(dir: string, version: string): Promise<"created" | "reused"> {
  const manifestPath = join(dir, "package.json");
  if (existsSync(manifestPath)) {
    const { name } = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: string };
    if (name !== DEMO_NAME) {
      throw new DemoError(
        `${dir} already has a package.json that isn't a totalmod demo. Pass --dir <new folder>.`,
      );
    }
    return "reused";
  }
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    throw new DemoError(`${dir} is not empty. Pass --dir <new folder>.`);
  }
  const source = demoSource();
  if (source.ready) await cp(source.path, dir, { recursive: true });
  else await copyDemoApp(source.path, dir, version);
  return "created";
}

/** Env vars a child process needs to find node, npm's cache and temp files. Nothing else. */
const BASE_ENV = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "APPDATA",
  "LOCALAPPDATA",
  "LANG",
];

export interface DemoPorts {
  app: number;
  preview: number;
}

/**
 * The two servers' environments, built from scratch: never the caller's DATABASE_URL, API keys or
 * tokens. The secrets are random per run and only shared between these two processes.
 */
export function serverEnvs(
  parent: Record<string, string | undefined>,
  ports: DemoPorts,
): Record<"app" | "preview", Record<string, string>> {
  const base: Record<string, string> = { NEXT_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" };
  for (const key of BASE_ENV) {
    const value = parent[key];
    if (value !== undefined) base[key] = value;
  }
  const previewSecret = randomBytes(32).toString("hex");
  return {
    app: {
      ...base,
      PORT: String(ports.app),
      TOTALMOD_MODE: "production",
      DEMO_SCRIPTED: "1",
      // A different host name from the app's, so the two servers' session cookies don't collide.
      DEMO_PREVIEW_URL: `http://127.0.0.1:${ports.preview}`,
      DEMO_SESSION_SECRET: randomBytes(32).toString("hex"),
      TOTALMOD_PREVIEW_SECRET: previewSecret,
    },
    preview: {
      ...base,
      PORT: String(ports.preview),
      TOTALMOD_MODE: "mock",
      DEMO_SCRIPTED: "1",
      TOTALMOD_PREVIEW_SECRET: previewSecret,
    },
  };
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    // npm is a .cmd shim on Windows and needs a shell; node does not.
    const shell = process.platform === "win32" && command !== process.execPath;
    const child = spawn(command, args, { cwd, env, stdio: "inherit", shell });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new DemoError(`${command} ${args[0]} failed (${code}).`)),
    );
  });
}

async function waitForServer(url: string, child: ChildProcess, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new DemoError(`The server for ${url} stopped.`);
    try {
      await fetch(url, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new DemoError(`${url} didn't start within ${timeoutMs / 1000}s.`);
}

export interface DemoOptions {
  version: string;
  port: number;
  env: Record<string, string | undefined>;
  print: (line: string) => void;
}

/** Prepares, installs, builds and runs the demo. Resolves with the exit code when it stops. */
export async function runDemo(dir: string, options: DemoOptions): Promise<number> {
  const { print } = options;
  const prepared = await prepareDemo(dir, options.version);
  print(`${prepared === "created" ? "Created" : "Using"} the demo app in ${dir}`);

  print("Installing dependencies (about a minute the first time)…");
  await run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir, process.env);

  const next = createRequire(join(dir, "package.json")).resolve("next/dist/bin/next");
  const ports = { app: options.port, preview: options.port + 1 };
  const envs = serverEnvs(options.env, ports);
  if (!existsSync(join(dir, ".next", "BUILD_ID"))) {
    print("Building the app…");
    // Plain env: the build never runs in scripted or mock mode.
    const { DEMO_SCRIPTED: _s, DEMO_PREVIEW_URL: _p, ...buildEnv } = envs.app;
    await run(process.execPath, [next, "build"], dir, { ...buildEnv, TOTALMOD_MODE: "" });
  }

  const start = (env: Record<string, string>) =>
    spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1"], {
      cwd: dir,
      env,
      stdio: ["ignore", "ignore", "inherit"],
    });
  const servers = [start(envs.app), start(envs.preview)];
  const stop = () => {
    for (const server of servers) server.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await Promise.all([
      waitForServer(`http://127.0.0.1:${ports.app}/`, servers[0] as ChildProcess),
      waitForServer(`http://127.0.0.1:${ports.preview}/`, servers[1] as ChildProcess),
    ]);
  } catch (error) {
    stop();
    throw error;
  }

  print("");
  print(`  Open http://localhost:${ports.app}`);
  print("");
  print("  Sign in with any name, click Request a feature, and follow the request through:");
  print("  questions, a spec, a simulated build, your private preview, a fix round and the merge.");
  print(`  The preview runs on mock data at http://127.0.0.1:${ports.preview}.`);
  print("  Press Ctrl+C to stop. Data is kept in memory only.");

  // When either server stops, stop the other one too.
  return new Promise((resolve) => {
    for (const server of servers) {
      server.once("exit", (code) => {
        stop();
        resolve(code ?? 0);
      });
    }
  });
}
