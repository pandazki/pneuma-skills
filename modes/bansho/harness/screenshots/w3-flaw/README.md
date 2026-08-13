# 瑕疵 — the knob, looked at (2026-08-12)

The product owner's requirement, §5.3: 「影响真实感的，是瑕疵……书写区域的四边形
随机旋转和形变（我们写字有时也会斜）……粉笔随机周边的点击，没有那么干净的黑板。
这些程度都可以配置，调成 0 就是干干净净的状态。」

Three frames of the SAME four-board `bayes` wall, same browser process,
same camera pose (`translate(117.8px, 144.5px) scale(0.4)`), same playhead
(t = 66.2s, the end), dark theme, viewport 1600x1100, board 1242 wide.
Only `--bansho-flaw` in `bayes/theme.css` differs — edited live, with no
reload, which is also the proof that an author tuning the token sees the
board answer.

| Frame | Knob | What to look at |
|---|---|---|
| `01-wall-knob-0-clean.png` | `0` | Every heading rule dead level, every bullet on the same invisible ruler, the slate flat. This is byte-for-byte the board of before this feature — see the layout-baseline README's W3 section. |
| `02-wall-knob-1-default.png` | `1` | The shipped default. 「贝叶斯：证据怎么改变信念」 and its rule lean together; 「一个体检的例子」 leans the other way; the three bullets on board 4 each sit at their own angle; words drift a hair off their line; the slate carries grain and the broad smears a cloth leaves. It reads as a person's board and still reads as tidy. |
| `03-wall-knob-3-exaggerated.png` | `3` | Deliberately overdone, so the knob's direction is unmistakable. Useful as the upper reference when choosing a value; not a shipping look. |

## Why the default is what it is

The first draft was 1.7x smaller. At a single board at z = 1 it was
pleasant; on this wall at z = 0.4 — a real reading pose, since the reader
pulls back to see the room — it was simply not there, and the board still
read as typeset. The amplitudes were scaled until the wall reads as
written by a hand AND one board at z = 1 still reads as tidy. That is the
frame pair above, and it is the reason the numbers in `engine/flaw.ts`
are what they are rather than the numbers the first draft proposed.

## `04-detail-knob-1-z1.2.png` — the default at reading range

The same wall at z = 1.2, knob `1`, so the claim "a single board still
reads as tidy at the shipped amplitudes" is looked at rather than
asserted. What it shows: each block leaning its own way, words drifting
off the line inside them, the underline under 「一个体检的例子」 riding WITH
its block (ink travels with what it decorates — the whole reason the
transform sits on the box that contains both), the aside's drawn bar
leaning with its quote, and the chalk grain reading as slate rather than
as a tiled pattern. Nothing collides and nothing is separated from the
writing it belongs to.
