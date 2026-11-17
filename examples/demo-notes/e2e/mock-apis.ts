// Stand-in for the Anthropic Messages API and the GitHub issues API during e2e runs.
// The production-mode server points ANTHROPIC_BASE_URL and TOTALMOD_GITHUB_API_URL here.
// GET /__recorded returns everything received, so tests can inspect the issue payload.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_APIS_PORT ?? 3300);
const recorded = {
  messages: [] as unknown[],
  issues: [] as Record<string, unknown>[],
  /** Other GitHub calls: PR comments, labels, PR lookups, GraphQL. */
  github: [] as { method: string; path: string; body: unknown }[],
  /** Anonymous telemetry the production server sent. */
  telemetry: [] as { event: string; props: Record<string, number> }[],
};

/** The reviser's answer to "fix this": one rewritten change, never the raw feedback. */
const delta = {
  kind: "delta",
  changes: ["Show the word count in a smaller, lighter grey font"],
  declineReason: null,
};

const questions = {
  kind: "questions",
  questions: [
    {
      id: "where",
      text: "Where should the word count appear?",
      options: ["Under each note in the list", "In the editor"],
    },
    { id: "count", text: "What should it count?", options: ["Words", "Words and characters"] },
  ],
  spec: null,
  declineReason: null,
};

/** The spec title carries the request's nonce so parallel tests can find their own issue. */
function spec(nonce: string) {
  return {
    kind: "spec",
    questions: [],
    spec: {
      title: `Word count under each note ${nonce}`.trim(),
      userStory:
        "As a writer I want to see how many words each note has so I can keep posts short.",
      acceptanceCriteria: [
        "Each note in the list shows its word count",
        "Empty notes show 0 words",
      ],
      uiLocation: "Notes list, under each note",
      outOfScope: ["Character counts", "Admin pages"],
    },
    declineReason: null,
  };
}

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
    if (turn.includes("<feedback>")) return send(200, message(delta));
    const nonce = turn.match(/nonce-[a-z0-9]+/)?.[0] ?? "";
    return send(
      200,
      message(turn.includes("<answers>none yet</answers>") ? questions : spec(nonce)),
    );
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
