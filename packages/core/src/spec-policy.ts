import type { Spec } from "./schemas.ts";

/**
 * Areas the build agent may never work in. A spec may name them only under `outOfScope`.
 * Mirrors the always-blocked paths (auth, billing, migrations, env, CI) at the level of intent.
 */
const BLOCKED_AREAS: [area: string, pattern: RegExp][] = [
  [
    "authentication",
    /\b(auth|authenticat\w*|authoriz\w*|log ?-?in|sign ?-?in|sign ?-?up|sso|oauth|passwords?|2fa|mfa)\b/i,
  ],
  [
    "billing",
    /\b(billing|payments?|pay|invoices?|subscriptions?|checkout|coupons?|refunds?|pricing|stripe)\b/i,
  ],
  ["database migrations", /\b(migrations?|alter table|drop table|schema changes?)\b/i],
  ["admin access", /\b(admin(istrator)?s?|superusers?|all users'?|other users'?|impersonat\w*)\b/i],
  [
    "secrets",
    /\b(api ?keys?|secrets?|tokens?|credentials?|env(ironment)? var\w*|process\.env|\.env)\b/i,
  ],
  ["CI and workflows", /\b(github actions?|workflows?|\.github|ci pipeline)\b/i],
];

/** Signs that text was written to steer the agent rather than describe a feature. */
const INJECTION_MARKERS: [name: string, pattern: RegExp][] = [
  [
    "instruction override",
    /\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|prompts?|rules?|above|previous)\b/i,
  ],
  ["role play", /\b(you are now|act as|system prompt|developer mode|jailbreak)\b/i],
  ["markup", /<\/?[a-z][\w-]*[^>]*>|<!--|-->|```/i],
  ["shell command", /\b(curl|wget|bash|sh -c|rm -rf|chmod|eval|exec)\b|\|\s*(sh|bash)\b/i],
  ["external link", /https?:\/\//i],
];

export interface SpecProblem {
  field: keyof Spec;
  problem: string;
}

/**
 * Deterministic policy check on a spec, run by the server on every interviewer draft and on
 * every edit the requester makes. Policy lives here, not in the interviewer prompt.
 */
export function checkSpec(spec: Spec): SpecProblem[] {
  const fields: [keyof Spec, string][] = [
    ["title", spec.title],
    ["userStory", spec.userStory],
    ["uiLocation", spec.uiLocation],
    ...spec.acceptanceCriteria.map((c): [keyof Spec, string] => ["acceptanceCriteria", c]),
  ];
  const problems: SpecProblem[] = [];
  for (const [field, text] of fields) {
    for (const [area, pattern] of BLOCKED_AREAS) {
      if (pattern.test(text)) problems.push({ field, problem: `touches ${area}` });
    }
  }
  // Out-of-scope notes may name blocked areas, but must not smuggle instructions either.
  for (const [field, text] of [
    ...fields,
    ...spec.outOfScope.map((o): [keyof Spec, string] => ["outOfScope", o]),
  ]) {
    for (const [name, pattern] of INJECTION_MARKERS) {
      if (pattern.test(text)) problems.push({ field, problem: `contains ${name}` });
    }
  }
  return dedupe(problems);
}

/** Same policy for a fix round's changes: no blocked areas, no injected instructions. */
export function checkChanges(changes: string[]): string[] {
  const problems = new Set<string>();
  changes.forEach((change, i) => {
    for (const [area, pattern] of BLOCKED_AREAS) {
      if (pattern.test(change)) problems.add(`change ${i + 1} touches ${area}`);
    }
    for (const [name, pattern] of INJECTION_MARKERS) {
      if (pattern.test(change)) problems.add(`change ${i + 1} contains ${name}`);
    }
  });
  return [...problems];
}

/** Heuristic flags for raw request text. Logged with the request; never used to block in v0.1. */
export function screenText(text: string): string[] {
  const flags = INJECTION_MARKERS.filter(([, p]) => p.test(text)).map(([name]) => name);
  if (/[A-Za-z0-9+/]{120,}={0,2}/.test(text)) flags.push("encoded blob");
  return flags;
}

function dedupe(problems: SpecProblem[]): SpecProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = `${p.field}:${p.problem}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
