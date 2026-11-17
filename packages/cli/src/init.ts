import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectNextApp, exists, type NextApp } from "./detect.ts";

/** In the repo: the root templates/ folder. Published: the copy made at build, next to dist/. */
const templatesDir = [
  new URL("../../../templates/", import.meta.url),
  new URL("../templates/", import.meta.url),
]
  .map((url) => fileURLToPath(url))
  .find((dir) => existsSync(join(dir, "totalmod.config.yaml"))) as string;

/** Template file -> target path in the user's repo. `{src}` becomes "src/" or "". */
const manifest: [template: string, target: string][] = [
  ["totalmod.config.yaml", "totalmod.config.yaml"],
  ["totalmod.flags.json", "flags/totalmod.flags.json"],
  ["route.ts", "{src}app/api/totalmod/[...totalmod]/route.ts"],
  ["totalmod-adapter.ts", "{src}lib/totalmod.ts"],
  ["totalmod-widget.tsx", "{src}components/totalmod-widget.tsx"],
  ["seed-mock.ts", "seed/mock.ts"],
  ["workflows/totalmod-build.yml", ".github/workflows/totalmod-build.yml"],
  ["workflows/totalmod-release.yml", ".github/workflows/totalmod-release.yml"],
];

export interface InitResult {
  app: NextApp;
  created: string[];
  skipped: string[];
  nextSteps: string[];
}

/** Copies the templates into a Next.js App Router project. Existing files are kept unless `force`. */
export async function init(dir: string, options: { force?: boolean } = {}): Promise<InitResult> {
  const app = await detectNextApp(dir);
  const created: string[] = [];
  const skipped: string[] = [];

  for (const [template, rawTarget] of manifest) {
    const target = rawTarget.replace("{src}", app.src);
    const path = join(dir, target);
    if (!options.force && (await exists(path))) {
      skipped.push(target);
      continue;
    }
    const text = await readFile(join(templatesDir, template), "utf8");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text.replaceAll("{{src}}", app.src));
    created.push(target);
  }

  return { app, created, skipped, nextSteps: nextSteps(app) };
}

function nextSteps(app: NextApp): string[] {
  const add = app.packageManager === "npm" ? "npm install" : `${app.packageManager} add`;
  return [
    `Install the runtime: \`${add} @totalmod/server @totalmod/widget @totalmod/flags\``,
    `Return the signed-in user from \`getRequester\` in ${app.src}lib/totalmod.ts`,
    `Render <TotalmodWidget /> from ${app.src}components/totalmod-widget.tsx in ${app.src}app/layout.tsx`,
    "GitHub Actions: secrets ANTHROPIC_API_KEY and TOTALMOD_GITHUB_TOKEN (the build agent gets nothing else), variable TOTALMOD_TRUSTED_ACTORS",
    "App server env (production): TOTALMOD_GITHUB_REPO, TOTALMOD_GITHUB_TOKEN, TOTALMOD_PREVIEW_SECRET, TOTALMOD_WEBHOOK_SECRET",
    "GitHub webhook to <your app>/api/totalmod/webhooks/github (Pull requests, Deployment statuses), secret TOTALMOD_WEBHOOK_SECRET",
    "Add a /totalmod/preview route that turns the signed link into a mock session (see the demo app)",
    "Vercel Preview env: TOTALMOD_MODE=mock and TOTALMOD_PREVIEW_SECRET only, no DATABASE_URL",
    'In next.config, add "@totalmod/flags" and "@openfeature/flagd-provider" to serverExternalPackages',
    "Check everything: `npx totalmod doctor`",
  ];
}
