# Online Player & Share Flow — Design

**Status:** draft for review (2026-06-05). Core player is built + deployed; this doc
designs the *full sharing chain* around it and lists the decisions to settle together.

---

## 1. The goal: a frictionless fission loop

> A user finishes something in a mode (a deck, a doc, a site, a paper, a diagram, a
> video, a cosmos). They share **one link**. The recipient opens it **in the browser** —
> no install — sees the finished result, can scrub the history, and is one click away
> from continuing it in their own local client. Seeing it makes them want to make one.

The loop we want:

```
create (any mode)  →  Share → link
                                 │
        recipient opens link (browser, no install)
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                            ▼
 watch result            scrub the process            "Open in app" badge
 (read-only viewer)      (history + timeline)          → pneuma://import → local client
                                                              │
                                              no client? → "Get Pneuma" → install
                                                              │
                                                        create → Share → …  (loop)
```

The player is **the same `src/` frontend in a read-only, no-agent, no-WS state**, fed by
a materialized "play package" on R2. Live today at `https://pneuma.deepaste.ai/s/?id=<id>`.

---

## 2. What's already built (feat/online-player)

- **Materialized play package** (`server/play-export.ts`): per-checkpoint, content-addressed
  blob store + `play.json` + `messages.jsonl`, uploaded to `plays/<id>/` on R2.
- **`shareProcess`** (UI "Share → process") and CLI `pneuma history share` both: upload the
  tar.gz (for the local-client badge) **and** the play package, and return a player URL.
- **Static player** (`src/player/*`, `vite.player.config.ts` → `dist-player/`): mounts the
  real viewers read-only via the shared `useViewerProps` hook, drives replay from the static
  package, registers a content service worker (`public/player-content-sw.js`) that serves
  `/content/*` + `/api/file` from the package blobs. Wrapped in the live session's framed
  shell (mesh + glass card).
- **"Open in app" badge** → `pneuma://import/<tar.gz>` (desktop already handles it).
- **9 modes verified**: draw, doc, illustrate, slide, webcraft, kami, diagram, remotion, cosmos.
- **Unsupported modes** (clipcraft, mode-maker, gridboard, custom) → `LocalClientFallback` card.
- **Deploy**: `scripts/deploy-player.sh` → CF Pages `pneuma-landing`, `/s/` subpath, SW at root,
  `Cache-Control: no-cache` on the SPA HTML so new builds land immediately.

---

## 3. The three surfaces

### 3a. Creator side — the Share action

**Today** the TopBar share dropdown offers three things, which is confusing:
- **Share result** → `shareResult`: files-only tar.gz to `shares/`. *Does NOT make a player link.*
  It's a workspace snapshot for `?action=import` (give someone editable files).
- **Share process** → `shareProcess`: history + checkpoints + **play package** → **player link**.
- **Export local** → downloads a tar.gz.

**Proposed model — one hero action + two utilities:**

| Action | What it does | Output |
|---|---|---|
| **Share** (hero) | `shareProcess` — materialize + upload play package | **player link** `…/s/?id=<id>` |
| Export file | download the tar.gz | local file (offline `history open`) |
| Copy snapshot *(optional/keep)* | `shareResult` — files only | `shares/*.tar.gz` for editable import |

Rationale: the player already *is* "result + process" in one — it opens on the finished
result and the history/timeline is right there to scrub. So "result vs process" is a false
choice; collapse to a single **Share**. Keep file export for offline; keep (de-emphasized)
snapshot-copy for the "here are my files to edit" case.

**Share dialog** (on click):
1. Title field (defaults to session displayName) → drives player header + link preview.
2. Progress ("Materializing… Uploading…").
3. Result: the link + **Copy**, **Open player**, and a small preview thumbnail.
4. If the mode isn't web-playable: say so ("recipients will open it in the desktop app") but
   still produce the link (the player shows the fallback card).

### 3b. The link & its preview

- URL: `https://pneuma.deepaste.ai/s/?id=<id>` (query form — see §5 for the pretty-path option).
- **Rich link preview (OG/Twitter cards)** is the single highest-leverage addition for fission:
  when the link is pasted into Slack / X / WeChat / iMessage, it should show a title +
  description + thumbnail, not a bare URL. The player is a static SPA with one `index.html`, so
  per-share OG tags need server-side injection. Options:
  - **(A, recommended) CF Pages Function** at `/s/` that reads `?id`, fetches `plays/<id>/play.json`,
    and injects `<meta og:title/og:description/og:image>` into the returned HTML. Cheap, no build
    change. Also unlocks the pretty `/s/<id>` path (the Function owns the route, sidestepping the
    landing catch-all).
  - (B) Pre-render a static `plays/<id>/index.html` with baked OG at share time and point the link
    there. More storage, no edge compute.
- **OG image** = the session thumbnail (`.pneuma/thumbnail.png`, already captured) uploaded into
  the play package as `cover.png`. Reused as the player's loading splash too.

### 3c. Recipient side — the player

- Opens to the **finished result**; **history** panel + **timeline** to scrub turns; read-only.
- **"Open in app"** → `pneuma://import/<tar.gz>` → desktop imports + continues editing.
- **No client?** → "Get Pneuma" → landing page / install. (Detect: if `pneuma://` doesn't resolve,
  fall back to the install CTA — the landing page's existing scheme-probe trick.)
- **Unsupported/custom mode** → fallback card with the same two CTAs.

---

## 4. Play-package additions to support this

- `cover.png` — session thumbnail, for OG + splash. (`shareProcess` copies `.pneuma/thumbnail.png`.)
- `play.json` already has `mode`, `supported`, `importUrl`, `manifest.metadata.title`. Add
  `description` + `cover` so the OG Function has everything from one fetch.

---

## 5. Open decisions (for the morning)

1. **Collapse the share UX to one "Share"?** (recommended) or keep result/process distinct?
2. **Rich link previews now?** → build the CF Pages Function (A). It also gives us pretty
   `/s/<id>` URLs. Worth it for fission, ~half a day. Yes/no?
3. **Access control.** v1 = unlisted public link (anyone with the link). Acceptable? Or do we
   want signed/expiring links or a "delete share" control before this goes wide?
4. **Share management.** A "your shares" list (revisit/copy/delete)? v2?
5. **Default share scope.** Whole session, or let the user pick which content-set / which
   checkpoint range? (v1: whole session, opens on final state.)
6. **Desktop "Share" parity.** Should the desktop app expose the same one-click Share + auto-copy?
7. **Analytics.** Do we want view counts on shares (for the creator)? Needs the Function + a counter.

---

## 6. Implementation status & next steps

- [x] Player + materialized package + SW + deploy (9 modes verified live).
- [x] `shareProcess` returns player link; CLI `history share` too.
- [x] Cache headers so users always get fresh builds.
- [ ] Add `cover.png` (thumbnail) to the play package + `description` to `play.json`.
- [ ] CF Pages Function for `/s/<id>` + OG injection (decision §5.2).
- [ ] Redesign the TopBar share dialog (decision §5.1): hero **Share** + preview + CTAs.
- [ ] Recipient "Get Pneuma" CTA wiring + scheme-probe fallback.
- [ ] (v2) share management, access control, analytics.

---

### Appendix — current live demo links (one per supported mode)

doc / webcraft / slide / draw / illustrate / kami / diagram / remotion / cosmos —
all under `https://pneuma.deepaste.ai/s/?id=<id>` (see session notes for ids).
