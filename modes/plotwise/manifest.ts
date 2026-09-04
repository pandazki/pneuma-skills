/**
 * Plotwise Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 *
 * Plotwise is a custom-tailored interactive learning-video mode: the agent
 * plans a grounded course outline and a screenplay — one scene per beat,
 * each a run of chained 5-15 s narrated shots — and a play-manager
 * process shoots it ahead of the learner with MiniMax H3 Max on fal.ai;
 * at the end of each scene the learner picks the next development like a
 * visual novel. Every knowledge visual is anchored by code-rendered
 * reference figures and cited evidence — the video model is never allowed
 * to imagine facts.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { load, save } from "./domain.js";

const plotwiseManifest: ModeManifest = {
  name: "plotwise",
  version: "0.5.0",
  displayName: {
    en: "Plotwise",
    "zh-CN": "Plotwise",
    ja: "Plotwise",
  },
  description: {
    en: "A learning studio that shoots your custom course — pick each plot turn like a visual novel, every fact grounded and verified",
    "zh-CN": "量身定制的学习片场——像玩剧情游戏一样选择走向,每个知识点都有据可查",
    ja: "あなた専用の学習スタジオ——ビジュアルノベルのように展開を選び、すべての知識に裏付けを",
  },
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h5"/><path d="M8 12c3.5 0 3.5-5 7-5h3"/><path d="M8 12c3.5 0 3.5 5 7 5h3"/><circle cx="3" cy="12" r="1.2" fill="currentColor"/><path d="m19 5 2 2-2 2"/><path d="m19 15 2 2-2 2"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-plotwise",
    mdScene: `You and the user are inside a learning studio. The user names something they want to learn; you plan a grounded master outline while they settle the visual style on the viewer's style board — a preset, your recommendation, or their own description — by confirming a 5-second sample you shoot in that style. Then the course is written as a screenplay — one scene per outline beat, each a run of 1-6 chained 5-15 second narrated shots, as long as the content needs — and a play-manager process shoots it ahead of the learner with MiniMax H3 Max on fal.ai, pruning what they do not choose. At the end of each scene the user picks the next development like a visual novel — continue, take the one detour offered, or ask a question. During play you do nothing except answer questions and restart the manager if it dies. Every knowledge visual is anchored by code-rendered figures and cited evidence; the viewer renders the course as a stage while learning and as an infinite-canvas course map afterwards.`,
    envMapping: {
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    },
    sharedScripts: [
      "generate-video.mjs",
      // generate-video.mjs imports it: the installer copies only what is listed here.
      "fal-queue.mjs",
      "transcribe.mjs",
      "generate_image.mjs",
      "generate-tts.mjs",
    ],
  },

  viewer: {
    // Only what the viewer reads as text. The workspace snapshot the
    // browser loads (/api/files) carries every watched file's content —
    // with "**/nodes/**/*" a 15-scene course became a 1.2 GB snapshot of
    // base64 video and froze the tab (both blind trials, 2026-09-03).
    // Clips and figures reach the viewer through /content/* on demand;
    // course.json is the signal that one has landed.
    watchPatterns: [
      "**/course.json",
      "**/nodes/*/script.md",
      "**/nodes/*/evidence.json",
      "**/summary.md",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    course: {
      kind: "aggregate-file",
      config: {
        patterns: [
          "**/course.json",
          "**/nodes/*/script.md",
          "**/nodes/*/evidence.json",
        ],
        load,
        save,
      },
    },
    // Raw file view for evidence documents (verification notes, summary)
    // the panel renders as text. Binary assets (video.mp4, figures) reach
    // the viewer via /content/* paths, never through a Source.
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "**/course.json",
          "**/nodes/*/*.md",
          "**/nodes/*/*.json",
          "**/summary.md",
        ],
      },
    },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Plotwise Mode" skill="pneuma-plotwise" session="new"></system-info>
