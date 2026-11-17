// The composite actions and workflow templates only run on GitHub; at least make sure they parse
// and wire the steps the code expects.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const root = join(import.meta.dirname, "../..");
const files = [
  "action/action.yml",
  "action/release/action.yml",
  "templates/workflows/totalmod-build.yml",
  "templates/workflows/totalmod-release.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/cla.yml",
  ".github/workflows/release.yml",
];

function load(file: string) {
  const doc = parseDocument(readFileSync(join(root, file), "utf8"));
  expect(doc.errors.map((e) => e.message)).toEqual([]);
  return doc.toJS();
}

describe("action and workflow YAML", () => {
  it.each(files)("%s parses", (file) => {
    expect(load(file)).toBeTypeOf("object");
  });

  it("runs every main.ts command the build action needs, in order", () => {
    const steps = load("action/action.yml").runs.steps as { run?: string; uses?: string }[];
    const commands = steps
      .map(
        (s) =>
          s.run?.match(/main\.ts" (\w+)/)?.[1] ??
          (s.uses?.startsWith("anthropics/") ? "claude" : null),
      )
      .filter(Boolean);
    expect(commands).toEqual(["policy", "claude", "paths", "test", "publish", "spend"]);
  });

  it("hands the release job's cleanup request to the remove-flag job", () => {
    const workflow = load("templates/workflows/totalmod-release.yml");
    const removal = workflow.jobs["remove-flag"];
    expect(removal.needs).toBe("release");
    const step = removal.steps.find((s: { uses?: string }) => s.uses?.endsWith("/action@v0"));
    expect(step.with).toMatchObject({
      task: "remove-flag",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template
      req_id: "${{ needs.release.outputs.cleanup_req }}",
    });
  });
});
