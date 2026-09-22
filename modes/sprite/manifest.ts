/**
 * Sprite Mode Manifest — pure data, no React deps.
 *
 * Character-centric motion assets: the user designs a character once, then
 * asks for motions. Each motion is one GPT Image 2.5 sheet generated with the
 * character references attached, which a deterministic ffmpeg pipeline turns
 * into aligned frames, a packed atlas, a GIF/WebP preview, and — on request —
 * a short clip from a video model.
 *
 * A motion can also be a `loop`: a keyframe, a first-last clip with the same
 * image at both ends, and every frame of the cycle cut into one seamless
 * transparent animation (WebP / APNG / WebM / Lottie) for a UI.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadRoster, saveRoster } from "./domain.js";

const spriteManifest: ModeManifest = {
  name: "sprite",
  version: "0.3.2",
  changelog: {
    "0.3.2": ["Skill text states current behaviour without the incident stories; seed size note moved to the seed README"],
    "0.3.1": [
      "A loop's interview is now a gate, not a request: `set-motion --brief-duration/--brief-width/--brief-interpolator` records what the user answered, and `add-video` refuses the paid clip on a loop that has no brief. The 400-frame ceiling is warned about while the duration is still a question, and `register-run` says when the frames that landed are not the width the brief asked for",
      "`sprite-sheet.mjs retime` replays a clip's own frames in another order — an apex freeze cut short, a double blink dropped, a beat repeated — and registers as a derived clip (`--op retime --model ffmpeg`). It costs nothing and invents nothing, and it is the answer to the Seedance idle-loop failure modes that prompt wording does not fix",
      "`loop --width` caps frames at 512 px when it is not given, says so on stderr and records `widthDefaulted`; the Lottie and APNG size warnings now say something different depending on whether a width was passed, instead of advising a flag the caller already used",
      "The frame strip samples its thumbnails on a long loop instead of putting every frame in the DOM, so a 355-frame loop no longer freezes the tab, and the inspect block's seam limit reads as a threshold rather than as the unrelated maxStep",
    ],
    "0.3.0": [
      "Seamless transparent loops for a UI: a 3D-icon keyframe, a first-last clip with the same image at both ends so the loop closes by construction, then `sprite-sheet.mjs loop` cuts every frame of the cycle into `loop.webp`, `loop.apng`, `loop.webm` (VP9 with alpha) and a Lottie JSON",
      "A `loop` motion is judged on its seam against a normal frame step — not on anchor drift, which a bobbing icon is supposed to have; the frames stay unaligned and uncleaned because the movement is the content",
      "Video matting (VEED, its green-screen endpoint, or Bria) turns the plate clip transparent, and frame interpolation takes it to a higher rate — Topaz on fal by default, RIFE (which also closes the wrap) or free ffmpeg `minterpolate` when the user picks them. Interpolate first, matte second",
      "Fixed: every animated WebP this mode writes — the sprite `preview.webp` as well as the loop — ghosted its previous frames, because ffmpeg's `libwebp` encoder does not composite animation frames. Encoding with `libwebp_anim` took the mean alpha error from 9.8 to 0.03 per frame",
    ],
    "0.2.1": [
      "Measured the video workflow on the seed character's own green-screen walk: the contact window closes the loop where even sampling of the whole clip does not",
    ],
    "0.2.0": [
      "Look at a clip before cutting it: `sprite-sheet.mjs contact` tiles a timestamped contact sheet and measures the opening hold, the closing hold and the best loop window, so a motion from video samples one cycle instead of the whole clip",
      "`from-video --at` samples hand-picked times when the beats are not evenly spaced",
      "Start from the user's own character: uploaded images and poses cropped out of them are registered as such (`add-ref --uploaded` / `--derived-from`) and never redrawn",
    ],
    "0.1.1": [
      "Plan each motion around its own phases, contact points, movement and ending while keeping character identity consistent",
      "Sheet and video prompts allow deliberate crouching and turning; visual checks distinguish intended pose changes from drift and explain alignment limits",
    ],
    "0.1.0": [
      "Design a character once, then generate motions as GPT Image 2.5 sheets with the character references attached on a transparent background",
      "Every sheet is sliced, anchor-aligned and packed by ffmpeg into frames + sheet.png + atlas.json (TexturePacker JSON-hash, loads straight into Phaser or PixiJS) plus a GIF and WebP preview",
      "The stage plays the motion at its own fps and the agent watches through it — get-playback-state, play, capture and a deterministic inspect report replace guessing from the sheet PNG",
      "Video previews from Seedance 2.5 or MiniMax H3 Max, rendered from the motion you are looking at",
    ],
  },
  displayName: {
    en: "Sprite",
    "zh-CN": "精灵图",
    ja: "スプライト",
  },
  description: {
    en: "Design a character once, then generate consistent sprite sheets and motion reference frames with GPT Image 2.5 — auto-keyed, sliced, aligned, packed, previewed as GIF or a video clip. Or shoot a seamless transparent loop for a UI and export it as WebP, APNG, WebM and Lottie.",
    "zh-CN":
      "先定角色，再用 GPT Image 2.5 产出前后一致的雪碧图与动作参考帧；自动抠背景、切帧、对齐、打包，GIF 或视频模型预览。也可以做界面上那种循环不断的透明小动画，一次导出 WebP、APNG、WebM 和 Lottie。",
    ja: "キャラクターを一度設計すれば、あとは GPT Image 2.5 で一貫したスプライトシートとモーション参考フレームを生成 —— 背景抜き・分割・整列・パックまで自動、GIF や動画クリップでプレビュー。UI に置く継ぎ目のない透過ループも作れて、WebP・APNG・WebM・Lottie で書き出せます。",
  },
  // A 3×3 grid with one cell filled — a sheet with one frame picked out.
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-sprite",
    mdScene: `You and the user are building a character's motion assets inside Pneuma's workspace. The user watches a motion stage: a refs rail, a motion list, and a player that runs the selected motion at its own fps beside its GIF, video and atlas. You design the character, write the sheet prompts, run the generation and the ffmpeg pipeline, then look through the stage — playback state, the inspect report, a capture — before you tell them a motion is done.`,
    envMapping: {
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    },
    // sharedScripts is a WHITELIST: every script a listed script imports must
    // itself be listed, or the copied script dies on its first import line.
    // seedance-video.mjs, remove-background.mjs, remove-video-background.mjs
    // and interpolate-video.mjs all drive fal through fal-queue.mjs;
    // generate_image.mjs / edit_image.mjs are the sheet and keyframe path.
    sharedScripts: [
      "generate_image.mjs",
      "edit_image.mjs",
      "generate-video.mjs",
      "fal-queue.mjs",
      "seedance-video.mjs",
      "remove-background.mjs",
      "remove-video-background.mjs",
      "interpolate-video.mjs",
    ],
  },

  viewer: {
    watchPatterns: [
      "**/project.json",
      "**/refs/**/*",
      "**/motions/**/*",
    ],
    ignorePatterns: ["node_modules/**", ".pneuma/**"],
    serveDir: ".",
  },

  sources: {
    roster: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/project.json", "**/refs/**/*", "**/motions/**/*"],
        load: loadRoster,
        save: saveRoster,
      },
    },
  },

  viewerApi: {
    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: false,
      manifestFile: "project.json",
      supportsContentSets: true,
      // The motion list lives inside the viewer's own rail; a TopBar item
      // selector would duplicate it and fight the stage for the selection.
      topBarNavigation: false,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Show character / motion / frame",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              "ViewerAddress, e.g. `{ \"contentSet\": \"lumi\", \"motion\": \"attack\", \"frame\": 7 }`. `motion` selects a motion; `ref` opens a reference image in the stage instead (mutually exclusive with `motion`); `frame` seeks to that 0-based frame and pauses.",
            required: true,
          },
        },
        description:
          "Point the stage at a character, a motion, a reference, or one frame. Call it before `capture` so you screenshot what you mean, and after finishing a motion so the user lands on the thing you just made.",
      },
      {
        id: "play",
        label: "Play motion",
        category: "ui",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              "Optional ViewerAddress of the motion to play. Omit to play whatever is selected.",
          },
          fps: {
            type: "number",
            description:
              "Optional playback fps for this playback only; does not change the motion's stored fps.",
          },
          loop: {
            type: "boolean",
            description:
              "Optional loop override for this playback only; does not change the motion's stored loop flag.",
          },
        },
        description:
          "Run the motion on the stage. Use it to check timing the way the user will see it — a sheet PNG cannot tell you whether a walk cycle reads at 10 fps.",
      },
      {
        id: "pause",
        label: "Pause playback",
        category: "ui",
        agentInvocable: true,
        params: {},
        description:
          "Stop the stage on the current frame. Call it before capturing a specific frame so the screenshot is not a blur of whichever frame landed.",
      },
      {
        id: "get-playback-state",
        label: "Read what the stage shows",
        category: "custom",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              "Optional ViewerAddress to read instead of the current selection.",
          },
        },
        description:
          "Read back what the stage is actually showing: `{ contentSet, motion, kind, frame, frameCount, fps, loop, playing, source: \"frames\" | \"raw-sheet\" | \"keyframe\" | \"none\", warnings }`. Call it after a pipeline run — `source: \"raw-sheet\"` or a frameCount that disagrees with the grid means the run did not land, whatever the script printed. `kind` is `\"loop\"` on a loop motion and absent on a sprite motion; `source: \"keyframe\"` is a loop showing the image its clip starts and ends on because no frames exist yet, which is expected while the clip renders.",
      },
    ],
    // User → agent. The viewer renders these only while `editing !== false`,
    // so the hosted player shows a motion without offering to change it.
    //
    // `description` is the ONE-LINE HINT THE USER READS on hover. It used to
    // be the agent's briefing — script names, flags and all — and three blind
    // testers in a row hovered a button and got prose written past them
    // ("the UI is talking to the AI"). The agent's briefing for these same
    // three commands lives in the skill's Commands section, which is where a
    // sentence about `align --smooth` belongs; nothing here may name a
    // script, a flag or a file.
    commands: [
      {
        id: "render-video",
        label: "Render video preview",
        description:
          "Ask for a short video clip of this motion — you choose the model and how it is generated.",
      },
      {
        id: "regenerate-motion",
        label: "Regenerate this motion",
        description:
          "Draw this motion again, keeping the same name — add a note if something should change.",
      },
      {
        id: "fix-alignment",
        label: "Frames are misaligned",
        description:
          "Say the character slides or jumps between frames, and the agent re-aligns them.",
      },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Sprite Mode" skill="pneuma-sprite" session="new"></system-info>
The user just opened the sprite workspace. Greet them briefly (1-2 sentences) and mention that you start by designing a character — a name, a look, a style — and then generate motions for it.`,
  },

  init: {
    contentCheckPattern: "**/project.json",
    // One content set per seed card. The key is the source path (relative to
    // the repo root for a builtin mode), the value the destination inside the
    // workspace — so this copies `modes/sprite/seed/lumi/` to `<workspace>/lumi/`,
    // which is exactly one character directory, ready to play.
    seedFiles: {
      "modes/sprite/seed/lumi/": "lumi/",
    },
    seeds: [
      {
        id: "lumi",
        sourceKey: "modes/sprite/seed/lumi/",
        thumbnail: "lumi.png",
        displayName: {
          en: "Lumi — lantern courier",
          "zh-CN": "Lumi · 提灯信使",
          ja: "Lumi — 提灯の配達人",
        },
        description: {
          en: "A chibi courier with a floating paper lantern: two finished motions (16-frame idle loop and a lantern-swing attack), each with frames, atlas, GIF/WebP previews — plus one Seedance clip.",
          "zh-CN": "带着飘浮纸灯笼的 Q 版信使：两套做完的动作（16 帧待机循环 + 提灯挥击），各自带切好的帧、atlas 与 GIF/WebP 预览，外加一段 Seedance 短片。",
          ja: "浮かぶ提灯を連れたちび配達人。完成済みモーション 2 種（16 コマの待機ループと提灯スイング）に、フレーム・アトラス・GIF/WebP プレビュー、そして Seedance のクリップ 1 本。",
        },
        tags: ["chibi", "sprite-sheet"],
      },
    ],
    params: [
      {
        name: "openrouterApiKey",
        label: "OpenRouter API Key",
        description:
          "Required — GPT Image 2.5 draws every reference and every motion sheet through OpenRouter",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "falApiKey",
        label: "fal.ai API Key",
        description:
          "Optional — enables video previews and loop clips (Seedance 2.5 / MiniMax H3 Max), video matting and frame interpolation for a loop, and fal background removal for sheets that come back opaque",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "defaultVideoModel",
        label: "Default video model",
        description: "Which model renders a motion's video preview by default",
        type: "select",
        options: [
          {
            value: "seedance-2.5",
            label: "Seedance 2.5",
            description:
              "Cheap and quick at 480p; image, first-last and reference-to-video all available",
          },
          {
            value: "h3-max",
            label: "MiniMax H3 Max",
            description:
              "The alternative — stronger motion, slower and pricier; minimum 5 s",
          },
        ],
        defaultValue: "seedance-2.5",
      },
      {
        name: "defaultInterpolator",
        label: "Default frame interpolation",
        description:
          "Which path takes a loop clip to a higher frame rate when the user asks for one",
        type: "select",
        options: [
          {
            value: "topaz",
            label: "Topaz on fal",
            description:
              "Exactly 60 fps, sharpest in-betweens, ≈ $0.10 per 5 s clip",
          },
          {
            value: "rife",
            label: "RIFE on fal",
            description:
              "2× or 3× the rate, closes the wrap, cheaper — ≈ $0.03 per 5 s clip",
          },
          {
            value: "ffmpeg",
            label: "ffmpeg minterpolate",
            description:
              "Free, inside `sprite-sheet.mjs loop --fps`; the weakest in-betweens",
          },
        ],
        defaultValue: "topaz",
      },
    ],
    // The installer's template engine has `{{#key}}` sections and no inverted
    // form, so "no fal key" needs its own truthy key — otherwise the sentence
    // that tells the agent video is off has to sit outside the gate, where a
    // session that CAN render video reads it too.
    deriveParams: (params) => ({
      ...params,
      imageGenEnabled: params.openrouterApiKey ? "true" : "",
      videoGenEnabled: params.falApiKey ? "true" : "",
      videoGenDisabled: params.falApiKey ? "" : "true",
    }),
  },

  evolution: {
    directive: `Learn the user's character and animation preferences: art style (chibi / pixel /
anime / painterly), the grid and frame count they use per motion type, fps and loop conventions,
anchor choice, which video model they render with and how they phrase those prompts, and recurring
motion vocabularies (idle / walk / attack sets). Evidence comes from session history and
project.json changes. Write them back into this skill's defaults so a new character starts from the
user's house style while explicit instructions still win.`,
  },
};

export default spriteManifest;
