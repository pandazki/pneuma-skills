/**
 * ClipCraft Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const clipcraftManifest: ModeManifest = {
  name: "clipcraft-legacy",
  version: "0.1.0",
  displayName: "ClipCraft (Legacy)",
  description: "AI-orchestrated video production — describe your vision, generate clips, assemble on a timeline",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/><line x1="2" y1="14" x2="22" y2="14" opacity="0.3"/></svg>`,
  inspiredBy: {
    name: "medeo.app",
    url: "https://medeo.app",
  },
  layout: "editor",
  supportedBackends: ["claude-code"],

  skill: {
    sourceDir: "skill",
    installName: "pneuma-clipcraft-legacy",
    claudeMdSection: `## Pneuma ClipCraft Mode

You are running inside **Pneuma**, a co-creation workspace where you and the user produce videos together — you orchestrate AI generation, the user sees results in a live storyboard viewer.

This is **ClipCraft Mode**: AI-orchestrated video production with storyboard-based workflow.

For the full workflow, storyboard protocol, scene generation patterns, and error recovery strategies, consult the \`pneuma-clipcraft-legacy\` skill. Read it before your first generation in a new conversation.

### Architecture
- \`project.json\` — Project metadata (title, aspect ratio, resolution, style)
- \`storyboard.json\` — Scene sequence (the source of truth)
- \`assets/\` — Generated assets organized by type (reference/, images/, clips/, audio/, bgm/)

### Core Rules
- Always update \`storyboard.json\` after generating — write placeholder with \`"status": "generating"\` first, then update when done
- Each scene has typed slots: \`visual\` (image/video), \`audio\` (TTS), \`caption\` (text), \`transition\`
- Use \`characterRefs\` to maintain character consistency across scenes
- When user asks to change one scene, only regenerate that scene's slot — don't rebuild the whole storyboard
- Do not ask for confirmation on simple generations — just do them
- Default aspect ratio: {{aspectRatio}}

### Storyboard Protocol
1. Read current \`storyboard.json\`
2. Add/update scene with \`status: "generating"\` (viewer shows spinner)
3. Call MCP tool to generate asset
4. On success: update \`status: "ready"\` + \`source\` path + \`thumbnail\`
5. On failure: update \`status: "error"\` + \`errorMessage\`, attempt fallback strategy

### Available MCP Tools
{{#imageGenEnabled}}
- **clipcraft-imagegen**: \`generate_image\`, \`edit_image\` — Image generation via {{imageProvider}}
{{/imageGenEnabled}}
{{#videoGenEnabled}}
- **clipcraft-videogen**: \`generate_video_from_text\`, \`generate_video_from_image\` — Video generation via {{videoProvider}}
{{/videoGenEnabled}}
{{#ttsEnabled}}
- **clipcraft-tts**: \`generate_speech\`, \`list_voices\` — Text-to-speech via OpenRouter gpt-audio
{{/ttsEnabled}}
{{#bgmEnabled}}
- **clipcraft-bgm**: \`generate_music\`, \`generate_music_clip\` — Background music generation via Google Lyria 3
{{/bgmEnabled}}

### Viewer Capabilities
The viewer provides these agent-callable actions:
- \`play-preview\` — Start playback
- \`pause-preview\` — Pause playback
- \`select-scene\` — Navigate to a specific scene (\`params: { sceneId: string }\`)
- \`set-aspect-ratio\` — Change aspect ratio (\`params: { ratio: string }\`)

### Constraints
- Do not modify \`.claude/\`, \`.pneuma/\`, or \`node_modules/\`
- Save all generated assets under \`assets/\` with descriptive filenames
- Keep \`storyboard.json\` as the single source of truth
- Scene IDs must be stable (format: \`scene-NNN\`)`,
    envMapping: {
      IMAGE_PROVIDER: "imageProvider",
      IMAGE_API_KEY: "imageApiKey",
      VIDEO_PROVIDER: "videoProvider",
      VIDEO_API_KEY: "videoApiKey",
      TTS_PROVIDER: "ttsProvider",
      TTS_API_KEY: "ttsApiKey",
      BGM_PROVIDER: "bgmProvider",
      BGM_API_KEY: "bgmApiKey",
    },
    mcpServers: [
      {
        name: "clipcraft-imagegen",
        command: "node",
        args: ["scripts/clipcraft-imagegen.mjs"],
        env: {
          PROVIDER: "{{imageProvider}}",
          API_KEY: "{{imageApiKey}}",
        },
      },
      {
        name: "clipcraft-videogen",
        command: "node",
        args: ["scripts/clipcraft-videogen.mjs"],
        env: {
          PROVIDER: "{{videoProvider}}",
          API_KEY: "{{videoApiKey}}",
        },
      },
      {
        name: "clipcraft-tts",
        command: "node",
        args: ["scripts/clipcraft-tts.mjs"],
        env: {
          PROVIDER: "{{ttsProvider}}",
          API_KEY: "{{ttsApiKey}}",
        },
      },
      {
        name: "clipcraft-bgm",
        command: "node",
        args: ["scripts/clipcraft-bgm.mjs"],
        env: {
          PROVIDER: "{{bgmProvider}}",
          API_KEY: "{{bgmApiKey}}",
        },
      },
    ],
  },

  viewer: {
    watchPatterns: [
      "project.json",
      "storyboard.json",
      "graph.json",
      "assets/**/*",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
      "export/**",
      "scripts/**",
    ],
    serveDir: ".",
    refreshStrategy: "manual",
  },

  viewerApi: {
    workspace: {
      type: "single",
      multiFile: true,
      ordered: true,
      hasActiveFile: false,
    },
    actions: [
      {
        id: "play-preview",
        label: "Play",
        category: "ui",
        agentInvocable: true,
        description: "Start video preview playback",
      },
      {
        id: "pause-preview",
        label: "Pause",
        category: "ui",
        agentInvocable: true,
        description: "Pause video preview playback",
      },
      {
        id: "select-scene",
        label: "Select Scene",
        category: "navigate",
        agentInvocable: true,
        params: {
          sceneId: { type: "string", description: "Scene ID to select", required: true },
        },
        description: "Navigate to and select a specific scene",
      },
      {
        id: "set-aspect-ratio",
        label: "Set Aspect Ratio",
        category: "ui",
        agentInvocable: true,
        params: {
          ratio: { type: "string", description: "Aspect ratio: 16:9, 9:16, or 1:1", required: true },
        },
        description: "Change the preview aspect ratio",
      },
    ],
    commands: [
      { id: "generate-script", label: "Generate Script", description: "Write narration and captions for all scenes based on the video concept" },
      { id: "use-reference", label: "Use as Reference", description: "Register uploaded assets as character references for consistent generation" },
      { id: "regenerate-scene", label: "Regenerate Scene", description: "Regenerate the selected scene's visual" },
      { id: "add-scene-after", label: "Add Scene After", description: "Insert a new scene after the selected one" },
      { id: "remove-scene", label: "Remove Scene", description: "Delete the selected scene" },
      { id: "generate-captions", label: "Generate Captions", description: "Auto-generate captions for scenes that don't have them" },
    ],
    locatorDescription: 'Navigate to scene: data=\'{"scene":"scene-001"}\'. Auto-play from scene: data=\'{"scene":"scene-001","autoplay":true}\'.',
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="ClipCraft" backend="claude-code">New ClipCraft session started. The viewer is ready — describe your video idea and I'll orchestrate the production pipeline.</system-info>`,
  },

  init: {
    contentCheckPattern: "storyboard.json",
    seedFiles: {
      "modes/clipcraft-legacy/seed/default/": "./",
    },
    params: [
      { name: "aspectRatio", label: "Default aspect ratio", description: "16:9, 9:16, or 1:1", type: "string", defaultValue: "16:9" },
      { name: "falApiKey", label: "fal.ai API key (images + video)", type: "string", defaultValue: "", sensitive: true },
      { name: "openrouterApiKey", label: "OpenRouter API key (TTS + BGM)", type: "string", defaultValue: "", sensitive: true },
    ],
    deriveParams: (params: Record<string, number | string>) => ({
      ...params,
      // Derive provider selections from available keys
      imageProvider: params.falApiKey ? "fal" : "",
      imageApiKey: params.falApiKey as string,
      videoProvider: params.falApiKey ? "fal" : "",
      videoApiKey: params.falApiKey as string,
      ttsProvider: params.openrouterApiKey ? "openrouter" : "",
      ttsApiKey: params.openrouterApiKey as string,
      bgmProvider: params.openrouterApiKey ? "openrouter" : "",
      bgmApiKey: params.openrouterApiKey as string,
      // Feature flags
      imageGenEnabled: params.falApiKey ? "true" : "",
      videoGenEnabled: params.falApiKey ? "true" : "",
      ttsEnabled: params.openrouterApiKey ? "true" : "",
      bgmEnabled: params.openrouterApiKey ? "true" : "",
    }),
  },

  evolution: {
    directive:
      "Extract the user's video style preferences: pacing, shot composition, color grading, music taste, narration style, transition preferences, aspect ratio patterns, and content themes.",
  },
};

export default clipcraftManifest;