The user just opened the learning studio. Greet them briefly (1-2 sentences) and ask what they would like to learn — a topic, a question, or a link to an article.`,
  },

  viewerApi: {
    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
      manifestFile: "course.json",
      supportsContentSets: true,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Go to Scene",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              'ViewerAddress of the target scene, e.g. `{ "node": "n3" }` (optionally with `t` seconds into the clip)',
            required: true,
          },
        },
        description:
          "Focus the viewer on a specific scene — the stage jumps to that node's clip; the canvas view centers on it. Only when the user asks to jump somewhere; never while they are watching.",
      },
      {
        id: "open-references",
        label: "Show Evidence",
        category: "ui",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              'ViewerAddress of the scene whose evidence panel to open, e.g. `{ "node": "n3" }`',
            required: true,
          },
        },
        description:
          "Open the evidence panel for a scene — citations, code verifications, and rendered reference figures bound to that clip.",
      },
    ],
  },

  init: {
    contentCheckPattern: "**/course.json",
    seedFiles: {
      "modes/plotwise/seed/pythagorean/": "pythagorean/",
    },
    seeds: [
      {
        id: "pythagorean",
        sourceKey: "modes/plotwise/seed/pythagorean/",
        displayName: {
          en: "Pythagorean theorem · sample course",
          "zh-CN": "勾股定理 · 示例课程",
        },
        description: {
          en: "A finished mini-course to explore: a branching tree on the canvas, playable narrated scenes, and evidence pinned to every one.",
          "zh-CN": "一门已经学完的迷你课:画布上的分支树、可播放的口播场景、每一场都挂着参考依据。",
        },
        tags: ["Sample", "中文"],
      },
    ],
    params: [
      {
        name: "perceivedDuration",
        label: "Course depth",
        description:
          "How thorough the course feels — drives outline size and scene length, not just total video minutes",
        type: "select",
        options: [
          { value: "light", label: "Light (~10 min)", description: "A quick tour: 4-6 main beats, short scenes" },
          { value: "standard", label: "Standard", description: "A solid pass: 6-10 beats with room for branches" },
          { value: "deep", label: "Deep dive", description: "Thorough: 10+ beats, worked examples, side quests expected" },
        ],
        defaultValue: "standard",
      },
      // Visual style is not an init param: the learner settles it on the
      // viewer's style board (preset / recommendation / own description)
      // by confirming a sample the director shoots — see SKILL.md.
      {
        name: "lookahead",
        label: "Scenes shot ahead",
        description: "How many main-line scenes the play manager keeps shot ahead of you — more is smoother and costs more",
        type: "select",
        options: [
          { value: "1", label: "One ahead", description: "Cheapest: the next scene only; a short wait can remain after a choice" },
          { value: "2", label: "Two ahead", description: "The next two scenes and the current detour — the click usually lands on a ready scene" },
          { value: "3", label: "Three ahead", description: "Smoothest; shoots scenes you may never watch" },
        ],
        defaultValue: "2",
      },
      {
        name: "resolution",
        label: "Resolution",
        description: "480P renders roughly twice as fast; 768P for a keepsake-quality course",
        type: "select",
        options: [
          { value: "480P", label: "480P", description: "Fast — the default while learning" },
          { value: "768P", label: "768P", description: "Sharper, slower to shoot" },
        ],
        defaultValue: "480P",
      },
      {
        name: "continuity",
        label: "Continuity",
        description:
          "How hard the shoot holds one look, one voice and one face. Chain: shots inside a scene start on the exact last frame of the previous one (seamless), and every reference shot — scene openings, figures, a speaker on screen — carries the sample's voice. Locked: every shot carries the voice, and a speaker on screen gets a two-angle character sheet; about seven seconds more a shot, joins are matched cuts",
        type: "select",
        options: [
          { value: "chain", label: "Chain", description: "Seamless frame chain inside a scene; the voice reference rides where a reference shot is made anyway" },
          { value: "locked", label: "Locked", description: "The voice on every shot and a character sheet for a speaker — one narrator, one face, guaranteed; slower, joins are matched cuts" },
        ],
        defaultValue: "chain",
      },
      {
        name: "falApiKey",
        label: "fal.ai API Key",
        description:
          "Required — video generation runs on MiniMax H3 Max, which is only served by fal.ai",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "openrouterApiKey",
        label: "OpenRouter API Key",
        description:
          "Required — GPT 5.6 Luna via OpenRouter writes the screenplay, every detour and question scene, and judges the narration; the course cannot be written without it",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
    ],
  },

  evolution: {
    directive: `Learn this learner's preferences from their course history: how often they take the
