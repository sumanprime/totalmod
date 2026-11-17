// Runs the interviewer on a model on this machine, for trying totalmod without an Anthropic key.
// Ollama and LM Studio both serve the OpenAI chat completions API, so one backend covers both.
import { z } from "zod";
import { InterviewerError, type ModelBackend, type ModelResult } from "./interviewer.ts";

const PROVIDERS = {
  ollama: { label: "Ollama", url: "http://127.0.0.1:11434/v1", listModels: "ollama list" },
  lmstudio: { label: "LM Studio", url: "http://127.0.0.1:1234/v1", listModels: "lms ls" },
};
export type LocalProvider = keyof typeof PROVIDERS;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface LocalBackendOptions {
  provider: LocalProvider;
  model: string;
  /** Must point at this machine. Defaults to the provider's usual address. */
  url?: string;
  fetch?: typeof fetch;
  /** Local models can take minutes, the first call especially, while the model loads. */
  timeoutMs?: number;
}

export function createLocalBackend(options: LocalBackendOptions): ModelBackend {
  const { label, url: defaultUrl } = PROVIDERS[options.provider];
  const url = (options.url || defaultUrl).replace(/\/$/, "");
  assertLoopback(url);
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 300_000;

  return {
    async complete<O>(request: {
      system: string;
      content: string;
      schema: z.ZodType<O>;
    }): Promise<ModelResult<O>> {
      let response: Response;
      try {
        response = await send(`${url}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model: options.model,
            // Higher than the Anthropic call's: a thinking model's reasoning counts towards it.
            max_tokens: 8000,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.content },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "totalmod_output",
                strict: true,
                schema: z.toJSONSchema(request.schema),
              },
            },
          }),
        });
      } catch (error) {
        throw new InterviewerError(
          `Can't reach ${label} at ${url}. Is it running? (${(error as Error).message})`,
        );
      }
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        throw new InterviewerError(
          `${label} answered ${response.status} for model "${options.model}": ${detail}`,
        );
      }
      return parseCompletion(await response.json(), request.schema);
    },
  };
}

/** The backend `TOTALMOD_LLM` asks for, or null to use Anthropic. */
export function localBackendFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): ModelBackend | null {
  const provider = env.TOTALMOD_LLM;
  if (!provider) return null;
  if (!Object.hasOwn(PROVIDERS, provider)) {
    throw new InterviewerError(
      `TOTALMOD_LLM must be one of ${Object.keys(PROVIDERS).join(", ")}, got "${provider}".`,
    );
  }
  const name = provider as LocalProvider;
  if (!env.TOTALMOD_MODEL) {
    throw new InterviewerError(
      `TOTALMOD_LLM=${name} needs TOTALMOD_MODEL. \`${PROVIDERS[name].listModels}\` shows your models.`,
    );
  }
  return createLocalBackend({
    provider: name,
    model: env.TOTALMOD_MODEL,
    ...(env.TOTALMOD_LLM_URL ? { url: env.TOTALMOD_LLM_URL } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

/**
 * Request text must not leave the machine through this path, and a deployed app can't reach a
 * model on localhost, so a stray TOTALMOD_LLM in production fails instead of using a weak model.
 */
function assertLoopback(url: string): void {
  let hostname: string | undefined;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Reported below.
  }
  if (!hostname || !LOOPBACK.has(hostname)) {
    throw new InterviewerError(`TOTALMOD_LLM_URL must point at this machine, got "${url}".`);
  }
}

const Completion = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
});

function parseCompletion<O>(body: unknown, schema: z.ZodType<O>): ModelResult<O> {
  const completion = Completion.safeParse(body);
  if (!completion.success) return noOutput("The response had no choices.");
  const [choice] = completion.data.choices;
  if (choice?.finish_reason === "length") return noOutput("The model ran out of tokens.");

  let json: unknown;
  try {
    json = JSON.parse(extractJson(choice?.message.content ?? ""));
  } catch {
    return noOutput("The model did not reply with JSON.");
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { refused: false, output: parsed.data }
    : noOutput(`The reply did not match the schema: ${parsed.error.message}`);
}

/** Some models wrap their JSON in `<think>` blocks or code fences, despite the response format. */
function extractJson(content: string): string {
  const text = content.replace(/<think>[\s\S]*?<\/think>/g, "");
  return text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
}

function noOutput(problem: string): ModelResult<never> {
  return { refused: false, output: null, problem };
}
