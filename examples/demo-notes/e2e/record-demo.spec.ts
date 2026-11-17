// Records the README GIF: the whole loop through the real widget, one captioned screenshot per
// step. Skipped unless RECORD_DEMO=1; see `pnpm demo:gif`.
import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const FRAMES = join(import.meta.dirname, "..", "test-results", "demo-frames");
const MOCK_APIS = "http://127.0.0.1:3300";
const PRODUCTION = "http://127.0.0.1:3200";
const PREVIEW = "http://127.0.0.1:3100";
const REPO = "sumanprime/demo-notes";

test.use({ viewport: { width: 960, height: 600 } });

let frame = 0;
async function shot(page: Page, caption: string) {
  await page.evaluate((text) => {
    document.getElementById("demo-caption")?.remove();
    const el = document.createElement("div");
    el.id = "demo-caption";
    el.textContent = text;
    el.style.cssText =
      "position:fixed;left:16px;bottom:16px;z-index:2147483647;" +
      "background:#111;color:#fff;font:600 17px system-ui,sans-serif;padding:10px 18px;" +
      "border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.25);white-space:nowrap";
    document.body.append(el);
  }, caption);
  frame += 1;
  await page.screenshot({ path: join(FRAMES, `${String(frame).padStart(2, "0")}.png`) });
}

async function webhook(request: APIRequestContext, event: string, payload: object) {
  const body = JSON.stringify({ repository: { full_name: REPO }, ...payload });
  const signature = `sha256=${createHmac("sha256", "e2e-webhook-secret").update(body).digest("hex")}`;
  await request.post(`${PRODUCTION}/api/totalmod/webhooks/github`, {
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": signature,
    },
    data: body,
  });
}

test("record the README demo", async ({ page, request, browser }, info) => {
  test.skip(!process.env.RECORD_DEMO || info.project.name !== "production", "set RECORD_DEMO=1");
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });

  await page.goto("/signin");
  await page.getByLabel("Name").fill("Maya Chen");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Title").fill("Launch checklist");
  await page.getByLabel("Body").fill("Write the changelog, record the demo, ship it.");
  await page.getByRole("button", { name: "Add note" }).click();
  await shot(page, "1. A user of your app clicks “Request a feature”");

  await page.getByRole("button", { name: "Request a feature" }).click();
  await page
    .getByLabel("What would make this app better for you?")
    .fill("can I see how many words each note has?");
  await shot(page, "2. They describe it in their own words");

  await page.getByRole("button", { name: "Continue" }).click();
  const dialog = page.getByRole("dialog", { name: "Request a feature" });
  await dialog.getByRole("radio", { name: "Under each note in the list" }).check();
  await dialog.getByRole("radio", { name: "Words", exact: true }).check();
  await shot(page, "3. An AI interviewer asks a couple of quick questions");

  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByText("You'll be able to")).toBeVisible();
  await shot(page, "4. They confirm a spec. Only the spec reaches the coding agent");

  await dialog.getByRole("button", { name: "Looks right, build it" }).click();
  await expect(dialog.getByRole("status")).toContainText("We're building");
  await shot(page, "5. Claude Code builds it on a branch, behind a flag");

  // Recording runs alone (RECORD_DEMO), so the latest issue is ours.
  const issue = (await (await request.get(`${MOCK_APIS}/__recorded`)).json()).issues.at(-1);
  const reqId = issue.body.match(/"reqId":"([a-z0-9]+)"/)[1];
  const branch = `totalmod/req-${reqId}`;
  await webhook(request, "pull_request", {
    action: "opened",
    pull_request: { number: 42, head: { ref: branch } },
  });
  const deployed = () =>
    webhook(request, "deployment_status", {
      deployment: { ref: branch, environment: "Preview" },
      deployment_status: { state: "success", environment: "Preview", environment_url: PREVIEW },
    });
  await deployed();
  await page.reload();
  await page.getByRole("button", { name: "Your feature is ready" }).click();
  await expect(dialog.getByRole("link", { name: "Try it" })).toBeVisible();
  await shot(page, "6. Ready. Only the requester gets the link");

  const href = (await dialog.getByRole("link", { name: "Try it" }).getAttribute("href")) ?? "";
  const preview = await (
    await browser.newContext({ viewport: { width: 960, height: 600 } })
  ).newPage();
  await preview.goto(href);
  await expect(preview.getByRole("status")).toContainText("Preview with mock data");
  await preview.getByLabel("Title").fill("Blog post draft");
  await preview
    .getByLabel("Body")
    .fill("Three short paragraphs about shipping what users ask for.");
  await preview.getByRole("button", { name: "Add note" }).click();
  await expect(preview.getByText("Blog post draft")).toBeVisible();
  await shot(preview, "7. They try it on a preview with mock data");

  await dialog.getByRole("button", { name: /Fix this/ }).click();
  await dialog.getByLabel("What should change?").fill("make the count smaller and grey");
  await shot(page, "8. Not quite right? They ask for a fix (up to 3 rounds)");

  await dialog.getByRole("button", { name: "Send changes" }).click();
  await expect(dialog.getByRole("status")).toContainText("round 1 of 3");
  await deployed();
  await page.reload();
  await page.getByRole("button", { name: "Your feature is ready" }).click();
  await dialog.getByRole("button", { name: "Looks good" }).click();
  await expect(dialog.getByRole("status")).toContainText("The team will review");
  await shot(page, "9. Thumbs-up: the PR is ready for your review");

  await page.getByRole("button", { name: "Close" }).click();
  await shot(page, "10. You merge. It turns on for them first, then you roll it out");
});
