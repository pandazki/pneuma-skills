/**
 * ClipCraft Mode Manifest.
 * Declares the skill, viewer, sources, init params, and the user → agent
 * commands surfaced in the viewer toolbar.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import {
  parseProjectFile,
  formatProjectJson,
  type ProjectFile,
} from "./persistence.js";

const clipcraftManifest: ModeManifest = {
  name: "clipcraft",
  version: "0.6.0",
  displayName: "ClipCraft",
  description: "AI-orchestrated video production, rebuilt on @pneuma-craft",

  supportedBackends: ["claude-code"],
  layout: "editor",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-clipcraft",
    sharedScripts: ["generate_image.mjs", "edit_image.mjs"],
    claudeMdSection: `## Pneuma ClipCraft Mode

You are running inside **Pneuma**, a co-creation workspace. This is **ClipCraft Mode** — AI-orchestrated video production on \`@pneuma-craft\`.

Your domain knowledge lives in the \`pneuma-clipcraft\` skill. Read \`.claude/skills/pneuma-clipcraft/SKILL.md\` at session start; reference \`references/craft.md\` before creative decisions, \`references/project-json.md\` when editing \`project.json\`, \`references/workflows.md\` when the user asks for a generation task, \`references/reference-directives.md\` for the seedance multi-reference directive language, \`references/character-consistency.md\` when a specific human character appears, and \`references/filter-retries.md\` when seedance rejects with a 422.

The \`scripts/\` directory holds six generator CLIs: \`generate_image.mjs\` (shared, GPT-Image-2 default — legible text, multi-layer composition, complex UI mockups, precise mask edits); \`edit_image.mjs\` (shared, Gemini vision for annotation-driven edits); \`generate-video.mjs\` (seedance 2.0 with veo3.1 fallback); \`generate-tts.mjs\`; \`generate-bgm.mjs\`; \`make-character-sheet.mjs\` (recovery tool for the image-side content filter). GPT-Image-2's strength at rendering text, preserving layout across multiple references, and holding an aesthetic direction makes the video-side pipeline much more controlled — first/last frames, title cards, text overlays, character sheets, and complex single-frame compositions all hold up now in ways that used to require heavy post-processing.`,
  },

  viewer: {
    watchPatterns: ["project.json"],
    ignorePatterns: [],
    serveDir: ".",
    refreshStrategy: "auto",
  },

  viewerApi: {
    commands: [
      {
        id: "generate-image",
        label: "Generate image",
        description:
          "Generate a new image asset for the current selection. The user may have a clip selected or be working in a scene — read the viewer context to figure out what they want.",
      },
      {
        id: "generate-video",
        label: "Generate video",
        description:
          "Generate a new video clip. veo3.1 is expensive — ask for confirmation if the request is vague.",
      },
      {
        id: "regenerate-variant",
        label: "Try another take",
        description:
          "The user wants a variant of the currently selected clip's asset. Look up the existing provenance, generate a sibling with small prompt tweaks, and register it as a derived asset so the variant switcher shows both options.",
      },
      {
        id: "add-narration",
        label: "Add narration",
        description:
          "Generate TTS narration for the currently selected subtitle clip (or the whole caption track if nothing specific is selected). Match the audio clip timing to the subtitle clip timing.",
      },
      {
        id: "add-bgm",
        label: "Add BGM",
        description:
          "Add background music. Ask the user for a mood/style if they haven't said. Generate, register, and add as a clip on a new or existing audio track.",
      },
      {
        id: "export-video",
        label: "Export video",
        description:
          "Export the project as an MP4. Handled directly in the viewer — clicking this button runs @pneuma-craft/video's ExportEngine against the live composition and downloads the finished file. No agent involvement.",
      },
    ],
    locatorDescription:
      'After creating or editing assets, clips, or moving the playhead, embed <viewer-locator> cards so the user can jump straight to the change. Emit one card per distinct thing you changed (a newly generated asset, a clip you just placed, a time beat you built around) — not one per response. Data shapes: navigate to an asset in the library via `data=\'{"assetId":"asset-<semantic-id>"}\'`; navigate to a clip on the timeline (auto-selects the clip and seeks the playhead to its start) via `data=\'{"clipId":"clip-<semantic-id>"}\'`; seek the playhead to a time in seconds via `data=\'{"time":3.5}\'`; focus a track via `data=\'{"trackId":"track-<semantic-id>"}\'`. Use short concrete labels like "新的 VO 开场" or "panda clip on Main" — the user will see these cards in chat and click to navigate.',
  },

  agent: {
    permissionMode: "bypassPermissions",
  },

  init: {
    contentCheckPattern: "project.json",
    seedFiles: {
      "modes/clipcraft/seed/project.json": "project.json",
      "modes/clipcraft/seed/assets/clips/panda-sad-v1.mp4": "assets/clips/panda-sad-v1.mp4",
      "modes/clipcraft/seed/assets/clips/panda-sad-v2.mp4": "assets/clips/panda-sad-v2.mp4",
      "modes/clipcraft/seed/assets/clips/panda-bamboo.mp4": "assets/clips/panda-bamboo.mp4",
      "modes/clipcraft/seed/assets/bgm/token-meme.mp3": "assets/bgm/token-meme.mp3",
    },
  },

  sources: {
    project: {
      kind: "json-file",
      config: {
        path: "project.json",
        parse: (raw: string): ProjectFile => {
          const result = parseProjectFile(raw);
          if (!result.ok) throw new Error(result.error);
          return result.value;
        },
        serialize: (value: ProjectFile): string => formatProjectJson(value),
      },
    },
  },
};

export default clipcraftManifest;
