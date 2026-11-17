import { describe, expect, it } from "vitest";
import {
  createInterviewer,
  createLocalBackend,
  InterviewerError,
  localBackendFromEnv,
} from "../src/index.ts";
import { wordCountSpec } from "./fakes.ts";

const input = {
  text: "word counts please",
  route: "/notes",
  appVersion: "1.4.0",
  turns: [],
  questionsLeft: 4,
};
const specOutput = { kind: "spec", questions: [], spec: wordCountSpec, declineReason: null };

const reply = (content: string | null, finish_reason = "stop") =>
  Response.json({ choices: [{ message: { content }, finish_reason }] });

/** Answers each call with the next scripted response, or throws a scripted error. */
function fakeFetch(responses: (Response | Error)[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error("No more scripted responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function interviewer(responses: (Response | Error)[], provider: "ollama" | "lmstudio" = "ollama") {
  const { fetchImpl, calls } = fakeFetch(responses);
  const backend = createLocalBackend({ provider, model: "qwen", fetch: fetchImpl });
  return { ai: createInterviewer({ backend }), calls };
}

describe("createLocalBackend", () => {
  it.each([
    ["ollama", "http://127.0.0.1:11434/v1/chat/completions"],
    ["lmstudio", "http://127.0.0.1:1234/v1/chat/completions"],
  ] as const)("sends %s the prompt and a JSON schema", async (provider, url) => {
    const { ai, calls } = interviewer([reply(JSON.stringify(specOutput))], provider);
    await expect(ai.next(input)).resolves.toEqual({ kind: "spec", spec: wordCountSpec });
    expect(calls[0]?.url).toBe(url);
    const body = calls[0]?.body as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: { type: string; json_schema: { schema: { required: string[] } } };
    };
    expect(body.model).toBe("qwen");
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.messages[1]?.content).toContain("word counts please");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.schema.required).toContain("kind");
  });

  it("finds the JSON inside think blocks and code fences", async () => {
    const wrapped = `<think>{"not": "this"}</think>\n\`\`\`json\n${JSON.stringify(specOutput)}\n\`\`\``;
    const { ai } = interviewer([reply(wrapped)]);
    await expect(ai.next(input)).resolves.toEqual({ kind: "spec", spec: wordCountSpec });
  });

  it("retries bad output, then fails with the reason", async () => {
    const { ai, calls } = interviewer([
      reply("sorry, no JSON here"),
      reply(JSON.stringify({ kind: "maybe" })),
      reply(JSON.stringify(specOutput), "length"),
    ]);
    await expect(ai.next(input)).rejects.toThrow(/after 3 attempts: The model ran out of tokens/);
    expect(calls).toHaveLength(3);
  });

  it("recovers when a retry succeeds", async () => {
    const { ai, calls } = interviewer([reply(null), reply(JSON.stringify(specOutput))]);
    await expect(ai.next(input)).resolves.toEqual({ kind: "spec", spec: wordCountSpec });
    expect(calls).toHaveLength(2);
  });

  it("says what to check when the server is down, without retrying", async () => {
    const { ai, calls } = interviewer([new Error("fetch failed")]);
    await expect(ai.next(input)).rejects.toThrow(
      /Can't reach Ollama at http:\/\/127.0.0.1:11434\/v1. Is it running\?/,
    );
    expect(calls).toHaveLength(1);
  });

  it("reports a missing model", async () => {
    const { ai } = interviewer([Response.json({ error: "model not found" }, { status: 404 })]);
    await expect(ai.next(input)).rejects.toThrow(/Ollama answered 404 for model "qwen"/);
  });

  it.each([
    "https://models.example.com/v1",
    "http://192.168.1.20:11434/v1",
    "http://localhost.example.com/v1",
    "not a url",
  ])("refuses %s, because request text must stay on this machine", (url) => {
    expect(() => createLocalBackend({ provider: "ollama", model: "qwen", url })).toThrow(
      /must point at this machine/,
    );
  });

  it.each(["http://localhost:8080/v1", "http://127.0.0.1:8080/v1/", "http://[::1]:8080/v1"])(
    "accepts %s",
    (url) => {
      expect(() => createLocalBackend({ provider: "ollama", model: "qwen", url })).not.toThrow();
    },
  );
});

describe("localBackendFromEnv", () => {
  it("is off unless TOTALMOD_LLM is set", () => {
    expect(localBackendFromEnv({})).toBeNull();
    expect(localBackendFromEnv({ TOTALMOD_LLM: "", TOTALMOD_MODEL: "qwen" })).toBeNull();
  });

  it("names the choices for an unknown provider", () => {
    expect(() => localBackendFromEnv({ TOTALMOD_LLM: "toString" })).toThrow(InterviewerError);
    expect(() => localBackendFromEnv({ TOTALMOD_LLM: "llama" })).toThrow(
      'TOTALMOD_LLM must be one of ollama, lmstudio, got "llama".',
    );
  });

  it("says how to find a model name when TOTALMOD_MODEL is missing", () => {
    expect(() => localBackendFromEnv({ TOTALMOD_LLM: "ollama" })).toThrow(/`ollama list`/);
    expect(() => localBackendFromEnv({ TOTALMOD_LLM: "lmstudio" })).toThrow(/`lms ls`/);
  });

  it("uses TOTALMOD_LLM_URL and TOTALMOD_MODEL", async () => {
    const { fetchImpl, calls } = fakeFetch([reply(JSON.stringify(specOutput))]);
    const backend = localBackendFromEnv(
      {
        TOTALMOD_LLM: "lmstudio",
        TOTALMOD_MODEL: "qwen",
        TOTALMOD_LLM_URL: "http://localhost:9/v1",
      },
      fetchImpl,
    );
    if (!backend) throw new Error("expected a backend");
    await createInterviewer({ backend }).next(input);
    expect(calls[0]?.url).toBe("http://localhost:9/v1/chat/completions");
    expect(calls[0]?.body.model).toBe("qwen");
  });
});
