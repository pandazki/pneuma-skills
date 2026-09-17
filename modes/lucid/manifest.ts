/**
 * Lucid Mode Manifest — pure data, no React deps.
 *
 * A closed loop between a picture and a program: the agent dreams a target
 * screenshot with its own image tool, builds a static Three.js scene toward
 * it, captures the live frame through the scene's bridge, and hands that
 * capture to a fresh-context judge. `lucid.mjs` owns the score history and
 * the exit rule; the viewer is the instrument panel the user watches it on.
 *
 * Ported from achimala/dream-loop (MIT) — see `inspiredBy` and NOTICE.md.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadLoops, saveLoops } from "./domain.js";

const lucidManifest: ModeManifest = {
  name: "lucid",
  version: "0.1.0",
  changelog: {
    "0.1.0": [
      "Describe what you want to see and the agent dreams it first: one generated target screenshot, locked, so every later round is measured against the same picture",
      "The scene is a plain static Three.js site — it runs in the viewer with no build step, and the Live / Target / Split wipe puts the render and the dream on the same pixels",
      "Every round is scored by a judge that has never seen the previous ones, on composition, lighting, materials and details, with named gaps and fixes",
      "The loop knows when to stop: the exit rule reads the score trajectory, the repeated gaps, the measured fps and the time budget instead of the agent's optimism",
      "Assets come down a ladder — image-to-3D first (Tripo H3.1 for heroes, Trellis for props, when a fal key is configured), headless Blender for what only a modeller can do, procedural geometry last — every model recorded in a ledger with its origin",
      "Every rung is a program: `image-to-3d.mjs recipe hero|hero-multiview|prop` plans a fal job with real-world size and image-aligned orientation, `blender.mjs prep` grounds, sizes, merges and single-sides any model in one pass, a Blender kit builds hard-surface props with bevels, arrays and booleans, and `texture.mjs` derives normal, roughness and ORM maps from the albedo the image tool gives you",
      "Every new project ships `assets.js`: a loader that scales by one aligning dimension, measures rigged meshes correctly, grounds the feet, clones rigs with their own mixers and strips root motion",
      "The scene's `errors[]` now sees what three.js only prints — failed shaders, console errors and `THREE.` warnings — tagged by channel in `errorSources`",
      "The time budget survives a pause: the wall clock never stops, so after a resume the agent credits the pause back with `lucid.mjs budget --pause-credit` instead of inventing a bigger budget",
      "A tab in the background is not a slow scene: the bridge reports `visibility` and `sinceLastRenderMs`, and a measurement older than two seconds is no measurement",
      "A gap the judge names twice is no longer a stall — the judge is told to carry ids forward, so that is every real scene one round in; the signal is a gap named in three verdicts running (`stubbornGaps`), and `repeatedGaps` is only reported",
      "`--yaw -90` parses: every script joins a negative number onto its option before parsing; `blender.mjs prep --thin` names parts before the merge erases their names; `status` lists the ledger entries not yet placed",
    ],
  },
  displayName: {
    en: "Lucid",
    "zh-CN": "清明梦",
    ja: "ルシッド",
  },
  description: {
    en: "Dream a target screenshot with image generation, build a Three.js scene toward it, and let a fresh-context judge score every round until the live frame matches the dream — Blender and image-to-3D on the asset ladder.",
    "zh-CN":
      "先用图像生成「梦」出一张目标截图，再用 Three.js 一轮轮把场景建到它那里；每一轮都交给一个没看过前情的评审打分，直到实时画面对得上那场梦——Blender 和图生 3D 就在素材的阶梯上。",
    ja: "まず画像生成で「夢」＝目標スクリーンショットを描き、Three.js のシーンをそこへ向けて組み上げる。毎ラウンド、前の回を知らない審査役が採点し、実際の描画が夢に追いつくまで回す —— Blender と画像から 3D も素材のはしごに並んでいる。",
  },
  // A circular arrow around a small square viewfinder — the loop around a frame.
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.06 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>`,

  // The dream and every cut-out come from the model's own image generation,
  // and the judge is a fresh subagent — codex supplies both today.
  supportedBackends: ["codex"],

  inspiredBy: {
    name: "achimala/dream-loop",
    url: "https://github.com/achimala/dream-loop",
  },

  skill: {
    sourceDir: "skill",
    installName: "pneuma-lucid",
    mdScene: `You are building toward a picture that does not exist yet. The user says what they want to see in the browser; you dream it first — one target screenshot from your own image tool, locked at \`target.png\` — and then build a static Three.js scene under \`scene/\` until the live frame matches it. In front of the user is the loop's instrument panel: your scene running live, the target over it under a draggable wipe, the score every round earned from a judge that had never seen the previous ones, and the ledger of every asset the scene needs.`,
    envMapping: {
      BLENDER_PATH: "blenderPath",
      FAL_KEY: "falApiKey",
    },
    // sharedScripts is a WHITELIST and it is transitive: image-to-3d.mjs
    // drives fal through fal-queue.mjs, so the transport primitive has to be
    // listed even though the agent never invokes it directly.
    sharedScripts: ["fal-queue.mjs"],
  },

  viewer: {
    // EVERY pattern here must end in a literal extension. The watcher derives
    // its file-type allowlist from these globs
    // (`server/file-watcher.ts::extractWatchExtensions`), and a directory
    // pattern like `**/scene/**` contributes NOTHING to it — measured
    // 2026-09-16: with that form the allowlist was `{.json, .png}`, so an edit
    // to `scene/main.js` never reached the viewer and the debounced auto-reload
    // could not fire. The initial scan still listed the file, which is what
    // makes this fail silently: the scene is there, it just never updates.
    // `.glb` is deliberately absent — a binary has no business in the file
    // store, and a new model is what `reload-scene` is for.
    watchPatterns: [
      "**/lucid.json",
      "**/target.png",
      "**/target-history/**/*.png",
      "**/rounds/**/*.png",
      "**/rounds/**/*.json",
      "**/scene/**/*.html",
      "**/scene/**/*.js",
      "**/scene/**/*.mjs",
      "**/scene/**/*.css",
      "**/scene/**/*.json",
      "**/assets/**/*.png",
      "**/assets/**/*.json",
    ],
    ignorePatterns: ["node_modules/**", ".pneuma/**"],
    serveDir: ".",
  },

  sources: {
    // The loop is ONE object assembled from a manifest per project; a missing
    // verdict breaks the trajectory, so it is an aggregate, not a file list.
    loops: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/lucid.json"],
        load: loadLoops,
        save: saveLoops,
      },
    },
    // A CHANGE SIGNAL, not content: the viewer never reads these bytes (the
    // iframe loads them itself over `/content/…`), it only needs to know the
    // agent touched the scene so it can debounce a reload. `vendor/` is
    // ignored because three.module.js is ~1.2 MB of text that never changes
    // after `init` and would be shipped into the browser on every snapshot.
    sceneFiles: {
      kind: "file-glob",
      config: {
        patterns: [
          "**/scene/**/*.html",
          "**/scene/**/*.js",
          "**/scene/**/*.mjs",
          "**/scene/**/*.css",
          "**/scene/**/*.json",
        ],
        ignore: ["**/scene/vendor/**"],
      },
    },
  },

  viewerApi: {
    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: false,
      manifestFile: "lucid.json",
      supportsContentSets: true,
      // The rounds rail is the navigation, and it lives on the stage beside
      // the thing it navigates. A TopBar item selector would be a second,
      // score-blind copy of it.
      topBarNavigation: false,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Show round / view",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              "ViewerAddress, e.g. `{ \"contentSet\": \"lantern-shrine\", \"round\": 2, \"view\": \"split\" }`. `round` is the 1-based round index and puts that round's recorded capture on the stage; omit it for the live scene. `view` is `\"live\"`, `\"target\"` or `\"split\"` (the wipe compare).",
            required: true,
          },
        },
        description:
          "Point the stage at a project, a recorded round, or a view. Call it before `capture` so you shoot what you mean — and after a round is judged, so the user lands on the frame you are talking about instead of hunting for it. A `view` with no `round` clears whatever round the user left selected, which is why `{ \"view\": \"live\" }` is the first step of a judged capture. A round that is not recorded, or a project that does not exist, is refused by name rather than quietly showing something else; the reply's `data` says where the stage actually ended up.",
      },
      {
        id: "get-scene-state",
        label: "Read what the scene reports",
        category: "custom",
        agentInvocable: true,
        params: {},
        description:
          "Read the stage and the live scene's own numbers: `{ bridge, registered, ready, loading, fps, rafFps, fpsSource, frameMs, passesPerFrame, visibility, sinceLastRenderMs, drawCalls, triangles, textures, errors[], errorSources, notes, viewport, stage, lastCapture, reloadedAt }`. `visibility: \"hidden\"` means the viewer's tab is in the background and the browser has paused its animation frames: `fps` is null because nothing is being drawn, not because the scene is slow — ask the user to bring the viewer to the front and never record a round from a hidden tab. `viewport.renderPixelRatio` is what the renderer draws at; `viewport.pixelRatio` is only what the display offers. CALL IT BEFORE YOU DREAM THE TARGET: `stage` is `{ width, height, aspect }`, the CSS box the scene fills, and it is always reported — even with no project open and no bridge running. Dream the target at that aspect; a 16:9 dream on a 1.48 stage makes every round get judged against a differently shaped picture. `bridge: false` means the page does not include `lucid-bridge.js`, so nothing can be measured and nothing can be captured — fix that before judging. `lastCapture` = `{ at, source, round?, ready, registered, waitedMs }` is the provenance of the LAST frame `capture` handed back, and both fields gate a verdict. `source` is `\"live\"`, `\"round\"` or `\"target\"`: with a round or the target on the stage, `capture` hands back that recorded PNG instead of shooting the scene, so before you judge a round call `navigate-to` `{ \"view\": \"live\" }` and then confirm `lastCapture.source === \"live\"` — a judge scoring the target against itself costs a whole round. `ready` is the other half: `capture` waits up to 4 s for the scene to report `registered && ready` before it shoots, so `lastCapture.ready === false` means that screenshot was taken before the scene was ready (or is a still) and must not be judged — reload, let it settle, capture again. `notes` are the scene's own named diagnostics (a separate channel from `errors`), and `rafFps` / `fpsSource` say how `fps` was measured — `fps` counts DISPLAYED frames, at most one per animation frame, so `passesPerFrame` above 1 means the scene draws extra passes, e.g. reflections (null while nothing is registered). Call it after a batch of edits too: a scene that throws on load still renders its last good frame, and `errors` is the only place that shows — including failed shaders and `THREE.` warnings, which three.js only prints; `errorSources` says which channel (`window`, `unhandledrejection`, `console`, `shader`) each distinct error came from, so a black material is told apart from a script that threw.",
      },
      {
        id: "reload-scene",
        label: "Reload the live scene",
        category: "ui",
        agentInvocable: true,
        params: {},
        description:
          "Restart the scene iframe now. Use it after a batch of edits or a new GLB, when you want the reload to happen at a moment you chose; the viewer otherwise reloads on its own 1.5 s after the last scene CODE file (html/js/mjs/css/json) stops changing. Replacing a texture or a model under scene/ with the same name does NOT reload anything — the running scene keeps the old bytes in GPU memory — so call this after swapping a binary, or reference the new file from code once it is on disk.",
      },
    ],
    // User → agent. `description` is the ONE-LINE HINT THE USER READS on
    // hover — never a script, a flag or a file name. The agent's briefing for
    // these two lives in the skill's Commands section.
    commands: [
      {
        id: "judge-round",
        label: "Judge this round",
        description:
          "Capture the scene now and ask a fresh judge to score it against the target",
      },
      {
        id: "re-dream",
        label: "Dream a better target",
        description:
          "Generate a new target from the current scene and the original direction",
      },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Lucid Mode" skill="pneuma-lucid" session="new"></system-info>
The user just opened the lucid workspace. Greet them briefly (1-2 sentences): say that you start by dreaming a target screenshot with your image tool from whatever they describe, then build a Three.js scene toward it while a fresh judge scores each round. If this session's model has no image-generation tool, say so in the same breath and ask them to switch to a model that has one (GPT-6 Astra in Codex) — the loop cannot start without a target.`,
  },

  init: {
    contentCheckPattern: "**/lucid.json",
    // The seed is the output of the mode's own zero-leak blind trial
    // (2026-09-16): a real dreamed target, three judged rounds and the scene
    // a cold-start agent built toward it. An invented seed would teach the
    // mode's own workflow wrong. Images are downscaled and quantized; the
    // budget is cleared so the demo does not open on "budget exhausted".
    seedFiles: {
      "modes/lucid/seed/ember-abbey/": "ember-abbey/",
    },
    seeds: [
      {
        id: "ember-abbey",
        sourceKey: "modes/lucid/seed/ember-abbey/",
        thumbnail: "ember-abbey.png",
        displayName: {
          en: "Ember Abbey — a loop in progress",
          "zh-CN": "余烬修道院 · 一个进行中的循环",
          ja: "エンバー・アビー — 進行中のループ",
        },
        description: {
          en: "An isometric voxel abbey in the rain: the dreamed target, three judged rounds (3.35 → 4.0 → 4.25) with every gap the judge named, and the live Three.js scene with click-to-move, lazy camera and wet-stone reflections.",
          "zh-CN": "雨夜里的等距体素修道院：梦出来的目标图、三轮已评分的回合（3.35 → 4.0 → 4.25）和评审点名的每一个缺口，以及可点击移动、镜头慢跟、湿石反射的实时 Three.js 场景。",
          ja: "雨に濡れたアイソメトリックなボクセル修道院。夢に見た目標画像、採点済みの 3 ラウンド（3.35 → 4.0 → 4.25）と審査役が挙げた全ギャップ、クリック移動と遅延カメラ、濡れた石の反射を持つ実動の Three.js シーン。",
        },
        tags: ["voxel", "three.js"],
      },
    ],
    params: [
      {
        name: "blenderPath",
        label: "Blender executable",
        description:
          "Leave blank to auto-detect: PATH, /Applications/Blender.app, Program Files. Only the mode's blender script runs it.",
        type: "string",
        defaultValue: "",
      },
      {
        name: "falApiKey",
        label: "fal.ai API Key",
        description:
          "Optional — enables image-to-3D on the asset ladder: Tripo H3.1 for hero assets, Trellis for props.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "fpsTarget",
        label: "Target frame rate",
        description:
          "What smooth means for this project; the loop's exit rule reads it.",
        type: "select",
        options: ["60", "30"],
        defaultValue: "60",
      },
    ],
    // The installer's template engine has `{{#key}}` sections and no inverted
    // form, so "no fal key" needs its own truthy key — otherwise the sentence
    // that tells the agent the rung is closed sits outside the gate, where a
    // session that CAN use image-to-3D reads it too.
    deriveParams: (params) => ({
      ...params,
      imageTo3dEnabled: params.falApiKey ? "true" : "",
      imageTo3dDisabled: params.falApiKey ? "" : "true",
      blenderConfigured: params.blenderPath ? "true" : "",
    }),
  },

  evolution: {
    directive: `Learn the user's visual taste and loop habits: the art directions and camera
framings they ask for, how they phrase target-image prompts, how strict they
want the judge, which asset rungs they prefer (image-to-3D vs Blender vs
procedural) and their usual fps target and time budget. Evidence comes from
session history, lucid.json histories and verdicts. Write them back as
this skill's defaults so a new loop starts from the user's house style while
explicit instructions still win.`,
  },
};

export default lucidManifest;
