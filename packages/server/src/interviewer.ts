import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { type InterviewTurn, type Spec, SpecDelta, SpecDraft } from "@totalmod/core";
import { z } from "zod";

export interface InterviewInput {
  text: string;
  route: string;
  appVersion: string;
  turns: InterviewTurn[];
  /** How many more questions may be asked in total (the interview asks 4 at most). */
  questionsLeft: number;
  /** Policy problems with the previous draft; the interviewer must fix them or decline. */
  policyFeedback?: string[];
}

export interface ReviseInput {
  spec: Spec;
  /** The requester's "fix this" text, as typed. */
  feedback: string;
  /** Changes from earlier fix rounds, already applied. */
  previousChanges: string[][];
  policyFeedback?: string[];
}

export interface Interviewer {
  next(input: InterviewInput): Promise<SpecDraft>;
  /** Rewrites fix-this feedback into a short spec delta (same sanitization as the interview). */
  revise(input: ReviseInput): Promise<SpecDelta>;
}

export class InterviewerError extends Error {
  override name = "InterviewerError";
}

/**
 * What the model fills in. Flat and permissive on purpose (structured outputs support a subset
 * of JSON Schema); the strict core schemas are applied afterwards, with retries on failure.
 */
const DraftOutput = z.object({
  kind: z.enum(["questions", "spec", "declined"]),
  questions: z.array(z.object({ id: z.string(), text: z.string(), options: z.array(z.string()) })),
  spec: z
    .object({
      title: z.string(),
      userStory: z.string(),
      acceptanceCriteria: z.array(z.string()),
      uiLocation: z.string(),
      outOfScope: z.array(z.string()),
    })
    .nullable(),
  declineReason: z.string().nullable(),
});
type DraftOutput = z.infer<typeof DraftOutput>;

const DeltaOutput = z.object({
  kind: z.enum(["delta", "declined"]),
  changes: z.array(z.string()),
  declineReason: z.string().nullable(),
});
type DeltaOutput = z.infer<typeof DeltaOutput>;

export const BLOCKED_AREAS_TEXT =
  "sign-in and authentication, billing and payments, database migrations, admin or cross-user access, secrets and environment variables, CI workflows";

const prompts = {
  interviewer: readFileSync(new URL("../prompts/interviewer.md", import.meta.url), "utf8"),
  reviser: readFileSync(new URL("../prompts/reviser.md", import.meta.url), "utf8"),
};

export function systemPrompt(which: keyof typeof prompts = "interviewer"): string {
  return prompts[which].replace("{{blockedAreas}}", BLOCKED_AREAS_TEXT);
}

/** The per-turn user message. Request text is wrapped and labelled as data. */
export function renderTurn(input: InterviewInput): string {
  const answers = input.turns.flatMap((turn) =>
    turn.questions.map(
      (q) => `- ${q.text}\n  Answer: ${escapeTags(turn.answers[q.id] ?? "(no answer)")}`,
    ),
  );
  const mustFinish = input.questionsLeft <= 0;
  const rules = [
    mustFinish
      ? "No questions left: reply with a spec or declined."
      : `You may ask up to ${input.questionsLeft} more question(s), or reply with a spec or declined.`,
    ...policyRule(input.policyFeedback, "spec", "moving off-limits parts to out of scope"),
  ];
  return [
    `<request route="${escapeAttr(input.route)}" app_version="${escapeAttr(input.appVersion)}">`,
    escapeTags(input.text),
    "</request>",
    answers.length ? `<answers>\n${answers.join("\n")}\n</answers>` : "<answers>none yet</answers>",
    `<turn>\n${rules.join("\n")}\n</turn>`,
  ].join("\n");
}

/** The fix-round message: the confirmed spec, what changed already, and the new feedback. */
export function renderRevision(input: ReviseInput): string {
  const spec = input.spec;
  const previous = input.previousChanges.flatMap((round, i) =>
    round.map((change) => `- Round ${i + 1}: ${change}`),
  );
  return [
    "<spec>",
    `Title: ${spec.title}`,
    `User story: ${spec.userStory}`,
    `Acceptance criteria:\n${spec.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`,
    `Where: ${spec.uiLocation}`,
    `Out of scope:\n${spec.outOfScope.map((o) => `- ${o}`).join("\n") || "- (none)"}`,
    "</spec>",
    previous.length ? `<applied>\n${previous.join("\n")}\n</applied>` : "<applied>none</applied>",
    "<feedback>",
    escapeTags(input.feedback),
    "</feedback>",
    ...policyRule(input.policyFeedback, "changes", "dropping off-limits parts"),
  ].join("\n");
}

