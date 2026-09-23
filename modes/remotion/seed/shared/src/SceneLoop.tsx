// Scene 3 — HERO. One file, two views. Motion intent: hero.
// Left: the agent types slides/kyoto.html. Right: the viewer renders each element the moment its line lands.
// Then the user points at an item, the selection travels back as <viewer-context>, the agent edits, the viewer updates.
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, F, Label, TEXT_IN, exitSubject, exitText, expoInOut, tw } from "./theme";
import { FONT, SIZE, T } from "./locale";

const LOOP_DUR = 420;

// ---- Geometry (absolute px) -------------------------------------------------
const TOP = 150;
const H = 440;
const FILE_X = 80;
const FILE_W = 470;
const VIEW_X = 630;
const VIEW_W = 570;
const HEADER_H = 38;
const LINK_Y = TOP + 200;

const SLIDE_X = VIEW_X + 20;
const SLIDE_Y = TOP + HEADER_H + 22;
const SLIDE_W = VIEW_W - 40;
const SLIDE_H = Math.round((SLIDE_W * 9) / 16);

const LIST_Y = 150; // relative to slide
const LIST_STEP = 36;
const PICK = 1; // the <li> the user selects

// ---- Timeline (local frames) ------------------------------------------------
const TYPE_T0 = 26;
const TYPE_STEP = 10;
const CURSOR_IN = 132;
const CURSOR_AT = 166;
const CLICK = 170;
const ASK_T0 = 182;
const CHIP_T0 = 212;
const CHIP_T1 = 238;
const EDIT_T0 = 252;
const EDIT_DONE = 280;
const VIEW_UPDATE = 284;

const CODE = T.loop.code;
const EDIT_LINE = 5;
const NEW_LINE = T.loop.newLine;
const ASK = T.loop.ask;

const lineDone = (i: number) => TYPE_T0 + i * TYPE_STEP + 8;

const STEP_SPANS: [number, number][] = [
  [20, 150],
  [150, 246],
  [246, LOOP_DUR],
];
const STEPS = T.loop.steps.map((s, i) => ({ ...s, from: STEP_SPANS[i][0], to: STEP_SPANS[i][1] }));

const syntax = (s: string) => {
  // Minimal tag/text colouring: tags in terra-soft, text in paper.
  const parts = s.split(/(<[^>]+>)/g).filter(Boolean);
  return parts.map((p, i) => (
    <span key={i} style={{ color: p.startsWith("<") ? C.terraSoft : C.nightText }}>
      {p}
    </span>
  ));
};

