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
 * This is the TASK-1 manifest (identity, skill block, shared scripts, keys);
 * the viewer, sources, init params and registration arrive with TASK-2
 * (docs/proposals/2026-11-06-sticker-mode.md).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const stickerManifest: ModeManifest = {
  name: "sticker",
  version: "0.1.0",
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

  skill: {
    sourceDir: "skill",
    installName: "pneuma-sticker",
    envMapping: {
      FAL_KEY: "falApiKey",
      OPENROUTER_API_KEY: "openrouterApiKey",
    },
    // sharedScripts is a WHITELIST and it is transitive: every shared script
    // a mode script imports has to be listed even when the agent never runs
    // it directly. sticker.mjs imports craft-project.mjs (pure rules),
    // craft-project-io.mjs (atomic load/save, runRegistered), generate_gif.mjs
    // (sticker takes; its readGifInfo is the frame-count authority),
    // generate_image.mjs (character and art) and fal-queue.mjs (fal key,
    // no-clobber writes; also imported by generate_gif.mjs and
    // craft-project-io.mjs); sticker-media.mjs imports zip.mjs (the upload
    // archives and the PNG CRC).
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
    // The viewer's text inputs and nothing else (media is read from
    // /content/<uri>?r=<createdAt>, never through the watcher).
    watchPatterns: ["pack.json", "project.json"],
    ignorePatterns: ["node_modules/**", ".pneuma/**", "inspect/**"],
    serveDir: ".",
  },
};

export default stickerManifest;
