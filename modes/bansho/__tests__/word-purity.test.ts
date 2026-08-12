/**
 * Word purity (T6-review / T7-review §12.1) — ONE gate over ONE list of
 * surfaces.
 *
 * The rule: everything the agent reads about this mode is written in
 * LECTURE vocabulary. A rendering word teaches it to think about how the
 * board draws instead of about what it is explaining, and the skill's whole
 * positioning ("help me put across what I mean", not an API manual) dies
 * one leaked word at a time.
 *
 * Why this file exists at all (T7-review): the gate used to be three
 * hand-kept copies — the skill text in `skill.test.ts`, the actions and
 * commands in `interaction-surface.test.ts`, the evolution directive in
 * `registration.test.ts`. Three lists meant every one of them assumed some
 * other one covered the rest, and `agent.greeting` — the first thing the
 * agent reads in a session — was covered by none. The surface list now
 * lives beside the word list in `vocabulary.ts`, and the reference files
 * are discovered from disk rather than listed, so a new one cannot ship
 * ungreppped.
 *
 * Runtime-generated wording (findings, addresses, the viewer context) is
 * pinned where it is generated — see `board-check.test.ts`,
 * `address.test.ts`, `context.test.ts`.
 */

import { describe, expect, test } from "bun:test";

import { agentSurfaces, findBannedWord } from "./vocabulary.js";

describe("every surface the agent reads speaks lecture, not rendering", () => {
  for (const { name, text } of agentSurfaces()) {
    test(name, () => {
      const hit = findBannedWord(text);
      expect(hit && `"${hit.label}" in ${name}: ${hit.excerpt}`).toBeNull();
    });
  }

  test("the gate covers the whole delivered surface, not a sample", () => {
    const names = agentSurfaces().map((s) => s.name);
    // The four kinds that exist. A new kind of agent-read text (another
    // manifest field, another file shipped with the skill) has to be added
    // to `agentSurfaces` — this assertion is the reminder.
    expect(names).toContain("SKILL.md");
    expect(names.some((n) => n.startsWith("references/"))).toBe(true);
    expect(names).toContain("manifest.skill.mdScene");
    expect(names).toContain("manifest.agent.greeting");
    expect(names).toContain("manifest.evolution.directive");
    expect(names.filter((n) => n.startsWith("manifest.action.")).length)
      .toBeGreaterThan(0);
    expect(names.filter((n) => n.startsWith("manifest.command.")).length)
      .toBeGreaterThan(0);
    // Nothing empty: a surface that reads as "" would pass every check
    // while covering nothing.
    for (const { name, text } of agentSurfaces()) {
      expect({ name, empty: text.trim().length === 0 }).toEqual({
        name,
        empty: false,
      });
    }
  });
});
