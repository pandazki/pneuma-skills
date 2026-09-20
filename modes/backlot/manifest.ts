/**
 * Backlot Mode Manifest — pure data, no React deps.
 *
 * The backlot's greybox stage is the part that ships today: block the shot in
 * 3D first, so a headless-Blender greybox animation fixes space, action and
 * camera, and a video model then paints the look on top of that exact MP4.
 * `previz.mjs` owns every piece of machine state — the revision counter, the
 * acceptance record, the take ledger — and the viewer is the shot's player:
 * the lanes on one clock, the plan's beats on the timeline, and what the
 * whole thing cost.
 *
 * Practice adapted from modengsir/blender-video-workflows (MIT) — see
 * `inspiredBy` and NOTICE.md.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadFilm, saveFilm } from "./domain.js";

const backlotManifest: ModeManifest = {
  name: "backlot",
  version: "0.1.0",
  changelog: {
    "0.1.0": [
      "The backlot opens with its greybox stage: block the shot in 3D before anything is generated, so a Blender greybox animation fixes the room, the action and the camera move, and the video model only paints the look on top of that exact clip",
      "Start from an idea or from a video you already have — the recreate entry trims the segment you point at, reads its cuts and adopts its duration, frame rate and size into the shot spec",
      "One shot is the unit of everything: plan, greybox, acceptance, prompt pack, takes and cost all live in one `shots/<id>/` directory with a single writer",
      "The player runs every lane on one clock — reference, greybox and takes side by side, under a wipe, or blended for silhouette matching — so a drift is seen at a frame, not remembered",
      "The greybox lane switches between the Render the model received and a 3D inspection view of the same scene: the shot camera with its real framing, or a free orbit with the camera path, a moving frustum and each subject's floor trail",
      "Frame arithmetic is exact: `frames = seconds × fps`, frames 1 to N, and `render` refuses a scene whose range disagrees with the shot spec instead of quietly producing a 193-frame eight-second clip",
      "Nothing is passed unseen — every acceptance check is pass, fail or unverified, a check nobody looked at stays unverified, and the status line never summarises as accepted while one is not green",
      "Cause before effect: a trigger beat names the beat that caused it, the timeline draws the link, and the prompt keeps that order so the device never lights before the hand arrives",
      "The same defect twice stops the loop: a check that fails on two consecutive greybox revisions is reported as stuck, and the agent saves the version and asks instead of rendering again",
      "Paid work is submitted once — a take is written down before the request leaves, ends done or failed with its request id, a second take needs a named fix and a third needs your approval",
      "A take is never called 1080p unless ffprobe says so: every lane header shows what was measured, not what was ordered",
      "Cost is priced before you spend it: `generate --estimate` prices the job from the fal per-second table, and the Cost tab shows each take and the total, labelled an estimate",
      "No fal key is a reported gap, not a silent success — you still get the plan, the greybox, the .blend and the prompt pack, and the mode says which stage is closed",
      "A Blender kit ships the greybox grammar: rooms, props, hinged doors and lids, a person-sized figure that travels a ground path, eased camera moves that do not overshoot, and accents that record themselves",
      "The greybox blocks the body and never acts for it: the subject is a pawn with an unambiguous front, so space, timing and facing are fixed while the walk, the reach and the press stay in the prompt where the video model is good at them — and `travel` refuses a cruise speed no walk or run could have, because the model animates the gait at whatever speed the clip shows",
    ],
  },
  displayName: {
    en: "Backlot",
    "zh-CN": "片场",
    ja: "バックロット",
  },
  description: {
    en: "From an idea to a finished cut — screenplay, character and set bible, storyboard frames, 3D greybox previz, model-rendered takes, dialogue and music. The creator approves every stage before the next one starts.",
    "zh-CN":
      "从一个念头拍到成片：剧本、人物与场景设定、分镜画稿、3D 白模预演、模型渲染的镜头、台词与配乐。每一道工序都要你点头，才进下一道。",
    ja: "アイデアから完成尺まで —— 脚本、キャラクターとセットのバイブル、絵コンテ、3D グレーボックスのプリビズ、モデルが描くテイク、セリフと音楽。各ステージはあなたが承認してから次へ進みます。",
  },
  // A camera frustum looking at a small cube standing on a ground line —
  // the greybox before anything is rendered.
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 19h19"/><rect x="1.5" y="10" width="3" height="4" rx="0.8"/><path d="M4.5 10.5 10 8v8l-5.5-2.5z"/><path d="m16 11 3.5 2-3.5 2-3.5-2z"/><path d="M12.5 13v4L16 19l3.5-2v-4"/><path d="M16 15v4"/></svg>`,

  // Everything here is a script the agent runs and an image it reads back.
  // No model-side image or video tool is required, so both harnesses qualify.
  supportedBackends: ["claude-code", "codex"],

  inspiredBy: {
    name: "modengsir/blender-video-workflows",
    url: "https://github.com/modengsir/blender-video-workflows",
  },

  skill: {
    sourceDir: "skill",
    installName: "pneuma-backlot",
    mdScene: `You and the user are shooting a short film the way a previz department does: every shot is blocked in 3D first. You write a shot plan with timed beats, build the blocking as a Blender script, render it headless into a greybox MP4 — untextured geometry, one light, the real camera — and go through the acceptance list on that clip before anything is generated. Only then does a video model paint the look on top of that exact file. In front of the user is the shot's player: the lanes on one clock, the beats drawn on the timeline, the acceptance record, the prompt pack, and what each take cost.`,
    envMapping: {
      BLENDER_PATH: "blenderPath",
      FAL_KEY: "falApiKey",
    },
    // sharedScripts is a WHITELIST and it is transitive: seedance-video.mjs
    // drives fal through fal-queue.mjs, so the transport primitive has to be
    // listed even though the agent never invokes it directly.
    sharedScripts: ["seedance-video.mjs", "fal-queue.mjs"],
  },

  viewer: {
    // EVERY pattern here must end in a literal extension — the watcher derives
    // its file-type allowlist from these globs
    // (`server/file-watcher.ts::extractWatchExtensions`) and a directory glob
    // contributes nothing to it.
    //
    // THIS LIST IS THE VIEWER'S TEXT INPUTS AND NOTHING ELSE. Every match is
    // read with `readFileSync(path, "utf-8")` — by the watcher AND by
    // `GET /api/files` on cold start (`server/routes/export.ts`) — and shipped
    // to the browser inside one JSON payload. Media does not belong here:
    // plotwise froze a tab with a 1.17 GB snapshot that way, and measured here
    // on 2026-09-20, adding `.png` for the contact sheets made `/api/files`
    // 4.1 MB of mangled binary against 17 KB with them removed.
    //
    // No media pattern is needed. `previz.mjs` bumps `greybox.revision` on
    // every render and appends the take to `shot.json`, which IS watched, and
    // the viewer's `/content/…?rev=<n>` URLs bust the cache off that number.
    // Image cache-busting also survives: the watcher's image branch fires
    // before the pattern filter, so a new PNG still bumps `imageVersion`.
    watchPatterns: [
      "**/backlot.json",
      "**/shots/*/shot.json",
      "**/shots/*/*.md",
      "**/shots/*/greybox/*.json",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".pneuma/**",
      // Per-frame PNG scratch: a render writes hundreds of them and they are
      // never read by the viewer — the MP4 is.
      "**/frames/**",
    ],
    serveDir: ".",
  },

  sources: {
    // A film is ONE object assembled from a project manifest plus a shot file
    // per shot: a missing `shot.json` changes what the rail can show, so the
    // viewer needs them loaded together, not as an unordered file list.
    film: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/backlot.json", "**/shots/*/shot.json"],
        load: loadFilm,
        save: saveFilm,
      },
    },
    // The agent's prose, read as text by the Plan and Prompt tabs.
    docs: {
      kind: "file-glob",
      config: {
        patterns: [
          "**/shots/*/shot-plan.md",
          "**/shots/*/prompts.md",
          "**/shots/*/comparison.md",
        ],
      },
    },
    // The Blender kit's sidecar: what the 3D lane needs that glTF cannot
    // carry — the camera's node name, the subjects to trail, and the accent
    // colour animation Workbench materials do not export.
    metas: {
      kind: "file-glob",
      config: {
        patterns: ["**/shots/*/greybox/scene.meta.json"],
      },
    },
  },

  viewerApi: {
    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: false,
      manifestFile: "backlot.json",
      supportsContentSets: true,
      // The shots rail is the navigation and it lives beside the stage it
      // drives. A TopBar item selector would be a second, stage-blind copy.
      topBarNavigation: false,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Show shot / lane / moment",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              'ViewerAddress, e.g. `{ "contentSet": "first-light", "shot": "lab-walk", "lane": "greybox", "time": 4.2 }`. `shot` is the shot id (required unless you only change the moment on the shot already open). `lane` is `"reference"`, `"greybox"` or `"take"`. `take` is a take id (`"take-01"`) and implies the take lane. `time` is seconds on the shared clock. `range` is `[from, to]` in seconds and marks that span on the timeline. `layout` is `"side"`, `"wipe"`, `"blend"` or `"solo"`.',
            required: true,
          },
        },
        description:
          "Put the player on the shot, lane and moment you are talking about, so the user is looking at the frame your sentence is about instead of hunting for it. Call it before you describe a defect (`{ shot, time }` lands the playhead on the frame; add `range` to mark the span you checked) and after a render or a take lands (`{ shot, lane: \"take\", take: \"take-02\" }`). A shot or take that does not exist is refused BY NAME and nothing moves; the reply's `data` always says where the stage actually ended up — shot, lane, take, layout, time and frame.",
      },
      {
        id: "get-player-state",
        label: "Read what the player shows",
        category: "custom",
        agentInvocable: true,
        params: {},
        description:
          "Read the stage exactly as the user sees it: `{ contentSet, shot, shots[], layout, laneA, laneB, greyboxMode, cameraMode, lanes[], playhead, markedRange, selectedTake, playing, rate, loop }`. `lanes[]` is one entry per lane with `{ id, label, kind, file, loaded, error, probe }` — `loaded` is whether that lane's media actually decoded in the browser, so a lane whose file is missing or unreadable is knowable rather than merely blank, and `kind` is `\"video\"`, `\"waiting\"` (a submitted take), `\"failed\"` or `\"empty\"`. `playhead` is `{ time, frame, beat }` on the shared clock — `frame` is 1-based and clamped to the spec, so it is the frame number to quote at the user. `markedRange` is the span the user shift-dragged on the timeline, or null. Call it before answering a question that starts with \"here\" or \"this\": it is the only way to know which lane and which frame \"here\" means.",
      },
    ],
    // User → agent. `description` is the ONE-LINE HINT THE USER READS on
    // hover — never a script, a flag or a file name. The agent's briefing for
    // these two lives in the skill's Commands section.
    commands: [
      {
        id: "check-greybox",
        label: "Check this greybox",
        description: "Go through the acceptance list on this greybox and record what you find",
      },
      {
        id: "generate-take",
        label: "Generate a take",
        description: "Render a take from this greybox with the prompt pack",
      },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    // Blocking is judgement — where the camera stands, how long the walk
    // takes, whether a defect is a fix or a redesign — but the acceptance
    // baseline this mode is held to is Codex GPT-6 Astra at medium, and blind
    // trials 2 and 3 passed at that setting. Asking for more than the level
    // the work was proven at buys latency, not judgement.
    reasoningEffort: "medium",
    greeting: `<system-info pneuma-mode="Pneuma Backlot Mode" skill="pneuma-backlot" session="new"></system-info>
The user just opened the backlot workspace. Greet them briefly (1-2 sentences): say that you block every shot in 3D first — a Blender greybox that fixes the room, the action and the camera — and only then let a video model paint the look on top of that exact clip. Ask what the shot is, or offer to recreate a video they already have. If Blender is not configured, say so in the same breath and name what is still possible without it.`,
  },

  init: {
    contentCheckPattern: "**/backlot.json",
    // The seed is a real run: a real greybox render, its GLB and sidecar, the
    // acceptance record it earned, and the Seedance take it became. An
    // invented seed would teach the mode's own workflow wrong.
    seedFiles: {
      "modes/backlot/seed/first-light/": "first-light/",
    },
    seeds: [
      {
        id: "first-light",
        sourceKey: "modes/backlot/seed/first-light/",
        thumbnail: "first-light.png",
        displayName: {
          en: "First Light — one shot, blocked and rendered",
          "zh-CN": "初光 · 一个镜头，从白模到成片",
          ja: "ファーストライト — ショット 1 本、ブロッキングからレンダーまで",
        },
        description: {
          en: "An eight-second lab shot with everything it took: the timed plan, the Blender script, the greybox MP4 the model received, its acceptance record, the prompt pack and the take that came back.",
          "zh-CN":
            "一个八秒的实验室镜头，连同它的全部工序：带时间线的分镜计划、Blender 脚本、交给模型的那段白模 MP4、验收记录、提示词包，以及最后生成的成片。",
          ja: "8 秒のラボのショットと、それに要したすべて —— 時間割つきのプラン、Blender スクリプト、モデルに渡したグレーボックス MP4、その受け入れ記録、プロンプトパック、そして返ってきたテイク。",
        },
        tags: ["blender", "seedance"],
      },
    ],
    params: [
      {
        name: "blenderPath",
        label: "Blender executable",
        description:
          "Leave blank to auto-detect: PATH, /Applications/Blender.app, Program Files. Only the mode's render script runs it.",
        type: "string",
        defaultValue: "",
      },
      {
        name: "falApiKey",
        label: "fal.ai API Key",
        description:
          "Optional — enables video takes (Seedance 2.5 reference-to-video). Without it you still get the plan, the greybox and the prompt pack.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
    ],
    // The installer's template engine has `{{#key}}` sections and no inverted
    // form, so "no fal key" needs its own truthy key — otherwise the sentence
    // that tells the agent the stage is closed sits outside the gate, where a
    // session that CAN generate reads it too.
    deriveParams: (params) => ({
      ...params,
      videoEnabled: params.falApiKey ? "true" : "",
      videoDisabled: params.falApiKey ? "" : "true",
      blenderConfigured: params.blenderPath ? "true" : "",
    }),
  },

  evolution: {
    directive: `Learn the user's shot habits: their default duration, aspect and frame rate,
how they describe camera moves, which looks they ask the video model for, how
strict they are at greybox acceptance, and what they are willing to spend per
take. Evidence comes from session history, the shot.json files (spec, beats,
checks and their history, takes and costs) and the prompt packs. Write them
back as this skill's defaults so a new shot starts from the user's house style
while explicit instructions still win.`,
  },
};

export default backlotManifest;
