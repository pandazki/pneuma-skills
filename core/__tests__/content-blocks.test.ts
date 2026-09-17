/**
 * The shared assistant-content merge rule (`core/utils/content-blocks.ts`).
 *
 * Both the bridge (`server/ws-bridge.ts::handleAssistantMessage`, persisting
 * `messageHistory`) and the browser (`src/store/helpers.ts::mergeContentBlocks`,
 * rendering the chat) fold Claude's one-frame-per-content-block delivery with
 * this function. It used to be written twice with a "change one and change the
 * other" comment; these cases are the contract both ends now share.
 */

import { describe, expect, test } from "bun:test";
import { containsAllBlocks, mergeContentBlocks } from "../utils/content-blocks.js";
import { mergeContentBlocks as mergeForChat } from "../../src/store/helpers.js";
import type { ContentBlock } from "../../src/types.js";

const toolUse: ContentBlock = {
  type: "tool_use", id: "toolu_judge", name: "Task", input: { description: "Judge" },
};
const text: ContentBlock = { type: "text", text: "Spawned the judge." };

describe("mergeContentBlocks", () => {
  test("keeps existing blocks first, then appends the new ones", () => {
    expect(mergeContentBlocks<ContentBlock>([toolUse], [text])).toEqual([toolUse, text]);
  });

  test("a repeated frame is a no-op (JSON identity)", () => {
    expect(mergeContentBlocks<ContentBlock>([toolUse, text], [{ ...toolUse }])).toEqual([toolUse, text]);
  });

  test("two calls of the same tool differ by id and both survive", () => {
    const second: ContentBlock = { ...toolUse, id: "toolu_builder" };
    expect(mergeContentBlocks<ContentBlock>([toolUse], [second])).toEqual([toolUse, second]);
  });

  test("duplicates inside one side are collapsed too", () => {
    expect(mergeContentBlocks<ContentBlock>([text, { ...text }], [])).toEqual([text]);
  });

  test("missing / empty sides are tolerated and yield an array", () => {
    expect(mergeContentBlocks<ContentBlock>(undefined, undefined)).toEqual([]);
    expect(mergeContentBlocks<ContentBlock>(undefined, [text])).toEqual([text]);
    expect(mergeContentBlocks<ContentBlock>([text], undefined)).toEqual([text]);
  });

  test("neither input is mutated", () => {
    const prev = [toolUse];
    const next = [text];
    mergeContentBlocks<ContentBlock>(prev, next);
    expect(prev).toEqual([toolUse]);
    expect(next).toEqual([text]);
  });
});

describe("containsAllBlocks", () => {
  test("true when every block is already present by JSON identity", () => {
    expect(containsAllBlocks<ContentBlock>([toolUse, text], [{ ...toolUse }])).toBe(true);
  });

  test("false when any block is new", () => {
    expect(containsAllBlocks<ContentBlock>([toolUse], [toolUse, text])).toBe(false);
    expect(containsAllBlocks<ContentBlock>([toolUse], [{ ...toolUse, id: "other" }])).toBe(false);
  });

  test("an empty needle is not 'contained' — nothing to recognise as a re-emit", () => {
    expect(containsAllBlocks<ContentBlock>([toolUse], [])).toBe(false);
    expect(containsAllBlocks<ContentBlock>([toolUse], undefined)).toBe(false);
  });
});

describe("the chat-store wrapper", () => {
  test("applies the same rule", () => {
    expect(mergeForChat([toolUse], [text])).toEqual([toolUse, text]);
  });

  test("keeps `undefined` for a message that has no blocks at all", () => {
    // `ChatMessage.contentBlocks` is optional; an empty array would make a
    // plain-text message look like a message with zero blocks.
    expect(mergeForChat(undefined, undefined)).toBeUndefined();
    expect(mergeForChat([], [])).toBeUndefined();
  });
});