detour instead of continuing and which kinds of detour they take (a worked example, a closer look, a
check), what they ask mid-course and at which scenes, which style they settle on at the board (a
preset, the recommendation, their own description) and what they adjust in the sample, and how the
course depth and lookahead they chose matched their pace. Augment the skill so future courses bias
the outline's depth, the detour briefs the screenplay offers, the style recommendation and the
scene length toward these preferences, while always respecting explicit instructions.`,
  },

  changelog: {
    "0.5.0": [
      "The H3 prompt practice lives in one script (h3-prompt.mjs), not in the model's head: every shot's prompt opens on the style anchor, writes the picture as a timeline of beats each with its camera move, carries a two-layer soundscape under the voice, and closes on the negatives for what the style shows",
      "One voice across the course: the confirmed sample's narration rides on every reference-to-video shot as the voice reference (about four seconds more a shot); a speaker on screen is always a reference shot, so their voice holds between shots too",
      "Continuity init param — chain (default) keeps the seamless image-to-video frame chain inside a scene and carries the voice on every reference shot; locked puts the voice on every shot and draws a two-angle character sheet for a speaker on screen, at a looser join",
      "The eighteen style recipes name their kind, frame, concrete colors, material and light, so the anchor holds across shots",
      "Shot joins fade 30 ms of audio so a scene no longer clicks between shots",
    ],
    "0.4.0": [
      "Play is a program. After the style is confirmed and the outline lands, write-screenplay.mjs writes the whole main line in one designed call — one scene per beat, 1-6 chained shots as long as the content needs, one detour brief per scene — and play-manager.mjs runs the play loop as a long-lived process: two queues (Luna for detours and questions, H3 slots for shots), scheduling by distance from the learner with main before detour, pruning and remote cancellation on choice, one narration re-shoot per shot, the shots concatenated into the scene. No model runs on the click path; the director does nothing during play but answer questions (a request file) and restart the manager.",
      "The viewer writes choices and retries to state/choice.json instead of notifying the director; between scenes the stage shows an interlude — the last frame drifting under a recap of what was just said, what comes next, and the shot progress (拍摄中 2/3) — and the caption follows the shot being spoken. The manager's heartbeat is watched: a stopped one is shown and reported once (managerOffline).",
      "course.json nodes carry shots[], brief, shotIndex/shotCount and the statuses scripting/queued/cancelled; play{} is the manager's snapshot. Init params: lookahead (scenes shot ahead) and resolution replace generationStrategy; SKILL.md carries them in the manager command. generate-video.mjs runs on fal's queue API with remote cancellation.",
      "Hardened by three blind trials: the manager daemonizes itself (--detach, pid gate) because a process backgrounded by an agent's shell dies with the command; a choice prunes only what the chosen scene cannot reach; narration QA reads digits and symbols as the words they were spoken as; every clip leaves with one audio format and the concat verifies its length; reference figures outside fal's 0.4–2.5 aspect range are letterboxed and audited; a learner's question is scheduled at once and offered where they are; the viewer watches only the text it reads (a wide watch pattern had shipped every clip to the browser as base64), re-reads the workspace after every manager write, and holds a short interlude on every scene change.",
      "After review: the manager shoots exactly `lookahead` scenes ahead (one too many before); a job leaving a queue re-schedules, so a scene retried while it was being shot is re-queued; a retry of a ready scene is a new take of every shot; narration that cannot be transcribed fails the shot (the clip is kept as `unchecked` and a retry checks it first) instead of passing unheard; a shot binding more figures than the reference slots allow — four, less the continuity frame and the course's recurring characters — fails at the shoot and is capped by the screenplay validator; fal jobs are cancelled remotely on a deadline or a dead poll, and a submit whose answer was lost is never sent twice (fal has no idempotency key); the viewer reports courseComplete so the director writes the summary; the OpenRouter key is declared required; a failed style sample stays visible on the board; course-edit evidence replaces a beat's problems instead of accumulating them; plan-course stops when the outline did not land.",
    ],
    "0.3.8": [
      "The endpoint is decided after the script, from what it shows: a segment with no figure on screen (most of them) is image-to-video from the parent's last frame; one that shows a figure, or a course with a recurring character, is reference-to-video with the producer injecting the numbered bindings. The writer hears the available figures by name and uses one only when the content needs it to be exact.",
    ],
    "0.3.7": [
      "Figures are references, never keyframes: segments are shot reference-to-video again (Image 1 = the continuity frame, Image 2+ = figures and characters, reproduced inside the model's own picture). Pinning a rendered figure as a first or last frame had put raw bitmaps on screen and degraded the course into a slideshow. Image-to-video remains only as the fallback for a figure-less segment when reference-to-video is down; a segment that needs a figure anchored fails honestly instead of imagining it.",
    ],
    "0.3.6": [
      "The stage tells the truth about a wait: the producer records phase (写稿中 / 拍摄中 / 质检中), start time and failure reason on the node; loading states show a clock, a node stuck past five minutes offers 再拍一次, a clip waiting past three minutes offers 再催一次, and the viewer re-reads the workspace every 30 s while waiting so a lost watcher event cannot freeze it.",
      "Faster: the director stays one step ahead on the main line and ends its turn after launching producers; the producer warms the transcriber while H3 renders (cold starts cost ~100 s a clip); figure specs no longer masquerade as figure files.",
    ],
    "0.3.5": [
      "The planner lands the outline first and grounds beat by beat: course-edit.mjs gained outline / evidence / audit, plan-course.js commits each beat's evidence into course.json the moment it is done and no longer ends in an assembling agent, and the opening can be shot as soon as the outline exists. Grounding agents are budgeted (no PDFs, no page images, ten tool calls a beat).",
    ],
    "0.3.4": [
      "Segments are shot image-to-video by default: the previous segment's last frame is this one's first, and the beat's figure is pinned as the last frame (which the next segment starts from). Reference-to-video only when a recurring character or a second figure must ride along; --endpoint auto|image|reference|text.",
      "The scripts own their retries: generate-video.mjs retries transient fal failures with a short back-off; the sampler reuses the anchor already on file, shoots image-to-video from it by default and falls back to it when reference-to-video is down; the producer falls back the same way. The director never writes a retry loop.",
    ],
    "0.3.3": [
      "The rail is the learner's main line — root to the segment they are on, then what \"continue\" means now — derived from parent links, so a path[] the director recorded short still draws whole; the rest of the tree lives on the course map.",
      "Opening a ready segment from the rail or the map that extends or changes the line counts as choosing it (segmentWatched), and a clip that ends with no continuations asks the director for them (continuationsMissing) instead of leaving the learner with nothing to click.",
      "course-edit.mjs watched records the segment's ancestors too and keeps the latest watched at the tail.",
    ],
    "0.3.2": [
      "Clips come back with their MP4 index at the front (faststart on the loudness pass), so a browser starts a segment and seeks without the head-tail-head round trip.",
      "The stage keeps one soundtrack: a segment switch pauses the outgoing layer at once and empties it once the next clip plays; a retry can no longer revive a layer that left the stage. Scrubbing a finished clip resumes it.",
    ],
    "0.3.1": [
      "The style sample carries the topic, not just the look: make-style-sample.mjs requires --action (what the 5 seconds show, in the style's materials) beside --hook, and the board's instructions ask for both.",
      "The sample screen starts playback explicitly and shows a play button whenever the clip is not running; a transient load error is retried once.",
    ],
    "0.3.0": [
      "The style board owns the style step: pick a preset, ask for a recommendation, or describe your own — the director shoots a sample (anchor still + 5s clip) with make-style-sample.mjs and the learner confirms it on the board. The audition and the `style` init param are gone.",
      "course.json style carries status (pending → sampling → sampled → confirmed), a custom recipe, the sample, and learner references; course-edit.mjs gained init / confirm-style.",
      "The root segment continues from the confirmed sample's last frame; a chosen-but-unproduced scene shows a loading stage instead of queuing a chip in the chat box.",
    ],
    "0.2.0": [
      "The play loop is one deterministic command: produce-segment.mjs (script → evidence gate → continuity frame → shoot → narration QA → commit under lock) replaces the agent-driven next-segment workflow on every backend.",
      "The outline is the evidence index: each beat carries evidence[] written at planning time; the producer reads it and never renders mid-course.",
      "course-edit.mjs for path/style/summary edits under the same lock; navigation and stage-stealing rules in SKILL.md.",
    ],
    "0.1.0": [
      "Initial release: branching learning-video courses on MiniMax H3 Max (fal.ai).",
      "Grounded generation pipeline: evidence-gated visuals, wizper narration QA.",
      "plan-course / next-segment workflow scripts for Claude Code.",
    ],
  },

  layout: "app",
};

export default plotwiseManifest;
