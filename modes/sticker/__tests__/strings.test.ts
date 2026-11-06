/**
 * The viewer speaks the user's Pneuma language (`props.locale`): Chinese,
 * Japanese, else English. Every table must say everything, so a Chinese
 * user never meets an English word the Chinese table forgot — including
 * what the rules say: every code `sticker-state.mjs` can emit has a string
 * in every language, and none of them carries CLI syntax.
 */

import { describe, expect, test } from "bun:test";

import * as S from "../skill/scripts/sticker-state.mjs";
import type { Platform, StateMessage } from "../skill/scripts/sticker-state.mjs";
import { resolveLocale, stickerStrings, STICKER_MESSAGE_TABLES, STICKER_STRING_TABLES, STICKER_TERM_TABLES } from "../viewer/strings.js";
import { allMessages, englishIn, sampleMessages } from "./message-samples.js";
import { finishedWorkspace, richWorkspace } from "./pack-workspace.js";
import { packFrom } from "./sticker-fixture.js";

const SAMPLE: unknown[] = [3, 2, "1 min"];
const LOCALES = ["en", "zh-CN", "ja"] as const;

function render(key: string, value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    if (key === "say") return sampleMessages().map((m) => String((value as (m: StateMessage) => string)(m)));
    if (key === "status") return ["empty", "generating", "failed", "pick", "ready", "stale"].map((s) => String((value as (...a: unknown[]) => string)(s, 2, "3 s")));
    if (key === "artKind") return ["portrait", "head", "banner", "reward-guide", "reward-thanks"].map((k) => String((value as (k: string) => string)(k)));
    if (key === "archiveState") return ["current", "stale", "missing", "blocked"].map((k) => String((value as (k: string) => string)(k)));
    if (key === "exportSummary") return [String((value as (c: unknown) => string)({ current: 1, stale: 1, missing: 1, blocked: 1 }))];
    if (key === "rightsBasis") return ["original", "own-pet", "self", "consenting-adult", "client"].map((k) => String((value as (k: string) => string)(k)));
    if (key === "rowLabel") return ["rights", "count", "words", "zip", "listing-name", "cover"].map((id) => String((value as (p: string, r: unknown) => string)("wechat", { id, label: "fallback" })));
    if (key === "deliverableLabel") return ["cover", "icon", "banner"].map((d) => String((value as (p: string, d: string) => string)("wechat", d)));
    if (key === "listingLabel") return ["title", "creator"].map((f) => String((value as (p: string, f: string) => string)("line", f)));
    return [String((value as (...a: unknown[]) => unknown)(...SAMPLE))];
  }
  return Object.values(value as Record<string, string>);
}

/** Every message the rules emit over the fixture workspaces. */
function emitted(): StateMessage[] {
  const out: StateMessage[] = [];
  for (const workspace of [richWorkspace(), finishedWorkspace()]) {
    const pack = packFrom(workspace.raw);
    const doc = workspace.doc;
    for (const s of pack.stickers) out.push(...S.stickerState(pack, doc, s.id).messages);
    for (const platform of S.PLATFORMS) {
      for (const row of S.checkPack(pack, doc, platform)) out.push(row.message);
      for (const item of S.exportState(pack, doc, platform).items) if (item.message) out.push(item.message);
    }
    out.push(S.nextStep(pack, doc).message);
  }
  return out.flatMap(allMessages);
}

describe("viewer strings", () => {
  test("Chinese and Japanese users get their tables; everything else falls back to English", () => {
    for (const locale of ["zh", "zh-CN", "zh-TW"]) expect(resolveLocale(locale)).toBe("zh-CN");
    for (const locale of ["ja", "ja-JP"]) expect(resolveLocale(locale)).toBe("ja");
    for (const locale of ["en", "en-US", "fr", undefined]) expect(resolveLocale(locale)).toBe("en");
    expect(stickerStrings("zh").makeMissing).toBe("补齐没出图的表情");
    expect(stickerStrings("ja").view.submit).toBe("申請");
  });

  test("every table defines every key, and every entry renders text", () => {
    const en = STICKER_STRING_TABLES.en as unknown as Record<string, unknown>;
    for (const locale of ["zh-CN", "ja"] as const) {
      const table = STICKER_STRING_TABLES[locale] as unknown as Record<string, unknown>;
      expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        expect(typeof table[key]).toBe(typeof en[key]);
        for (const text of render(key, table[key])) {
          expect(text.length).toBeGreaterThan(0);
          expect(text).not.toContain("undefined");
        }
      }
    }
    for (const key of Object.keys(en)) for (const text of render(key, en[key])) expect(text).not.toContain("undefined");
  });

  test("the Chinese and Japanese chrome is in Chinese and Japanese", () => {
    const zh = stickerStrings("zh-CN");
    const ja = stickerStrings("ja");
    for (const s of ["empty", "generating", "failed", "pick", "ready", "stale"] as const) {
      expect(zh.status(s, 2, "3 秒")).toMatch(/[一-鿿]/);
      expect(ja.status(s, 2, "3 秒")).toMatch(/[぀-ヿ一-鿿]/);
    }
    expect(zh.noPackBody).toMatch(/[一-鿿]/);
    expect(ja.noPackBody).toMatch(/[぀-ヿ]/);
  });
});

