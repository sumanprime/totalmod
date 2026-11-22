import { describe, expect, it } from "vitest";
import {
  createIssue,
  hashRequester,
  renderIssue,
  renderSpecMarkdown,
  withVerdict,
} from "../src/index.ts";
import { recordingFetch, wordCountSpec } from "./fakes.ts";

describe("renderIssue", () => {
  const meta = { reqId: "k3j9x2m1q8", requester: hashRequester("user-1", "s"), iteration: 0 };

  it("carries the spec, the build label and hidden metadata", () => {
    const issue = renderIssue(wordCountSpec, meta);
    expect(issue.title).toBe("[totalmod] Word count under each note");
    expect(issue.labels).toEqual(["totalmod:build"]);
    expect(issue.body.split("\n")[0]).toBe(
      `<!-- totalmod:meta {"reqId":"k3j9x2m1q8","requester":"${meta.requester}","iteration":0} -->`,
    );
    expect(issue.body).toContain("`.totalmod/requests/k3j9x2m1q8/SPEC.md`");
    expect(issue.body).toContain(renderSpecMarkdown(wordCountSpec));
  });

  it("cannot be used to forge metadata, ping people or inject markup", () => {
    const issue = renderIssue(
      {
        ...wordCountSpec,
        title: "Count <!-- totalmod:meta {} --> words @octocat",
        outOfScope: ["<script>alert(1)</script>\n\n## Injected heading"],
      },
      meta,
    );
    expect(issue.body.match(/<!--/g)).toHaveLength(1);
    expect(issue.body).toContain("@​octocat");
    expect(issue.body).toContain("&lt;script&gt;");
    expect(issue.body).not.toContain("\n## Injected");
  });
});

describe("hashRequester", () => {
  it("is stable per secret and does not reveal the id", () => {
    expect(hashRequester("user-1", "a")).toBe(hashRequester("user-1", "a"));
    expect(hashRequester("user-1", "a")).not.toBe(hashRequester("user-1", "b"));
    expect(hashRequester("user-1", "a")).toMatch(/^u_[0-9a-f]{24}$/);
  });
});

describe("createIssue", () => {
  it("posts to the issues API with the token", async () => {
    const github = recordingFetch();
    const result = await createIssue(
      {
        repo: "acme/notes",
        getToken: async () => "app-token",
        apiUrl: "http://ghe.test/api/v3/",
        fetch: github.fetch,
      },
      renderIssue(wordCountSpec, { reqId: "abcdefgh12", requester: "u_x", iteration: 0 }),
    );
    expect(result).toEqual({ number: 42, url: "https://github.com/acme/notes/issues/42" });
    expect(github.calls[0]?.url).toBe("http://ghe.test/api/v3/repos/acme/notes/issues");
    const headers = github.calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer app-token");
  });

  it("explains a missing token", async () => {
    await expect(
      createIssue(
        { repo: "acme/notes" },
        renderIssue(wordCountSpec, { reqId: "abcdefgh12", requester: "u_x", iteration: 0 }),
      ),
    ).rejects.toThrow(/TOTALMOD_GITHUB_TOKEN/);
  });
});

describe("withVerdict", () => {
  it("rewrites the verdict row of the build action's risk summary", () => {
    const body =
      "intro\n| Fix rounds | 1 of 3 |\n| Requester verdict | waiting for the requester <!-- totalmod:verdict --> |\nend";
    expect(withVerdict(body, "approved on the preview")).toBe(
      "intro\n| Fix rounds | 1 of 3 |\n| Requester verdict | approved on the preview <!-- totalmod:verdict --> |\nend",
    );
    expect(withVerdict("no summary here", "approved")).toBe("no summary here");
  });

  it("stays fast on a body that repeats the marker", () => {
    const body = "<!-- totalmod:verdict -->".repeat(50_000);
    const started = performance.now();
    expect(withVerdict(body, "approved")).toBe(
      "| Requester verdict | approved <!-- totalmod:verdict --> |",
    );
    expect(performance.now() - started).toBeLessThan(200);
  });
});
