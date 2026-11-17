import type { SpecDelta, SpecDraft } from "@totalmod/core";
import type { Telemetry } from "@totalmod/telemetry";
import type { Interviewer, InterviewInput, ReviseInput } from "../src/index.ts";

export const wordCountSpec = {
  title: "Word count under each note",
  userStory: "As a writer I want to see how many words a note has so I can keep posts short.",
  acceptanceCriteria: ["Each note in the list shows its word count", "Empty notes show 0 words"],
  uiLocation: "Notes list, below each note body",
  outOfScope: ["Character counts"],
};

export const twoQuestions: SpecDraft = {
  kind: "questions",
  questions: [
    {
      id: "where",
      text: "Where should the count appear?",
      options: ["Notes list", "Editor"],
      allowFreeText: true,
    },
    {
      id: "what",
      text: "What should it count?",
      options: ["Words", "Characters"],
      allowFreeText: true,
    },
  ],
};

/** Returns the scripted drafts (and fix-round deltas) in order, recording every input. */
export function scriptedInterviewer(
  drafts: SpecDraft[],
  deltas: SpecDelta[] = [],
): Interviewer & { inputs: InterviewInput[]; revisions: ReviseInput[] } {
  const inputs: InterviewInput[] = [];
  const revisions: ReviseInput[] = [];
  return {
    inputs,
    revisions,
    async next(input) {
      inputs.push(structuredClone(input));
      const draft = drafts.shift();
      if (!draft) throw new Error("No more scripted drafts");
      return draft;
    },
    async revise(input) {
      revisions.push(structuredClone(input));
      const delta = deltas.shift();
      if (!delta) throw new Error("No more scripted deltas");
      return delta;
    },
  };
}

/** Records GitHub calls. GETs of a pull request return a draft PR; everything else an issue. */
export function recordingFetch() {
  const calls: { method: string; url: string; init: RequestInit; body: Record<string, unknown> }[] =
    [];
  const fetch = (async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, init, body: init.body ? JSON.parse(String(init.body)) : {} });
    if (method === "GET" && /\/pulls\/\d+$/.test(url)) {
      return Response.json({ node_id: "PR_node_1", draft: true });
    }
    return Response.json({ number: 42, html_url: "https://github.com/acme/notes/issues/42" });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

/** Telemetry that records events instead of sending them. */
export function recordingTelemetry() {
  const events: { event: string; props: Record<string, number> | undefined }[] = [];
  const telemetry: Telemetry = {
    enabled: true,
    async track(event, props) {
      events.push({ event, props });
    },
  };
  return { events, telemetry };
}