describe("what the rules say, in every language", () => {
  test("every code the module can emit has a string in every locale", () => {
    for (const locale of LOCALES) {
      const table = STICKER_MESSAGE_TABLES[locale] as unknown as Record<string, unknown>;
      const missing = S.MESSAGE_CODES.filter((code) => typeof table[code] !== "function");
      expect({ locale, missing }).toEqual({ locale, missing: [] });
      expect(Object.keys(table).sort()).toEqual([...S.MESSAGE_CODES].sort());
    }
  });

  test("a sample of every code renders in every locale: no holes, and Chinese and Japanese carry no English words", () => {
    for (const locale of LOCALES) {
      const t = stickerStrings(locale);
      for (const message of sampleMessages()) {
        const text = t.say(message);
        expect({ code: message.code, text }).toEqual({ code: message.code, text: expect.stringMatching(/\S/) });
        expect(text).not.toMatch(/undefined|NaN|\[object|null/);
        if (locale !== "en") expect({ code: message.code, english: englishIn(text) }).toEqual({ code: message.code, english: [] });
      }
    }
  });

  test("no locale says a CLI command or a pack.json path — those are the agent's", () => {
    // A read-only page (a share link) shows `say` and nothing else; the
    // viewer adds `message.command` only while it can write.
    for (const locale of LOCALES) {
      const t = stickerStrings(locale);
      for (const message of sampleMessages()) {
        expect({ code: message.code, text: t.say(message) }).toEqual({ code: message.code, text: expect.not.stringMatching(/sticker\.mjs|--platform|--only|pack\.json|project\.json|listing\.\w+\.|stickers\[\]/) });
      }
    }
  });

  test("everything the rules emit over the fixtures renders in every locale", () => {
    const messages = emitted();
    expect(messages.length).toBeGreaterThan(40);
    for (const locale of LOCALES) {
      const t = stickerStrings(locale);
      for (const message of messages) expect(t.say(message)).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  test("the module's English stays the CLI's: a command follows the meaning there, never in the viewer", () => {
    const missing = { code: "zip.missing", params: { platform: "wechat" }, command: "sticker.mjs export --platform wechat" } as const;
    expect(S.messageText(missing)).toBe("missing — sticker.mjs export --platform wechat");
    expect(stickerStrings("en").say(missing)).toBe("not made yet");
    expect(stickerStrings("zh-CN").say(missing)).toBe("还没打包");
    expect(stickerStrings("ja").say(missing)).toBe("まだ作っていません");
  });
});

describe("platform terms", () => {
  test("every deliverable and listing field of every platform is named in every locale", () => {
    for (const locale of LOCALES) {
      for (const [platform, profile] of Object.entries(S.PLATFORM_PROFILES) as Array<[Platform, S.PlatformProfile]>) {
        expect(Object.keys(STICKER_TERM_TABLES.deliverables[locale][platform]).sort()).toEqual(Object.keys(profile.deliverables).sort());
        expect(Object.keys(STICKER_TERM_TABLES.listing[locale][platform]).sort()).toEqual(Object.keys(profile.text).sort());
      }
    }
  });

  test("every checklist row is named in Chinese and Japanese, not with the module's English label", () => {
    const pack = packFrom(richWorkspace().raw);
    const raw = richWorkspace().raw;
    raw.listing.wechat.rewardLine = "谢谢你的赞赏";
    const rewarded = packFrom(raw);
    for (const locale of ["zh-CN", "ja"] as const) {
      const t = stickerStrings(locale);
      for (const p of [pack, rewarded]) {
        for (const platform of S.PLATFORMS) {
          for (const row of S.checkPack(p, richWorkspace().doc, platform)) {
            const name = t.rowLabel(platform, row);
            if (row.id.startsWith("sticker-")) expect(name).toBe(row.label);
            else expect({ id: row.id, english: englishIn(name) }).toEqual({ id: row.id, english: [] });
          }
        }
      }
    }
  });
});
