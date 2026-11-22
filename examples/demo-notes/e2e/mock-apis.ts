// Stand-in for the Anthropic Messages API and the GitHub issues API during e2e runs.
// The production-mode server points ANTHROPIC_BASE_URL and TOTALMOD_GITHUB_API_URL here.
// GET /__recorded returns everything received, so tests can inspect the issue payload.
import { createServer } from "node:http";
import { scriptedAnswer } from "../lib/scripted-answers.ts";

const port = Number(process.env.MOCK_APIS_PORT ?? 3300);
const recorded = {
  messages: [] as unknown[],
  issues: [] as Record<string, unknown>[],
  /** Other GitHub calls: PR comments, labels, PR lookups, GraphQL. */
  github: [] as { method: string; path: string; body: unknown }[],
  /** Anonymous telemetry the production server sent. */
  telemetry: [] as { event: string; props: Record<string, number> }[],
};

function message(output: unknown) {
  return {
    id: `msg_mock_${recorded.messages.length}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: JSON.stringify(output), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 },
  };
}

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };

  if (req.method === "GET" && url.pathname === "/__health") return send(200, { ok: true });
  if (req.method === "GET" && url.pathname === "/__recorded") return send(200, recorded);

  if (req.method === "POST" && url.pathname === "/v1/events") {
    recorded.telemetry.push(body);
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    recorded.messages.push(body);
    const turn = String(body?.messages?.[0]?.content ?? "");
    return send(200, message(scriptedAnswer(turn)));
  }

  const issue = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues$/);
  if (req.method === "POST" && issue) {
    recorded.issues.push({
      repo: `${issue[1]}/${issue[2]}`,
      auth: req.headers.authorization,
      ...body,
    });
    const number = 100 + recorded.issues.length;
    return send(201, {
      number,
      html_url: `https://github.com/${issue[1]}/${issue[2]}/issues/${number}`,
    });
  }

  if (url.pathname.startsWith("/repos/") || url.pathname === "/graphql") {
    recorded.github.push({ method: req.method ?? "GET", path: url.pathname, body });
    if (req.method === "GET" && /\/pulls\/\d+$/.test(url.pathname)) {
      return send(200, { node_id: "PR_kwDOmock", draft: true });
    }
    if (url.pathname === "/graphql") {
      return send(200, {
        data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } },
      });
    }
    return send(201, { id: recorded.github.length });
  }

  send(404, { error: `mock-apis: no route for ${req.method} ${url.pathname}` });
}).listen(port, "127.0.0.1", () => console.log(`mock APIs on :${port}`));
