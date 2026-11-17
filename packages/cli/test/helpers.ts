import { cp, mkdir, mkdtemp, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const fixture = join(import.meta.dirname, "fixtures", "next-app");

/** Copies the fixture Next.js app into a fresh temp dir; `src` moves app/ under src/. */
export async function fixtureApp(options: { src?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "totalmod-cli-"));
  await cp(fixture, dir, { recursive: true });
  if (options.src) {
    await mkdir(join(dir, "src"));
    await rename(join(dir, "app"), join(dir, "src", "app"));
  }
  return dir;
}

/** Sorted, slash-separated list of every file under `dir`. */
export async function fileTree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"))
    .sort();
}
