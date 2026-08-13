# T4 player — G7 visual verification artifacts

Captured against the real viewer (`bun bin/pneuma.ts bansho --dev --viewing`,
Vite dev server, chrome-devtools screenshots) while appending the design-doc
§4.2 NVIDIA/AMD demo to `board.md` in five chunks — the same streaming rhythm
an agent produces. Timestamps below are the transport clock visible in each
frame (canonical seconds / total).

| File | Proves |
|------|--------|
| `01-empty.jpeg` | Empty-board state: script placeholder, empty-board hint, transport at 0.0s/0.0s with LIVE active. |
| `02-chunk1-live-a.jpeg` | First append on an empty open board PLAYS from 0 (1.3s/8.0s — title mid-performance, script line highlighted). The empty-at-open live-join fix (`createPlayer(duration, joinAtTip=false)` via the `filesHydrated` latch). |
| `03-chunk2-zero-replay-a.jpeg` / `-b.png` | **Zero replay**: after appending chunk 2 the clock CONTINUES (9.7s → 12.6s of a 17.2s total, never restarting) and every previously-inked stroke is pixel-identical between the two frames; only the new suffix performs (strike mid-draw → strike + underline done, next sentence mid-write). |
| `04-chart-skeleton.jpeg` | Serial chart skeleton (axes, ticks, labels one by one) + G6 chart-ROW precision: the script pane highlights exactly the `x:` line inside the chart block, not the whole block. Camera followed the pen down (G5 — earlier content still exists, see script pane). |
| `05-nvidia-series-middraw.jpeg` | Series draws left→right with its `+ NVIDIA:` row highlighted; label at the right edge inside the canvas (G8-C). |
| `07-chunk4-circle-mark.jpeg` | In-place ink circle around `((35.6B))`, chart `mark` landed at the NVIDIA endpoint, hand-drawn `---` rule, side-note styling. |
| `08-backref-camera-turn.jpeg` | `@circle "三倍"` back-reference: the camera turns UP to the target paragraph and the circle is drawn around the earlier text; script highlights the directive line. |
| `09-bad-block-badge.jpeg` | R6 degradation: malformed chart block → amber "1 ISSUE" chip; the rest of the board plays on, total duration unaffected. |
| `10-rate-1.5x.jpeg` | Rate 1.5×: clock total still 37.4s and tick positions unchanged — rate scales the clock only, canonical timeline untouched. |
| `11-scrub-18.4-first.jpeg` / `12-scrub-18.4-second.jpeg` | Scrub determinism: t=18.4s reached twice (End → 19 × Shift+ArrowLeft, with a trip to the tip in between). Board `innerHTML` hash identical both times (`-277135226`, 27885 chars); frames identical; later ink (NVIDIA line, backref circle) correctly absent. |
| `14-reopen-join-at-tip.jpeg` | Reload of the same session with existing content: joins AT the tip (37.4s/37.4s, full board incl. backref circle, LIVE active) — history is shown, never replayed. |
| `15-align-two-column.jpeg` | §4.3 并列对齐, first pass: three `label:value` items (glued fullwidth colon) form one column — `定价权:` carries the spacer that aligns its value with the two wider labels. Hand-drawn bullets sit INLINE (Tailwind-preflight `svg{display:block}` fix). |
| `16-align-cascade-widened.jpeg` | Streaming align cascade: appending the wider `资本开支承诺可见度:高` widens the whole column — the three earlier items rebuild with wider spacers (hash-invisible invalidation via `alignCascade`), presented at final state, not re-animated. |
| `17-math-katex-underline.jpeg` | KaTeX `$$…$$` block + inline `$g \approx 17\%$` render; `@underline "差距在指数上"` lands EXACTLY under its target even though the target follows an inline math run — the F7 zero-width plain-text offset mapping in action. |

## Amend round 1 (T4 review) — captured against a tall two-section board (45.0s), `--viewing`, dark theme

| File | Proves |
|------|--------|
| `18-scrub-follow-t10.jpeg` | **Scrub camera follow** (major finding resolved): from the tip (45.0s, camera at the bottom), Home then 10 × Shift+ArrowRight → t=10.0s. The camera turned UP with the seek — the performing strike/highlight paragraph sits framed near the top with margin, instead of the empty-chalkboard bottom that `11-scrub-18.4-first.jpeg` showed before the `player.onSeek` seam. |
| `19-scrub-follow-end.jpeg` | The reverse leg: End from t=10 → camera turns back DOWN to the tip (underline line in view). Also pins two sibling fixes: the transport shows the REPLAY icon after a paused scrub-to-the-end (previously stale PLAY), and the track's a11y node reports `value="45"` (`aria-valuenow` mirrored in the frame listener — verified via devtools a11y snapshot). |
| `20-issue-chip-warning-token.jpeg` | A malformed chart block appended LIVE → amber "1 ISSUE" chip now in `cc-warning` token colors (not raw amber-500) + R6 "unreadable block" badge on the board; playhead stayed at the live tip through the append. |
| `21-resize-scroll-restore.jpeg` | Window resized 1440→1200 while PAUSED at the tip: the width-change wipe/rebuild reflows the board and the camera stays at the tip (scrollTop captured before the wipe, restored after rebuild) — previously a paused viewer was stranded at the board top. |

## Amend round 2 (T4 review) — captured against the NVIDIA/AMD demo board (50.5s), `--viewing`

| File | Proves |
|------|--------|
| `22-follow-survives-click.jpeg` | **A bare click no longer kills live follow** (minor finding resolved): the board was clicked once at ~10s while streaming; the camera kept following through appended chunks to the live tip (50.5s/50.5s, bottom of the board framed, top scrolled out — scrollTop 791→837 across the run). Previously one click latched the detach forever and the viewport froze at the top. Detach still works where it should: wheel, scrollbar drag, touch pan (pure `camera-latch.ts`, unit-tested). |
| `23-empty-transport-inert-play.jpeg` | Empty board waits with a DISABLED, dimmed Play at 0.0s/0.0s (`createPlayer` starts `playing: true` for autoplay, but the transport no longer claims playback is happening — previously a PAUSE glyph). |
| `24-slider-focus-ring.jpeg` | Keyboard focus on the timeline track shows a `cc-primary` ring (Tab → slider; box-shadow ring, since the app's global `*:focus { outline: none }` reset defeats outline utilities). The a11y node also mirrors `aria-valuetext` — devtools reported `"50.5 of 50.5 seconds"` alongside `aria-valuenow="50.5"`. |
| `25-light-chart-scrub.jpeg` | **Light theme, running viewer** (evidence gap closed): light board tokens live — `--board: #ffffff`, `--hl: #ffe072` on 三倍, the light `--hand` stack (Bradley Hand first), NVIDIA series + label — with the pane/transport chrome on light `cc-bg`, scrubbed to t=22.0s (camera followed the seek). |
| `26-light-tip-live.jpeg` | Light theme at the LIVE tip (50.5s): circle ink around 35.6B, hand-drawn rule, blockquote, §4.3 aligned two-column list, KaTeX block + inline math, `@underline` — the full ink vocabulary on the white board, chrome in light tokens. Token values verified in-page via computed style, not assumed from CSS. |
