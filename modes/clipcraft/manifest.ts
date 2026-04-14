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
  version: "0.1.0-bootstrap",
  displayName: "ClipCraft",
  description: "AI-orchestrated video production, rebuilt on @pneuma-craft",

  supportedBackends: ["claude-code"],
  layout: "editor",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-clipcraft",
    claudeMdSection: `## Pneuma ClipCraft Mode

You are running inside **Pneuma**, a co-creation workspace. This is **ClipCraft Mode** — AI-orchestrated video production on \`@pneuma-craft\`.

Your domain knowledge lives in the \`pneuma-clipcraft\` skill. Read \`.claude/skills/pneuma-clipcraft/SKILL.md\` at session start; reference \`references/project-json.md\` when editing \`project.json\`, \`references/workflows.md\` when the user asks for a generation task, and the \`scripts/\` directory for the four bundled generator CLIs (image / video / TTS / BGM).`,
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
