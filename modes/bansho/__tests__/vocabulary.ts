/**
 * The word ban list T6-review greps for — and the SSOT list of the
 * surfaces it is greppped over. Shared by every test that pins bansho's
 * agent- and user-facing wording.
 *
 * Not a `*.test.ts` file on purpose (Bun would collect it): it is a
 * fixture, like `backends/__tests__/lifecycle-harness.ts`.
 *
 * The rule (T6-review): the address vocabulary, the notification wording
 * and everything else the agent reads may only use LECTURE words. A
 * rendering word anywhere in them is a blocker — it teaches the agent to
 * think about how the board draws instead of about what it is explaining.
 * The first six are the exact list T6/T7-review name; the rest are the
 * rendering nouns this mode's own internals use most, which are the ones
 * that would actually leak.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import banshoManifest from "../manifest.js";

export const BANNED_WORDS = [
  "beat",
  "wipe",
  "stroke",
  "fade",
  "easing",
  "clip-path",
  // "frame" LEFT this list on 2026-08-11 (canvas pivot §3/§6). It stopped
  // being a rendering noun and became a DIALECT noun the same day `@at`
  // shipped: a region has a frame, and the product owner named the preview
  // action `frame-board` over `imagine-board` precisely because it is the
  // concrete board word. The rendering senses stay banned below.
  "revealable",
  "unit",
  "animation",
];

/**
 * The matcher for STATIC delivered text (see `agentSurfaces`). Word-bounded
 * so the dialect's own verbs survive: `@strike`, "strikethrough" and
 * "struck" are board language, "stroke" is not. The extra entries are
 * inflections the plain word list cannot express (T7-review §12.1). The
 * list is a trusted fixture, so the words go into RegExp unescaped (the one
 * hyphen is not a metacharacter).
 *
 * Runtime-generated wording (findings, addresses, the viewer context) is
 * pinned in its own suites with a plain substring check over `BANNED_WORDS`
 * — strictly stronger, and cheap there because those strings are short.
 */
export const BANNED_PATTERNS: ReadonlyArray<readonly [label: string, re: RegExp]> = [
  ...BANNED_WORDS.map(
    (word): readonly [string, RegExp] => [word, new RegExp(`\\b${word}s?\\b`, "i")],
  ),
  ["keyframe", /\bkey ?frames?\b/i],
  ["frame rate", /\bframe[- ]?rates?\b|\bfps\b/i],
  ["fade", /\bfad(?:e|es|ed|ing)\b/i],
  ["ease", /\beased?\b/i],
  ["duration", /\bdurations?\b/i],
  ["animation", /\banimat(?:e|es|ed|ing|ion|ions)\b/i],
  ["动画", /动画/],
];

/** The first banned word in `text`, with its neighbourhood — or `null`. */
export function findBannedWord(
  text: string,
): { label: string; excerpt: string } | null {
  for (const [label, re] of BANNED_PATTERNS) {
    const hit = text.match(re);
    if (hit) {
      const at = hit.index ?? 0;
      return {
        label,
        excerpt: `…${text.slice(Math.max(0, at - 40), at + 40)}…`,
      };
    }
  }
  return null;
}

// ── The surfaces ────────────────────────────────────────────────────────────

export const SKILL_DIR = join(import.meta.dir, "..", "skill");

/** Read one file under `skill/`. */
export function readSkillFile(rel: string): string {
  return readFileSync(join(SKILL_DIR, rel), "utf8");
}

/**
 * Every reference file, DISCOVERED rather than listed. A hand-kept list is
 * how a new reference file ships unchecked: it would be indexed by nobody
 * and greppped by nobody, which is the exact hole T7-review found on the
 * greeting.
 */
export function referenceFiles(): string[] {
  return readdirSync(join(SKILL_DIR, "references"))
    .filter((f) => f.endsWith(".md"))
    .sort();
}

/**
 * Everything the agent reads, in one place — the list the word-purity gate
 * walks (`word-purity.test.ts`).
 *
 * Deliberately EXCLUDED: `displayName`, `description` and `changelog`.
 * Those are the marketplace card and the update prompt — human copy, read
 * by a person deciding whether to open the mode. "Charts that draw
 * themselves stroke by stroke" is the right sentence for a human and the
 * wrong one for the agent, and conflating the two audiences is what a
 * single blanket list would do.
 */
export function agentSurfaces(): Array<{ name: string; text: string }> {
  const actions = banshoManifest.viewerApi?.actions ?? [];
  const commands = banshoManifest.viewerApi?.commands ?? [];
  return [
    { name: "SKILL.md", text: readSkillFile("SKILL.md") },
    ...referenceFiles().map((f) => ({
      name: `references/${f}`,
      text: readSkillFile(`references/${f}`),
    })),
    { name: "manifest.skill.mdScene", text: banshoManifest.skill?.mdScene ?? "" },
    // The first thing the agent ever reads in a session. It reached T7
    // review ungreppped because the two gates each assumed the other had it.
    { name: "manifest.agent.greeting", text: banshoManifest.agent?.greeting ?? "" },
    ...actions.map((action) => ({
      name: `manifest.action.${action.id}`,
      text: [
        action.id,
        action.label,
        action.description ?? "",
        ...Object.values(action.params ?? {}).map((p) => p.description ?? ""),
      ].join("\n"),
    })),
    ...commands.map((command) => ({
      name: `manifest.command.${command.id}`,
      text: [command.id, command.label, command.description ?? ""].join("\n"),
    })),
    // Read by the evolution agent, which then writes skill text the main
    // agent reads — a rendering word here leaks two hops down.
    {
      name: "manifest.evolution.directive",
      text: banshoManifest.evolution?.directive ?? "",
    },
  ];
}
