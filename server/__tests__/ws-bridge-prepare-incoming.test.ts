/**
 * Tests for `WsBridge.prepareIncomingUserMessage` — the backend-agnostic
 * ingest step every BridgeBackend funnels uploads through. The earlier
 * codex/kimi paths silently dropped `msg.files` and `msg.images`; this
 * suite locks in the shared contract so all three backends stay aligned.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WsBridge } from "../ws-bridge.js";

function makeBridge(): { bridge: WsBridge; workspace: string; sessionId: string } {
  const workspace = mkdtempSync(join(tmpdir(), "pneuma-bridge-upload-"));
  const bridge = new WsBridge();
  bridge.setWorkspace(workspace);
  const sessionId = "test-session";
  bridge.getOrCreateSession(sessionId, "kimi-cli");
  return { bridge, workspace, sessionId };
}

describe("WsBridge.prepareIncomingUserMessage", () => {
  let ctx: ReturnType<typeof makeBridge>;

  beforeEach(() => {
    ctx = makeBridge();
  });

  afterEach(() => {
    rmSync(ctx.workspace, { recursive: true, force: true });
  });

  test("saves uploaded files to .pneuma/uploads/ and references them in the notification", () => {
    const session = ctx.bridge.getSession(ctx.sessionId)!;
    const html = "<html><body>Tanka Flow 2026</body></html>";
    const base64 = Buffer.from(html, "utf-8").toString("base64");

    const result = ctx.bridge.prepareIncomingUserMessage(
      session,
      {
        content: "have a look",
        files: [
          {
            name: "Tanka Flow 2026.html",
            media_type: "text/html",
            data: base64,
            size: html.length,
          },
        ],
      },
      { inlineImagesSupported: true },
    );

    const uploadsDir = join(ctx.workspace, ".pneuma", "uploads");
    const saved = readdirSync(uploadsDir);
    expect(saved.length).toBe(1);
    expect(saved[0]).toMatch(/Tanka Flow 2026\.html$/);

    // .html under TEXT_INLINE_LIMIT (32KB) → inlined into the notification body.
    expect(result.textContent).toContain("<uploaded-files");
    expect(result.textContent).toContain(saved[0]);
    expect(result.textContent).toContain('size="');
    expect(result.textContent).toContain(html);
    expect(result.textContent.endsWith("have a look")).toBe(true);

    // History entry carries the saved path + size.
    const last = session.messageHistory[session.messageHistory.length - 1];
    expect(last.type).toBe("user_message");
    expect((last as { files?: { name: string; size: number; path: string }[] }).files).toEqual([
      { name: "Tanka Flow 2026.html", size: html.length, path: join(uploadsDir, saved[0]) },
    ]);
  });

  test("over-32KB text file is saved but only referenced by path (no inline body)", () => {
    const session = ctx.bridge.getSession(ctx.sessionId)!;
    const big = "x".repeat(40 * 1024);
    const base64 = Buffer.from(big, "utf-8").toString("base64");

    const result = ctx.bridge.prepareIncomingUserMessage(
      session,
      {
        content: "see attached",
        files: [{ name: "big.html", media_type: "text/html", data: base64, size: big.length }],
      },
      { inlineImagesSupported: true },
    );

    expect(result.textContent).toContain("<uploaded-files");
    expect(result.textContent).toContain("big.html");
    // No inline body for oversize text files — agent has to Read it.
    expect(result.textContent).not.toContain(big);
    // Self-closing tag form.
    expect(result.textContent).toMatch(/<file path="[^"]+" name="big\.html" size="[^"]+" \/>/);
  });

  test("inline-eligible images come back as inlineImages and are saved to disk", () => {
    const session = ctx.bridge.getSession(ctx.sessionId)!;
    // 8-byte fake PNG payload — well under the 5MB inline limit.
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

    const result = ctx.bridge.prepareIncomingUserMessage(
      session,
      {
        content: "describe this",
        images: [{ media_type: "image/png", data }],
      },
      { inlineImagesSupported: true },
    );

    const uploadsDir = join(ctx.workspace, ".pneuma", "uploads");
    const saved = readdirSync(uploadsDir);
    expect(saved.length).toBe(1);
    expect(saved[0]).toMatch(/\.png$/);

    expect(result.inlineImages.length).toBe(1);
    expect(result.inlineImages[0].media_type).toBe("image/png");
    expect(result.inlineImages[0].data).toBe(data);

    // Notification still lists the image so the agent has the disk path.
    expect(result.textContent).toContain("<image path=");
    expect(result.textContent).not.toContain('large="true"');
  });

  test("text-only backend (inlineImagesSupported=false) drops inline images, marks them large in the notification", () => {
    const session = ctx.bridge.getSession(ctx.sessionId)!;
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

    const result = ctx.bridge.prepareIncomingUserMessage(
      session,
      {
        content: "describe this",
        images: [{ media_type: "image/png", data }],
      },
      { inlineImagesSupported: false },
    );

    // File still saved to disk so the agent can Read it.
    const uploadsDir = join(ctx.workspace, ".pneuma", "uploads");
    expect(readdirSync(uploadsDir).length).toBe(1);

    // No inline payload returned — kimi's adapter doesn't accept image blocks.
    expect(result.inlineImages).toEqual([]);

    // Notification marks the image large so the agent knows to use Read.
    expect(result.textContent).toContain('large="true"');
    expect(result.textContent).toContain('hint="');
  });

  test("drains pendingEnvContext into the prefix and clears the buffer", () => {
    const session = ctx.bridge.getSession(ctx.sessionId)!;
    session.pendingEnvContext.push("<pneuma:env locale=\"zh-CN\" />");
    session.pendingEnvContext.push("<pneuma:env handoff=\"from-doc\" />");

    const result = ctx.bridge.prepareIncomingUserMessage(
      session,
      { content: "hi" },
      { inlineImagesSupported: true },
    );

    expect(result.textContent.startsWith("<pneuma:env locale=\"zh-CN\" />")).toBe(true);
    expect(result.textContent).toContain("<pneuma:env handoff=\"from-doc\" />");
    expect(result.textContent.endsWith("hi")).toBe(true);
    // One-shot — buffer cleared.
    expect(session.pendingEnvContext.length).toBe(0);
  });

  test("no uploads + empty env queue → textContent is just the original content", () => {
    const session = ctx.bridge.getSession(ctx.sessionId)!;
    const result = ctx.bridge.prepareIncomingUserMessage(
      session,
      { content: "plain message" },
      { inlineImagesSupported: true },
    );
    expect(result.textContent).toBe("plain message");
    expect(result.inlineImages).toEqual([]);
  });

  test("file-save error doesn't break the message — content still flows through", () => {
    const session = ctx.bridge.getSession(ctx.sessionId)!;
    // Force the save to fail by pointing at a path that can't be created.
    ctx.bridge.setWorkspace(join(ctx.workspace, "definitely", "not", "writable", "\0", "bad"));
    const result = ctx.bridge.prepareIncomingUserMessage(
      session,
      {
        content: "should still send",
        files: [{ name: "x.txt", media_type: "text/plain", data: Buffer.from("hi").toString("base64"), size: 2 }],
      },
      { inlineImagesSupported: true },
    );
    // Notification is empty because no files saved, but the user content reaches the agent.
    expect(result.textContent).toBe("should still send");
  });
});
