/**
 * WordTaste Mode Manifest — Taste Writing Studio.
 *
 * A human-in-the-loop, no-gradient writing studio: the agent generates +
 * orchestrates across model families (Claude / codex / gemini), the human is
 * the zero-reward-hacking discriminator. The user points at the draft (a
 * block or a span) and picks an action; the studio routes it to the
 * cross-family search loop. Direct manipulation bypasses chat — the canvas is
 * the primary surface (brief §1).
 *
 * Pure data declaration, NO React dependency — imported by both the Bun
 * backend (pneuma.ts / skill-installer) and the frontend (pneuma-mode.ts).
 * The load/save pure functions live in domain.ts (mirrors kami). Cross-family
 * generation is a per-mode SKILL capability (skill-bundled scripts the agent
 * shells out to via Bun.spawn) — NOT a new AgentBackend, invisible to the
 * server (brief §2, §7).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import {
  loadDraft,
  saveDraft,
  loadTaste,
  saveTaste,
  loadAnnotations,
  saveAnnotations,
} from "./domain.js";

/** The cross-family availability triple the probe writes and the viewer reads. */
interface CrossFamily {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

/**
 * Parse `.pneuma/cross-family.json` into a fully-normalized {claude,codex,gemini}
 * triple. Degrades GRACEFULLY: malformed or partial JSON never throws — it falls
 * back to single-family (claude-only) so the json-file source always emits a
 * value (not an E_PARSE error) and the viewer's family banner stays sane.
 *
 * Claude is the orchestrator default, so an absent/unparseable `claude` field
 * is treated as present; codex/gemini default to absent (unknown-until-probe).
 * Each field is coerced through Boolean so a probe that hand-rolls `"true"` /
 * `1` (no jq) still reads correctly.
 */
function parseCrossFamily(raw: string): CrossFamily {
  let obj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") obj = parsed as Record<string, unknown>;
  } catch {
    // Malformed JSON → single-family default below. Not an error worth surfacing.
  }
  const truthy = (v: unknown, fallback: boolean): boolean =>
    v === undefined ? fallback : v === "false" ? false : Boolean(v);
  return {
    claude: truthy(obj.claude, true),
    codex: truthy(obj.codex, false),
    gemini: truthy(obj.gemini, false),
  };
}