const Pointer: React.FC<{ x: number; y: number; press: number; opacity: number }> = ({ x, y, press, opacity }) => (
  <svg
    width={24}
    height={30}
    viewBox="0 0 24 30"
    style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${1 - press * 0.12})`, transformOrigin: "0 0" }}
  >
    <path d="M1 1 L1 23 L7 17.5 L11 27 L15 25.2 L11 16 L19 16 Z" fill={C.ink} stroke={C.paper} strokeWidth={1.6} strokeLinejoin="round" />
  </svg>
);

const Loop: React.FC = () => {
  const f = useCurrentFrame();
  // Handoff: headline and stepper leave first; the panels stay until the first pillar's
  // image has wiped in over them.
  const textOut = exitText(f, LOOP_DUR);
  const subjOut = exitSubject(f, LOOP_DUR);

  // The panels replace the gap scene's two cards in place (same geometry), so they only fade up.
  const fileIn = tw(f, 0, 12);
  const viewIn = tw(f, 2, 14);

  // Cursor path
  const cx = tw(f, CURSOR_IN, CURSOR_AT, 1150, SLIDE_X + 32 + 170, expoInOut);
  const cy = tw(f, CURSOR_IN, CURSOR_AT, 660, SLIDE_Y + LIST_Y + PICK * LIST_STEP + 14, expoInOut);
  const press = tw(f, CLICK - 3, CLICK, 0, 1) * tw(f, CLICK, CLICK + 6, 1, 0);
  const cursorOpacity = tw(f, CURSOR_IN, CURSOR_IN + 8) * tw(f, CHIP_T0 + 20, CHIP_T0 + 34, 1, 0);

  // Selection
  const sel = tw(f, CLICK, CLICK + 10) * tw(f, VIEW_UPDATE + 18, VIEW_UPDATE + 34, 1, 0);
  const askIn = tw(f, ASK_T0 - 6, ASK_T0 + 6) * tw(f, CHIP_T0, CHIP_T0 + 10, 1, 0);
  const askChars = Math.floor(tw(f, ASK_T0, ASK_T0 + 22, 0, ASK.length, (t) => t));

  // Chip flight (viewer → agent)
  const chipP = tw(f, CHIP_T0, CHIP_T1, 0, 1, expoInOut);
  const chipX = SLIDE_X + 60 + (FILE_X + 22 - (SLIDE_X + 60)) * chipP;
  const chipY = SLIDE_Y + LIST_Y + PICK * LIST_STEP + 50 + (TOP + H - 92 - (SLIDE_Y + LIST_Y + PICK * LIST_STEP + 50)) * chipP;
  const chipVisible = f >= CHIP_T0 - 2 && f < CHIP_T1 + 4 ? 1 : 0;
  const inbox = tw(f, CHIP_T1 - 2, CHIP_T1 + 12);

  // Edit
  const hl = tw(f, EDIT_T0, EDIT_T0 + 8);
  const strike = tw(f, EDIT_T0 + 4, EDIT_T0 + 14);
  const newChars = Math.floor(tw(f, EDIT_T0 + 14, EDIT_DONE, 0, NEW_LINE.length, (t) => t));
  const edited = f >= EDIT_T0 + 14;
  const editTag = tw(f, EDIT_DONE, EDIT_DONE + 10);

  // Live pulse on the link: busy while typing and again after the edit
  const busy = (f > TYPE_T0 && f < lineDone(CODE.length - 1) + 6) || (f > EDIT_DONE - 4 && f < VIEW_UPDATE + 16);
  const pulseX = ((f * 3.2) % 80) / 80;

  const activeStep = STEPS.findIndex((s) => f >= s.from && f < s.to);

  return (
    <AbsoluteFill>
      {/* Headline */}
      <div style={{ position: "absolute", left: FILE_X, top: 42, opacity: tw(f, TEXT_IN, TEXT_IN + 18) * textOut }}>
        <Label color={C.terra}>Pneuma</Label>
        <div style={{ marginTop: 8, fontFamily: F.head, fontWeight: FONT.headWeight, fontSize: 36, color: C.ink }}>{T.loop.headline}</div>
      </div>
      <Label style={{ position: "absolute", right: 80, top: 100, opacity: tw(f, TEXT_IN + 8, TEXT_IN + 24) * textOut }}>
        {T.loop.aside}
      </Label>

      {/* Panels, slide, selection and pointer: the subject of this scene. */}
      <AbsoluteFill style={{ opacity: subjOut }}>
        {/* ---------------- File panel ---------------- */}
        <div
          style={{
            position: "absolute",
            left: FILE_X,
            top: TOP,
            width: FILE_W,
            height: H,
            background: C.night,
            borderRadius: 14,
            overflow: "hidden",
            boxShadow: "0 30px 60px -30px rgba(60,35,20,0.55)",
            opacity: fileIn,
          }}
        >
          <div
            style={{
              height: HEADER_H,
              display: "flex",
              alignItems: "center",
              padding: "0 18px",
              borderBottom: `1px solid ${C.nightLine}`,
              fontFamily: F.mono,
              fontSize: 12,
              color: C.nightMuted,
              justifyContent: "space-between",
            }}
          >
            <span>
              <span style={{ color: C.nightText }}>slides/kyoto.html</span>
            </span>
            <span>agent · native file tools</span>
          </div>

          <div style={{ padding: "16px 20px", fontFamily: F.mono, fontSize: 15, lineHeight: "30px" }}>
            {CODE.map((line, i) => {
              const t0 = TYPE_T0 + i * TYPE_STEP;
              const n = Math.floor(tw(f, t0, t0 + 8, 0, line.length, (t) => t));
              const isEdit = i === EDIT_LINE;
              const typingHere = f >= t0 && f < t0 + 10;
              return (
                <div key={i} style={{ position: "relative", display: "flex", whiteSpace: "pre", height: 30 }}>
                  <span style={{ width: 28, color: "rgba(233,223,205,0.25)", fontSize: 12 }}>{i + 1}</span>
                  {isEdit && (
                    <div
                      style={{
                        position: "absolute",
                        left: 22,
                        right: -20,
                        top: 0,
                        bottom: 0,
                        background: edited
                          ? `rgba(123,154,128,${0.22 * hl})`
                          : `rgba(186,83,52,${0.28 * hl})`,
                      }}
                    />
                  )}
                  <span style={{ position: "relative" }}>
                    {isEdit && edited ? (
                      syntax(NEW_LINE.slice(0, newChars))
                    ) : (
                      <>
                        {syntax(line.slice(0, n))}
                        {isEdit && strike > 0 && (
                          <span
                            style={{
                              position: "absolute",
                              left: 32,
                              top: 15,
                              height: 1.5,
                              width: `${strike * 80}%`,
                              background: C.terraSoft,
                            }}
                          />
                        )}
                      </>
                    )}
                    {(typingHere || (isEdit && f >= EDIT_T0 + 14 && f < EDIT_DONE + 2)) && (
                      <span style={{ display: "inline-block", width: 8, height: 17, marginLeft: 1, verticalAlign: -3, background: C.terra }} />
                    )}
                  </span>
                  {isEdit && (
                    <span
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        fontSize: 12,
                        color: C.sageSoft,
                        opacity: editTag,
                      }}
                    >
                      Edit +1 −1
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Inbox — what arrives from the viewer */}
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: 16,
              height: 66,
              borderRadius: 10,
              background: C.night2,
              border: `1px solid rgba(217,137,106,${0.45 * inbox})`,
              padding: "10px 14px",
              fontFamily: F.mono,
              fontSize: 12.5,
              lineHeight: "22px",
              opacity: inbox,
              transform: `translateY(${(1 - inbox) * 8}px)`,
            }}
          >
            <div style={{ color: C.terraSoft }}>
              {"<viewer-context>"} <span style={{ color: C.nightMuted }}>kyoto.html · slide 1 · li[2]</span>
            </div>
            <div style={{ color: C.nightText }}>
              <span style={{ color: C.nightMuted }}>user </span>
              {ASK}
            </div>
          </div>
        </div>

        {/* ---------------- Link ---------------- */}
        <div style={{ position: "absolute", left: FILE_X + FILE_W, top: LINK_Y, width: VIEW_X - FILE_X - FILE_W, height: 2, opacity: viewIn }}>
          <div style={{ position: "absolute", inset: 0, background: C.line }} />
          {busy && (
            <div
              style={{
                position: "absolute",
                top: -3,
                left: `calc(${pulseX * 100}% - 4px)`,
                width: 8,
                height: 8,
                borderRadius: 4,
                background: C.terra,
              }}
            />
          )}
        </div>
        <Label style={{ position: "absolute", left: FILE_X + FILE_W, width: VIEW_X - FILE_X - FILE_W, top: LINK_Y - 28, textAlign: "center", fontSize: 11, letterSpacing: 1.6, opacity: viewIn, color: busy ? C.terra : C.muted }}>
          live
        </Label>

        {/* ---------------- Viewer panel ---------------- */}
        <div
          style={{
            position: "absolute",
            left: VIEW_X,
            top: TOP,
            width: VIEW_W,
            height: H,
            background: "#faf5eb",
            borderRadius: 14,
            border: `1px solid ${C.line}`,
            overflow: "hidden",
            boxShadow: "0 30px 60px -34px rgba(60,35,20,0.35)",
            opacity: viewIn,
          }}
        >
          <div
            style={{
              height: HEADER_H,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 18px",
              borderBottom: `1px solid ${C.line}`,
              fontFamily: F.mono,
              fontSize: 12,
              color: C.muted,
            }}
          >
            <span>
              viewer · <span style={{ color: C.ink }}>slides</span>
            </span>
            <span>1 / 6</span>
          </div>

          {/* filmstrip */}
          <div style={{ position: "absolute", left: 20, top: HEADER_H + 22 + SLIDE_H + 18, display: "flex", gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 72,
                  height: 40,
                  borderRadius: 4,
                  background: i === 0 ? C.paper : C.paperDeep,
                  border: i === 0 ? `1.5px solid ${C.terra}` : `1px solid ${C.line}`,
                  opacity: tw(f, 30 + i * 3, 44 + i * 3),
                }}
              />
            ))}
          </div>
        </div>

        {/* Slide (absolute, so selection + cursor share its coordinate system) */}
        <div
          style={{
            position: "absolute",
            left: SLIDE_X,
            top: SLIDE_Y,
            width: SLIDE_W,
            height: SLIDE_H,
            background: C.paper,
            borderRadius: 6,
            border: `1px solid ${C.line}`,
            overflow: "hidden",
            opacity: viewIn,
          }}
        >
          {/* sun */}
          <div
            style={{
              position: "absolute",
              right: 46,
              top: 40,
              width: 110,
              height: 110,
              borderRadius: 55,
              background: C.terra,
              opacity: 0.9 * tw(f, lineDone(0), lineDone(0) + 20),
              transform: `scale(${tw(f, lineDone(0), lineDone(0) + 24, 0.6, 1)})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 30,
              top: 150,
              width: 150 * tw(f, lineDone(2), lineDone(2) + 20),
              height: 2,
              background: C.sage,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 32,
              top: 34,
              fontFamily: F.head,
              fontWeight: FONT.titleWeight,
              fontSize: SIZE.slideTitle,
              color: C.ink,
              opacity: tw(f, lineDone(1), lineDone(1) + 10),
              transform: `translateY(${tw(f, lineDone(1), lineDone(1) + 14, 10, 0)}px)`,
            }}
          >
            {T.loop.title}
          </div>
          <div
            style={{
              position: "absolute",
              left: 34,
              top: 98,
              fontFamily: F.body,
              fontSize: 17,
              color: C.ink2,
              opacity: tw(f, lineDone(2), lineDone(2) + 10),
            }}
          >
            {T.loop.subtitle}
          </div>
          {T.loop.items.map((txt, k) => {
            const li = 4 + k;
            const p = tw(f, lineDone(li), lineDone(li) + 10);
            const isPick = k === PICK;
            const updated = isPick && f >= VIEW_UPDATE;
            return (
              <div
                key={k}
                style={{
                  position: "absolute",
                  left: 32,
                  top: LIST_Y + k * LIST_STEP,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontFamily: F.body,
                  fontSize: 19,
                  color: C.ink,
                  opacity: p,
                  transform: `translateX(${(1 - p) * -10}px)`,
                }}
              >
                <span style={{ fontFamily: F.mono, fontSize: 12, color: C.terra }}>0{k + 1}</span>
                <span style={{ position: "relative" }}>
                  {updated ? T.loop.itemAfter : txt}
                  {updated && (
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        bottom: -4,
                        height: 2,
                        width: `${tw(f, VIEW_UPDATE, VIEW_UPDATE + 20) * 100}%`,
                        background: C.terra,
                      }}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* Selection box around the picked <li> */}
        {sel > 0 && (
          <div
            style={{
              position: "absolute",
              left: SLIDE_X + 22,
              top: SLIDE_Y + LIST_Y + PICK * LIST_STEP - 6,
              width: SIZE.pickW,
              height: 40,
              border: `1.5px solid ${C.terra}`,
              borderRadius: 4,
              opacity: sel,
              transform: `scale(${1.04 - 0.04 * sel})`,
            }}
          >
            {[
              [-4, -4],
              [SIZE.pickW - 4, -4],
              [-4, 36],
              [SIZE.pickW - 4, 36],
            ].map(([x, y], i) => (
              <div key={i} style={{ position: "absolute", left: x - 1.5, top: y - 1.5, width: 8, height: 8, background: C.paper, border: `1.5px solid ${C.terra}` }} />
            ))}
            <div
              style={{
                position: "absolute",
                left: "calc(100% + 10px)",
                top: 11,
                padding: "2px 7px",
                background: C.terra,
                color: C.paper,
                fontFamily: F.mono,
                fontSize: 10.5,
                borderRadius: 3,
                whiteSpace: "nowrap",
              }}
            >
              li[2]
            </div>
          </div>
        )}

        {/* Ask bubble */}
        {askIn > 0 && (
          <div
            style={{
              position: "absolute",
              left: SLIDE_X + 60,
              top: SLIDE_Y + LIST_Y + PICK * LIST_STEP + 44,
              padding: "9px 14px",
              background: C.ink,
              color: C.paper,
              borderRadius: 10,
              fontFamily: F.body,
              fontSize: 16,
              opacity: askIn,
              transform: `translateY(${(1 - askIn) * 6}px)`,
              whiteSpace: "nowrap",
              minWidth: 170,
            }}
          >
            {ASK.slice(0, askChars)}
            <span style={{ display: "inline-block", width: 1.5, height: 16, marginLeft: 2, verticalAlign: -2, background: C.terraSoft, opacity: askChars < ASK.length ? 1 : 0 }} />
          </div>
        )}

        {/* Context chip in flight */}
        {chipVisible > 0 && (
          <div
            style={{
              position: "absolute",
              left: chipX,
              top: chipY,
              padding: "6px 12px",
              background: C.terra,
              color: C.paper,
              borderRadius: 7,
              fontFamily: F.mono,
              fontSize: 12.5,
              whiteSpace: "nowrap",
              boxShadow: "0 12px 24px -10px rgba(120,50,25,0.6)",
              transform: `scale(${1 - 0.1 * Math.sin(chipP * Math.PI)})`,
              opacity: tw(f, CHIP_T1, CHIP_T1 + 4, 1, 0),
            }}
          >
            {"<viewer-context>"} + {ASK}
          </div>
        )}

        <Pointer x={cx} y={cy} press={press} opacity={cursorOpacity} />
      </AbsoluteFill>

      {/* ---------------- Stepper ---------------- */}
      <div style={{ position: "absolute", left: FILE_X, top: TOP + H + 34, right: 80, display: "flex", alignItems: "baseline", opacity: tw(f, 24, 42) * textOut }}>
        <div style={{ display: "flex", gap: 34 }}>
          {STEPS.map((s, i) => {
            const on = i === activeStep;
            return (
              <div key={s.k} style={{ position: "relative", fontFamily: F.head, fontWeight: FONT.headWeight, fontSize: 26, color: on ? C.ink : C.muted, opacity: on ? 1 : 0.7 }}>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: C.terra, marginRight: 8, verticalAlign: 4 }}>0{i + 1}</span>
                {s.k}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    bottom: -10,
                    height: 2,
                    width: `${on ? tw(f, s.from, s.from + 18) * 100 : 0}%`,
                    background: C.terra,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ marginLeft: 58, position: "relative", flex: 1, height: 30 }}>
          {STEPS.map((s, i) => {
            const o = tw(f, s.from, s.from + 14) * tw(f, s.to - 10, s.to, 1, 0);
            return (
              <div
                key={s.k}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 2,
                  fontFamily: F.body,
                  fontSize: 21,
                  color: C.ink2,
                  whiteSpace: "nowrap",
                  opacity: i === STEPS.length - 1 ? tw(f, s.from, s.from + 14) : o,
                  transform: `translateY(${tw(f, s.from, s.from + 14, 8, 0)}px)`,
                }}
              >
                {s.d}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { LOOP_DUR, Loop };