function policyRule(feedback: string[] | undefined, what: string, how: string): string[] {
  return feedback?.length
    ? [
        `Your previous ${what} broke these rules: ${feedback.join("; ")}. Rewrite them, ${how}, or decline.`,
      ]
    : [];
}

/** Maps model output onto the strict core schema; throws a readable error when it doesn't fit. */
export function toSpecDraft(output: DraftOutput, questionsLeft: number): SpecDraft {
  const draft =
    output.kind === "questions"
      ? {
          kind: "questions" as const,
          questions: output.questions.map((q, i) => ({
            id: q.id.trim() || `q${i + 1}`,
            text: q.text,
            options: q.options,
            allowFreeText: true,
          })),
        }
      : output.kind === "spec"
        ? { kind: "spec" as const, spec: output.spec }
        : { kind: "declined" as const, reason: output.declineReason ?? "" };
  const parsed = SpecDraft.safeParse(draft);
  if (!parsed.success) {
    throw new InterviewerError(`Draft did not match the schema: ${parsed.error.message}`);
  }
  if (parsed.data.kind === "questions") {
    if (parsed.data.questions.length > questionsLeft) {
      throw new InterviewerError(
        `Asked ${parsed.data.questions.length} questions, ${questionsLeft} allowed.`,
      );
    }
    const ids = new Set(parsed.data.questions.map((q) => q.id));
    if (ids.size !== parsed.data.questions.length)
      throw new InterviewerError("Duplicate question ids.");
  }
  return parsed.data;
}

export function toSpecDelta(output: DeltaOutput): SpecDelta {
  const parsed = SpecDelta.safeParse(
    output.kind === "delta"
      ? { kind: "delta", changes: output.changes }
      : { kind: "declined", reason: output.declineReason ?? "" },
  );
  if (!parsed.success) {
    throw new InterviewerError(`Delta did not match the schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export type ModelResult<O> =
  | { refused: true }
  /** `output` is null when the model gave nothing usable; the interviewer then retries. */
  | { refused: false; output: O | null; problem?: string };

/** One structured model call. Throw for failures a retry won't fix, like a server that's down. */
export interface ModelBackend {
  complete<O>(request: {
    system: string;
    content: string;
    schema: z.ZodType<O>;
  }): Promise<ModelResult<O>>;
}

export type InterviewerOptions = (
  | { model: string; client?: Anthropic }
  /** A model other than Claude; see local-model.ts. */
  | { backend: ModelBackend }
) & {
  /** Attempts per call when the output does not fit the schema. */
  maxAttempts?: number;
};

const REFUSED = "This is not something we can build through the request form.";

function anthropicBackend(model: string, client: Anthropic): ModelBackend {
  return {
    async complete<O>({
      system,
      content,
      schema,
    }: {
      system: string;
      content: string;
      schema: z.ZodType<O>;
    }): Promise<ModelResult<O>> {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content }],
        output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
      });
      return response.stop_reason === "refusal"
        ? { refused: true }
        : { refused: false, output: (response.parsed_output as O | null) ?? null };
    },
  };
}

export function createInterviewer(options: InterviewerOptions): Interviewer {
  const backend =
    "backend" in options
      ? options.backend
      : anthropicBackend(options.model, options.client ?? new Anthropic());
  const maxAttempts = options.maxAttempts ?? 3;

  /** One structured call with retries; a refusal maps to the caller's decline value. */
  async function ask<O, R>(
    system: string,
    content: string,
    schema: z.ZodType<O>,
    toResult: (output: O) => R,
    refused: R,
  ): Promise<R> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await backend.complete({ system, content, schema });
      if (result.refused) return refused;
      try {
        if (!result.output) throw new InterviewerError(result.problem ?? "No structured output.");
        return toResult(result.output);
      } catch (error) {
        lastError = error;
      }
    }
    throw new InterviewerError(
      `Interviewer failed after ${maxAttempts} attempts: ${(lastError as Error).message}`,
    );
  }

  return {
    next(input) {
      return ask(
        systemPrompt("interviewer"),
        renderTurn(input),
        DraftOutput,
        (o) => toSpecDraft(o, input.questionsLeft),
        { kind: "declined", reason: REFUSED },
      );
    },
    revise(input) {
      return ask(systemPrompt("reviser"), renderRevision(input), DeltaOutput, toSpecDelta, {
        kind: "declined",
        reason: REFUSED,
      });
    },
  };
}

/** Stops request text from closing our wrapper tags (`</request>` and friends). */
function escapeTags(value: string): string {
  return value.replaceAll("<", "‹").replaceAll(">", "›");
}

function escapeAttr(value: string): string {
  return value.replace(/[<>"&]/g, "");
}
