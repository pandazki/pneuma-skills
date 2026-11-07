/**
 * The chat view: a phone-width conversation that sends the pack's stickers
 * in order, back and forth, on the light or dark chat plate — how the pack
 * feels in use, and what a stranger sees first through a share link.
 *
 * Everything inside the phone is CONTENT (a chat app's own colours), not
 * Pneuma chrome. Tapping a sticker in the tray sends it into the thread;
 * that is local, throwaway state — nothing is written.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { StickerPack, StickerView } from "../domain.js";
import { StickerLoop } from "./StickerLoop.js";
import { mediaUrl } from "./media.js";
import type { StickerStrings } from "./strings.js";
import { Icon } from "./ui.js";
import { PLATE_COLORS, type Plate } from "./view-model.js";

/** The size a sticker plays at in a chat thread. */
export const CHAT_SIZE = 120;

const PHONE: Record<Plate, { bar: string; field: string; ink: string; soft: string; tray: string; line: string }> = {
  light: { bar: "#F7F7F7", field: "#FFFFFF", ink: "#191919", soft: "#8C8C8C", tray: "#F2F2F2", line: "rgba(0,0,0,0.08)" },
  dark: { bar: "#1E1E1E", field: "#2B2B2B", ink: "#E8E8E8", soft: "#7D7D7D", tray: "#191919", line: "rgba(255,255,255,0.07)" },
};

function Avatar({ side }: { side: "them" | "me" }) {
  const bg = side === "me" ? "linear-gradient(135deg,#f6c08a,#e88d4f)" : "linear-gradient(135deg,#a9bfd8,#7d97b8)";
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-white/90" style={{ background: bg }} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="9" r="4" />
        <path d="M4.5 20.5c.8-4 3.9-6.5 7.5-6.5s6.7 2.5 7.5 6.5z" />
      </svg>
    </span>
  );
}

interface Message {
  key: string;
  side: "them" | "me";
  sticker: StickerView;
}

export function ChatView({ value, plate, base, t }: { value: StickerPack; plate: Plate; base: string; t: StickerStrings }) {
  const sendable = useMemo(() => value.stickers.filter((s) => mediaUrl(base, s.shown)), [value, base]);
  const [sent, setSent] = useState<Message[]>([]);
  const [tray, setTray] = useState(true);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const colors = PHONE[plate];

  const thread: Message[] = useMemo(
    () => [...sendable.map((s, i): Message => ({ key: `seed-${s.id}`, side: i % 2 === 0 ? "them" : "me", sticker: s })), ...sent],
    [sendable, sent],
  );

  useEffect(() => {
    if (!sent.length) return;
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [sent.length]);

  const iconSource = value.art.find((a) => a.kind === "head")?.asset ?? value.character?.asset ?? null;
  const iconUrl = mediaUrl(base, iconSource?.status === "ready" ? iconSource : null);

  return (
    <div className="flex h-full min-h-0 justify-center overflow-auto px-4 py-4">
      <div
        data-chat
        data-plate={plate}
        className="flex h-full max-h-[860px] min-h-[520px] w-[390px] max-w-full flex-col overflow-hidden rounded-[30px] border border-cc-border shadow-[0_24px_64px_rgba(0,0,0,0.45)]"
        style={{ backgroundColor: PLATE_COLORS[plate] }}
      >
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2.5 pt-3.5" style={{ backgroundColor: colors.bar, color: colors.ink, borderBottom: `1px solid ${colors.line}` }}>
          <Icon.Back size={18} />
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-[15px] font-semibold">{value.title || t.untitled}</div>
            <div className="text-[10.5px]" style={{ color: colors.soft }}>
              {t.chatPreview}
            </div>
          </div>
          <span className="w-[18px]" />
        </header>

        <div ref={threadRef} data-thread className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="mb-3 flex justify-center">
            <span className="rounded-md px-2 py-0.5 text-[11px]" style={{ color: colors.soft }}>
              {t.today} 09:41
            </span>
          </div>
          {thread.length === 0 ? (
            <p className="mt-16 text-center text-[12.5px]" style={{ color: colors.soft }}>
              {t.chatEmpty}
            </p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {thread.map((m) => (
                <div key={m.key} data-message={m.sticker.id} data-side={m.side} className={`flex items-start gap-2 ${m.side === "me" ? "flex-row-reverse" : ""}`}>
                  <Avatar side={m.side} />
                  <StickerLoop value={value} sticker={m.sticker} take={m.sticker.shown} base={base} size={CHAT_SIZE} alt={m.sticker.sticker.word} t={t} />
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="shrink-0" style={{ backgroundColor: colors.bar, borderTop: `1px solid ${colors.line}`, color: colors.ink }}>
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span style={{ color: colors.ink }}>
              <Icon.Mic size={22} />
            </span>
            <div className="h-9 flex-1 rounded-md px-3 text-[13px] leading-9" style={{ backgroundColor: colors.field, color: colors.soft }}>
              {t.messagePlaceholder}
            </div>
            <button
              type="button"
              aria-label={t.stickerTray}
              aria-pressed={tray}
              data-tray-toggle
              onClick={() => setTray((v) => !v)}
              className="rounded-full focus-visible:ring-2 focus-visible:ring-cc-primary/60"
              style={{ color: tray ? "#f97316" : colors.ink }}
            >
              <Icon.Smile size={24} />
            </button>
            <Icon.Plus size={24} />
          </div>
          {tray ? (
            <div data-tray style={{ backgroundColor: colors.tray, borderTop: `1px solid ${colors.line}` }}>
              <div className="grid grid-cols-4 gap-1.5 px-3 pb-1 pt-3">
                {sendable.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    data-send={s.id}
                    aria-label={s.sticker.word}
                    onClick={() => setSent((list) => [...list, { key: `sent-${list.length}`, side: "me", sticker: s }])}
                    className="grid aspect-square place-items-center rounded-lg transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-cc-primary/60"
                  >
                    <StickerLoop value={value} sticker={s} take={s.shown} base={base} size="86%" alt={s.sticker.word} t={t} note="icon" />
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 px-3 pb-2.5 pt-1" style={{ borderTop: `1px solid ${colors.line}` }}>
                <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-md" style={{ backgroundColor: colors.field }}>
                  {iconUrl ? <img src={iconUrl} alt="" crossOrigin="anonymous" className="h-7 w-7 object-contain" /> : <Icon.Sticker size={16} />}
                </span>
                <span className="text-[10.5px]" style={{ color: colors.soft }}>
                  {t.trayHint}
                </span>
              </div>
            </div>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
