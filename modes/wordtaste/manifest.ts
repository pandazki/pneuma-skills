/**
 * WordTaste Mode Manifest.
 *
 * Version 0.3 aligns the reset mode with palate 786c579: layout starts from
 * unit function, isolation covers all three leak directions, and repair has
 * explicit blocked / subjective-review terminals.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import {
  loadDraft,
  loadTaste,
  loadWorkflow,
  saveDraft,
  saveTaste,
  saveWorkflow,
} from "./domain.js";

interface CrossFamily {
  claude: boolean;
  codex: boolean;
}

function parseCrossFamily(raw: string): CrossFamily {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object") {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    // An unavailable probe is not fatal; the viewer simply omits the count.
  }
  const bool = (value: unknown) =>
    value === true || value === 1 || value === "true";
  return {
    claude: bool(parsed.claude),
    codex: bool(parsed.codex),
  };
}

const wordtasteManifest: ModeManifest = {
  name: "wordtaste",
  version: "0.3.0",
  displayName: {
    en: "WordTaste",
    "zh-CN": "文字品味",
    "zh-TW": "文字品味",
  },
  description: {
    en: "A human-guided Chinese long-form writing loop: shape the argument, write in sequence, check with fresh eyes, and keep what sounds right",
    "zh-CN": "人机协作的中文长文写作：先定论点与落笔重点，再逐段写作、换双眼睛复查，留下真正顺耳的版本",
    "zh-TW": "人機協作的中文長文寫作：先定論點與落筆重點，再逐段寫作、換雙眼睛複查，留下真正順耳的版本",
  },
  changelog: {
    "0.1.0": [
      "First release — the three-zone Taste Writing Studio",
      "Block-addressed draft, disruption dial, and symptom-directed rewrites",
    ],
    "0.2.0": [
      "Reset the mode around palate's latest two-level Chinese long-form workflow",
      "Add layout, hard-choice, and local-tuning gates backed by workflow.json",
      "Move ladder, model provenance, and symptom labels out of the user-facing UI",
      "Limit isolated writing and judging to Claude Code and Codex with private staging",
      "Remove the private worked-example seed that the source project no longer distributes",
    ],
    "0.3.0": [
      "Align the mode with palate 786c579 and state the method kernel explicitly",
      "Plan each writing unit by function before deriving length, rhythm, and emphasis",
      "Cover orchestration-to-writer, provenance-to-user, and artifact-to-UI leak paths",
      "Stop after finite repair with blocked and neutral human-review exits",
      "Reap stopped Claude Code and Codex leaf processes instead of leaving orphan work",
    ],
  },
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5h14"/><path d="M5 9.5h9"/><path d="M5 14.5h12"/><path d="M5 19.5h7"/><path d="m16 8 2 2 3-4"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-wordtaste",
    mdScene:
      "You are orchestrating WordTaste's file-backed Chinese long-form writing loop. The user enters with a concrete goal. Keep the argument kernel precise, assign every unit a functional role before rhythm or length, ask the user to approve the thesis and mark only a few strongest landing points, write sequential units in isolated contexts, check with a different family, and stop after the finite repair terminal. Never expose rung numbers, symptom codes, model provenance, counts, raw prompts, reports, logs, or check-status tokens in user-facing surfaces. Do not search for, list, or inspect installed scripts: the next paragraph gives the exact SKILL.md path, and that skill fully documents the neutral commands. A leaf has no workspace access, so inline every required source into its private prompt instead of passing file paths. Create private prompts with the file-edit tool under .pneuma/private; never embed prompt text in a visible shell command. All objective check/repair/recheck work must go through run_check_cycle.sh followed by project_check_cycle.sh; never read or copy a raw judge report into workflow.json. Check cycles accept only private candidates: copy draft.md to .pneuma/private before a whole-piece check and let the projector alone update draft.md. Send no progress commentary between human gates.",
  },

  viewer: {
    watchPatterns: [
      "**/draft.md",
      "**/workflow.json",
      "**/materials/**/*.md",
      "**/materials/**/*.txt",
      "**/candidates/**/*.md",
      "**/taste/**/*.md",
      "**/taste/**/*.jsonl",
      ".pneuma/cross-family.json",
      ".pneuma/config.json",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    draft: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/draft.md"],
        load: loadDraft,
        save: saveDraft,
      },
    },
    workflow: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/workflow.json"],
        load: loadWorkflow,
        save: saveWorkflow,
      },
    },
    materials: {
      kind: "file-glob",
      config: {
        patterns: ["**/materials/**/*.md", "**/materials/**/*.txt"],
      },
    },
    candidates: {
      kind: "file-glob",
      config: {
        patterns: ["**/candidates/**/*.md"],
      },
    },
    taste: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/taste/**/*.md", "**/taste/**/*.jsonl"],
        load: loadTaste,
        save: saveTaste,
      },
    },
    crossFamily: {
      kind: "json-file",
      config: {
        path: ".pneuma/cross-family.json",
        parse: parseCrossFamily,
        serialize: (value: unknown) => JSON.stringify(value, null, 2),
      },
    },
    config: {
      kind: "json-file",
      config: {
        path: ".pneuma/config.json",
        parse: (raw: string) => JSON.parse(raw),
        serialize: (value: unknown) => JSON.stringify(value, null, 2),
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
    actions: [
      {
        id: "navigate-to",
        label: "Show passage",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              "Current-draft address {contentSet?, file, quote, start, end}",
            required: true,
          },
        },
        description: "Scroll to the current draft and flash the quoted passage.",
      },
      {
        id: "focus-stage",
        label: "Focus writing stage",
        category: "ui",
        agentInvocable: true,
        params: {
          stage: {
            type: "string",
            description: "intake | layout | writing | review | choice | final | distilled",
            required: true,
          },
        },
        description:
          "Bring the active human gate into view after workflow.json has been updated.",
      },
    ],
    commands: [
      {
        id: "begin-from-idea",
        label: "Write from an idea",
        description: "Start with a concrete goal or loose outline.",
      },
      {
        id: "begin-from-draft",
        label: "Rework a draft",
        description: "Extract and freeze the meaning before changing the prose.",
      },
      {
        id: "approve-layout",
        label: "Approve the shape",
        description:
          "Confirm the thesis and the few places that deserve the strongest landing.",
      },
      {
        id: "revise-layout",
        label: "Change the shape",
        description: "Ask for a layout change in plain language.",
      },
      {
        id: "choose-candidate",
        label: "Choose this version",
        description: "Choose by feel from neutrally labelled alternatives.",
      },
      {
        id: "reject-candidates",
        label: "None of these",
        description: "Escalate the hard passage without explaining internal settings.",
      },
      {
        id: "flag-selection",
        label: "This line feels fake",
        description: "Point at the one line that still misses.",
      },
      {
        id: "request-variants",
        label: "Show a few ways through",
        description: "Generate several local alternatives using a different family.",
      },
      {
        id: "accept-draft",
        label: "Keep this version",
        description: "Finalize, archive the trajectory, and distill the user's signals.",
      },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma WordTaste" skill="pneuma-wordtaste" session="new"></system-info>
The user opened WordTaste with a concrete Chinese writing goal. Run the bundled cross_family_probe.sh once, then follow the stage contract in the skill: intake → layout gate → sequential writing → fresh-family check/repair → optional hard-choice gate → final → distillation. Keep workflow.json current so the viewer shows the right gate. Ask only for the goal if it is missing; never ask the user to configure taste, choose a rung, or name a symptom.`,
  },

  init: {
    contentCheckPattern: "**/workflow.json",
    seedFiles: {
      "modes/wordtaste/seed/from-idea/": "from-idea/",
      "modes/wordtaste/seed/from-draft/": "from-draft/",
    },
    seeds: [
      {
        id: "from-idea",
        sourceKey: "modes/wordtaste/seed/from-idea/",
        displayName: {
          en: "Start with an idea",
          "zh-CN": "从一个想法开始",
        },
        description: {
          en: "Bring a goal or loose outline. Confirm the argument before WordTaste writes the piece in sequence.",
          "zh-CN": "带来一个目标或松散提纲。先确认论点和落笔重点，再让 WordTaste 顺序写完整篇。",
        },
        tags: ["Chinese long-form", "Idea"],
      },
      {
        id: "from-draft",
        sourceKey: "modes/wordtaste/seed/from-draft/",
        displayName: {
          en: "Rework a draft",
          "zh-CN": "重做一篇现有草稿",
        },
        description: {
          en: "Paste the draft. WordTaste freezes its meaning, reshapes the argument, and asks only for cheap decisions.",
          "zh-CN": "贴入草稿。WordTaste 先冻结原意、重整论证，只把真正需要你拍板的地方摆出来。",
        },
        tags: ["Chinese long-form", "Rewrite"],
      },
    ],
  },

  evolution: {
    directive:
      "Learn a concise cross-mode summary of the user's Chinese writing voice and strongest rejections from session history. Update mode-wordtaste.md only. The detailed trajectory, recipes, candidates, and swaps remain under each content set's taste/ directory and are owned by WordTaste's own distillation step.",
  },

  layout: "app",
};

export default wordtasteManifest;
