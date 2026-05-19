---
description: Hand the current task off to a Pneuma session for the current directory
argument-hint: <intent> [--mode <name>] [--project | --quick]
---

<!-- pneuma:agent-command version="{{pneumaVersion}}" backend="{{backendType}}" -->

You are routing the user's request to **Pneuma** — a co-creation workspace
that spins up a domain-specific viewer (a deck, a webpage, a board, a
diagram, a video, …) plus an editing agent. Your job in this command is to
collect the minimum information needed, then call
`pneuma handoff-from-external`, which mints the session and returns a URL.

The slash command's argument is `$ARGUMENTS`.

## Steps

1. **Parse `$ARGUMENTS`** into these slots:
   - `INTENT` — free-form text describing what the user wants built. May be
     empty.
   - `--mode <name>` — optional, e.g. `webcraft`, `slide`, `diagram`.
   - `--project` / `--quick` — optional. `--project` initializes the current
     folder as a Pneuma Project (persistent, multi-session). `--quick` skips
     project setup (one-off session).

   If `INTENT` is empty, ask the user:
   > "What would you like Pneuma to build? Describe it in one or two
   > sentences."

   Wait for their reply and treat that as `INTENT`. If the user replies with
   a refusal/cancel, stop here — do NOT call `pneuma handoff-from-external`.

2. **Resolve `--mode`.** If not supplied, run:

   ```bash
   pneuma mode list --local --json
   ```

   If that command fails (e.g. "command not found" — Pneuma's CLI isn't on
   PATH), skip the list step and instead propose a sensible mode from the
   common set: `webcraft` (webpages / dashboards / static sites),
   `slide` (decks), `doc` (markdown), `diagram` (flowcharts), `draw`
   (whiteboard), `illustrate` (AI illustrations), `kami` (paper-canvas
   sites), `remotion` (programmatic video), `gridboard` (tile dashboards),
   `clipcraft` (AIGC clips). Confirm with the user.

   When the JSON command worked, parse its output (an array of
   `{ name, displayName, description, source, hidden }`), drop entries where
   `hidden` is `true`, show the user a numbered list — `displayName` plus a
   one-line description — and ask which fits. You may propose a best guess
   based on `INTENT` and confirm. Map the pick back to the `name` field.

3. **Resolve project init.** If neither `--project` nor `--quick` was given,
   ask the user:

   > "Initialize this folder as a Pneuma Project (recommended for ongoing
   > work — persistent preferences, multiple sessions can share it), or just
   > spin up a one-off session in the current directory?"

   - Project → pass `--init-project` in step 5.
   - Quick → omit `--init-project`.

4. **Bridge the conversation context.** This is the step that matters most.

   The target Pneuma session sees `INTENT` as a literal string. If the
   user said something like "做个工作汇报" / "write up what we just did",
   that intent is meaningless without the conversation that preceded it —
   the target agent would have to guess from filesystem state alone. Don't
   make it guess.

   Prepare three things based on your current conversation:

   - **SUMMARY** — 2-4 sentences capturing what's been built/discussed in
     this session, what state things are in now, and why the user wants to
     hand off. Be specific about deliverables, decisions, and outstanding
     issues. Avoid filler like "the user asked me to…".
   - **FILES** — comma-separated list of absolute paths the target should
     read first to understand the work-in-progress. Limit to ~5 files; only
     include what's actually relevant to `INTENT`.
   - **SOURCE_TRANSCRIPT** — *(Claude Code only)* path to the JSONL file
     for this very conversation, so the target can read the verbatim
     exchange when the summary isn't enough. Claude Code stores transcripts
     at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, where
     `<encoded-cwd>` is the workspace path with `/` → `-`. The most
     recently-modified `.jsonl` in that directory is this session. Find it:

     ```bash
     ENC_CWD=$(pwd | sed 's|/|-|g')
     SOURCE_TRANSCRIPT=$(ls -t ~/.claude/projects/${ENC_CWD}/*.jsonl 2>/dev/null | head -1)
     ```

     If you can't determine the path, leave `SOURCE_TRANSCRIPT` empty —
     don't fabricate one. For Codex / other agents that lack a known
     transcript path convention, also leave it empty.
   - **LANGUAGE** — BCP47 code for the language you and the user have
     been conversing in (e.g. `zh-CN`, `en`, `ja`). The target Pneuma
     agent will reply in this language AND use it for any user-visible
     copy it generates (page text, slide content, doc body, …). Without
     this, the target falls back to Pneuma's UI locale — which is often
     `en` even for users speaking 中文/日本語/etc. with you, producing
     jarring language mismatches. Detect from the recent turns; if
     genuinely mixed, pick the dominant language or briefly ask
     ("Which language should Pneuma reply in?").

