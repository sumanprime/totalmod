// The scripted demo (DEMO_SCRIPTED=1, what `npx totalmod demo` runs): the whole loop with no
// Anthropic key, GitHub repo or build agent. The interviewer's answers are scripted, GitHub is faked in-process, and the
// "build" is a short wait followed by the webhooks GitHub and Vercel would send.
import { createHmac, randomBytes, randomInt } from "node:crypto";
import {
  createInterviewer,
  type GithubTarget,
  type Interviewer,
  type ModelBackend,
} from "@totalmod/server";
import { eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "./db";
import { totalmodRequests } from "./db/schema";
import { scriptedAnswer } from "./scripted-answers";

const REPO = "totalmod-demo/notes";
/** How long each simulated build or merge takes, so you see the "building" step. */
const BUILD_MS = 5_000;

type Handle = (request: Request) => Promise<Response>;

const backend: ModelBackend = {
  async complete({ content, schema }) {
    return { refused: false, output: schema.parse(scriptedAnswer(content)) };
  },
};

/**
 * Options for `createTotalmodHandlers`, and `connect` to hand it the handler, which receives the
 * simulated webhooks. The webhook secret is random per process: only this process signs them.
 */
export function scriptedDemo(previewUrl: string) {
  let handle: Handle | undefined;
  const webhookSecret = randomBytes(32).toString("hex");

  async function webhook(event: string, payload: object): Promise<void> {
    if (!handle) throw new Error("scriptedDemo: connect() was not called.");
    const body = JSON.stringify({ repository: { full_name: REPO }, ...payload });
    const signature = `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`;
    const res = await handle(
      new Request("http://demo.internal/api/totalmod/webhooks/github", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": event,
          "x-hub-signature-256": signature,
        },
        body,
      }),
    );
    if (!res.ok) console.error(`scripted demo: ${event} webhook got ${res.status}`);
  }

  /** Runs after the response, so the widget first shows the step as in progress. */
  function later(step: () => Promise<void>): void {
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, BUILD_MS));
      await step();
    });
  }

  const branch = (reqId: string) => `totalmod/req-${reqId}`;

  /**
   * The preview "deployed" for the request's latest fix round. The round goes in the URL's path:
   * the handler builds the try-it link as `new URL(previewPath, environment_url)`, and with the
   * relative `previewPath` below that keeps the path, giving /round/<n>/totalmod/preview?token=…
   */
  async function previewDeployed(reqId: string): Promise<void> {
    const db = await getDb();
    const [row] = await db
      .select({ data: totalmodRequests.data })
      .from(totalmodRequests)
      .where(eq(totalmodRequests.id, reqId));
    const round = row?.data.iteration ?? 0;
    const base = previewUrl.endsWith("/") ? previewUrl : `${previewUrl}/`;
    await webhook("deployment_status", {
      deployment: { ref: branch(reqId), environment: "Preview" },
      deployment_status: {
        state: "success",
        environment: "Preview",
        environment_url: new URL(`round/${round}/`, base).toString(),
      },
    });
  }

  /** The PR number is the issue number, so any server instance can find the request again. */
  async function reqIdForPr(number: number): Promise<string | undefined> {
    const db = await getDb();
    const [row] = await db
      .select({ id: totalmodRequests.id })
      .from(totalmodRequests)
      .where(sql`(${totalmodRequests.data}->>'prNumber')::int = ${number}`);
    return row?.id;
  }

  const json = (status: number, data: unknown) => Response.json(data, { status });

  /** Answers the GitHub calls the handler makes, and schedules what a real build would do. */
  const fakeGithub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const path = url.pathname.replace(`/repos/${REPO}`, "");

    if (method === "POST" && path === "/issues") {
      const reqId = String(body.body ?? "").match(/"reqId":"([a-z0-9]+)"/)?.[1];
      const number = randomInt(1_000, 2 ** 31 - 1);
      if (reqId) {
        later(async () => {
          await webhook("pull_request", {
            action: "opened",
            pull_request: { number, head: { ref: branch(reqId) } },
          });
          await previewDeployed(reqId);
        });
      }
      return json(201, { number, html_url: `https://github.com/${REPO}/issues/${number}` });
    }

    const comment = path.match(/^\/issues\/(\d+)\/comments$/);
    if (method === "POST" && comment) {
      // A fix round: rebuild, then deploy a fresh preview.
      const reqId = await reqIdForPr(Number(comment[1]));
      if (reqId) later(() => previewDeployed(reqId));
      return json(201, { id: 1 });
    }

    const pull = path.match(/^\/pulls\/(\d+)$/);
    if (method === "GET" && pull) {
      return json(200, { node_id: `PR_demo_${pull[1]}`, draft: true, body: "" });
    }

    if (method === "POST" && url.pathname.endsWith("/graphql")) {
      // Thumbs-up made the PR ready for review: the founder merges it a moment later.
      const number = Number(String(body.variables?.id ?? "").replace("PR_demo_", ""));
      const reqId = await reqIdForPr(number);
      if (reqId) {
        later(() =>
          webhook("pull_request", {
            action: "closed",
            pull_request: { number, merged: true, head: { ref: branch(reqId) } },
          }),
        );
      }
      return json(200, {
        data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } },
      });
    }

    // Labels and PR body edits: accepted, nothing to simulate.
    return json(200, {});
  }) as typeof fetch;

  const github: GithubTarget = {
    repo: REPO,
    token: "scripted-demo",
    apiUrl: "https://github.invalid",
    fetch: fakeGithub,
  };
  const interviewer: Interviewer = createInterviewer({ backend });

  return {
    // Relative, so the try-it link keeps the round in environment_url's path (see previewDeployed).
    options: { github, interviewer, webhookSecret, previewPath: "totalmod/preview" },
    connect(handler: Handle) {
      handle = handler;
    },
  };
}