const wordtasteManifest: ModeManifest = {
  name: "wordtaste",
  version: "0.1.0",
  displayName: {
    en: "WordTaste",
    "zh-CN": "文字品味",
    "zh-TW": "文字品味",
  },
  description: {
    en: "Taste Writing Studio — a cross-family studio that de-AIs your prose and learns your voice as you go",
    "zh-CN": "文字品味写作工作室 —— 跨模型家族协同，去掉文字的「一眼 AI」味，并在过程中习得你的声音",
    "zh-TW": "文字品味寫作工作室 —— 跨模型家族協同，去掉文字的「一眼 AI」味，並在過程中習得你的聲音",
  },
  changelog: {
    "0.1.0": [
      "First release — the three-zone Taste Writing Studio (materials · draft · taste)",
      "Block-addressed draft with kernel-freeze, the disruption ladder, and span-select 5-direction rewrite",
      "Cross-family generation across Claude / codex / gemini, degrading gracefully to single-family",
    ],
  },
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7"/><path d="M9 11h5"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-wordtaste",
    mdScene: `You and the user are de-AI-ing prose together inside Pneuma's Taste Writing Studio. The user watches a live three-zone player — materials on the left, the editable draft in the center, the learned taste profile on the right — and points directly at the draft (a block, a span) to drive the rewrite search, bypassing chat. You are the generator + orchestrator: you reach across model families (Claude / codex / gemini) to escape any single model's RLHF attractor basin; the user is the gold-standard judge. The load-bearing kernel is frozen; only structure and texture get disrupted.`,
  },

  viewer: {
    // Patterns are `**/`-anchored so they match files inside a content-set
    // subdirectory (a writing project lives at `<project>/draft.md`,
    // `<project>/materials/…`, `<project>/taste/…` — brief §6.1), not only the
    // workspace root. Without the leading `**/`, materials and taste files in a
    // seeded content-set dir would never be watched or served to the viewer.
    watchPatterns: [
      "**/draft.md",
      "**/draft.blocks.json",
      "**/draft.freeze.json",
      // Per-block revision notes — the annotation channel (the "what I changed
      // and why" the agent keeps OUT of draft.md). The viewer renders these in
      // the block-aligned annotation column; chokidar reloads the column the
      // moment the agent writes a note.
      "**/draft.annotations.json",
      "**/materials/**/*.md",
      "**/materials/**/*.txt",
      "**/taste/**/*.md",
      "**/taste/**/*.jsonl",
      // The startup probe's output — a single root-relative file (NOT
      // content-set scoped), so the json-file crossFamily source observes it
      // and chokidar reloads the family banner the moment the probe writes.
      ".pneuma/cross-family.json",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    // The single editable output — ordered, block-addressed markdown blocks.
    // load/save reconcile stable block ids via draft.blocks.json (domain.ts).
    draft: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/draft.md", "**/draft.blocks.json", "**/draft.freeze.json"],
        load: loadDraft,
        save: saveDraft,
      },
    },
    // Read-only input files — outline / original draft / kernel statement /
    // voice anchors / reference texts. Multi-file IS the domain → file-glob.
    materials: {
      kind: "file-glob",
      config: {
        patterns: ["**/materials/**/*.md", "**/materials/**/*.txt"],
      },
    },
    // The agent-authored taste substrate. Read in the viewer; the agent owns
    // all writes via its native Edit/Write tools (saveTaste is a stub).
    taste: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/taste/**/*.md", "**/taste/**/*.jsonl"],
        load: loadTaste,
        save: saveTaste,
      },
    },
    // Per-block revision notes (the annotation channel). Read-only in the
    // viewer — the agent writes draft.annotations.json with Edit/Write
    // (saveAnnotations is a stub). The viewer aligns each note to its block by
    // the shared block id and renders the right-hand annotation column.
    annotations: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/draft.annotations.json"],
        load: loadAnnotations,
        save: saveAnnotations,
      },
    },
    // Cross-family availability, READ from the startup probe's output
    // (.pneuma/cross-family.json — written by scripts/cross_family_probe.sh).
    // A json-file source (not memory) so chokidar reloads the viewer's family
    // banner the moment the probe lands the file; the parse degrades to
    // single-family (claude-only) when the file is absent or malformed, so the
    // banner is correct from cold start onward (brief §3.2).
    crossFamily: {
      kind: "json-file",
      config: {
        path: ".pneuma/cross-family.json",
        parse: parseCrossFamily,
        serialize: (v: unknown) => JSON.stringify(v, null, 2),
      },
    },
    // Init params (active content set, default content-type). Mirrors kami.
    config: {
      kind: "json-file",
      config: {
        path: ".pneuma/config.json",
        parse: (raw: string) => JSON.parse(raw),
        serialize: (v: unknown) => JSON.stringify(v, null, 2),
      },
    },
  },

  viewerApi: {
    workspace: {
      type: "single",
      multiFile: true,
      ordered: true,
      hasActiveFile: true,
      supportsContentSets: true,
    },
    // Agent → Viewer actions — a rich direct-manipulation verb family on one
    // address noun (the draft block/span). All agent-invocable; each is also
    // triggered from a viewer gesture (brief §4.1).
    actions: [
      {
        id: "navigate-to",
        label: "Go to passage",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: { type: "object", description: "ViewerAddress { contentSet?, block, span? } to scroll to and highlight", required: true },
        },
        description: "Scroll to and highlight the addressed block, optionally selecting the span.",
      },
      {
        id: "rewrite-span",
        label: "Rewrite this",
        category: "custom",
        agentInvocable: true,
        params: {
          address: { type: "object", description: "ViewerAddress of the block/span being rewritten", required: true },
          direction: { type: "string", description: "The chosen rewrite direction (e.g. 'cut the AI metaphor', 'tighten')", required: true },
        },
        description: "Signal that the addressed block/span was rewritten in a direction; the viewer pulses the change once the draft.md edit lands.",
      },
      {
        id: "mask-and-complete",
        label: "Mask & continue",
        category: "custom",
        agentInvocable: true,
        params: {
          address: { type: "object", description: "ViewerAddress of the mask anchor", required: true },
          scope: { type: "string", description: "'region' (just the masked span) or 'after' (everything after this block)", required: true },
        },
        description: "Signal a masked region is regenerating; the viewer shows a shimmer overlay and reflows downstream non-frozen blocks when the result lands.",
      },
      {
        id: "set-block-frozen",
        label: "Freeze / unfreeze",
        category: "ui",
        agentInvocable: true,
        params: {
          block: { type: "string", description: "Block id (e.g. 'b7')", required: true },
          frozen: { type: "boolean", description: "true to freeze (kernel-lock), false to unfreeze", required: true },
        },
        description: "Toggle a block's kernel-freeze flag; frozen blocks render with a lock chrome and are excluded from rewrite scopes.",
      },
      {
        id: "poke-symptom",
        label: "Tag symptom",
        category: "custom",
        agentInvocable: true,
        params: {
          address: { type: "object", description: "ViewerAddress of the poked span", required: true },
          symptom: { type: "string", description: "Symptom id from the rubric (e.g. 'S7')", required: true },
        },
        description: "Record a symptom tag on a span; the viewer marks it and the agent runs the cross-family surgical fix.",
      },
      {
        id: "set-ladder",
        label: "Set disruption",
        category: "ui",
        agentInvocable: true,
        params: {
          rung: { type: "number", description: "Absolute disruption rung 0–5", required: false },
          delta: { type: "number", description: "Relative bump (e.g. +1) — applied when rung is absent", required: false },
        },
        description: "Set or bump the global disruption rung; the viewer updates the dial and persists to config.json. The agent re-reads on its next pass.",
      },
      {
        id: "propose-directions",
        label: "Show directions",
        category: "ui",
        agentInvocable: true,
        params: {
          address: { type: "object", description: "ViewerAddress the directions are for", required: true },
          directions: { type: "object", description: "The ~5 taste-aware rewrite directions to render as chips", required: true },
        },
        description: "Return the contextual rewrite directions for a selection; the viewer renders them as popup chips (each chip → rewrite-span).",
      },
      {
        id: "mark-resolved",
        label: "Clear symptom",
        category: "ui",
        agentInvocable: true,
        params: {
          address: { type: "object", description: "ViewerAddress whose symptom/direction marker to clear", required: true },
        },
        description: "Clear a symptom/direction marker once the user accepts a fix.",
      },
    ],
    // User → Agent commands — the chat-bypassing entry + global gestures.
    commands: [
      { id: "start-from-idea", label: "Write from this outline", description: "Entry (A): generate the first cross-family draft from the materials/outline." },
      { id: "start-from-draft", label: "De-AI this draft", description: "Entry (B): intake the disliked draft, freeze the kernel, run the first disruption pass." },
      { id: "request-directions", label: "Request directions", description: "Internal — fired by span-select; asks the agent for taste-aware rewrite directions for the selected address." },
      { id: "still-ai", label: "Still reads AI — dial up", description: "The cheapest signal: bump the ladder +1 and regenerate the whole draft one-shot." },
      { id: "good-enough", label: "This is good — finalize", description: "Trigger the finalize + distill pass." },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma WordTaste" skill="pneuma-wordtaste" session="new"></system-info>
The user opened WordTaste with a concrete writing goal, not a configuration task. First run scripts/cross_family_probe.sh to detect which model families are available (writes .pneuma/cross-family.json), then ask for their goal if it is not already given: entry A is an outline/idea to write from, entry B is a draft to de-AI. Greet in 1–2 sentences. Never frame this as taste configuration or a setup wizard — onboarding is a byproduct of "give me your writing goal."`,
  },

  init: {
    contentCheckPattern: "**/draft.md",
    seedFiles: {
      "modes/wordtaste/seed/from-idea/": "from-idea/",
      "modes/wordtaste/seed/from-draft/": "from-draft/",
      "modes/wordtaste/seed/worked-example/": "worked-example/",
    },
    seeds: [
      {
        id: "from-idea",
        sourceKey: "modes/wordtaste/seed/from-idea/",
        displayName: {
          en: "Start from an idea",
          "zh-CN": "从一个想法开始",
        },
        description: {
          en: "You have an outline but no prose. WordTaste writes the first cross-family draft, then de-AIs it with you.",
          "zh-CN": "你有提纲但没有正文。WordTaste 跨家族写出初稿，再和你一起去 AI 味。",
        },
        tags: ["Entry A", "Idea"],
      },
      {
        id: "from-draft",
        sourceKey: "modes/wordtaste/seed/from-draft/",
        displayName: {
          en: "De-AI a draft",
          "zh-CN": "改一篇「一眼 AI」的稿子",
        },
        description: {
          en: "You have prose that reads one-glance-AI. Paste it in; WordTaste freezes the kernel and runs the disruption ladder.",
          "zh-CN": "你有一篇「一眼 AI」的稿子。贴进来，WordTaste 冻结内核、跑扰动档位。",
        },
        tags: ["Entry B", "De-AI"],
      },
      {
        id: "worked-example",
        sourceKey: "modes/wordtaste/seed/worked-example/",
        displayName: {
          en: "Read a worked example",
          "zh-CN": "读一个完整范例",
        },
        description: {
          en: "A fully-converged taste profile and finalized essay — see the methodology before starting your own.",
          "zh-CN": "一份已收敛的口味画像和定稿文章 —— 先看清方法，再开始你自己的。",
        },
        tags: ["Example"],
      },
    ],
  },

  evolution: {
    directive: `Learn the user's writing voice and de-AI taste from session history. Maintain a concise, cross-mode summary of their voice signature (breathing/hedging habits, metaphor style, structural preferences) and the AI-symptoms they reject, suitable for OTHER modes to consult. Augment mode-wordtaste.md with this summary. Do NOT touch the per-content-set taste/ artifacts — those are owned by wordtaste's own distillation workflow.`,
  },

  layout: "editor",
};

export default wordtasteManifest;