5. **Run the handoff. Pick the right launcher based on what's installed.**

   First, detect what's installed. Run both checks — the second matters
   when the first comes back `nocli`:

   ```bash
   # 1. Is the pneuma CLI on PATH?
   command -v pneuma >/dev/null 2>&1 && echo cli || echo nocli

   # 2. Is the Pneuma desktop app installed? (macOS only — the only OS
   #    that ships an Electron build today). The bundle is literally
   #    "Pneuma Skills.app" (with the space) — `mdfind -name Pneuma.app`
   #    won't find it. Check the install path AND the URL-scheme
   #    registration; both should resolve before you commit to Path B.
   if [ "$(uname)" = "Darwin" ] && [ -d "/Applications/Pneuma Skills.app" ]; then
     echo desktop
   else
     echo nodesktop
   fi
   ```

   Pick the first path that matches, in order:
   - `desktop` → **Path B** (URL scheme — opens a native Pneuma window,
     the best UX when available; preferred even when the CLI is also
     installed)
   - `nodesktop` + `cli` → **Path A** (terminal-only environments,
     remote SSH boxes, Linux servers, CI)
   - `nodesktop` + `nocli` → **Path C**

   Do not silently fall back from one path to the next if it appears to
   fail. If `open pneuma://…` errors out, or `pneuma handoff-from-external`
   errors out, do not switch to the other path — surface the error to
   the user. Mixing paths is how you get two windows or two staged
   handoffs.

   ### Path A — CLI (fallback when no desktop app, works everywhere)

   ```bash
   pneuma handoff-from-external \
     --intent "$INTENT" \
     --mode "$MODE" \
     [--init-project] \
     --source-agent {{sourceAgent}} \
     --summary "$SUMMARY" \
     [--files "$FILES"] \
     [--source-transcript "$SOURCE_TRANSCRIPT"] \
     [--language "$LANGUAGE"]
   ```

   Run from the user's **current shell directory** — do NOT `cd` first.
   The CLI will validate the mode, stage `inbound-handoff.json` (with
   `intent`, `summary`, `suggested_files`, and `source_transcript`
   baked in), spawn `pneuma <mode>` in the background, open a browser
   tab, and print the session URL on its last stdout line.

   ### Path B — Pneuma desktop app (preferred — native window + tray, macOS only)

   The desktop app registers itself as a handler for the `pneuma://` URL
   scheme. Emit a deep link and `open` it:

   ```bash
   # URL-encode each value. Python3 is the portable fallback.
   enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
   URL="pneuma://handoff?intent=$(enc "$INTENT")&mode=$MODE&cwd=$(enc "$(pwd)")&init-project=$INIT_PROJECT&source-agent={{sourceAgent}}"
   [ -n "$SUMMARY" ]            && URL="$URL&summary=$(enc "$SUMMARY")"
   [ -n "$FILES" ]              && URL="$URL&files=$(enc "$FILES")"
   [ -n "$SOURCE_TRANSCRIPT" ]  && URL="$URL&source-transcript=$(enc "$SOURCE_TRANSCRIPT")"
   [ -n "$LANGUAGE" ]           && URL="$URL&language=$(enc "$LANGUAGE")"
   open "$URL"
   ```

   Where `$INIT_PROJECT` is `1` for project init, `0` for quick. The
   desktop app will pick up the URL, stage the handoff (including the
   summary + suggested files + transcript pointer), and open a new
   session window. No browser URL gets printed in this path — the app's
   own window IS the result.

   ### Path C — Neither installed

   Tell the user (verbatim) one of these is required, with the install hints:

   - **Recommended on macOS**: download the desktop app at
     https://github.com/pandazki/pneuma-skills/releases — registers the
     `pneuma://` URL scheme automatically, opens sessions in a native
     window.
   - **For terminal-only / Linux / CI**: `bun add -g pneuma-skills`
     (requires [Bun](https://bun.sh/) ≥ 1.3.5).

   Do not attempt to install anything yourself.

6. **Report the URL back to the user (Path A only).** Repeat the URL
   verbatim. The new Pneuma agent already has the intent, summary,
   suggested files, and source transcript pointer staged — they should
   continue the conversation in that window. For Path B, just confirm
   "Pneuma opened a new session window for `$INTENT`".

## Notes

- This command is for **new** sessions in the **current** directory. If
  the user wants to resume an existing session, point them at `pneuma`
  with no arguments — that opens the launcher.
- Don't open the URL for the user on Path A — just print it. Pneuma
  itself opens the browser tab.
- On Path A, common failure modes: unknown mode → re-run step 2; port
  exhaustion → re-run (the helper auto-picks).
