/**
 * Sticker Pack Mode Manifest — pure data, no React deps.
 *
 * One photo or character image becomes a pack of animated chat stickers:
 * the same character in every sticker, each sticker a chat phrase with its
 * own motion and caption, exported and checked against WeChat, Telegram and
 * LINE submission rules. GPT Image 2.6 draws each sticker as a finished GIF
 * (fal); deterministic scripts record, measure, export, check and package.
 *
 * Two files, two kinds of writer:
 *   pack.json      the pack — text and the person's decisions; the agent
 *                  edits it and the viewer writes it
 *   project.json   the craft project: every media file with provenance and
 *                  cost, plus the `sticker` sidecar of measurements — only
 *                  `skill/scripts/sticker.mjs` writes it
 *
 * Every derived status (a sticker's prompt and staleness, export staleness,
 * the platform checklists) is computed by `skill/scripts/sticker-state.mjs`,
 * which the scripts and the viewer's `domain.ts` both import.
 *
 * Design brief: docs/proposals/2026-11-06-sticker-mode.md.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadPack, savePack } from "./domain.js";

const stickerManifest: ModeManifest = {
  name: "sticker",
  version: "0.1.0",
  changelog: {
    "0.1.0": [
      "One photo or character becomes a pack of animated chat stickers: the same character in every sticker, each a chat phrase with its own motion and caption, drawn by GPT Image 2.6 as a finished GIF",
      "The panel plays every sticker on a real chat background — light or dark — with one status each: no take yet, generating, failed (and whether it may have been billed), takes to pick, stale and why, or ready",
      "Open a sticker to see it at twice the size, step through its frames, compare its takes and pick one, and edit its word, caption, emoji and action; a changed caption says the take is stale until it is re-rolled",
      "The chat view sends the stickers in order in a phone-width conversation, so you see how the pack feels in use",
      "One submission tab per platform — WeChat, Telegram, LINE — shows the exported files at native size, the platform's checklist (the same rows the scripts print) and the listing text with character counters",
      "A finished pack can be shared as a read-only link",
    ],
  },
  displayName: {
    en: "Sticker Pack",
    "zh-CN": "表情包",
    ja: "スタンプ",
  },
  description: {
    en: "Turn one photo or character into a pack of animated chat stickers — the same character in every one, captioned, exported and checked for WeChat, Telegram and LINE.",
    "zh-CN": "把一张照片或一个角色做成一整套动态聊天表情——每张都是同一个角色，配好字，按微信、Telegram、LINE 的规范导出并逐项检查。",
    ja: "写真やキャラクター 1 枚から、動くチャットスタンプのセットを。どれも同じキャラクターで文字入り、WeChat・Telegram・LINE 向けに書き出して規定をチェックします。",
  },
  // A square sticker with a peeled corner and a small smile.
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 20.5H6a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 6 3.5h12A2.5 2.5 0 0 1 20.5 6v8z"/><path d="M14 20.5V17a3 3 0 0 1 3-3h3.5"/><path d="M8.5 12.5a3.5 3.5 0 0 0 5 0"/><path d="M9 8.5h.01M15 8.5h.01"/></svg>`,

  // Everything is a script the agent runs and an image it reads back (the
  // inspect contact sheet, a capture). No model-side image tool is
  // required, so both harnesses qualify.
  supportedBackends: ["claude-code", "codex"],

  skill: {
    sourceDir: "skill",
    installName: "pneuma-sticker",
    mdScene: `You and the user are making a pack of animated chat stickers: one locked character, each sticker a chat phrase with its own motion and caption. pack.json holds the pack — the character, the stickers' words, captions, emoji and actions, the picked takes and art, the listing text — and both of you edit it. The mode's scripts draw each sticker as a GIF with GPT Image 2.6, then export, measure and check the files for WeChat, Telegram and LINE, recording everything in the craft project (project.json). In front of the user is the sticker panel on a real chat background, a chat preview and one submission checklist per platform.`,
    envMapping: {
      FAL_KEY: "falApiKey",
      OPENROUTER_API_KEY: "openrouterApiKey",
    },
    // sharedScripts is a WHITELIST and it is transitive: every shared script
    // a mode script imports has to be listed even when the agent never runs
    // it directly. sticker.mjs imports craft-project.mjs (pure rules; also
    // bundled into the viewer through domain.ts), craft-project-io.mjs
    // (atomic load/save, runRegistered), generate_gif.mjs (sticker takes; its
    // readGifInfo is the frame-count authority), generate_image.mjs
    // (character and art) and fal-queue.mjs (fal key, no-clobber writes; also
    // imported by generate_gif.mjs and craft-project-io.mjs); sticker-media.mjs
    // imports zip.mjs (the upload archives and the PNG CRC).
    sharedScripts: [
      "craft-project.mjs",
      "craft-project-io.mjs",
      "fal-queue.mjs",
      "generate_gif.mjs",
      "generate_image.mjs",
      "zip.mjs",
    ],
  },

  viewer: {
    // EVERY pattern must end in a literal extension — the watcher derives
    // its file-type allowlist from these globs.
    //
    // THIS LIST IS THE VIEWER'S TEXT INPUTS AND NOTHING ELSE. Takes, art and
    // exports are read from /content/<uri>?r=<createdAt> (the craft asset's
    // landing time busts the cache); a media glob here would ship every GIF
    // as mangled text in each snapshot. project.json changes whenever a
    // script lands a file, which is what re-renders the viewer.
    watchPatterns: ["pack.json", "project.json"],
    ignorePatterns: ["node_modules/**", ".pneuma/**", "inspect/**"],
    serveDir: ".",
  },

  sources: {
    // A pack is ONE object assembled from two files: pack.json (the text and
    // the person's decisions) and project.json (every file, its provenance
    // and measurements). Every status the viewer draws comes from both
    // together through sticker-state.mjs, so they load as one aggregate.
    // `save` writes pack.json only: the viewer never writes machine state.
    pack: {
      kind: "aggregate-file",
      config: {
        patterns: ["pack.json", "project.json"],
        load: loadPack,
        save: savePack,
      },
    },
  },

  viewerApi: {
    workspace: {
      // One pack per workspace. The viewer owns its whole surface (panel,
      // chat, submission tabs); there is no item list for the TopBar.
      type: "single",
      multiFile: false,
      ordered: false,
      hasActiveFile: false,
      supportsContentSets: false,
      topBarNavigation: false,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Show a sticker / frame / take / art / platform export",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              'ViewerAddress. A sticker `{ "sticker": "s01" }`, one of its frames `{ "sticker": "s01", "frame": 3 }` (0-based, as in keepFrames and the inspect contact sheet), one take `{ "sticker": "s01", "take": "s01-take-2" }`, the character `{ "character": true }`, an art kind `{ "art": "portrait" }` (portrait, head, banner, reward-guide, reward-thanks). Add `"platform": "wechat" | "telegram" | "line"` to mean that platform\'s export of it (opens the submission tab); `{ "platform": "line" }` alone opens that tab.',
            required: true,
          },
        },
        description:
          "Put the viewer on the sticker, frame, take, art or platform export you are talking about, so the user sees what your sentence is about — and call it before `capture` so the screenshot is the thing you mean (a frame address freezes the stage on that frame; when the browser cannot show it — no frame decoder, a decode error, still decoding after 5 s — the reply fails with the reason and the stage plays the whole sticker, so do not capture it as that frame). A sticker, take, frame, art kind or platform that does not exist is refused by name and nothing moves; the reply's `data` says what the viewer shows.",
      },
      {
        id: "set-view",
        label: "Switch view and chat background",
        category: "ui",
        agentInvocable: true,
        params: {
          view: {
            type: "string",
            description: '"panel" (the sticker grid and inspector), "chat" (a phone-width conversation sending the stickers in order) or "submit" (one platform\'s checklist, exported files and listing text).',
            required: true,
          },
          platform: {
            type: "string",
            description: 'With "submit": "wechat", "telegram" or "line" — one of pack.platforms. Defaults to the tab already open, else the first platform.',
          },
          plate: {
            type: "string",
            description: '"light" (#EDEDED) or "dark" (#111111): the chat background every sticker plays on. Check a sticker on the dark plate before calling it done — a white fringe only shows there.',
          },
        },
        description:
          "Show the view you want the user (or a `capture`) to look at: the panel, the chat preview or a platform's submission tab, on the light or dark chat background. Refused when the platform is not one of pack.platforms.",
      },
    ],
    // User → agent. `description` is the ONE-LINE HINT THE USER READS — never
    // a script, a flag or a file name. The agent's briefing for each lives in
    // the skill.
    commands: [
      { id: "make-missing", label: "Make the missing stickers", description: "Generate a take for every sticker that has none yet" },
      { id: "export-check", label: "Export and check", description: "Export this platform's files and run its checklist" },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Sticker Mode" skill="pneuma-sticker" session="new"></system-info>
The user just opened the sticker workspace. Greet them briefly (1-2 sentences) in their language: if pack.json exists, name the character and the next step (\`sticker.mjs status\` prints it); otherwise ask whose sticker it is — a photo, their own character, their pet — and who will use it (friends, or a sticker store). If the fal key (sticker takes) or the OpenRouter key (character and art) is missing, say so in the same breath and name what still works without it.`,
  },

  init: {
    contentCheckPattern: "pack.json",
    // The seed is a real run, shipped as it came out and stopped before
    // export: the character redrawn from the anime-series 牛马 with its
    // provenance, eight everyday work-chat stickers with their re-rolls kept
    // as takes, and all art. Exports are left out to keep the catalog
    // download near 14 MB (31.6 MB with them); `export` rebuilds them free in
    // about half a minute, byte-identical to the run's own.
    seedFiles: {
      "modes/sticker/seed/niuma/": "./",
    },
    seeds: [
      {
        id: "niuma",
        sourceKey: "modes/sticker/seed/niuma/",
        displayName: {
          en: "Work Ox — eight stickers, ready to export",
          "zh-CN": "打工牛马 · 八张表情，就差导出",
          ja: "働く牛 —— 8 枚完成、書き出しはこれから",
        },
        description: {
          en: "A flat outlined ox who has had enough of the office, in eight everyday work-chat stickers. A real run, as it came out: the character, all eight stickers made and picked (the re-rolls are kept), and the cover, icon and banner art. The platform files are not made yet: ask the agent to export (free, about half a minute) to see the WeChat, Telegram and LINE checklists.",
          "zh-CN": "一头受够了上班的扁平描边牛马，八张打工日常聊天表情。这是一次真实的制作，原样保留：角色、八张已经做好并选定的表情（重画的那几张也留着），还有封面、图标和横幅配图。各平台的文件还没导出——让 agent 导出一下（免费，半分钟左右），就能看到微信、Telegram、LINE 的检查清单。",
          ja: "会社にうんざりしたフラットな線画の牛、仕事の日常で使えるスタンプ 8 枚。実際の制作をそのまま収録：キャラクター、作って選び終えた 8 枚（撮り直した分も残しています）、カバー・アイコン・バナーのアート。各プラットフォーム向けのファイルはまだ書き出していません —— エージェントに書き出しを頼めば（無料、30 秒ほど）、WeChat・Telegram・LINE のチェックリストが見られます。",
        },
        tags: ["sticker", "gif", "wechat", "telegram", "line"],
      },
    ],
    params: [
      {
        name: "falApiKey",
        label: "fal.ai API Key",
        description:
          "Optional — draws the stickers (GPT Image 2.6 animated GIFs). Without it every sticker's prompt is still assembled to paste into ChatGPT, and the GIF you bring back is recorded and checked like a generated one.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "openrouterApiKey",
        label: "OpenRouter API Key",
        description:
          "Optional — draws the character from your photo and the platform art (cover, icon, banner). Without it the prompts are still assembled and the images you bring are used as they are.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
    ],
    // The installer's template engine has `{{#key}}` sections and no inverted
    // form, so "no key" needs its own truthy key. The viewer reads the same
    // flags to say what cannot be generated here and why.
    deriveParams: (params) => ({
      ...params,
      stickersEnabled: params.falApiKey ? "true" : "",
      stickersDisabled: params.falApiKey ? "" : "true",
      imagesEnabled: params.openrouterApiKey ? "true" : "",
      imagesDisabled: params.openrouterApiKey ? "" : "true",
    }),
  },

  evolution: {
    directive: `Learn how this user makes sticker packs — the character styles they keep
(outline weight, palette, proportions), their caption voice and recurring
phrases, how big they like motions, which platforms they ship to, pack size,
what they re-roll and why, and what they spend per pack. Evidence: pack.json,
the craft project's takes, picks and costs, session history. Write them back as
this skill's defaults; explicit instructions still win.`,
  },
};

export default stickerManifest;
