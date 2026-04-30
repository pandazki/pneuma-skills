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
  version: "0.7.2",
  displayName: "ClipCraft",
  description: "AI video production with seedance and gpt-image-2 — first-/last-frame anchoring, 3D timeline, full provenance lineage",

  supportedBackends: ["claude-code", "codex"],
  layout: "editor",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-clipcraft",
    sharedScripts: ["generate_image.mjs", "edit_image.mjs"],
    envMapping: {
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    },
    mdScene: `You and the user are producing an AI-generated video together inside Pneuma's ClipCraft workspace. The user watches an exploded 3D timeline of tracks, clips, and assets — every asset you generate and every edit you make to \`project.json\` re-hydrates the composition live, so they can hear the new TTS take or see the new shot land on the timeline as soon as it's ready. You orchestrate the work by running the bundled generation scripts and editing \`project.json\`; the viewer plays the result back as the file changes.`,
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
    greeting: `<system-info pneuma-mode="Pneuma ClipCraft Mode" skill="pneuma-clipcraft" session="new"></system-info>
The user just opened the workspace. You are ready to assist with AI-orchestrated video production — image, video, narration, BGM. Greet the user briefly (1-2 sentences) and mention they can describe a video idea, ask for another take, or use the toolbar commands to get started.`,
  },

  init: {
    contentCheckPattern: "project.json",
    seedFiles: {
      "modes/clipcraft/seed/project.json": "project.json",
      "modes/clipcraft/seed/assets/images/shot1-start.png": "assets/images/shot1-start.png",
      "modes/clipcraft/seed/assets/images/shot2-start.png": "assets/images/shot2-start.png",
      "modes/clipcraft/seed/assets/images/shot2-end.png": "assets/images/shot2-end.png",
      "modes/clipcraft/seed/assets/images/shot3-end.png": "assets/images/shot3-end.png",
      "modes/clipcraft/seed/assets/clips/shot1-spark.mp4": "assets/clips/shot1-spark.mp4",
      "modes/clipcraft/seed/assets/clips/shot2-convergence.mp4": "assets/clips/shot2-convergence.mp4",
      "modes/clipcraft/seed/assets/clips/shot3-resolution.mp4": "assets/clips/shot3-resolution.mp4",
      "modes/clipcraft/seed/assets/audio/vo-tagline.mp3": "assets/audio/vo-tagline.mp3",
      "modes/clipcraft/seed/assets/bgm/pneuma-ambient.mp3": "assets/bgm/pneuma-ambient.mp3",
      "modes/clipcraft/seed/assets/brand/pneuma-logo.png": "assets/brand/pneuma-logo.png",
    },
    params: [
      {
        name: "openrouterApiKey",
        label: "OpenRouter API Key",
        description: "for BGM generation via google/lyria-3-pro-preview",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "falApiKey",
        label: "fal.ai API Key",
        description: "for image (GPT-Image-2), video (seedance 2.0), and TTS",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
    ],
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
