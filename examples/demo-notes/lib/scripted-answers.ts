// The interviewer's scripted answers, shared by the e2e stand-in (e2e/mock-apis.ts) and the hosted
// demo (lib/scripted-demo.ts). Every request becomes the same word-count feature.

/** The reviser's answer to "fix this": one rewritten change, never the raw feedback. */
export const delta = {
  kind: "delta",
  changes: ["Show the word count in a smaller, lighter grey font"],
  declineReason: null,
};

export const questions = {
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
export function spec(nonce: string) {
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

/** The answer to one interviewer turn: questions first, then the spec, or a fix round's delta. */
export function scriptedAnswer(turn: string): unknown {
  if (turn.includes("<feedback>")) return delta;
  if (turn.includes("<answers>none yet</answers>")) return questions;
  return spec(turn.match(/nonce-[a-z0-9]+/)?.[0] ?? "");
}
