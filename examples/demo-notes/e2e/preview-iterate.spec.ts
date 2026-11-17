// M5: request -> preview URL -> requester opens the signed link -> "fix this" -> second preview
// -> thumbs-up. GitHub and Vercel are simulated: signed webhooks go to the production server,
// and the "preview deployment" is the mock-mode server on :3100.
import { createHmac } from "node:crypto";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const MOCK_APIS = "http://127.0.0.1:3300";
const PRODUCTION = "http://127.0.0.1:3200";
const PREVIEW = "http://127.0.0.1:3100";
const REPO = "sumanprime/demo-notes";

interface Recorded {
  issues: { title: string; body: string }[];
  telemetry: { event: string; installId: string; props: Record<string, number> }[];
  github: { method: string; path: string; body: { body?: string; labels?: string[] } | null }[];
}
const recorded = async (request: APIRequestContext) =>
  (await (await request.get(`${MOCK_APIS}/__recorded`)).json()) as Recorded;

async function webhook(request: APIRequestContext, event: string, payload: object) {
  const body = JSON.stringify({ repository: { full_name: REPO }, ...payload });
  const signature = `sha256=${createHmac("sha256", "e2e-webhook-secret").update(body).digest("hex")}`;
  const res = await request.post(`${PRODUCTION}/api/totalmod/webhooks/github`, {
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": signature,
    },
    data: body,
  });
  expect(res.status()).toBe(200);
  return res.json();
}

/** Signs in, requests a feature, answers, confirms. Returns the request id from the issue. */
async function requestFeature(page: Page, request: APIRequestContext, nonce: string) {
  await page.goto("/signin");
  await page.getByLabel("Name").fill(`Previewer ${nonce}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await page.getByRole("button", { name: "Request a feature" }).click();
  await page
    .getByLabel("What would make this app better for you?")
    .fill(`word counts please ${nonce}`);
  await page.getByRole("button", { name: "Continue" }).click();
  const dialog = page.getByRole("dialog", { name: "Request a feature" });
  await dialog.getByRole("radio", { name: "Under each note in the list" }).check();
  await dialog.getByRole("radio", { name: "Words", exact: true }).check();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Looks right, build it" }).click();
  await expect(dialog.getByRole("status")).toContainText("We're building");

  const issue = (await recorded(request)).issues.find((i) => i.title.includes(nonce));
  const reqId = issue?.body.match(/"reqId":"([a-z0-9]+)"/)?.[1];
  expect(reqId).toBeTruthy();
  return reqId as string;
}

test("preview -> signed link -> fix this -> second preview -> thumbs-up", async ({
  page,
  request,
  browser,
}, info) => {
  test.skip(info.project.name !== "production", "requests are production-only");
  const nonce = `nonce-${Date.now().toString(36)}`;
  const reqId = await requestFeature(page, request, nonce);
  const branch = `totalmod/req-${reqId}`;
  const prNumber = 500 + Math.floor(Math.random() * 400);
  const deployed = () =>
    webhook(request, "deployment_status", {
      deployment: { ref: branch, environment: "Preview" },
      deployment_status: { state: "success", environment: "Preview", environment_url: PREVIEW },
    });

  // The action opened the draft PR and Vercel deployed the branch.
  expect(
    await webhook(request, "pull_request", {
      action: "opened",
      pull_request: { number: prNumber, head: { ref: branch } },
    }),
  ).toEqual({ updated: reqId });
  expect(await deployed()).toEqual({ updated: reqId });

  await page.reload();
  await page.getByRole("button", { name: "Your feature is ready" }).click();
  const dialog = page.getByRole("dialog", { name: "Request a feature" });
  await expect(dialog.getByRole("status")).toContainText("Only you can see it");
  const href = (await dialog.getByRole("link", { name: "Try it" }).getAttribute("href")) ?? "";
  expect(href.startsWith(`${PREVIEW}/totalmod/preview?token=`)).toBe(true);

  // The requester opens the link: a mock session on the preview, with mock data.
  // Its own context: in real life the preview is on another domain, so cookies never mix.
  const preview = await (await browser.newContext()).newPage();
  await preview.goto(href);
  await expect(preview).toHaveURL(`${PREVIEW}/notes`);
  await expect(preview.getByRole("status")).toContainText("Preview with mock data");
  await expect(preview.getByText(/You \(preview/)).toBeVisible();

  // A tampered link is refused.
  const tampered = await request.get(href.replace(/.$/, (c) => (c === "A" ? "B" : "A")));
  expect(tampered.status()).toBe(401);

  // "Fix this": the reviser's rewrite goes to the PR, not the raw words.
  await dialog.getByRole("button", { name: "Fix this (3 rounds left)" }).click();
  await dialog
    .getByLabel("What should change?")
    .fill("the number is WAY too loud, make it grey pls");
  await dialog.getByRole("button", { name: "Send changes" }).click();
  await expect(dialog.getByRole("status")).toContainText("round 1 of 3");
  const comment = (await recorded(request)).github.find(
    (c) => c.method === "POST" && c.path === `/repos/${REPO}/issues/${prNumber}/comments`,
  );
  expect(comment?.body?.body).toMatch(/^totalmod:iterate\n/);
  expect(comment?.body?.body).toContain("Show the word count in a smaller, lighter grey font");
  expect(comment?.body?.body).not.toContain("WAY too loud");

  // The rebuilt branch deploys again: second preview, then thumbs-up.
  await deployed();
  await page.reload();
  await page.getByRole("button", { name: "Your feature is ready" }).click();
  await expect(dialog.getByRole("button", { name: "Fix this (2 rounds left)" })).toBeVisible();
  await dialog.getByRole("button", { name: "Looks good" }).click();
  await expect(dialog.getByRole("status")).toContainText("The team will review");

  const calls = (await recorded(request)).github.map((c) => `${c.method} ${c.path}`);
  expect(calls).toContain(`GET /repos/${REPO}/pulls/${prNumber}`);
  expect(calls).toContain("POST /graphql");
  // Telemetry: counts only. The requester's words never leave the app.
  await expect
    .poll(async () => (await recorded(request)).telemetry.map((e) => e.event))
    .toEqual(expect.arrayContaining(["request_submitted", "preview_ready", "iteration"]));
  const telemetry = JSON.stringify((await recorded(request)).telemetry);
  expect(telemetry).not.toContain("WAY too loud");
  expect(telemetry).not.toContain(reqId);
  expect(telemetry).not.toContain(nonce);

  const label = (await recorded(request)).github.find(
    (c) => c.path === `/repos/${REPO}/issues/${prNumber}/labels`,
  );
  expect(label?.body?.labels).toEqual(["totalmod:ready"]);
});

test("preview links do nothing on production", async ({ request }, info) => {
  test.skip(info.project.name !== "production", "production only");
  expect((await request.get("/totalmod/preview?token=anything")).status()).toBe(404);
});
