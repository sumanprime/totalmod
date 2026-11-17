// Turns the frames from e2e/record-demo.spec.ts into the README GIF (2 seconds per frame).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import gifenc from "gifenc";
import { PNG } from "pngjs";

// gifenc is CommonJS: its functions hang off the default export.
const { applyPalette, GIFEncoder, quantize } = gifenc;

const frames = join(import.meta.dirname, "..", "test-results", "demo-frames");
const out = join(import.meta.dirname, "..", "..", "..", "docs", "media", "request-a-feature.gif");
const files = readdirSync(frames)
  .filter((f) => f.endsWith(".png"))
  .sort();
if (files.length === 0)
  throw new Error("No frames: run `RECORD_DEMO=1 pnpm exec playwright test record-demo` first.");

const gif = GIFEncoder();
for (const file of files) {
  const png = PNG.sync.read(readFileSync(join(frames, file)));
  const palette = quantize(png.data, 256);
  gif.writeFrame(applyPalette(png.data, palette), png.width, png.height, { palette, delay: 2000 });
}
gif.finish();
mkdirSync(join(out, ".."), { recursive: true });
writeFileSync(out, gif.bytes());
console.log(`Wrote ${out} (${files.length} frames, ${(gif.bytes().length / 1024).toFixed(0)} KB)`);
