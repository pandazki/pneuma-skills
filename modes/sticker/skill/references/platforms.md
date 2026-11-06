# Platforms: rules, files, submitting

The rules below were read from each platform's own pages on 2026-11-06. The
authority is the profile data in `scripts/sticker-state.mjs`, which `check`
and the viewer's checklist both evaluate; a rule no official page states is
marked `unconfirmed` and stays a warning. Byte limits are read strictly
(KB = 1000 bytes). If a store's page says something else today, the page
wins: tell the user, and do not edit the files by hand.

## WeChat (微信表情开放平台, sticker.weixin.qq.com)

| Item | Rule | Made from |
|---|---|---|
| stickers | 8–24 per set; GIF 240×240, ≤ 500 KB, loops forever; a set is all animated or all static | the picked takes |
| 表情封面图 cover | PNG 240×240, ≤ 500 KB, transparent, no white outline, no square frame | `art.portrait` |
| 聊天页图标 icon | PNG 50×50, ≤ 100 KB, transparent | `art.head` |
| 详情页横幅 banner | PNG or JPG 750×400, ≤ 500 KB, opaque, not white, no text | `art.banner` |
| 赞赏引导图 reward guide | 750×560, ≤ 500 KB, opaque — only with a reward line | `art.reward-guide` |
| 赞赏致谢图 reward thanks | 750×750, ≤ 500 KB, opaque — only with a reward line | `art.reward-thanks` |
| text | name ≤ 8 characters, no punctuation (≤ 5 shows best); intro ≤ 80; each 含义词 ≤ 4 and unique; copyright ≤ 10; reward line 5–15 | `listing.wechat`, `stickers[].word` |
| unconfirmed | 赞赏缩略图 (reward thumbnail) is required by the reward section but never specified: not exported, prepared by hand | — |

Files: `exports/wechat/01.gif…`, `cover.png`, `icon.png`, `banner.png`
(plus the reward pictures), `上架文案.md` with every text field and each
sticker's 含义词, and `exports/wechat.zip`.

**Submitting.** The user signs up on the open platform as an author (a
person or an organization) and completes the identity checks it asks for.
They create a new animated set, upload the stickers in order with their
含义词, then the cover, icon and banner, and paste the name, intro and
copyright from `上架文案.md`. Reward (赞赏) is optional and needs its own
pictures and line. They submit for review.

**Review.** People at the platform review the set against the rules above,
originality and rights. A rejection comes back with a reason; fix the cause
here (a re-roll, art, text), export, check and resubmit. The platform crops
and recompresses oversize files itself; the exporter stays inside the limits
so nothing changes after the user has looked at it.

## Telegram (video stickers)

| Item | Rule | Made from |
|---|---|---|
| sticker | WEBM VP9 with alpha; one side exactly 512, the other ≤ 512; ≤ 3 s; ≤ 30 fps; ≤ 256 KB; no audio; loops | the picked takes, resampled to a constant 30 fps |
| set thumbnail | PNG 100×100, ≤ 128 KB (optional; the first sticker otherwise) | `art.portrait` |
| emoji | 1–20 per sticker; one is exported | `stickers[].emoji` |
| set | 1–50 stickers at creation, 120 at most | |
| text | a title and a short name (the link) | `listing.telegram` |

GIF is not accepted; the WEBM files are the deliverable. Files:
`exports/telegram/01.webm…`, `thumb.png`, `listing.md` (title, short name,
each file's emoji), `exports/telegram.zip` (Telegram takes the files one by
one; the zip is for keeping them together).

**Submitting.** In the Telegram app the user opens a chat with the official
**@Stickers** bot and chooses the command that creates a video sticker set
(the bot lists its commands). They send the title, then each `.webm` in order
followed by its emoji, then publish; the bot asks for an icon (send
`thumb.png`, or skip) and a short name, which becomes the link
`t.me/addstickers/<short name>`. Short names are unique across Telegram: if
the one in `listing.telegram.shortName` is taken, the user picks another
there and then.

**Review.** None before publishing; the set works as soon as it is published.
Telegram can still remove sets that break its terms.

## LINE (animation stickers, LINE Creators Market)

| Item | Rule | Made from |
|---|---|---|
| count | 8, 16 or 24 | |
| sticker | APNG (`.png`), transparent, within 320×270 with width or height ≥ 270, empty margins cropped | the picked takes |
| frames and time | 5–20 frames; one loop ≤ 4 s; 1–4 plays, ≤ 4 s in total (16 × 120 ms → 2 plays); not every frame the same | |
| bytes | ≤ 1 MB per image; ZIP ≤ 60 MB | |
| main image | APNG 240×240, one per set | the sticker in `art.lineMain` (default: the first) |
| tab image | PNG 96×74 | `art.head` |
| first frame | shown as the still in the store, so it must be a good pose | the take's frame 0 |
| text | title 40, creator 50, description 160, copyright 50 (an Asian character counts 2) | `listing.line` |
| unconfirmed | ZIP names `01.png…`, `main.png`, `tab.png` come from third-party guides | — |

Files: `exports/line/01.png…`, `main.png`, `tab.png`, `listing.md`,
`exports/line.zip`.

The main image is cut from a sticker, so with the white sticker border its
check row warns about a near-white outline; tell the user what it is rather
than treating it as a failure.

**Submitting.** The user signs in to LINE Creators Market
(creator.line.me) with their LINE account, registers as a creator (payout
details are needed to sell), creates a new animation sticker item, enters
the title, description and copyright, uploads `line.zip` (or the images) and
checks the preview, sets the price and sales area, and requests review. Check
the file names the upload page expects against the zip's (the unconfirmed
row).

**Review.** LINE reviews every item before it can be sold; the result and
any rejection reason arrive in Creators Market. After approval the creator
releases it.
