# Changelog

All notable changes to this project will be documented in this file.

## [3.12.2] - 2026-05-22

### Improved — Recent Projects mirrors Recent Sessions

The launcher's Recent Projects section showed every project inline — three featured cards followed by an unbounded list of compact rows. With enough projects that list ran on indefinitely, pushing everything below it off-screen.

It now follows the same three-tier shape as the Continue (sessions) section:

- **Top 3 as cards, next 5 as compact rows** — the section no longer grows unbounded with the project count.
- **All Projects overlay** — once there are more than eight projects, an "All Projects" button in the section header opens a full-screen, searchable list of every project, mirroring the existing "All Sessions" overlay.
- The redundant "All Projects" sub-heading between the cards and rows is gone, and the top-3 cards are now simply the three most recent (the previous 14-day "featured" cutoff is dropped).

## [3.12.1] - 2026-05-21

### Improved — `/handoff-pneuma` skips the redundant Project/Quick question

When the `/handoff-pneuma` slash command ran in a directory that was *already* a Pneuma Project, it still asked whether to initialize the folder as a Project or start a quick session — a question with only one correct answer. Worse, picking "Quick" there would scatter loose session state into an existing project root.

- **Project detection** — the slash-command template now probes `<cwd>/.pneuma/project.json` before asking. An already-initialized project skips the question and always runs as a project session; only genuinely un-initialized folders still get the prompt. An explicit `--quick` in a project root is overridden, since sessions inside a project must be project sessions.

Installed `/handoff-pneuma` files auto-update to this template on the next launcher boot after a desktop-app update — no manual reinstall needed.

## [3.12.0] - 2026-05-20

### Added — Background Mode: external handoffs run invisibly until they're done

`/handoff-pneuma` from Claude Code or Codex spun up a Pneuma session and immediately threw a full window at the user — mid-task, unasked. But a handoff is often fire-and-forget: "make me a finance dashboard" doesn't need supervision, it needs a result. The window was an interruption, not a help.

Background mode makes that the default for desktop-received `pneuma://handoff` deep links. The session runs in a hidden Electron window — fully WebSocket-connected and rendering, just `show: false`. On a cold start there's no splash, no launcher window, no dock icon: the handoff is invisible. The only signal is an animated tray spinner while the agent works. When the agent backend goes idle, the window auto-reveals — the finished result, instantly, because it was rendering hidden all along. A system notification fires alongside as a secondary cue.

- The hidden window's renderer relays turn status to the main process over a new `pneuma:session-status` IPC channel — no server changes, no polling. The window is created with `backgroundThrottling: false` so an offscreen renderer keeps processing WebSocket messages.
- The tray gains a status glyph + tooltip and a "Background Sessions" section — every running/ready background session is one click from the foreground even if the notification is missed.
- Resilience: a watchdog reveals the window if the session never starts, `loadURL` retries cover the session server still binding its port right after spawn, and a renderer crash surfaces the window — a broken background session can never strand the user.
- Escape hatch: `pneuma://handoff?…&background=0` opens a normal foreground window as before.

## [3.11.0] - 2026-05-20

### Added — `ViewerAddress`: one contract for "which object in the viewer"

The agent and the viewer ask each other "which object?" constantly — but it was answered five different ways: a `ViewerLocator`'s location data, a `navigate-to` action's params, the `capture` action's selector, a selection's `selector`/`file`, the current `<viewer-context>` position. Five payload shapes for one concept. The agent had to learn a different addressing vocabulary per feature, and the shapes didn't interoperate — you couldn't take the address of a thing the user selected and feed it back to `capture` or a locator card.

`ViewerAddress` promotes object-addressing to a first-class protocol noun: one mode-defined, framework-opaque shape that **every** agent↔viewer verb consumes or produces:

- a `<viewer-locator>` card points the user at an address,
- the `capture` action screenshots one,
- navigation moves the viewer to one,
- a selection reports the one the user picked — now surfaced as a machine-readable `Address:` line in `<viewer-context>`.

Because the same shape is produced and consumed, the select → view → point round-trip is finally expressible: the user clicks an element, the agent receives its address, and feeds it straight back into `capture` or a locator. The contract fixes the *slot*; each mode owns the *vocabulary and granularity* — slide addresses a slide, webcraft a page-plus-DOM-region, doc a heading or line range, diagram a node id. The agent learns one invariant interaction pattern instead of N feature-specific ones.

### Changed — address-driven `capture`, and the contract rename

- The `capture` viewer action now takes a `ViewerAddress` (`params.address`) instead of a bare `params.selector`. Capturing an address that names a non-active object **navigates the viewer there first, then screenshots** (navigate-then-shoot) — composed from the existing `navigateRequest` channel, with no new per-mode plumbing.
- `ViewerLocator.data` → `ViewerLocator.address`; `ViewerSelectionContext` gains an `address` machine handle alongside its existing descriptors. The `<viewer-locator>` chat tag's canonical attribute is now `address='{…}'`; the legacy `data='{…}'` is still parsed, so locator cards in resumed sessions keep rendering.
- All eleven content modes — webcraft, slide, kami, doc, draw, diagram, illustrate, remotion, gridboard, clipcraft, mode-maker — migrated to declare and consume their own address vocabulary. Each mode's skill documents its address keys (a coarse "where" plus an optional fine "within").

## [3.10.13] - 2026-05-20

### Added — `capture` viewer action: visual self-QA without an external browser

After finishing web work, coding agents reflexively spawn an external browser (or the chrome-devtools MCP) to "verify" the result. Two problems: it's redundant — the user is already watching the live Pneuma viewer — and it's misleading. Web-based modes apply rendering rules the raw files don't carry on their own: slide renders HTML *fragments* with a viewer-injected `theme.css`, kami renders a locked-size paper sheet, webcraft resolves content-set asset/proxy paths. Open a file directly in a browser and you see something the user never will.

New framework-level `capture` viewer action closes the QA loop inside Pneuma:

- `POST $PNEUMA_API/api/viewer/action {"actionId":"capture"}` screenshots the live viewer; `params.selector` captures a region. The runtime renders the viewer to a PNG, persists it under `<sessionDir>/.pneuma/captures/`, and returns the file path — the agent `Read`s it to see exactly what the user sees.
- Environment-adaptive with fallback: Electron `capturePage` (real window screenshot) → same-origin iframe snapshot via `snapdom` → viewer `captureViewport()` → DOM. Full-page captures first scroll-prime the iframe so `IntersectionObserver` entrance reveals fire (defeating CSS `scroll-behavior: smooth`) — a long page is no longer blank below the fold.
- Surfaced to every mode through the viewer-API instructions block; the `webcraft` / `kami` / `slide` skills gain a "Verifying your work" section that bans external-browser verification and points at `capture`.

Slide overflow keeps a separate, measurement-based check. A slide canvas is `overflow: hidden`, so a screenshot *cannot* reveal clipped content — it shows a clean slide with content silently missing. Slide already measured overflow geometrically (`checkContentFit`, via `postMessage` to its sandboxed iframes), but the action was undeclared and the skill still pointed at the chrome-devtools MCP. `checkContentFit` is now a declared agent-invocable action; slide's "Layout Verification" guidance uses it for overflow QA and reserves `capture` for visual judgement. The obsolete `layout_check.js` script is removed.

## [3.10.12] - 2026-05-20

### Added — handoff carries the source-conversation language

`<pneuma:env reason="handed-off">` already emitted `user_locale="..."`, but that's Pneuma's UI locale — a global setting. A user whose Pneuma is in English but who's been talking with Claude Code in 中文 would see the spawned Pneuma agent reply in English regardless of the conversation context. Annoying and unstable: language sometimes "right", sometimes not, depending on what the target agent decided to weigh.

New `--language <BCP47>` flag threads through every layer end-to-end:

- `pneuma handoff-from-external --language zh-CN …` (CLI)
- `pneuma://handoff?…&language=zh-CN` (URL scheme — Electron parses + forwards)
- `POST /api/handoffs/external` body field `language`
- `InboundHandoffPayload.language` → CLAUDE.md handoff section renders **Reply language**: zh-CN with explicit instruction to use it for chat replies AND user-visible content (page text / slide body / etc.)
- `<pneuma:env reason="handed-off" … language="zh-CN" />` so agents that skip CLAUDE.md still see it

The `/handoff-pneuma` slash template gains a fourth context step (LANGUAGE) alongside SUMMARY / FILES / SOURCE_TRANSCRIPT. The source agent auto-detects from its own conversation and only asks the user as a tie-breaker. Distinct from `user_locale` — both attributes ride along on the env tag now; downstream readers can pick whichever matches their scope.

When unset, behaviour is unchanged — target agent picks based on UI locale and the user's first message style, same as today.

## [3.10.11] - 2026-05-19

### Changed — `/handoff-pneuma` slash command prefers the desktop app over the CLI

Two related template fixes:

- **Detection block.** The template documented Path A (CLI), Path B (URL scheme via desktop app), and Path C (neither) but only spelled out the *CLI* detection command. For Path B it just said "the Pneuma desktop app is installed" and left the source agent to figure out the check itself. Predictably, agents tried `mdfind -name "Pneuma.app"` — which returns nothing because the actual bundle is `Pneuma Skills.app` (with a space). Conclusion "no desktop app", silent fall-through to Path A, "command not found: pneuma", confused user. Template now ships both checks side-by-side: `[ "$(uname)" = "Darwin" ] && [ -d "/Applications/Pneuma Skills.app" ]` for the desktop side (bundle path is more reliable than `mdfind` / `lsregister`).

- **Path priority flipped to desktop-first.** Previous order was "CLI if present, else desktop, else neither". When both are installed (common in dev) the agent picked the CLI, which spawns a detached process + browser tab; users with the desktop app installed would much rather get a native Pneuma window. New order: desktop → CLI → neither. The agent only falls back to the CLI when there's no desktop app (Linux, CI, SSH'd terminals).

Also added a "don't silently fall back if a path errors — surface it" guardrail so a one-off `open` failure doesn't fork into two staged handoffs across both paths.

## [3.10.10] - 2026-05-19

### Fixed — handoff `<pneuma:env reason="handed-off">` actually woke the agent

Final root cause of the "spawned Pneuma stays Idle / no model until you type something" issue. Wasn't a timing race — it was a semantic mismatch in `WsBridge.enqueueEnvContext`.

The dispatch path was:

1. `dispatchEnvTag` built `<pneuma:env reason="handed-off" inbound_path="..." />`
2. `wsBridge.enqueueEnvContext` recorded the tag in `messageHistory`, broadcast it to browsers as a timeline banner, and **queued it as pending context** — to be prepended to the next real user message, not dispatched on its own.

That pending-context model is correct for `reason="opened"` / `reason="resumed"` (you don't want the agent firing a spurious "welcome back" reply at a user who hasn't even asked anything yet). But for handoff it's a deadlock: the source agent has already supplied intent / summary / files / transcript via `inbound-handoff.json` + the `pneuma:handoff` CLAUDE.md block; the target should start work immediately. Worse, on Claude Code the CLI subprocess uses `--print --input-format stream-json`, which never emits `system.init` until it receives at least one stdin event — so the model picker in the chat header stayed at "no model" indefinitely until the user typed something, at which point the queued env + new message hit the CLI together.

Fix: `enqueueEnvContext` gains an `{ immediate?: boolean }` option. When `true`, the tag goes through `sendUserMessage` (same path browser-originated messages take) — recorded once, broadcast once, delivered to the CLI. `dispatchEnvTag` in `bin/pneuma.ts` sets `immediate: true` when an inbound handoff payload OR a `fromSessionId` is present (i.e. either external handoff or intra-pneuma Smart Handoff). `opened` and `resumed` keep the pending-queue semantics — nothing changes for non-handoff spawns.

After this, the spawned session boots, the `handed-off` env tag flows straight to the CLI, `system.init` fires, the model picker resolves, and the agent's first reply acknowledges the handoff and starts the work. No user nudge required.

## [3.10.9] - 2026-05-19

### Fixed — Quick-session handoff actually reached the agent (path mismatch)

Even after 3.10.5 dropped the "project-only" guards on `readInboundHandoff` and the handoff-section injection, the spawned Quick session still booted with a fresh `<pneuma:env reason="opened">` and no acknowledgement of the inbound. Filesystem trace explains why:

- `runHandoffFromExternal` was writing the inbound at `<workspace>/.pneuma/.pneuma/inbound-handoff.json` (double `.pneuma/`)
- `readInboundHandoff(sessionDir)` was reading from `<workspace>/.pneuma/inbound-handoff.json` (single `.pneuma/`)

Root cause: I assumed `sessionDir` for Quick was `<workspace>/.pneuma`, which would have made the double-nest mirror Project's layout. It isn't. `resolveSessionPaths` (and the no-op `workspace = sessionDir` reassignment at `bin/pneuma.ts:1961`) make Quick's `sessionDir == workspace` — i.e. the workspace root itself. So `<sessionDir>/.pneuma/` *is* the right and only `.pneuma/`; the second one I was creating was orphaned, and the file never got read.

Fixed by collapsing the CLI's Quick path to `<cwd>/.pneuma/inbound-handoff.json` (matching what the reader actually expects). Added a regression test that writes the inbound via `runHandoffFromExternal` and reads it back via `readInboundHandoff` for both Quick + Project, asserting the payload survives. The skill-installer then injects the `<!-- pneuma:handoff -->` block into the Quick session's CLAUDE.md (which lives at `<workspace>/CLAUDE.md`, not under `.pneuma/`), and the agent's first turn finally sees the intent.

### Also bundled (3.10.8, never shipped — cancelled mid-CI for this fix)

- `pneuma <mode>` spawned by `runHandoffFromExternal` now passes `--no-open` so the user doesn't get two windows (the spawned child's stray browser tab on top of our Electron mode window).
- CLI polls `http://127.0.0.1:<port>/` after spawn for up to ~12 s before returning the URL, so Electron's `createModeWindow` doesn't load on a not-yet-bound port and end up on a permanently-black `chrome-error://chromewebdata` frame.

## [3.10.7] - 2026-05-19

### Changed — Backends settings card now owns the whole per-backend lifecycle

Reworked the launcher Settings → BACKENDS section so each backend card carries every knob that applies to it, instead of spreading the controls across multiple sections.

Each card now shows:
- **Status + enable/disable toggle** (new) — flipping the orange switch hides the backend from session-creation pickers but keeps it visible in Settings, so the user can re-enable later without re-detection. Persisted via `POST /api/backends/:type/disabled` → `~/.pneuma/settings.json` `backends` key.
- **`/handoff-pneuma` install row** — install / reinstall / update / uninstall buttons rendered inline for backends that support the slash command (Claude Code, Codex). Kimi just shows status + the toggle; no slash-command row.

Underneath the cards, a shared two-column strip carries the global controls:
- **Auto-update on launch** — toggle for the silent re-stamp pass on launcher boot.
- **pneuma CLI on PATH** — detection status + one-click symlink to `~/.local/bin/pneuma-skills`, with shell-rc hint when the dir isn't on PATH yet.

The standalone "Manage agent commands…" link in the small `AppSettings` popover is gone — it duplicated the BACKENDS surface for the same backends. Old `BackendOption` callers automatically pick up the new `disabled` field; session-creation pickers filter `disabled: true` entries out unless they're the backend an existing-session resume is bound to.

### Added — `POST /api/backends/:type/disabled` route + `core/backend-prefs.ts`

Persists per-user backend disable flags as `{ backends: { [type]: { disabled: boolean } } }` under `~/.pneuma/settings.json`. Standalone from `SettingsManager` (which is plugin-focused) so the schema can grow per-backend without touching plugin code.

## [3.10.5] - 2026-05-19

### Fixed — `/handoff-pneuma` carries conversation context now, and works for Quick sessions

Two problems compounded into a target agent that had no idea what to do with a non-trivial intent like "做个工作汇报":

- **Quick sessions silently dropped the inbound payload.** `runHandoffFromExternal` correctly wrote `inbound-handoff.json` for both Quick and Project sessions, but the launcher boot path (`bin/pneuma.ts`) had a `startup.kind === "project"` guard around `readInboundHandoff` — and `installSkill` had a parallel `projectRoot && sessionId` guard around the handoff section injection. Both were legacy from intra-pneuma Smart Handoff (where the source was always a project session); external handoffs from CC/Codex are valid regardless of target shape. Dropped both guards. Quick sessions now surface the inbound payload exactly like project sessions do.

- **Slash template didn't tell the agent to bridge conversation context.** The CLI / URL scheme only carried `intent` (the literal slash argument) — for "build a counter webpage" that's enough, but for "做个工作汇报" the target needed to know what was just done. Extended the template with a new "Step 4: Bridge the conversation context" that instructs the source agent to compose a 2-4 sentence `SUMMARY`, list `FILES` worth reading first, and (Claude Code only) find the source transcript at `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` so the target can read the verbatim exchange when the summary isn't enough.

### Added — `--summary`, `--file`/`--files`, `--decision`, `--open-question`, `--source-transcript` flags

- `pneuma handoff-from-external` now accepts the full context payload (the schema already had these fields for intra-pneuma handoffs; the external CLI just didn't expose them).
- `POST /api/handoffs/external` accepts the same fields as JSON body keys (`summary`, `suggestedFiles`, `keyDecisions`, `openQuestions`, `sourceTranscript`).
- `pneuma://handoff` URL scheme accepts them as query params (`?summary=…&files=a,b,c&source-transcript=…`); the Electron handler in `desktop/src/main/index.ts` parses them through.
- `InboundHandoffPayload` gains an optional `source_transcript` field; `buildHandoffSection` renders it in the agent's first-turn prompt with explicit guidance to read it when the summary is insufficient.

## [3.10.4] - 2026-05-19

### Fixed — `/handoff-pneuma` install failed inside `/Applications/Pneuma Skills.app/` (spaces in path)

- **`loadBundledTemplate` left URL escapes in the resolved file path.** The function used `new URL(import.meta.url).pathname` to find its own directory and join `../templates/agent-commands/handoff-pneuma.md`. That `pathname` keeps URL escapes (e.g. `%20` for spaces), and `readFileSync` does not decode them — so on any install path containing a space (the default macOS app bundle `/Applications/Pneuma Skills.app/...` qualifies), the install endpoint threw `ENOENT: no such file or directory, open '/Applications/Pneuma%20Skills.app/...'` and the launcher's first-run banner surfaced that as a red inline error. Switched to `fileURLToPath(import.meta.url)` (the standard cross-platform decoder) so the resolved path matches what's actually on disk.

  No dev test or CI tmp path contained a space, which is why this slipped 3.10.0–3.10.3. Added a regression test that copies the package skeleton into a tmp dir whose name intentionally contains a space, dynamic-imports the copied installer, and asserts `loadBundledTemplate()` returns the template body.

## [3.10.3] - 2026-05-19

### Changed — desktop binary version unified with npm package version

- **`desktop/package.json` jumps 2.20.2 → 3.10.3.** From this release the Electron desktop binary, the npm `pneuma-skills` package, and the `**Version:**` line in `CLAUDE.md` all carry the same number. Bumping only one is now a release-process bug — CLAUDE.md's "Version Bump Checklist" was updated in 95365a8 to make this explicit.

  Why this matters: between 3.9.0 and 3.10.2 only the npm `package.json` got bumped each release; `desktop/package.json` sat at 2.19.1 from May 2024 through 3.10.0. `electron-updater` reads `desktop/package.json`'s version when comparing the running app to the latest release — so on every 3.9.x release the auto-update prompt never fired and users had to manually re-download. Fixed silently in 3.10.0 by bumping both, now unified here so the version field on the auto-updater dialog matches the GitHub Release tag and the changelog.

  Existing 2.20.2 users will see "v3.10.3 available" in the auto-updater dialog — that's a normal forward semver bump, no special handling needed on the user side.

## [3.10.2] - 2026-05-19

### Fixed — first-run "Install" banner silently failed on the Electron desktop build

- **`templates/` directory was missing from the desktop bundle.** `core/agent-command-installer.ts::loadBundledTemplate` resolves `../templates/agent-commands/handoff-pneuma.md` relative to its own location. The launcher's per-session and bundled-pneuma file tree (`/Applications/Pneuma Skills.app/Contents/Resources/pneuma/`) carries `bin/`, `core/`, `server/`, etc. but `desktop/electron-builder.yml`'s `extraResources` list never copied `templates/`. Result: every `POST /api/agent-commands/:backend/install` from inside the Electron app threw `ENOENT` and returned 500. Added the missing copy clause; the npm package was never affected (it bundles the whole repo).

- **`<AgentCommandBanner />` dismissed the prompt even when install failed.** The banner's `handleInstall` called `dismissPrompt()` unconditionally after iterating backends. Combined with the bundle bug above, one click left users in a stuck state — `promptDismissed: true`, `installed: {}`, no banner, no way to retry without manually editing `~/.pneuma/agent-commands.json`. The hook now returns a per-call success boolean and the banner only dismisses when every selected backend installed cleanly; failures render a red inline error and keep the banner up so retry is one click away.

## [3.10.1] - 2026-05-19

### Fixed — `pneuma://handoff` / `pneuma handoff-from-external` opened a black window

- **Missing session + mode query params in the spawned-session URL.** `runHandoffFromExternal` was returning a bare `http://localhost:<port>` after spawning the per-session pneuma server. The session backend bound and rendered correctly (project.json, history.json, viewer-state.json all written; the agent even produced first-turn output in `gazette/index.html`), but the frontend mounts only when it sees `?session=<id>&mode=<name>` in the URL — without those params the launcher renders an empty state, which the Electron mode window surfaced as a fully black window.

  Fixed by mirroring the URL builder in the regular `pneuma <mode>` boot path: the CLI and `/api/handoffs/external` now return `http://localhost:<port>?session=<sessionId>&mode=<mode>`. The Electron `pneuma://handoff` handler picks up the corrected URL via `createModeWindow`, so no Electron-side change was needed.

## [3.10.0] - 2026-05-19

### Added — `/handoff-pneuma` slash command for external code agents

Drop into a Pneuma session from Claude Code, Codex, or the desktop app without ever opening the launcher manually. The agent in your terminal runs `/handoff-pneuma "make a finance dashboard"`, picks a mode, and Pneuma spins up the right session in the current directory with the intent already staged via the existing Smart Handoff `inbound-handoff.json` plumbing.

- **`pneuma://handoff` URL scheme — primary path for desktop users.** The Pneuma Skills desktop app is already registered as the `pneuma://` URL handler (since the import/mode schemes). New `handoff` case in `desktop/src/main/index.ts::handlePneumaUrl` parses `intent`, `mode`, `cwd`, `init-project`, `source-agent`, POSTs the same body to the launcher's `/api/handoffs/external`, then opens a new mode window on the spawned session. No CLI install required — `open "pneuma://handoff?..."` is all the agent needs. Cold-start path (URL arrives before `app.whenReady`) covered via `pendingPneumaUrl`; Windows/Linux receive it through `second-instance`.

- **`pneuma handoff-from-external` CLI — for terminal-only / SSH / CI workflows.** `pneuma handoff-from-external --intent "..." --mode <name> [--init-project|--quick] [--cwd <path>] [--source-agent claude-code|codex]` validates the mode, optionally writes `<cwd>/.pneuma/project.json`, mints a session id, stages `inbound-handoff.json` under `<sessionDir>/.pneuma/`, picks a free port via `node:net listen 0`, and spawns `pneuma <mode> --no-prompt --project <cwd> --session-id <id> --port <p>` detached. Prints the URL on its last stdout line.

- **`pneuma agent-command` CLI** — `status|install|uninstall|update`, scriptable JSON output, per-backend or `--backend all`. Refuses to overwrite a user-authored file at the same path without `--force`. Auto-update re-stamps installed files on launcher boot.

- **`pneuma mode list --local [--json]`** — local-launchable modes (builtins + `~/.pneuma/modes/` + activated library modes) the slash command uses to drive its mode picker. Filters hidden modes. Distinct from the existing R2-published listing.

- **Launcher first-run banner** — `<AgentCommandBanner />` mounts on the launcher when neither backend has the command installed and the user hasn't dismissed the prompt. Per-backend checkboxes; one click installs both.

- **Settings → Manage agent commands** — full panel reachable from the `AppSettings` popover. Per-backend status (installed / out-of-date / conflict), install/uninstall/update, auto-update toggle, **one-click symlink to `~/.local/bin/pneuma-skills`** for desktop users who never ran `bun add -g pneuma-skills`, plus a shell-rc snippet (fish/zsh/bash detected from `$SHELL`) when that dir isn't on PATH.

### Install paths

- Claude Code: `~/.claude/commands/handoff-pneuma.md` → `/handoff-pneuma`
- Codex: `~/.codex/prompts/handoff-pneuma.md` → `/handoff-pneuma`

Source template: `templates/agent-commands/handoff-pneuma.md`. Carries a `<!-- pneuma:agent-command version="X" backend="..." -->` marker *below* the YAML frontmatter (line 1 stays as `---` so frontmatter parsers don't break). Absence of the marker = user-authored = never overwritten without `--force`. Registry at `~/.pneuma/agent-commands.json`.

### Internals worth knowing

- Machine-readable subcommands (`agent-command`, `mode list --local`, `handoff-from-external`) dispatch *before* `p.intro()` in `bin/pneuma.ts::main()`, so stdout is parseable JSON for the agent.
- Bun's `os.homedir()` is process-start-cached. `core/agent-command-installer.ts` reads `process.env.HOME ?? USERPROFILE ?? homedir()` so tests can override.
- Spawn uses `--no-prompt` — detached children can't read stdin, so clack's optional `init.params` prompts (webcraft's fal.ai key, etc.) would block forever. Defaults are silently applied; user can configure inside the running session.

### Tests

38 new tests across `core/__tests__/agent-command-installer.test.ts`, `core/__tests__/local-modes.test.ts`, `bin/__tests__/agent-command-cli.test.ts`, `bin/__tests__/handoff-from-external-cli.test.ts`.

## [3.9.1] - 2026-05-19

### Fixed — Electron client hangs on non-English locales (regression from 3.8.0)

- **Backward-compat launcher ready marker.** The 3.8.0 i18n PR localized the launcher's "Marketplace ready" stdout line (e.g. `模式画廊 → http://...` for zh-CN, `マーケットプレイス → ...` for ja), but the Electron desktop wrapper's `bun-process.ts` was matching the English literal `Marketplace → <url>` to know the launcher had booted. Non-English users saw the window stuck on "loading" for 30 seconds and then timeout.

  Hotfix: the launcher now also prints a stable English marker line `Marketplace → <url>` *immediately after* the localized line. Every shipped desktop wrapper version's regex matches it — no coordinated wrapper upgrade required, and the i18n behavior for the human-facing line is preserved.

- **Desktop wrapper regex hardened (defense in depth).** `desktop/src/main/bun-process.ts` now falls back to a locale-agnostic `→\s+(https?:\/\/\S+)` pattern after the English match fails. Future i18n additions to the launcher's startup output won't re-break the desktop client. Doesn't help users *currently* stuck on a pre-3.9.1 wrapper (auto-updater can't run if the app can't start), but matters for any future cold install of an older wrapper or out-of-band rebuilds.

### Workaround for users currently stuck on 3.9.0

Until your desktop client auto-updates to 3.9.1, the immediate unstick is one line:

```bash
# macOS / Linux
sed -i '' 's/"locale": "zh-CN"/"locale": "en"/' ~/.pneuma/settings.json   # macOS
# (Linux uses `sed -i` without the empty string after -i)
```

After editing, open the desktop app — the launcher boots in English. From there, the auto-updater picks up 3.9.1, restarts, and you can switch the locale back from Settings.

## [3.9.0] - 2026-05-19

### Added — Pneuma version compatibility

External mode authors can now declare which Pneuma runtime range they target, and the launcher surfaces incompatibility up-front so users see why a stale mode shouldn't be launched.

- **`pneumaVersion` field on `ModeManifest`** (optional, semver range — e.g. `"^3.8.0"`, `">=3.7.0 <4.0.0"`, `"*"`). Same field on `LibraryManifest` as a library-wide fallback, propagated through `InstalledLibrary` / `InstalledLibraryMode` sidecar caches so the launcher renders without re-parsing every manifest. Resolution precedence: per-mode > sidecar cache > library-level fallback.
- **`core/version-compat.ts` utility** — `checkCompat(declared, runtime) → { level, declared, runtime, reason? }`. Levels: `match` / `minor-drift` / `major-drift` / `unknown`. Lean implementation, no `semver` npm dependency; handles exact / caret / tilde / `>=` `<` / compound / wildcard / pre-release. 19 tests in `core/__tests__/version-compat.test.ts`.
- **`/api/registry` response** carries top-level `runtimeVersion` plus optional per-entry `compat` + `pneumaVersion`. Builtins never receive a compat field — they ship with the runtime by construction.
- **Launcher incompatibility UI** — `GalleryModeCard` dims to 60% opacity, prepends a red "Incompatible" chip next to the display name, and switches the launch button to a destructive red variant with a confirm-before-launch prompt (major drift). `QuickStartTile` dims and gains a small bottom-right red dot with the same confirm-on-click guard. Modes that don't declare `pneumaVersion` render exactly as before — the check is opt-in by design.

### Design notes

- **`pneuma library upgrade` (sketch)** — `docs/design/pneuma-library-upgrade.md` captures the planned CLI that will consume these declarations to walk library authors through major-version migrations. Two strategies (guided manual / agent-driven with the `create-mode` skill), per-version migration doc format, sidecar bookkeeping, rollout phases. Not implemented in this release.

### Companion: `pneuma-mode-gallery`

- The new [`pneuma-mode-gallery`](https://github.com/pandazki/pneuma-mode-gallery) library ships a `create-mode` skill that scaffolds new Pneuma modes (three archetype templates, `bin/dev.ts` with version-compat probe + seedFiles preflight) and stamps `pneumaVersion` on every template manifest — so consumers of the gallery automatically declare runtime targeting from day one.

## [3.8.0] - 2026-05-18

### Added — full-stack i18n + theme propagation

The chat is now multilingual end-to-end and every mode can dress for the user's chosen colour scheme.

#### UI / CLI / metadata i18n (en / zh-CN / ja)

- **Browser**: react-i18next over per-component namespaces, ~940 keys across 36 JSON files per locale. Locale picker promoted from Settings panel into the launcher header (`A / 中 / あ` typographic glyphs, no SVG globe), order Language → Theme → Settings → GitHub. Locale-parity tests assert identical key trees across en/zh-CN/ja (36 tests).
- **CLI**: `bin/i18n.ts` mirrors the browser stack with `fs.readFileSync` (no Vite at runtime). Every user-facing CLI log line now flows through `t(…)`.
- **Mode metadata**: `LocalizedString = string | { en, "zh-CN", ja }` added to `ModeManifest.displayName`/`description` and showcase highlights. `resolveLocalized(value, locale)` is the canonical reader; `core/utils/manifest-parser.ts::findTopLevelField` anchors via line-start + 2-space indent to stop nested `params[].description` from leaking into top-level extraction.
- **Persistence**: `~/.pneuma/settings.json` keeps a top-level `locale` field next to `theme`. `SettingsManager.save()` merges so plugin writes can't clobber it.
- **Server**: `/api/registry` carries a per-locale SWR cache. `/api/user-locale` / `/api/user-theme` mounted on launcher + every per-session server.

#### Workspace theme protocol

- **Hoisted `useTheme` → `src/hooks/useAppTheme.ts`** so the session shell (`App.tsx`, `EmptyShell.tsx`) shares one source of truth with the launcher. The `.launcher-light` design-token override is split into scope-agnostic `.cc-theme-light` (mounted by all session containers) + launcher-specific child rules.
- **Session shell light refinement**: dark-mode atmospherics (orange + purple mesh blobs, orange glow shadow, `cc-surface/40` glass `::before`) suppressed under `.cc-theme-light`. Replaced with a three-stop warm-tinted elevation stack and a neutral hairline border — matches the `launcher-card-elevated` vocabulary. Same treatment for `ChatInput` and `AgentBubble`'s floating panel.
- **`ViewerPreviewProps` gained `theme: "light" | "dark"` + `locale: string`** required fields. `useViewerProps` threads them from `useSystemPreferences` (the single Pneuma-overrides + browser-defaults merger). Viewers can opt in to re-skin / localize their own chrome.
- **Per-mode light support**: every builtin viewer audited and swapped. `illustrate`'s 1600-LOC `COLORS` constant became a theme-aware `getColors(theme)` helper threaded as props (and through React-Flow node `data` for the canvas tiles). `webcraft`'s 50+ inline `rgba`/`hex` literals swapped to `var(--color-cc-*)` references (iframe user content untouched). `kami`'s parchment letterbox (`#d9d6ca`) intentionally stays fixed — that's the product identity, not chrome. Plus the smaller swaps in `slide` / `doc` / `draw` / `diagram` / `remotion` / `gridboard` / `mode-maker` / `evolve` / `project-evolve` / `project-onboard`. `clipcraft` skipped — refactor pending separately.
- **Mode-maker CodeMirror theme** now follows the user's resolved theme via `theme={theme}` instead of the hard-coded `"dark"`.
- **Right-panel chrome polish** for light mode: `ModelSwitcher` dropdown, `ProcessPanel` scan button, `SchedulePanel` refresh, `DiffPanel` / `DiffViewer` / `SlashMenu` / `MessageBubble` token-bar / `ContextPanel` status dots — all swapped from `neutral-*` to `cc-*`. Terminal canvas + xterm chrome intentionally stay dark.

#### Agent-side propagation

- **`PNEUMA_USER_LOCALE` / `PNEUMA_USER_THEME` env vars** injected into every spawned agent process for skill / script / tool-call programmatic access.
- **`<pneuma:env user_locale="…">` attribute** carried on the first-turn env tag — agent's response language locks to the user's preference without the user having to repeat it.
- **Greeting is now single-language.** Each mode's manifest greeting gets folded with a `user-locale` attribute inside its existing `<system-info>` envelope (not appended as a separate tag — separate tags produce two assistant bubbles). The agent emits exactly one greeting matching the user's locale.

### Fixed — chat-stream rough edges

- **Ghost duplicate of the last reply with a blinking cursor on initial connect.** Server's replay buffer kept `stream_event` partials but the matching terminator `assistant`/`result` events were filtered out by `isHistoryBackedEvent` (already in `message_history`). Browser's `streaming` state replayed those partials and never got a terminator. `stream_event` removed from `shouldBufferForReplay`; browser also clears `streaming` defensively on every `message_history` arrival.
- **Redundant "welcome back" bubble next to fresh greeting.** `<pneuma:env>` tags are no longer delivered to the agent as standalone user turns. New `enqueueEnvContext()` records the tag in `messageHistory` (so the chat banner persists) and broadcasts it (so it renders live), but the agent doesn't see it until the user actually types — the next `handleUserMessage` prepends the queued tags as a one-shot prefix and clears the buffer. Consecutive same-reason banners collapse to the last in `ChatPanel` (the launcher / edit-toggle / reload paths each re-enqueue an "opened" tag; only the latest is informative).
- **"User ignored the question" reaction with the AskUserQuestion picker still on screen.** Claude Code 2.x's SDK auto-denies the `AskUserQuestion` tool internally (returns an `is_error` `tool_result` before the user can click); the model reads the denial and emits a reactionary assistant turn. We now flag `Session.suppressingPostAskq = true` after delivering an assistant message that *contained* the AskUserQuestion, and drop the *next* assistant turn + its `stream_event` partials. The flag clears when the user submits a real answer (resolving the synthetic permission) or when the CLI / browser cancels — the agent's response to the actual answer flows through normally.
- **Cancel button collapsed to a vertical CJK column** in `ConfirmButton` — flex `min-width: auto` defaults to the intrinsic minimum on CJK glyphs. `whitespace-nowrap` fixes it.

### Misc

- `useSystemPreferences` stops using a `useRef` to dedupe its fetch — that ref dead-locked inside StrictMode's mount → cleanup → mount cycle (first run set the ref + got cancelled, second run gated out, `ready` stuck false). The `cancelled` flag inside the effect closure is the proper guard.
- `pneuma-session` skill installed globally for every session — teaches `pneuma session refine` for late-binding display name + description.

## [3.7.2] - 2026-05-17

### Fixed

- **`gh` probe inside the packaged Electron app.** Settings → GitHub reported `GitHub CLI not installed` in the .app even when `gh` was at `/opt/homebrew/bin/gh` — macOS GUI apps inherit the launchd PATH (`/usr/bin:/bin:/usr/sbin:/sbin` only), which doesn't include Homebrew on Apple Silicon. The `Bun.spawn(["gh", …])` calls in `core/github-cli.ts` ran with that minimal env and silently ENOENT'd. The backend CLIs (claude / codex / kimi) already route through `server/path-resolver.ts` for the same reason; `gh` is now wired up the same way — `resolveBinary("gh")` finds the absolute path via the user's interactive shell PATH, and every spawn passes `env: { ...process.env, PATH: getEnrichedPath() }`. Dev (`bun run dev`) was unaffected because it inherits the user's shell PATH directly.

## [3.7.1] - 2026-05-17

### Improved — kami and webcraft upstream skill syncs

Pure skill-content release: both upstream-tracked modes pull in their latest design intelligence. No platform code changes — modes/* only.

#### Kami: tw93/kami V1.4.1 → V1.5.0 "Live Paper"

The substantive sync of the release cycle. Two stacked PRs (drop-in references first, prose + font second) bring kami to upstream-parity for everything that fits Pneuma's iframe paper-canvas model. The WeasyPrint runtime, `build.py` / `ensure-fonts.sh` pipeline, Claude Code plugin marketplace path, `llms.txt` / sitemap / JSON-LD landing-page assets, and the `~/.config/kami/brand.md` profile loader remain explicitly non-adopted per `modes/kami/NOTICE.md`.

- **Two new skill references.** `anti-patterns.md` is a six-category quality checklist (Emptiness / Fabrication / Mimicry / Excess / Source gaps / Tone) that any kami session can consult before drafting. `resume-writing.md` extracts the three-part bullet structure (Role / Actions / Impact) with explicit per-language char/word limits and metric layout rules — content that used to live inline inside `writing.md` and is now its own first-class doc to mirror upstream.
- **`design.md` gains Pygments-style syntax highlighting guidance** reframed for client-side highlighters (highlight.js / Prism, same five token-to-CSS-var bindings: `Keyword → --brand`, `Comment → --stone`, etc.). Plus a slide-caption floor, a CJK-screen-body line-height row, a cascading-break-inside browser-print note, and tightened sparse-slide handling cells in the Deck Recipe table ("merge with neighbor first; shrink page size last").
- **`writing.md` gains two new core principles.** #7 "Term annotation half-life" governs when a parenthetical English gloss after a CJK term can drop on subsequent appearances. #8 "English-term density in CJK text" sets a per-paragraph ceiling so prose stays readable.
- **`diagrams.md` adds a slide-section sizing rule.** SVG diagrams now fill ≥65% of slide area — keeps diagrams from looking lost on a 1280×720 paper.
- **`SKILL.md` grows by 179 net lines.** A new doc-type genre map covers 8 supported genres (one-pager, long-doc, letter, portfolio, resume, slides, equity-report, changelog — `landing-page` stays deferred while we decide whether kami or `webcraft` owns it). An "Auto-select charts from data" decision tree maps data shape to the right chart type. Per-page density rules — items-per-page hard floors per template — are reframed against the existing `kami-fit.json sparse` status + `<div class="page">` / `.co` callout vocabulary. A new three-step "When the user hands over raw content" subflow runs source/material pass → layout note → content-set creation before any code lands. A single-line Note defers output format selection to the viewer's Export menu so agent-side and UI-side selection can't fight.
- **Headings now ship in TsangerJinKai02-W05 (500-weight) alongside W04 body.** New 18.9 MB `seed/_shared/assets/fonts/TsangerJinKai02-W05.ttf` joins the existing W04 ttf. `styles.css` replaces the previous single-face `font-weight: 400 500` synthetic-interpolation declaration with two fixed-weight `@font-face` blocks (W04 at 400, W05 at 500) — upstream-faithful, avoids engines fabricating a synthetic 500 when both faces ARE present. The Tsanger commercial-use caveat in `NOTICE.md` now applies to both faces.
- **Manifest skill version 1.1.0 → 1.3.0** (two minor bumps in one release cycle): 1.2.0 captures the drop-in references, 1.3.0 closes the prose + font sync.

#### WebCraft: pbakaus/impeccable skill-v3.1.0 → skill-v3.1.1

Pure bookkeeping. The 3.1.0 → 3.1.1 upstream diff is a Windows path fix in `cli/.../critique-storage.mjs` (CLI-only — Pneuma doesn't ship the upstream CLI), an antipattern-detector tweak in `cli/engine/detect-antipatterns.mjs` (also CLI engine), and the SKILL.md frontmatter `version:` line. The skill body, every `references/cmd-*.md` verb file, every `references/*.md` topic file, and every adaptation in `NOTICE.md` are byte-identical to 3.1.0.

- **NOTICE.md tracked-version line** moves to `impeccable skill-v3.1.1 (May 14, 2026)`.
- **Manifest skill version 1.4.0 → 1.4.1** (patch — no content delta, just the tracking pin honesty).

### Process note — stacked-PR pitfall caught and patched

The kami sync shipped as two stacked PRs (#109 drop-in references, #110 prose + font). When #109 squash-merged to `main`, its branch was auto-deleted; GitHub then "merged" #110 into the orphaned branch and the merge commit landed nowhere reachable from `main`. Caught during the bump pass — `ls modes/kami/seed/_shared/assets/fonts/` showed no W05 file despite #110's status reporting `MERGED`. Recovered by cherry-picking the original PR-2 commit onto a fresh branch from current `main` and re-opening as #111 (the diff was exactly the 5 expected files, no merge conflicts). Going forward: for stacked PRs, use merge commits on the base PR (not squash) so dependent PRs can rebase cleanly, or manually rebase the dependent PR onto `main` after the base PR squash-merges.

## [3.7.0] - 2026-05-16

### Added — Mode Libraries: ship N modes from one GitHub repo, pin favorites to the front

A single GitHub repo can now host many Pneuma modes as a library. `pneuma mode add github:<user>/<repo>` detects the shape at install time, drops a multi-mode repo into `~/.pneuma/libraries/<id>/` with a `.library.json` sidecar tracking per-mode activation + last-synced sha, and surfaces the contained modes in the Mode Gallery alongside Built-in / Local / Published. Author side adds init / publish / push so anyone can run a personal community library on their own GitHub account — same flow that the launcher uses to install other people's libraries. The launcher also gains a favorites layer: a small persistent list of pinned modes that bubble to the front of Quick Start and the project mode-tile picker.

#### Multi-mode library distribution

- **New `~/.pneuma/libraries/<id>/` layout** keyed by `<user>-<repo>` for github sources. Each library carries a `.library.json` sidecar with the source URL/ref, the git sha observed on last sync, and per-mode rows `{ name, manifestVersion, activated, installedVersion }`. Activation is local-only — every contained mode lives on disk after the initial clone; toggling visibility is a zero-cost sidecar flip.
- **Auto-detect at install time.** `core/mode-resolver.ts` clones into the single-mode cache as before, then inspects the layout: root `manifest.ts` → single-mode (legacy path unchanged); root `pneuma.library.json` or N subdirs with manifests → library. Library shape moves the clone into `~/.pneuma/libraries/<id>/` atomically and writes the sidecar; the legacy `resolveMode()` path throws a friendly error for library specifiers so the launch flow stays single-mode-only.
- **New `pneuma library` CLI family** mirroring the existing mode/plugin subcommand rhythm: `init [--github user/repo] [--private]`, `link <source>`, `list`, `sync <id>`, `publish <mode> [--to id] [--as name] [--push]`, `push <id>`, `unlink <id>`, `activate <id> <mode>`, `deactivate <id> <mode>`. `--to` auto-infers when exactly one library is linked.
- **Author flow.** `core/library-publish.ts` adds `initLocalLibrary` (scaffolds dir + git init + initial commit), `publishModeToLibrary` (copies a mode in, updates the repo-side `pneuma.library.json` idempotently, syncs the consume-side sidecar, optionally pushes), and `pushLibrary`. Repo creation uses the local `gh` binary via `core/github-cli.ts` — `gh repo create --source --push` in one shot. No PAT fallback in v1; the launcher's Settings → GitHub card surfaces install + sign-in hints when `gh` is missing or unauthenticated.

#### Server surface

- **`/api/libraries/*` route family** mounted launcher-scope: `GET /api/libraries`, `POST /api/libraries/link`, `POST /api/libraries/init`, sync / activate / deactivate / accept-update / publish / push / delete, plus `GET /api/github/status`. Every mutation broadcasts a `libraries_updated` WS event via new `WsBridge.broadcastAll` so connected browsers refresh without polling — and invalidates the launcher's `/api/registry` SWR cache so the Quick Start grid picks up newly activated library modes in the same tick instead of after a 60s TTL.
- **`/api/registry`'s `local[]`** gets two optional fields per entry: `librarySource: { id, name, displayName? }` and `updateAvailable: boolean`. Library-activated modes surface through the existing local-mode plumbing; the gallery uses `librarySource` to group them under their library headers.

#### Mode Gallery v2

- **Libraries section sits as a peer of Built-in / Local / Published** between Local and Published — "yours trending toward public". Each linked library renders as a sub-group: an identity strip (display name, source URL chip, last-synced timestamp) with inline Sync / + Publish / Unlink actions, then the existing `GalleryModeCard` for activated modes (visual aesthetic preserved verbatim), then a collapsible "N inactive modes" footer with per-mode Activate buttons. Library management is now contextually right next to the modes it owns — no separate panel cluttering the gallery, no second click to reach Sync.
- **Library provenance band** appears at the bottom of an expanded library mode card showing `From <displayName> · <source.url> · synced <ts>`. The Quick Start tile's corner chip carries this as a tooltip; the gallery card has room to spell it out.
- **Add Library / Publish dialog entry points** moved from the launcher main page into the gallery's Libraries section header (`+ Add library`) and each library's `+ Publish` action. Launcher main is back to "Quick Start grid + Mode Maker hero" — the dedicated Mode Libraries section + unused LibraryCard / LibraryIcon helpers (~330 lines) were removed.

#### Quick Start favorites

- **Persistent favorites at `~/.pneuma/favorites.json`** — atomic write, graceful fallback to a curated default set (`webcraft`, `slide`, `diagram`, `illustrate`, `remotion`, `kami`) when the file is missing or malformed.
- **`useFavorites()` hook** with optimistic-toggle + a write-sequence guard so a slow earlier POST can't clobber a later state once it lands. Exposes `favorites`, `isFavorite`, `toggle`.
- **Quick Start tile gets a small filled-star top-left when favorited**; pairs with the existing library link glyph (top-right) without colliding. Toggling happens in the gallery card header (next to Evolve / Edit) — Quick Start is for fast launch, not management.
- **ProjectPanel's mode-tile picker re-orders** by the same favorites list: favorites in their persisted order, then used-in-this-project modes by recency, then the rest by builtin priority. The inline favorite glyph rides next to the title.

### Fixed

- **Tile descriptions actually clamp now.** The `block` Tailwind utility was clobbering `line-clamp-2`'s `display: -webkit-box` in source order, silently disabling the clamp and letting Guizang Ppt's marathon description balloon QuickStartTiles to ~10 lines while neighbors stayed at 2. Removed `block`; the clamp's own display rule handles it.
- **Library origin chip no longer dominates the tile.** The previous full pill (`from E2E Library Roundtrip`) competed with the mode title and varied wildly with library name length. Replaced with a 12px corner link glyph; the full library name lives in the tooltip.
- **Quick Start grid React keys.** `key={mode.name}` collided whenever multiple modes manifested the same name (the builtin `slide` plus each `slide-evolved-*` fork all say `name: "slide"`). React was warning about duplicate keys and the favorite badge appeared on only one of the colliding tiles per render. Composite key `${source}::${path || name}` restores per-tile stability.

### Changed

- **Launcher main page no longer carries a Mode Libraries section.** Quick Start grid (with favorites pinned + library-sourced tiles inline-merged via `/api/registry`) sits above the Mode Maker hero, and that's it. Library management lives in the gallery's Libraries group.

## [3.6.0] - 2026-05-15

### Added — `pneuma session refine`: the agent can rewrite a session's UI identity

A session's row in the launcher / ProjectPanel used to read `"<Mode> session"` plus the first user-message preview, which for project sessions is the synthetic `<pneuma:env reason="opened">` tag — pure placeholder. Three sessions of the same mode were indistinguishable except by thumbnail and timestamp memory. This release gives the agent the ability to rewrite both fields once the conversation has produced enough substance, mirroring the existing "refine project meta / generate atlas" pattern but scoped down to a single session and run inline (no separate evolve mode, no separate process).

#### Layer 1 — preview no longer says `<pneuma:env>`

- **`extractPreviewFromHistory` walks past synthetic pneuma tags.** The first user message in a project session is always a server-emitted `<pneuma:env reason="opened" />` (or `<pneuma:request-handoff>`, `<pneuma:handoff-cancelled>`, `<pneuma:askq-answer>`) — these ride the user-message channel for the agent's benefit but carry zero information for a human scanning the panel. The preview computation now skips any message whose trimmed content begins with `<pneuma:` and surfaces the first real user prompt instead. Pure server-side; no agent involvement.

#### Layers 2 + 3 — schema + agent CLI + server route + WS broadcast

- **`<sessionDir>/session.json` gains optional `displayName`, `description`, `refinedAt` fields** alongside the existing `sessionId` / `agentSessionId` / `mode` / `backendType` / `createdAt`. The `ProjectSessionRegistryEntry` and `QuickSessionRegistryEntry` in `~/.pneuma/sessions.json` mirror `description` + `refinedAt` so the launcher's flat list-fetch doesn't have to crack open every session file.
- **New `pneuma session refine --json '<json>'` CLI subcommand** (in `bin/session-cli.ts`, modeled directly on `pneuma handoff`). Reads JSON inline or from stdin, validates that at least one of `displayName` (≤40 chars) / `description` (≤280 chars) is present, POSTs to `${PNEUMA_SERVER_URL}/api/session/refine`. Single-shot, no retries.
- **New `POST /api/session/refine` server route** atomically rewrites the session-local `session.json`, syncs the corresponding registry entry (refined `displayName` only overrides the resolved row title when no explicit user `sessionName` is set — manual rename still wins), and broadcasts `session_meta_updated` over WS so any open browsers refresh the affected row in place.
- **`BrowserIncomingMessage` gets a `session_meta_updated` member** + a new `sessionMetaTick` counter on the store. Components that list sessions (currently ProjectPanel) bump-tick to re-fetch instead of mutating local state — keeps the data path single-source.

#### Layer 4 — `pneuma-session` skill (global, mode-agnostic)

- **New `modes/_shared/skills/pneuma-session/`** installed automatically for every session alongside `pneuma-preferences`. Teaches the agent: (a) when to refine — user asks ("整理一下会话信息", "rename this session", etc.) or substantive progress (15+ user turns + the default title still in place + a clear topic has emerged); (b) what makes a good title and description — describe the session's topic, not the work done, in the user's language; (c) to launch a Task subagent for proactive refines so the main turn doesn't stall; (d) a soft cadence cap (≈once per 20 turns) so the row doesn't flicker between titles.

#### UI — mode icon next to the refined title, live row updates

- **A small mode-icon chip sits next to every session-row title in ProjectPanel.** Since the refined `displayName` replaces "WebCraft session" wholesale, the mode used to disappear from view. The chip restores it at a glance and exposes the full mode name via `title=` / `aria-label` on hover.
- **The row prefers `description` over the history-derived `preview`** — refined summaries are higher-signal. Both are line-clamped to one row with the full text in a hover tooltip.
- **The panel re-fetches its session list when `sessionMetaTick` advances** (driven by the WS `session_meta_updated` broadcast from the active server). Manual refresh is no longer required for the row that just refined.

#### Documentation

- **`CLAUDE.md` gains a "Session-meta refine (3.6.0)" subsection** describing the CLI / route / WS / skill / UI surface, and the per-session-files table now notes the optional `displayName` / `description` / `refinedAt` fields on `session.json`.

## [3.5.6] - 2026-05-14

### Fixed — Chinese export names, restored chat attachments

Two small but visible bugs that surfaced from project-mode sessions with non-ASCII content.

#### Export name no longer collapses on CJK titles

- **Webcraft / slides / remotion export filenames now fall back to the content-set directory when the title is non-ASCII.** The slug regex `/[^\w\s.-]/g` was stripping CJK to underscore runs (a pure-Chinese manifest title like "我的作品集" became "____.zip"), and the hardcoded fallbacks never fired because the slug was technically non-empty. A new shared `safeDownloadName(rawTitle, contentSet, fallback)` helper picks: (1) the slug if it keeps at least one word char ("Kaku 作品集" → "Kaku"), (2) the content-set directory name (always Latin/kebab-case by SKILL.md + scaffold convention), (3) the hardcoded literal.
- **Two related drive-by fixes.** `/export/slides/download` had a malformed `Content-Disposition` header (stray spaces in `filename = "..."; filename *= UTF - 8''...`) that fell back to URL-derived filenames; the ZIP route only set the ASCII `filename=` form. Both now use the proper `filename="<ascii>"; filename*=UTF-8''<utf8>` pair so modern browsers display the readable name.

#### Chat-attached files restore on session reopen

- **User-message attachments survive the persist/rehydrate round trip.** `WsBridge.handleUserMessage` saved uploaded files + images to disk but persisted only `content`, `timestamp`, `id` into `session.messageHistory`. On reopen the chat bubble re-rendered as text-only — the original files still on disk, invisible. The history entry now carries optional `images: { media_type, path }[]` and `files: { name, size, path? }[]`; `history.json` stays small (path only, no base64); the browser fetches image bytes through the existing `/api/file?path=<abs>` route. `MessageBubble` renders `data` (fresh send) or `path` (rehydrated) — same look either way.
- **Scope:** fix lands on the Claude Code bridge (the default backend). The Codex and kimi-cli bridges have their own `handleBrowserUserMessage` that drop the same metadata; they'll get the matching treatment in a follow-up that extracts the `saveImageToDisk` / `saveFileToDisk` helpers behind a shared module so the three bridges don't fork on disk-save logic.

## [3.5.5] - 2026-05-14

### Fixed — packaged app finally ships its builtin deploy plugins

The desktop app silently shipped without any builtin plugins, so a workspace with valid Vercel / CF Pages config detected no providers and the deploy UI showed nothing — even though running the same workspace under `bun run dev` worked. Now:

- **`plugins/` is bundled into the .app's extraResources** — mirroring the existing `../modes -> pneuma/modes` clause in `desktop/electron-builder.yml`. `PluginRegistry` resolves the builtin directory as `join(import.meta.dir, "..", "plugins")` relative to `server/`, which is `pneuma/plugins/` in the packaged layout; the missing clause meant `existsSync(dir)` returned false and discovery silently exited with zero manifests. vercel-deploy, cf-pages-deploy, and obsidian-memory now load in production builds the same way they always loaded in dev.

## [3.5.4] - 2026-05-14

### Improved — WebCraft skill resynced to Impeccable v3.1.0; backend picker in the project launcher

Two unrelated touch-ups in one release: the WebCraft mode's skill content jumps from upstream Impeccable v3.0.1 to v3.1.0 (the upstream "Skill 3.1.0" tag), and the project-launcher mode-tile drawer finally gets the Agent (backend) picker it had been quietly missing.

#### WebCraft skill — synced to Impeccable v3.1.0

- **The mode skill jumps from Impeccable v3.0.1 to v3.1.0** — all 22 verb command references (`cmd-craft.md`, `cmd-shape.md`, `cmd-critique.md`, …) and all 12 topic references (`brand.md`, `typography.md`, `spatial-design.md`, …) are reset against the upstream `skill-v3.1.0` tag, then re-adapted to Pneuma's iframe paper-canvas runtime. `NOTICE.md` tracks the new version + nine adaptation rows. The webcraft mode's manifest version bumps to **1.4.0**, so existing workspaces see a skill-update prompt on next open.
- **`craft` enforces explicit gates again.** Four STOP markers between shape and code (direction questions, palette generation, mock generation, mock approval), plus a new mock-fidelity inventory and image gate before any HTML is written. A compact shape's "confirm or override" no longer reads as code-green by accident.
- **`critique` writes a snapshot; `polish` reads it.** Each critique persists to `.impeccable/critique/<YYYYMMDD-HHMMSS>__<slug>.md` (YAML frontmatter carries `total_score` / `p0_count` / `p1_count`); `polish` pulls the latest snapshot for the same target as additional signal, so backlogs aren't re-derived from scratch. A user-curated `.impeccable/critique/ignore.md` is honored — flagged-but-intentional deviations stop re-raising.
- **New anti-patterns in `SKILL.md`'s catalog.** Italic-serif display heroes (Fraunces, Recoleta, Newsreader, Playfair, Cormorant, Tiempos as primary hero h1), uppercase letter-spaced hero eyebrow chips (incl. the 999px-radius pill variant), body text running to the absolute viewport edge, and a two-altitude category-reflex check that catches both first-order ("observability → dark blue") and second-order ("AI tool that isn't SaaS-cream → editorial-typographic") training-data tells.
- **Image-led brand surfaces can't degrade into abstract panels.** Travel, editorial, portfolio, venue, product showcase, entertainment, and education work needs credible imagery (generated plates, illustrations, maps, renders, destination scenes) when the approved mock or subject matter calls for it — a tasteful gradient is a missing-asset defect, not a stylistic choice.
- **Live mode and Codex's native image-gen path stay unadopted.** Pneuma's iframe preview already provides the live surface upstream's `live` command wraps around; image generation continues to flow through `scripts/generate_image.mjs` / `edit_image.mjs` taught in `SKILL.md`. `reference/codex.md`, `skill/agents/impeccable-asset-producer.md`, and the `skill/scripts/live-*` family are intentionally not ported (documented in `NOTICE.md`).

#### Project launcher — Agent picker in the mode-tile drawer

- **A mode-tile click in `ProjectPanel` now lets you pick the backend** — Claude Code / Codex / Kimi — before confirming. Mirrors the picker in the standalone-launcher's `BackendLaunchDialog` (same 3-button layout, "Soon" / "N/A" badges for unavailable backends), defaults to the server's `defaultBackendType`, and only ships in the `/api/launch` payload for fresh sessions; resuming a session still reads the persisted `backendType` from its `session.json`. The launcher's `BackendType` / `BackendOption` / `FALLBACK_BACKENDS` / `BackendLogo` / `backendLabel` are now exported so the picker doesn't fork.

## [3.5.3] - 2026-05-12

### Fixed — no more un-closable "running" sessions

After 3.5.1 surfaced *all* running sessions in the launcher's "Continue" (not just children the launcher spawned), an orphaned session — e.g. a Smart Handoff target whose spawning server already exited, reparented to init, and not honoring SIGTERM — showed up as a "running" card that "Stop" couldn't kill. Now:

- **The kill endpoint escalates** — `POST /api/processes/children/:pid/kill` sends SIGTERM, then SIGKILL after a short grace if the process is still alive, and drops the registry entry. SIGKILL can't be caught, so a wedged session always goes down; the dead-PID prune on the next `/api/running` read clears the card. Works for sessions spawned by *any* server, not just the launcher's own children.
- **Session shutdown can't wedge** — `bin/pneuma.ts`'s SIGTERM/SIGINT handler now has a force-exit fuse (and a re-entry guard), so a hung cleanup (unresponsive agent backend, stuck `server.stop`) can't keep the process alive.
- **Closing a mode window tears down everything it hosted** — a desktop window tracks every URL it navigates through (project shell → onboard → handoff target) and, on close, kills all those session servers (matched by port via the system-wide running registry — so a handoff target spawned by a different server is covered too), rather than only the URL the window was first opened with. This is what was leaving orphans behind in the first place.

## [3.5.2] - 2026-05-12

### Fixed — selection cards restored from history no longer look broken

When a session reopens and the chat reloads from `history.json`, a viewer-selection card used to degrade to a generic `paragraph in file.html` header followed by an empty `""` — the only thing recovered from the persisted `<viewer-context>` block was the `file` attribute. Now:

- **The locator card recovers what the persisted block actually carries** — the CSS locator path, element label, tag, classes, and nearby text — so a restored card shows the real `▷ div.shell > main > section.metrics in index.html`, not `paragraph`. For text-style selections (`heading (level 2) "Title"`, etc.) the type/level/excerpt are recovered too, since those *are* in the block. (The element's text excerpt isn't emitted for selector-based selections and the inline-SVG widget thumbnail isn't persisted at all — those stay absent, by design.)
- **An empty excerpt is dropped, not rendered** — the card omits the `"…"` line entirely when there's no text, rather than showing `""`.
- **No phantom cards** — a pure "viewing"-context message (no element selected) no longer synthesizes a locator card on reload.

## [3.5.1] - 2026-05-12

### Fixed — session thumbnails, launcher "Continue" staleness, chat file actions

A polish wave across the launcher and chat surfaces.

#### Session thumbnails — real captures, settled frames, project sessions

- **Desktop builds capture a real window screenshot** — `webContents.capturePage(rect)` via a new `pneuma:capture-page` IPC, instead of serializing the DOM with snapdom. So iframe-based viewers (WebCraft, mode-maker Play), web fonts, and full-window (`layout: app`) viewers finally get a faithful thumbnail. Browser-only dev keeps the snapdom fallback (no iframe contents — accepted). Capture priority: viewer-supplied `captureViewport()` → `capturePage` → snapdom-family fallback.
- **Capture waits for the render to settle** — a short minimum delay, then until no finite CSS animations/transitions are running in the viewer subtree (entry/appear animations no longer get caught mid-frame), then a couple of rAFs + idle.
- **Escalating + debounced passes** — a few passes after the viewer mounts (≈1.5s / 5s / 14s — covers short-lived sessions that close before file activity) plus a 6s debounce after any file change; each pass overwrites the previous one.
- **Near-uniform frames are rejected** — an all-white / all-dark capture is dropped rather than uploaded, so a blank frame never replaces a good thumbnail. (An iframe viewer whose snapdom capture comes out blank now falls back to its mode icon instead of a white rectangle.)
- **`GET /api/running` carries `thumbnailUrl`** — so the launcher's "Continue" cards show a thumbnail for project sessions too, not just quick sessions.

#### Launcher "Continue" — system-wide running sessions, no stale modes

- **New shared running-session registry** — `~/.pneuma/running/`, one pid-file per live `pneuma <mode>` process, written on startup and removed on exit; readers prune dead PIDs. `GET /api/running` returns *all* running sessions system-wide, each carrying that process's *current* mode. "Continue" now sources its running items from here instead of the launcher's own `childProcesses` map — so a project that switched modes internally (a Smart Handoff target, or a `project-onboard` "apply task" target — spawned by a *different* session server, previously invisible to the launcher) shows its current mode, not a stale one. A workspace with more than one running session collapses to the most-recent.
- **Stop works on any running session** — the kill endpoint will signal a known running session even when it isn't one of this launcher's own children.

#### Launcher — opening a Project opens a new window

- **Clicking a Project card** (and the meta-row quick-resume, "Create & discover", and replay-a-recent-session) opens a **new window** (`window.open` → Electron's `setWindowOpenHandler` → a fresh mode window) instead of navigating the launcher window itself — the launcher keeps its main-window role. In a browser it's a new tab. In-project navigation (picking a session in `ProjectPanel`, `EmptyShell`'s auto-onboard) is unchanged — those stay within the project's own window.

#### Chat — file tool-call action row

- **"Open" / "Reveal" work on files outside the session workspace** — `/api/system/open` and `/api/system/reveal` no longer require the path to live inside the workspace (matching `/api/system/open-in-editor`, which never did); they just require the path to exist. Agents routinely `Read`/`Edit` files in sibling projects, docs, and configs — the affordance now opens *that* file.
- **The "Editor" picker dropdown is no longer clipped** — it renders in a portal anchored to the split-button (flips above / clamps to the viewport, repositions on scroll), so the tool block's `overflow: hidden` and the chat scroller no longer eat it.

## [3.5.0] - 2026-05-11

### Added — scene-type preview + system-open actions for file tool calls

The chat now surfaces what the agent touches. A `Read` of an image renders an inline thumbnail (the tool block defaults to expanded; click the thumbnail for a full-screen lightbox), and every file-touching tool call (`Read` / `Write` / `Edit` / `NotebookEdit`, plus whatever the active backend normalizes to those — Codex's `fileChange` lands as `Edit`) gets a one-click action row: open with the OS default app, open in a detected code editor (split-button, remembers your choice), reveal in Finder/Explorer.

- **Backend-agnostic by construction.** Backend tool-naming differences live in a new optional `BackendModule.toolFileRef(toolName, input)` pure resolver (a shared `defaultToolFileRef` covers the Claude-shaped `Read`/`Write`/`Edit`/`NotebookEdit` + `file_path` convention, used verbatim by claude-code and codex; kimi-cli layers a generic `path`/`file_path` fallback). A `stampFileRefs` helper, called on every assistant-message broadcast in all three backend bridges, stamps a normalized `fileRef: { path, kind }` onto `tool_use` blocks. The chat UI reads `block.fileRef` only — no tool-name strings, no `if (backend === …)` branching.
- **`GET /api/file?path=<abs>`** — a workspace-contained file server (strict `resolve` + workspace-root prefix check) so the chat's `<img>` can point at any file the agent read.
- **New mode-agnostic chat components** — `FilePreview` (image thumbnail v1; the file-type dispatch leaves a clean seam for markdown/JSON/video/audio/PDF later), `ToolFileActions` (the open/editor/reveal row; shares the editor-picker `localStorage` key with `EditorPickerButton`), `ImageLightbox` (full-screen overlay, Esc/backdrop close, focus-trap), and `src/hooks/useFocusTrap` (lifted from `modes/clipcraft/`).

#### Known limitations / follow-ups

- Inline preview is images only in v1; other types fall through to the existing code-block rendering.
- Grouped tool blocks (`ToolGroupBlock` — several `Read`s collapsed into one row) don't show per-item thumbnails/actions; only standalone tool blocks do.
- `ToolFileActions` and `EditorPickerButton` are separate components that now share the remembered-editor `localStorage` key but not the UI; unifying them is a future cleanup.

## [3.4.0] - 2026-05-11

### Changed — Project lifecycle simplified

The launcher's "Recent Projects" list is now a single source of truth: `~/.pneuma/sessions.json`. No more startup scans, no more silent recovery. The previous design walked `~/pneuma-projects/` on every launcher boot to re-add Projects whose registry rows had vanished, which had two failure modes that drove the user nuts:

1. Projects living outside `~/pneuma-projects/` could never be recovered (the scan only knew about one folder).
2. The scan made it impossible to actually *delete* a Project — every boot resurrected whatever it found on disk.

The new shape:

- **Startup auto-scan removed.** `reconcileSessionsRegistry()` and the `pneuma sessions rebuild` subcommand are gone. The launcher reads `~/.pneuma/sessions.json` as-is.
- **`POST /api/projects` is now Open-or-Create.** Three branches depending on the chosen path:
  - **Fresh path** (no `.pneuma/`): scaffold a new Project as before — Onboard fires unless the caller passed `skipOnboard`.
  - **Existing `.pneuma/project.json`**: load it. The on-disk manifest is the source of truth for identity (`name` / `displayName` / `description` / `createdAt` / `founderSessionId`); the dialog's typed values are ignored. `onboardedAt` is preserved or freshly stamped so `EmptyShell`'s auto-trigger doesn't re-run `project-onboard` on a set-up project. Registry row upserted.
  - **`.pneuma/sessions/` exists but no manifest**: synthesize a minimal manifest from the dialog's `name` / `displayName`, stamp `onboardedAt`, upsert. Recovers Projects whose `project.json` was lost while the sessions/ tree survived.
- **Response carries `migrated: boolean`** so the dialog (or any future caller) can distinguish a fresh create from an "I opened an existing path" outcome.
- **`pneuma project add <path>` CLI.** Same Open-or-Create logic exposed as a one-line CLI for users who want to bulk-recover from a backup, register a Project that lives outside the default folder, or otherwise script their setup. Replaces the implicit auto-scan.

#### Server / CLI

- `server/projects-routes.ts` POST `/api/projects` — branch on `.pneuma/project.json` + `.pneuma/sessions/` presence; preserve existing manifest fields on migrate; idempotent registry upsert.
- `bin/pneuma.ts` — `reconcileSessionsRegistry()` (~160 lines), its startup call, and the `pneuma sessions rebuild` subcommand removed. New `pneuma project add <path>` subcommand added.
- `server/__tests__/projects-routes.test.ts` — old 409-on-existing test replaced with four tests covering the three Open-or-Create branches plus `onboardedAt` preservation.

#### Migration notes

- Existing `~/.pneuma/sessions.json` files keep working unchanged. The schema is the same.
- Anyone who relied on `pneuma sessions rebuild` to rehydrate their registry: run `pneuma project add <path>` for each Project root instead, or just click *Create Project* on each path in the launcher.
- Anyone who relied on the implicit scan finding their Projects under `~/pneuma-projects/`: same — use either entry point above.

### Fixed — CI test step could hang for hours

- **`server/__tests__/projects-routes.test.ts` leaked chokidar watchers.** `POST /api/projects` (and archive / restore / delete) call `primeProjectCache` / `revalidateProjectCache`, which start persistent watchers; the test's `afterEach` removed the tmp dir but never tore the watchers down, so `bun test` couldn't drain its event loop and the CI "Run tests" step would stall for hours instead of finishing in minutes. Added `await shutdownProjectCache()` to the `afterEach`, mirroring `projects-cache.test.ts`.
- **CI hardening.** `release.yml` gains `timeout-minutes: 25` on the test/build job (and `45` on the desktop matrix) so a wedged step fails fast instead of burning a runner; `bun test --timeout 60000` caps any single test; bun pinned `1.3.10 → 1.3.11` to match local dev.

## [3.3.4] - 2026-05-11

### Fixed — ClipCraft Setup tab dialog a11y + markdown rendering

Follow-ups to the post-merge code review on ClipCraft 0.9.0 setup tab:

- **Focus-trap + focus-restore on both lightboxes.** `AssetLightbox` and the new `CardLightbox` opened modal dialogs but never trapped Tab focus inside them, so keyboard users could Tab into the underlying chat / timeline behind the backdrop. Extracted a shared `useFocusTrap` hook (`modes/clipcraft/viewer/hooks/useFocusTrap.ts`) that (a) moves focus to the first focusable inside the dialog on open, (b) cycles Tab / Shift+Tab between the first and last focusable so focus stays inside, and (c) restores focus to the previously-active element on close. Wired into both lightboxes so they stay in parity. Inner modal container also gains `role="dialog"` + `aria-modal` + `aria-label` so assistive tech announces the dialog correctly.
- **Dropped `rehypeRaw` from the setup-tab markdown renderers.** `BibleSection` and `CardLightbox` rendered agent-authored markdown via `react-markdown` + `rehype-raw`, which (1) opens an XSS sink the moment any external template or snapshot is ever imported into a project, and (2) actively breaks the angle-bracket placeholder syntax the bible / character-card templates use (`TITLE: <project name>`, `FLOW INTENTION: <one-sentence emotional metaphor>`, etc.) by trying to parse those as HTML tags. With `rehype-raw` removed, react-markdown's default escapes those placeholders to literal text so the template reads correctly, and there's no surface for raw HTML to land. `doc` and `mode-maker` modes keep `rehype-raw` — different threat model (the user authors that content directly).

## [3.3.3] - 2026-05-10

### Fixed — review-driven hardening across the chat bridge, ClipCraft preview track, and storyboard tooling

Follow-ups to the recent ClipCraft 0.8.0 / 0.9.0 + AskUserQuestion bridge work, addressing the high-confidence findings from the post-merge code review:

- **`<pneuma:*>` marker dedup regex was too greedy.** The pattern `/^<pneuma:[a-z-]+\b[^>]*>[\s\S]*<\/pneuma:[a-z-]+>$/i` had no backreference between open and close tag names and used a greedy body, so a user message of the shape `<pneuma:env … />\nplease continue\n<pneuma:askq-answer>…</pneuma:askq-answer>` was mis-classified as a single non-meaningful marker — letting the resume-dedup walk-back overwrite legitimate distinct assistant turns. Fix: extracted a single `isPneumaMarkerOnly` helper to `core/utils/pneuma-markers.ts` (with bun:test coverage) backreferencing the tag name and forbidding any nested `</pneuma:` in the body, so two adjacent markers never collapse into one. Wired into all three dedup sites: `server/ws-bridge.ts` (messageHistory), `src/store/chat-slice.ts` (appendMessage), and `src/ws.ts` (history-replay loader). Single source of truth — no more drift across the server / browser bundles.
- **`isInternalDiagnosticError` swallowed user-stop signals.** `"Request was aborted"` is the legitimate signal Claude Code emits when the user hits Stop or a network blip ends a turn early; users need to see it. Removed from the filter; the `[ede_diagnostic]` and `ensureToolResultPairing` self-repair messages remain filtered.
- **`AskUserQuestion` follow-up `tool_use_id` now escaped.** `buildAskUserQuestionFollowupMessage` interpolated the upstream-supplied `tool_use_id` into a `<pneuma:askq-answer tool_use_id="…">` attribute without escaping. Cheap insurance: now escapes `&`, `<`, and `"` before string-interpolation so an unusual id from a future CLI can't corrupt the wrapper.
- **`computePreviewSegments` defensive sort.** The helper assumed ascending-time order — true for upstream-sorted programmatic writes, but a hand-crafted `project.json` could feed unsorted previews and silently drop segments via `naturalEnd <= naturalStart`. Sorts internally now (O(N log N) for tiny N) and caps the trailing segment at composition `duration` so a preview past the end doesn't blow past the timeline. Two new test cases lock the contract — unsorted input round-trips, and trailing duration cap.
- **`Export draft` now disabled when there's nothing to draft.** Already disabled `Export video` when no clips existed (avoiding a 4-second black mp4); same trap exists for `Export draft` if neither clips nor preview frames are present. Disabled with an explanatory tooltip.
- **`storyboard.mjs` ffmpeg argv hardening.** `spawnSync` is argv-based (no shell injection), but a `--name "-foo"` would produce an output filename starting with `-` that ffmpeg would parse as a flag. Now passes the output path after `--` so it's always treated as a positional.
- **Setup-listing route safety polish.** `stdout.json` reads now cap at 1 MB (previously unbounded — a pathologically large file would block the event loop on a sync read). `findCardImage` now matches extensions case-insensitively, consistent with the inner-directory scan in `detectCardsIn`, so `KIRA.PNG` resolves on case-sensitive filesystems.

## [3.3.2] - 2026-05-10

### Fixed — chat polish around the AskUserQuestion shim

Three follow-up fixes layered on the 3.3.1 AskUserQuestion bridge:

- **Suppress CLI internal diagnostic noise.** Claude Code 2.x raises `[ede_diagnostic] result_type=user … stop_reason=tool_use` and `ensureToolResultPairing: repaired …` warnings on turns where it self-repaired tool_result pairing — typical when the AskUserQuestion follow-up arrives after the auto-deny. The repair already happened, so the diagnostic only confused users. Filtered out at `src/ws.ts` via a new `isInternalDiagnosticError` helper applied to both live `result.errors` and the history-replay path.
- **Dedup resume-induced assistant duplicates.** Claude Code 2.x re-emits the last assistant message with a fresh `message.id` on every `--resume`, and Pneuma also redispatches an `<pneuma:env reason="opened">` envelope every reopen, so the chat used to render the same greeting twice (once from history, once from the live re-emit). Now deduped at three layers — server-side `messageHistory` (`server/ws-bridge.ts`), browser `appendMessage` (`src/store/chat-slice.ts`), and the history-replay loader (`src/ws.ts`). Each walks back over `<pneuma:*>` markers and system events; if the previous *real* assistant turn has the same trimmed text content, the new message overwrites it instead of appending.

## [3.3.1] - 2026-05-10

### Fixed — AskUserQuestion picker round-trip on Claude Code 2.x

Restores the in-chat picker for Claude Code 2.1.x, which stopped sending a `can_use_tool` permission gate for `AskUserQuestion` and instead auto-denies the tool with an `is_error: true` tool_result whose content is the tool's `checkPermissions().message` ("Answer questions?"). Symptom: the picker either showed `Waiting for question...` forever, or — once the synthetic-perm shim landed — the agent saw the auto-deny first and reported "tool errored, please retry by text".

The bridge now (a) fabricates a synthetic `PermissionRequest` when an `AskUserQuestion` `tool_use` arrives so the existing browser picker still renders, and (b) on user submit, sends the answer back as a plain `<pneuma:askq-answer>` user message rather than a `tool_result` (the auto-deny already won the `tool_use_id` race). The agent reads the natural-language follow-up after seeing the auto-deny and continues with the user's selection. UX residual: the auto-deny tool_result is briefly visible in chat — cosmetic, not functional.

- `server/ws-bridge.ts` — synthetic-perm fabrication in `handleAssistantMessage` for `tool_name === "AskUserQuestion"`.
- `server/ws-bridge-browser.ts` — `handlePermissionResponse` detects `synthetic:` request_ids and dispatches `buildAskUserQuestionFollowupMessage`, which writes a `user` message wrapped in `<pneuma:askq-answer tool_use_id="...">…</pneuma:askq-answer>` to the CLI's stdin. The auto-deny is acknowledged inline so the agent ignores it.
- No browser changes — picker UI and `recordAnsweredQuestion` Q&A summary continue to work as in 0.9.0.

## [3.3.0] - 2026-05-09

### ClipCraft 0.8.0 — Storyboard preview track

Progressive-fidelity planning on the timeline before any expensive seedance generation. Backed by the upstream `PreviewFrame` capability in `@pneuma-craft/timeline ≥ 0.4.0` and `@pneuma-craft/video ≥ 0.5.0` (currently consumed via local `bun link`; production-version cutover is a follow-up commit once upstream publishes).

- **Three planning layers on the same track** — sketches (cheap line-art `gpt-image-2` overlay across the whole timeline), then anchors (photoreal first/last frames at gen boundaries), then real video clips. Auto-fallback per upstream's half-open interval rule: clip wins where covered, else the most recent preview frame, else nothing. Preview-frame data stays in `track.previewFrames` even after a clip lands — useful for audit / undo / revisit.
- **Persistence migration** — `project.json` carries a new optional `track.previewFrames: { id, trackId, time, assetId }[]`. Legacy files without the field parse unchanged. Round-trip preserved byte-identically.
- **Timeline preview strip** — new `PreviewFrameStrip` component renders thumbnails in regions not covered by clips. Sketch fidelity (`asset.metadata.fidelity === "sketch"`) gets a dashed border + 70% opacity; anchor / absent gets solid + full opacity. Pending / failed / missing assets render explicit SVG placeholders.
- **`previewFrameId` locator card** — agents can emit `<viewer-locator data='{"previewFrameId":"pf-04"}'>panel 4 — opening sketch</viewer-locator>` to land users on a specific anchor / sketch on the timeline. Click selects the referenced asset, seeks the playhead, and flashes the strip thumbnail. The id is stable across move / rebind so the locator survives re-pacing.
- **`<preview-frames>` viewer-context** — `extractContext` parses `project.json` and emits a `<preview-frames total="N">` summary with per-track counts inside the existing `<viewer-context>`. Agents see the planning layer's scale every turn.
- **Export draft** toolbar button — produces an MP4 with sketches + anchors baked in for review before committing to expensive seedance generation. Uses `useExportVideo({ includePreviewFrames: true })` against the upstream `createExportEngine` flag. Manifest exposes `export-draft` viewerApi command id alongside the existing `export-video`.
- **`generate_image.mjs --style sketch | photo`** — sketch mode appends a fixed line-art prompt suffix and drops `--quality` to `low` (unless explicitly set) for cheap stage-1 storyboard generation. Photo mode (default) preserves the existing behaviour.
- **`references/storyboard-workflow.md`** — agent-facing playbook covering the three-stage progressive-fidelity flow, density / pacing recipes, the Path B single-clip multi-beat long-form gen, move semantics, locator card usage, and known pitfalls. SKILL.md and `mdScene` cite it.

#### Known limitations / deferred follow-ups

- **`@pneuma-craft/react` doesn't expose `playbackEngineOptions`** on `PneumaCraftProvider` / `PneumaCraftStoreOptions` yet, so we can't explicitly set `includePreviewFrames` through the React provider. Functionally fine — upstream `PlaybackEngineOptions.includePreviewFrames` defaults to `true`, and ClipCraft documents the gap at the provider mount site. Push upstream when convenient.
- **Lightweight dive integration deferred.** The dive canvas selects its root asset from the active clip at the playhead, not the global craft selection. Clicking a preview frame strip thumbnail correctly selects the referenced image asset, but dive doesn't see it because there's no clip at that time. Deeper integration (preview-frame fallback or selection-priority root) is a separate design pass.
- **Selection-aware `<preview-frame />` element in `<viewer-context>` deferred** — would require bridging the craft `Selection` enum (`asset / clip / track / time-range / none`) with the protocol-level `ViewerSelectionContext`. Out of scope for this release; the `<preview-frames>` summary still gives the agent useful planning-layer awareness.
- **Production cutover** for `@pneuma-craft/{timeline,video,core,react}` — currently consumed via `bun link` from `~/Codes/pneuma-craft`. Final commit (`bun unlink` + bump `package.json` constraints) lands once upstream publishes `0.4.0` / `0.5.0`.

## [3.1.0] - 2026-05-08

### Added — kimi-cli as a third agent backend

- **Kimi CLI backend** (`--backend kimi-cli`) — Pneuma now drives [Moonshot AI's Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) alongside Claude Code and Codex. Same launcher backend picker, same project / session lifecycle, same skill installation surface. Spawn shape: `kimi --print --input-format stream-json --output-format stream-json -y --work-dir <cwd> -r <agent-session-id>` over `node:child_process` stdio, with the Pneuma-side session UUID pre-allocated as kimi's own session id (kimi's `kimi -r <id>` resume token) so reconnect / resume round-trips through the existing session.json `agentSessionId` plumbing. Capabilities matrix declares `streaming: true, resume: true, permissions: false, toolProgress: false, modelSwitch: true`.
- **Backend-aware skill installer** — kimi-cli writes its skills under `.kimi/skills/` and its project-level instructions into `AGENTS.md` (kimi explicitly reads `AGENTS.md` per `kimi_cli/soul/agent.py:88-132`; it does NOT read `CLAUDE.md`). Refactored the installer's per-backend file-layout decision into a `BackendInstallHandler` registry (`server/skill-installer-backend.ts`) — adding a new backend means adding a registry entry, not threading new `if (backendType === "...")` branches through `skill-installer.ts`. Codex still installs to `.agents/skills/` + `AGENTS.md`; Claude Code stays at `.claude/skills/` + `CLAUDE.md`.
- **kimi protocol synthesis layer** — kimi's stream-json doesn't emit `system.init` (no model field), `result` (no turn-end signal), or `stream_event:message_start` (no thinking indicator) the way Claude's CLI does, so the chat panel sat silent during multi-second reasoning turns and the input stayed locked behind a "Running" pill that never cleared. The new `KimiBridge` (`server/ws-bridge-kimi.ts`) synthesises all three at the right lifecycle points; the existing chat-panel state machine then renders kimi sessions identically to Claude/Codex sessions (header model badge populated, "thinking" activity lights up at turn start, input unlocks on result envelope).
- **Tool-result metadata extraction** — kimi prepends agent-facing `<system>...</system>` markers to every tool result (per `kimi_cli/agents/default/system.md` — they're meant to be LLM-readable status hints, not human-visible text). The kimi protocol module now lifts those markers out of the body into a new optional `tool_result.metadata` field on `ContentBlock`; the chat panel renders metadata as a small status header above the result body. Claude / Codex don't set the field and their UI is unchanged.
- **`stream_event:message_start` thinking indicator** — every kimi-bound user message (browser, server-injected greeting, queued flush) now fires a synthetic `message_start` so the frontend's existing `activity={phase:"thinking"}` indicator activates immediately. Claude emits this natively; kimi doesn't. Stays on until the synthesised `result` envelope at turn yield.

### Added — `BridgeBackend` lifecycle architecture

- **Per-backend bridge handler interface** (`server/ws-bridge-backend.ts`) — `WsBridge` no longer carries parallel `Map<sessionId, XAdapter>` fields and inline `if (backendType === "...")` branches at every routing site. A single `streamingBackends: Map<sessionId, BridgeBackend>` plus `attach()` / `injectUserMessage()` / `routeBrowserMessage()` / `disconnect()` lifecycle methods replaces them. `KimiBridge` and `CodexBridge` each own their backend's quirks (envelope synthesis, unsupported-message drops, interrupt handling) inside their own files; the bridge's main routing code stays backend-agnostic. Adding a fourth backend is now a new `BridgeBackend` class plus a registry entry — not a sweep through `ws-bridge.ts`.

### Improved — chat block visual consistency

- **Tamed chat block chrome.** `ToolBlock`, `ThinkingBlock`, and `BashResultBlock` had drifted into a maximalist orange-tinted aesthetic — orange borders + orange shadow glows + scanline overlays + `backdrop-blur` on tool calls; orange border + orange glow + orange-gradient hover on reasoning blocks. Per `.impeccable.md`'s "purposeful orange — never decorative" principle, all three drop the orange chrome for a neutral `border-cc-border/60 rounded-lg bg-cc-card/50` style. Tool-result rendering unified into a single `ToolResultBlock` component (Bash → tail-N preview, anything else → head-N preview; same chrome, same toggle position). The `CronTriggerBubble` drops its unsanctioned amber tint for the same neutral surface.
- **Tool-result preview defaults shrunk to 6 lines** across the board (was 20-line tail for Bash, 6-line head for everything else). Multi-shell-call codex turns no longer stretch the chat panel; "Show full (+N lines)" is one click away when the remaining lines actually matter.
- **`tool_result` blocks now ride the `assistant` envelope** (matches Codex's pattern) so the chat panel pairs them with their `tool_use` ancestor by `tool_use_id` and renders the result as a compact `BashResultBlock` / scrollable card — instead of the previous wall-of-text user bubble where a 100-line file read or kimi's `<system>...</system>` status would dominate the chat.

### Fixed

- **Kimi sessions with managed `kimi-code` subscription provider** — when thinking is enabled, kimi emits assistant `content` as a JSON array `[{type:"think",...}, {type:"text",...}]` instead of a plain string. The translator now handles both shapes; `think` parts get translated into Pneuma's canonical `thinking` content block, so kimi reasoning is actually visible in the chat (the OpenRouter provider keeps it hidden, but the managed provider's stream surfaces it). Without the fix, `kimiToPneumaMessages` crashed on `(msg.content ?? "").trim()` and every assistant message silently dropped — the symptom was "kimi session won't connect", chat sat empty.
- **Kimi adapter / launcher polish** — pre-allocated session UUID at launch (kimi only prints its `kimi -r <uuid>` resume hint on process exit, so the previous regex-on-stderr scheme never fired during multi-turn sessions), late-subscriber replay for `onSessionId` so the bridge gets the resume token even if it attaches after the launcher has already seeded it, idempotent adapter cleanup in `launcher.kill()`, and explicit drop (with debug log) for browser-outgoing message types kimi-cli doesn't support — `permission_response`, `set_model`, `end_session`, `update_environment_variables`, `stop_task` — so they don't queue indefinitely in `pendingMessages`.
- **Kimi Stop button** — `interrupt` now sends `SIGINT` to the kimi process (kimi's print-mode signal handler aborts the in-flight step but keeps the process alive for the next user message), and the bridge pushes a `cli_busy: false` snapshot so the input unlocks immediately rather than waiting for whatever wrap-up assistant turn kimi might emit on its way out.

## [3.0.3] - 2026-05-07

### Fixed — TopBar buttons clickable in launcher-reused windows

- **TopBar pill buttons (chip selectors, Chat/Editor/Diffs/Terminal/Processes tabs, share/edit) had their upper edge silently swallowed by macOS's title-bar drag region.** Repro: open a project / recent session from the launcher (which navigates the launcher window via `window.location.href` instead of spawning a new mode window). The launcher window keeps its `titleBarStyle: "hiddenInset"` + `trafficLightPosition: { y: 18 }`; macOS Sequoia extends the OS-managed drag inset down to roughly y≈56 to fit the lowered traffic lights, which sits a few pixels into the TopBar pills (`pt-4` only buys 16px of safe zone, not the ~20px the lowered traffic lights need). Confirmed via `elementFromPoint` — React DOM said the button was on top, but the click event never reached the renderer; the docked DevTools panel showed the same blocked band, ruling out any React/CSS occluder. Fix mirrors the Launcher header's existing pattern: TopBar root is `WebkitAppRegion: "drag"` so the bar still moves the window, and the three pill sub-containers (left chip strip, center tabs, right share/edit + replay-badge variant) are `WebkitAppRegion: "no-drag"` so every button is reachable. No-op in non-hiddenInset windows.

## [3.0.2] - 2026-05-06

### Improved — Kami mode synced to upstream V1.4.1

- **Kami mode synced to tw93/kami V1.4.1 ("Steadier Hand")**, last tracked at V1.2.0. All 14 SVG diagrams re-normalized per upstream's tightened invariants (`font-weight 500`, no italic, every `rgba(...)` fill replaced with solid hex pre-blended onto parchment so colors render identically across viewers). Reference docs (`design.md`, `diagrams.md`, `writing.md`) refreshed to V1.4.1 with our 6-line attribution header preserved. A side benefit of catching up: upstream V1.4.1 absorbed our former Pneuma-only sections verbatim ("Icon style" in diagrams, "Diagrams and infographics" in writing, the "Third-party figures" bullet) — we no longer carry divergent reference content. Kami mode manifest version bumped to `1.1.0`. WeasyPrint runtime, `build.py` / `ensure-fonts.sh` build pipeline, Claude Code plugin marketplace, `llms.txt` / sitemap / JSON-LD assets, and the `~/.config/kami/brand.md` brand profile are intentionally not synced — they don't apply to Pneuma's iframe paper-canvas / browser-print model. NOTICE.md now pins the tracked upstream version and lists what we deliberately skip.

## [3.0.1] - 2026-05-01

### Fixed — three post-3.0 dogfood findings

- **Auto-spawn / handoff-target / mid-turn refresh UI showed "Idle" while the agent was streaming.** A browser joining a session that was already mid-turn hard-coded `sessionStatus="idle"` on `session_init`, and `turnInProgress` only flipped on via the user-send path or the synthetic-user-message broadcast — neither fires for a joining browser. The chat input stayed enabled (race-prone) and the top-right read "Idle" while the agent produced text behind the scenes. `SessionState` (the wire shape) now carries an optional `cli_busy` field, computed at every `session_init` / `session_update` broadcast as `!session.cliIdle`. The browser hydrates `sessionStatus` + `turnInProgress` from it. Live transitions (assistant → running, result → idle) keep working as before; the new code only matters at the moment a browser connects to a session that's already running.
- **Webcraft scaffold timed out on the first turn of a freshly-spawned session.** `VIEWER_ACTION_TIMEOUT_MS` was 15s, which broke a real scenario: a Smart Handoff spawned a fresh webcraft session and the agent's first turn included `scaffold` while the browser was still navigating to the new per-session URL + loading the mode bundle + reconnecting WS. The 15s window often closed before the viewer could even register the action handler, even though the actual work was milliseconds. Bumped to 60s — most viewer actions are sub-second; the timeout is a safety net for hung browsers, not a real upper bound on legitimate work.
- **OnboardPreview's "Discovering your project…" status pill** now uses a sonar-style ping (steady center + two staggered concentric rings) instead of a single orange pulse-dot. Reads as active scanning, matching the verb in the copy. 1.6s cycle paced calmly so it doesn't compete with the carousel's wipe.

## [3.0.0] - 2026-05-01

### 3.0 — Projects Are First-Class

The Project layer that landed in 2.41.0 has its loop closed. Pneuma now greets you on the way into a fresh project, walks you through what it is on the way to the first session, and hands you two concrete next moves on the way out. Bumping to 3.0 marks the moment "open a directory and start co-creating in five minutes" stops being aspirational.

### Added — fresh-project onboarding

- **Hidden `project-onboard` mode** that auto-runs the first time you enter a project that has no sessions and no `onboardedAt` stamp. The agent reads README, package manifest, and visual assets, then writes a Discovery Report — anchors with citations, two open questions, and two concrete first-task recommendations tuned to whatever API keys you actually have configured.
- **One-click Apply + Handoff** — clicking a task card lands the writes (`project.json` with `onboardedAt`, `project-atlas.md`, optional cover) and spawns the target session with the task's brief pre-staged in its CLAUDE.md, all in one round-trip. No HandoffCard interrupt because the user already confirmed by clicking the card.
- **10-frame intro carousel** that fills the discovery wait time (~30–60s) instead of a generic spinner. Soft diagonal mask wipe + warm orange glow band. Each frame is a 16:9 marketing-grade illustration in the existing Ethereal Tech aesthetic — files-as-canvas, twelve-modes-one-shell, project layer, click-to-locate, evolution, replay, etc.
- **Welcome egg** for sparse projects (a stub `test.txt`, an empty README) — the agent draws a small atmospheric image (paper lantern in the dusk, notebook with constellations being sketched, etc.) plus a short tone-matched greeting. Not persisted; lives in the session as a one-time meet-cute moment.
- **Auto-cover** for content-rich-but-logo-less projects — minimal monogram + single orange accent line, matching Pneuma's launcher placeholder aesthetic. Wired through the existing `coverSource` field; apply route persists it like any found cover.
- **Split-button "Create & discover"** on the Create Project dialog. Primary action navigates straight into the new project so the auto-trigger fires; chevron menu offers "Create without discovery" (server stamps `onboardedAt: now` to suppress the auto-trigger).
- **Re-discover affordance** on `ProjectPanel` for already-onboarded projects that want a fresh take.
- **`hidden: true`** field on `ModeManifest`. Internal modes (`evolve`, `project-evolve`, `project-onboard`) are filtered from launcher grids + ProjectPanel mode picker via `/api/registry`. Source of truth is the manifest field; the omission-from-a-curated-list pattern is fragile by comparison.
- **`onboardedAt?: number`** field on `ProjectManifest`. Auto-trigger gate is one boolean: `!project.onboardedAt && sessions.length === 0`.
- **`POST /api/projects/onboard/apply`** route that lands the proposal's writes and (when `chosenTask` is set) mints a target session, stages `inbound-handoff.json`, and spawns the target mode in one round-trip.
- **`/api/projects/:id/file?path=<rel>`** route — generic project-rooted file fetch (manifest gate + path containment) for the cover preview, since per-session `/content/*` resolves to the session dir, not the project root.
- **Cover route accepts `.png/.jpg/.jpeg/.webp/.svg`** — SVG logos stay vector with the right content-type instead of being force-renamed to `.png`.

### Added — internationalization

- **`README.zh.md`** — Chinese mirror of the English README. Both READMEs cross-link from a header language toggle. Voice tuned for casual Chinese tech reading rather than a literal translation.

### Changed — documentation alignment

- **`AGENTS.md`** is now a synced mirror of `CLAUDE.md` (Codex's convention; same project guidance for the same agent role, just read by a different runtime). The abandoned `AGENT.md` stub is deleted.
- **README**: new "First Run — Pneuma Walks You Through It" section between modes table and Getting Started; Projects (3.0) section expanded with Smart Handoff narrative + project-scoped preferences + first-run cross-link; Built-in Modes table gains `remotion` + `gridboard`; CLI Usage block adds the 3.0 flags (`--project / --session-id / --session-name / --viewing`) and the subcommands shipped over recent minor versions (`plugin`, `history`, `sessions rebuild`).
- Six 3.0-era design docs moved from `docs/design/` to `docs/archive/proposals/` now that they're shipped: shadow-git checkpoints, user-preference analysis, project layer, project UX pivot, handoff tool-call protocol, and fresh-project onboarding.

### Compatibility

- 2.x quick sessions (workspace without `project.json`) keep all prior behavior.
- Projects without `onboardedAt` are treated as "fresh" — opening one for the first time after upgrading auto-launches the welcome flow. Use `project-onboard`'s "Apply only" if you want to mark a project as onboarded without picking a task.
- `~/.pneuma/sessions.json` schema stays at the 3.0 shape (auto-upgraded from 2.x array on read).

## [2.41.0] - 2026-04-28

### Added — 3.0 Project Layer + UX pivot

**Project layer** (organizational tier above sessions, opt-in):
- A project is any user directory marked by `<root>/.pneuma/project.json`. Multiple sessions across modes share preferences and coordinate via handoff files. Quick (project-less) sessions remain fully supported.
- Cross-mode handoff protocol: source agent writes `<projectRoot>/.pneuma/handoffs/<id>.md`; Pneuma surfaces a Handoff Card; user confirms; target session launches and consumes (deletes) the file.
- Project-scoped preferences at `<projectRoot>/.pneuma/preferences/` — orthogonal to `~/.pneuma/preferences/`. Both inject into CLAUDE.md (`pneuma:project` and `pneuma:preferences` blocks).
- Shared skill `pneuma-project` auto-installed in project sessions; teaches handoff write/consume protocol.
- New CLI flags `--project <path>`, `--session-id <id>`.
- New env vars `PNEUMA_SESSION_DIR`, `PNEUMA_HOME_ROOT`, `PNEUMA_PROJECT_ROOT`, `PNEUMA_SESSION_ID`.
- Project-scope evolve: scans all session histories under the project, writes to `<projectRoot>/.pneuma/preferences/`.

**UX pivot** (Project as in-shell component, not a separate route):
- `EmptyShell` render path for `?project=<root>` URLs — TopBar without tabs/share/edit, panel auto-opens.
- `ProjectChip` + `ProjectPanel` mounted in TopBar; replaces the prior `ProjectPage` detour.
- Three-chip identity strip `[Pneuma] | [Project ▾] | [Mode ▾] | [Session ▾]` with thin vertical dividers.
- Soft archive: registry field + `/archive` and `/restore` endpoints; panel inline confirm; launcher Archived bucket; Restore action on archived `ProjectCard`.
- Quick-resume hot zone on launcher cards — clicking the SessionMeta line skips empty-shell and lands directly in the latest session.
- Mode switcher dropdown in project session header emits `<pneuma:request-handoff>` chat tag.

### Changed
- `~/.pneuma/sessions.json` schema upgraded to `{ projects: [...], sessions: [...] }`. Legacy array format auto-upgraded on read.
- `installSkill` accepts an `InstallSkillOptions` object (was 7 positional params); 43 caller sites migrated.
- All state file paths (session.json, history.json, shadow.git, checkpoints.jsonl, evolution/, deploy.json, etc.) parameterized by `stateDir`. For project sessions: `<project>/.pneuma/sessions/{id}/`. Quick sessions unchanged.
- `scanProjectSessions` surfaces `backendType`, `displayName`, `lastAccessed` so the panel renders real session names + relative time, and non-default-backend project sessions resume correctly.
- Plugin skill installer threads `sessionDir` so project sessions get plugin skills under `<sessionDir>/.claude/skills/` (was wrongly landing in `<workspace>/.claude/`).
- Project session identity: `<projectRoot>/.pneuma/sessions/<id>/session.json` stores `startup.sessionId` as the canonical id; backend's protocol id stored separately in `agentSessionId`. Reopening / handoff routing both use the project session id.
- Quick session resume preserves the registry's existing `sessionName` when launched without `--session-name` (no-arg resume no longer drops user renames).
- Internal: extracted `parseHandoffMarkdown` helper in `server/handoff-parser.ts`, replacing three near-identical YAML readers; extracted `ProjectCover.tsx` (cover image + session meta) for reuse between launcher card and panel.

### Compatibility
- Quick sessions (workspace without `project.json`) keep all 2.x behavior.
- Old `sessions.json` arrays read transparently; first write upgrades the shape.
- Old workspaces are not auto-migrated. Users opt in via launcher's "Create Project" with optional "Initialize from existing session" copy.

### Known limitations
- Handoff confirm cannot kill its own session (source survives until tab closes).
- Session display names fall back to truncated 8-char hex when `session.json` doesn't carry a `displayName` field; the panel and route are wired, write path is incremental work.

## [2.40.0] - 2026-04-28

### Changed
- **Claude Code backend re-architected onto stdio stream-json** — replaces the `--sdk-url ws://localhost` WebSocket bridge that Anthropic locked behind a host whitelist in CC 2.1.118. The launcher now spawns `claude --print --output-format stream-json --input-format stream-json --include-partial-messages --include-hook-events --verbose --permission-mode bypassPermissions [--resume <id>]` and pipes stdin/stdout directly into the bridge. The user's `~/.claude/.credentials.json` flows through unchanged, so Pro/Max subscription auth keeps working — the headless CLI is Anthropic's officially-supported entry point for scripted automation, unaffected by the OpenClaw third-party-OAuth ban. Same shape Crystal, Conductor, and opcode all converged on.
- **`Session.cliSocket` retyped to a duck-typed `CLITransport`** with just `send(line)` and `close()`. The legacy WebSocket path wraps a real `ServerWebSocket` in this interface; the new stdio path wraps the launcher's stdin pipe. The bridge gained `attachCLITransport`, `detachCLITransport`, and `feedCLIMessage` so both transports share the existing `routeCLIMessage` pipeline unchanged.
- **Default backend reverts to `claude-code`** — the v2.39.0 codex-default flip was the right move while we thought `--sdk-url` was permanently broken; the stdio transport works on every public CC version, so the original happy path is restored.

### Removed
- **Claude Code version-compatibility gate** — `backends/claude-code/version.ts` and its test are deleted. The probe was correct for `--sdk-url`'s host whitelist but is moot under the stdio transport, which works on every public CC version. Backend availability is now back to a plain "binary on PATH" check.

### Fixed
- **Pneuma's claude-code backend works again on Claude Code 2.1.118 and later** — the CC versions where `--sdk-url ws://localhost` is rejected with `"host \"localhost\" is not an approved Anthropic endpoint"`. Verified end-to-end on 2.1.121 with a Pro/Max account: `apiKeySource: "none"` in the system/init confirms subscription billing flows through, streaming text deltas / tool_use / hook events / cumulative usage / `--resume` all work.

## [2.39.0] - 2026-04-28

### Added
- **Claude Code backend now version-checks before reporting available** — Anthropic removed the hidden `--sdk-url` transport in CC 2.1.118 (PR #28334), which is the WebSocket bridge the `claude-code` backend relies on. `detectBackendAvailability()` probes `claude --version`, compares against the break point, and disables the option in the launcher with a "Claude Code vX.Y.Z removed --sdk-url" explanation when the installed CLI is too new. Probe failure (no version line, exotic install) defaults to allow rather than block.

### Changed
- **Default backend switched from `claude-code` to `codex`** — keeps the happy path working for users on current Claude Code without forcing them through the picker. New CLI launches and the launcher landing both honor the new default. Sessions persisted before the `backendType` field existed still backfill to `claude-code` via a separate constant, so legacy resumes keep targeting the agent they were originally launched with.

## [2.38.0] - 2026-04-27

### Added
- **`clipcraft` rebuilt as a builtin mode on the `@pneuma-craft` engine** — AIGC video production with a domain-modelled `project.json` (Assets, Composition with Tracks/Clips, Provenance DAG, Scenes) projecting an event-sourced craft store; file edits auto-rehydrate the viewer with no reload. Canvas preview + canvas-rendered subtitles (pixel-identical between preview and export). Asset Panel + Asset Manager modal showing the union of `assets/` filesystem and `project.json.assets[]` with transfer-list import / unregister, delete-to-OS-trash, per-type filters with media previews. Timeline collapses to a flat track view and expands to a 3D layered carousel with camera presets (front / side / exploded) and per-clip dive panels. Generation scripts for images (fal.ai nano-banana-2 / shared GPT-Image-2), video (seedance-2.0 with t2v / from-image / reference subcommands; veo3.1 fallback), TTS (gemini-3.1-flash-tts), and BGM (lyria-3-pro), plus a character-sheet recovery tool that defeats seedance's image-side filter. Replaces the prior `clipcraft-legacy` prototype, which is removed along with its server-side ffmpeg export route — export now runs in-browser against the live composition.
- **Pneuma self-intro seed for ClipCraft** — first-launch workspace ships a project that introduces Pneuma itself, so new users have a working timeline to inspect instead of an empty canvas.
- **`/api/assets/fs-listing` and `/api/assets/trash` server routes** — symlink-safe walk of `workspace/assets/**` with media-extension filter, plus OS-trash deletion via the `trash` package.
- **`server/ffmpeg.ts` audio probe utilities** — local waveform peaks and duration extraction for the Asset Panel's audio previews.

### Removed
- **`clipcraft-legacy` prototype mode and its server surface** — 74-file mode plus `server/domain-api.ts`, the legacy `/api/export*` ffmpeg routes, and the corresponding `core/mode-loader.ts` registration. The new mode replaces it end-to-end.

### Changed
- **CLAUDE.md, README, and the launcher mode list now reflect `clipcraft` as a builtin** — the mode table gains a clipcraft row; the CLI `Modes:` section gains a clipcraft line.

## [2.37.1] - 2026-04-27

### Fixed
- **Codex bash output rendered as a bare tile instead of a collapsible "Output" card** — `MessageBubble`'s tool-name lookup was per-message, but the Codex backend emits `tool_use` and `tool_result` in two separate assistant messages (`msg-{id}` and `result-{id}`), so the result fell through to the generic plain-text fallback and lost the BashResultBlock styling (header + Show full / Show tail toggle). `ChatPanel` now builds a single `globalToolUseById` map across the whole conversation and passes it down, so cross-message linkage works for any backend that splits the two events.

## [2.37.0] - 2026-04-27

### Added
- **WebCraft synced to Impeccable.style v3.0.1** — brand vs product register split, color-strategy ladder (restrained → committed → full palette → drenched), absolute-bans list (no side-stripe borders, gradient text, glassmorphism, em dashes), category-reflex check. Two new commands — `Document` (generate `DESIGN.md` in Stitch format) and `Onboard` (first-run flows + empty states + activation moments) — bring the total to 22.
- **Pneuma Console seed** — product-register companion to the existing brand-register pneuma seed. Sessions dashboard + settings form + a shared placeholder page for unfinished sections, all in restrained system-font product UI. Switch content sets in the launcher to compare brand vs product register side by side.
- **Skill update prompts now show changelog highlights** — `ModeManifest.changelog` (semver → bullet list) feeds the launcher prompt, which extracts entries for the version range between installed and current. SessionCard renders them inline; CompactSessionRow exposes a `What's new ▼` toggle. Both link out to the project CHANGELOG on GitHub.
- **Content set resolver gained a `priority` option** — explicit ordering wins over alphabetical for the default-selection candidate, so webcraft keeps pneuma as the default seed even with the new console companion installed.

### Fixed
- **Internal page links inside webcraft seeds no longer 404 in the iframe preview** — the link interceptor now `preventDefault()`s on `href="#"` before bailing (previously the browser navigated to `<base>#` and 404'd against the dev server) and accepts navigation to any `.html` file in the active content set, not just manifest-declared pages. The PageNavigator tab strip stays clean — internal targets like the new shared placeholder reach via sidebar links without showing up as a top-level page.
- **Pneuma seed dropped gradient text + glassmorphism nav** — aligns with v3.0.1's "absolute bans" guidance; the brand register now demonstrates restraint instead of every effect at once.

### Changed
- **WebCraft skill bumped 1.2.0 → 1.3.0** with corresponding `changelog` entries so existing workspaces see what's new in their resume prompt before applying the update.

## [2.36.2] - 2026-04-27

### Fixed
- **Desktop app still hit "Failed to load PPTX library" after 2.36.1** — fixing the `package.json` `files` array only patched the npm-published package; the Electron build has its own allowlist in `desktop/electron-builder.yml` `extraResources` that explicitly enumerates which directories get copied into the app bundle. `vendor/` was never on that list, so the desktop app at `/Applications/Pneuma Skills.app/Contents/Resources/pneuma/` shipped without `dom-to-pptx.bundle.js` even on 2.36.1. Added `vendor/` to extraResources.

## [2.36.1] - 2026-04-27

### Fixed
- **Slide PPTX export failed with "Failed to load PPTX library" on every published install** — the `dom-to-pptx.bundle.js` was added under `vendor/` in v2.17.0 but the `package.json` `files` array was never updated to include it. Every npm-published version since then has shipped without the bundle, so the `/vendor/dom-to-pptx.bundle.js` route 404s and the script-tag `onerror` triggers the alert. Verified by inspecting `~/.bun/install/cache/pneuma-skills/2.34.0@@@1/` — no `vendor/` directory. Local dev was unaffected because the file lives in the repo. Fix: add `"vendor/"` to the `files` array.

## [2.36.0] - 2026-04-27

### Added
- **Kami diagram catalog grows from 3 to 14** — synced with upstream tw93/kami v1.2.0. New templates in `seed/_shared/assets/diagrams/`: `bar-chart`, `candlestick`, `donut-chart`, `layer-stack`, `line-chart`, `state-machine`, `swimlane`, `timeline`, `tree`, `venn`, `waterfall`. The agent picks the right diagram from data context (proportion → donut, time series → line, decomposition → waterfall) without waiting for the user to ask.
- **NVDA equity-report seed** — third demo content set in kami showing the new equity-research doc type. Two A4 pages with header + metric strip + thesis + inline candlestick + financial table on page 1, then revenue stacked-bar + comp table + risk grid + analyst summary on page 2. Inline SVG charts demonstrate the diagram-embed pattern.

### Changed
- **Kami typography moves to single-serif-per-page** — matches upstream v1.2.0. `--sans` aliases `--serif`, body uses `var(--serif)`, Chinese body letter-spacing 0.3pt to compensate for TsangerJinKai02's natural density. Charter (system-bundled) joins the EN fallback chain.
- **Kami reference docs collapsed to one English source of truth** — `references/design.md`, `diagrams.md`, `writing.md` now match upstream verbatim; the `.en.md` siblings are deleted. The agent reads one authoritative spec and translates concepts in CN context as needed.
- **Kami color tokens migrated** — `--olive: #504e49` (was `#5e5d59`), `--stone: #6b6a64` (was `#87867f`); `--border` consolidates the previous `--border-cream`/`--border-warm`. Existing 3 diagrams + both old seed templates updated.

### Removed
- **Inter and Newsreader font files dropped from the kami seed** — saves ~170KB per install. Active stack uses TsangerJinKai02 + system serifs (Charter / Songti / Source Han). Existing user workspaces keep their copy; only new workspaces are affected.

## [2.35.6] - 2026-04-25

### Fixed
- **LaunchDialog header could slide under the Electron title-bar buttons** — desktop uses `titleBarStyle: "hiddenInset"`, so the macOS traffic-light buttons draw over the top ~38px of the content area. When LaunchDialog content hit its max-height, the centered card's top (mode icon + title) could fall into that zone and look visually clipped. The overlay now has `py-12` (48px top/bottom safe zone) and the card caps at `max-h-full`, so it can only fill the padded region — the top is guaranteed to be clear of the traffic-light area. Plain-browser users get the extra breathing room harmlessly.

## [2.35.5] - 2026-04-25

### Fixed
- **Published modes had a parallel Zustand store, breaking cross-boundary state** — the mode-maker Play route's `// Bun.build would duplicate src/store.ts` comment warned about this but the publish path never got the same fix. Every published mode that imported `useStore` (all of them, transitively through the viewer's slice subscriptions) had its own parallel store instance; writes from the mode (content set switching, active file, selection) went to that parallel copy and the host never saw them. Fixed by keeping `pneuma-skills/src/store.(ts|js)` external from the publish bundle, adding a `/vendor/pneuma-store.js` shim that re-exports `window.__PNEUMA_STORE__`, and wiring the host to expose its single `useStore` reference on that global. Modes published before 2.35.5 still have the inlined store — they need a republish to pick up the fix. Bundle size drops ~12% as a side effect of the de-duplication.

## [2.35.4] - 2026-04-25

### Fixed
- **Long mode descriptions clipped the LaunchDialog title** — 2.35.3 capped the dialog height and scrolled the form area, but description still lived inside the pinned header. A description of 5+ lines (guizang-ppt) made the header taller than the available viewport; since the header has `shrink-0` and the outer card `overflow-hidden`, the TOP of the header — mode icon + title — got cropped. Description now lives at the top of the scrollable body; pinned header is icon + title only.

## [2.35.3] - 2026-04-25

### Fixed
- **LaunchDialog overflowed the viewport on tall mode init panes** — modes with a long description plus multiple init params (guizang-ppt has 4 params + 2 API-key fields) in the compact dialog layout stretched the whole dialog past the window, putting Cancel / Launch offscreen. The outer card now caps at `calc(100vh - 4rem)` and the compact body became a flex column with a scrollable middle region, matching how the wide (showcase) layout already worked. No change for modes that do have showcase content.

## [2.35.2] - 2026-04-25

### Fixed
- **Pre-2.35.1 published modes still crashed with the `import.meta.env.DEV` error** — 2.35.1's `Bun.build` `define` fix only helps bundles produced going forward; already-published tarballs contain literal `import.meta.env.*` tokens in `.build/*.js` and the host runtime can't polyfill them (import.meta isn't a writable object per-module). `ensureUrlMode` in `core/mode-resolver.ts` now does a one-time regex sweep of the extracted `.build/` tree right after tar extraction, substituting the Vite env tokens with the same static values the new `Bun.build` `define` produces. Pre-existing published modes start working again on next install without the author having to re-bundle.

## [2.35.1] - 2026-04-25

### Fixed
- **Published viewers crashed with `Cannot read properties of undefined (reading 'DEV')`** — many mode viewers branch on `import.meta.env.DEV` to pick between a dev-time API origin and a prod same-origin path. Vite substitutes `import.meta.env.*` in dev, but `Bun.build` at publish time wasn't substituting them, so the bundle shipped with literal `import.meta.env` accesses. At load time `import.meta.env` is `undefined` in the host's runtime and the first `.DEV` access threw before the viewer mounted. `snapshot/mode-build.ts` now passes a `define` map that replaces `import.meta.env.DEV` / `.PROD` / `.MODE` with static values (DEV=false, PROD=true), making the "production" branch (same-origin relative fetches) the one that survives — which is correct for bundles served from the host's `/mode-assets/` route.

## [2.35.0] - 2026-04-24

### Added
- **`forkSource` URL contract for mode-maker** — the launcher's Gallery "Edit" button now carries the source mode identity through `?forkSource=<builtin>` (or `?forkSourcePath=<path>` for local modes) when it navigates to mode-maker. The viewer auto-forks on first mount, so Edit → pick workspace → see the source mode's code now works in one click. Previously Edit on a builtin fell through to an empty seed, and Edit on a local mode pointed mode-maker at the cached install dir (editing it in place).
- **`pneuma-skills/*` bare-specifier contract** — the fork route emits portable `pneuma-skills/core/...` and `pneuma-skills/src/...` imports instead of machine-specific relative paths. The Vite dev resolver and a new Bun.build plugin in `snapshot/mode-build.ts` both understand the form, so forked sources work identically on any disk layout and survive publish with no absolute paths baked in.

### Fixed
- **Published modes couldn't import from react-dom at all** — `/vendor/react-dom.js` shim read `window.__PNEUMA_REACT_DOM__` but nothing was ever setting that global. Every published mode that imported anything from `react-dom` (e.g. any viewer using `@dnd-kit`, which imports `unstable_batchedUpdates`) crashed at module load with a destructure-undefined error surfaced as `SyntaxError: ... does not provide an export named 'unstable_batchedUpdates'`. The shim was broken since it shipped; simple modes that didn't touch react-dom masked it. `src/main.tsx` now exposes the full react-dom namespace + `createRoot`/`hydrateRoot` from `react-dom/client`; the shim re-exports `unstable_batchedUpdates` (with an identity fallback since React 18+ auto-batches) and `version`.
- **Fork → Play rendered empty** — the fork chain had five compounding issues: (1) fork left seed files (`viewer/Preview.tsx`) alongside the new mode's files because `copyDirRecursive` merged instead of replacing; (2) `init.seedFiles` kept pointing at `modes/<sourceMode>/seed/...` paths that only resolved from the source mode's original install location, so Play's tmp workspace stayed empty; (3) the forked workspace had no `package.json`, so `bun install` didn't run and Bun.build at publish time couldn't resolve `@dnd-kit/core`, `@zumer/snapdom`, etc.; (4) the Vite workspace-resolve plugin returned filesystem paths with `.js` extension for `.ts` files, and on the first-time request Vite's URL-to-file fallback didn't remap, serving Vite's SPA HTML instead and crashing the mode loader; (5) published modes' machine-specific `../../Codes/pneuma-skills/...` imports broke as soon as the author moved their workspace. All five fixed together; fork now produces a portable, publish-ready mode package.
- **Fork UX flip-flopped across two confusing clicks** — the old flow required click Import → read amber warning → click the same button again, and most users cancelled after the first click. The warning now renders up front based on the current workspace file count, and a single click with `overwrite: true` finishes the fork.
- **Reasoning block looked broken on Claude Code 2.1.119** — adaptive thinking sends `{type:"thinking", thinking:"", signature:"<encrypted>"}`, but the UI rendered the empty-string fallback ("0 chars / No thinking text captured") as if the reasoning pipeline had failed. The block now shows "Reasoning · hidden by Anthropic (adaptive thinking)" when only the signature is present.
- **Publish returned an opaque "Bundle failed"** — `Bun.build` was throwing on errors instead of setting `success: false`, so the publish route's error-collection branch never ran and the outer catch swallowed every failure into one uninformative message. `throw: false` now lets the actual failing import name propagate to the UI.
- **Play returned a fabricated URL on timeout** — the play route used to resolve with `http://localhost:${PLAY_VITE_PORT}?mode=...` whenever the child failed to become ready in 30s or exited early, so the user opened a dead URL and saw `ERR_CONNECTION_REFUSED` with no signal as to why. The response is now a structured `{ success: false, message: "..." }` including the last 5 lines of the child's stderr.

### Changed
- **Mode-maker's skill gained a "Read the mode's own skill first" note** — when the agent is editing a forked mode, the workspace's own `skill/SKILL.md` holds the domain vocabulary (slide design, kami paper discipline, webcraft Impeccable.style). Mode-maker's own skill teaches how to *build* modes; the target mode's skill teaches what the mode is *for*. The new section tells the agent to consult it before editing, so it doesn't rebuild domain knowledge from external sources on every session.
- **Contract docs reflect the current `sources` requirement** — `core/types/mode-manifest.ts`, `skill/references/manifest-reference.md`, and `skill/references/viewer-guide.md` no longer claim `sources` is optional with a default synthesis (the runtime has rejected manifests without it since 2.29.0), and the `ModeDefinition` shape example in the viewer guide is corrected to the nested `{ manifest, viewer: { ... } }` form rather than a flat object.

## [2.34.0] - 2026-04-24

### Fixed
- **Fresh mode-maker forks crashed on mount** — the seed template's `viewer/Preview.tsx` destructured a `files` prop that had been removed when the Source abstraction landed, so every mode forked from the seed threw `Cannot read properties of undefined (reading '0')` inside its viewer before rendering anything. The seed now subscribes to `sources.files` via the `useSource` hook, matching how the builtin modes read files today.

### Changed
- **Upgraded mode-maker's agent reference docs to the current contracts** — `skill/references/viewer-guide.md` and `skill/references/manifest-reference.md` had drifted several refactors behind and were actively misleading the agent. The viewer guide now covers the full `ViewerPreviewProps` shape (sources, fileChannel, readonly, all the action/navigation props), with worked examples for reading via `useSource`, writing via a `json-file` source, and writing via `fileChannel`. The manifest reference now documents the `sources` field with examples for each built-in provider kind (file-glob, json-file, aggregate-file, memory), the `"select"` init-param type, `deriveParams`, evolution config, and `sharedScripts`. SKILL.md's mode-examples table was refreshed against the current lineup (doc/kami/slide/webcraft/draw/gridboard) and gained a short Source-abstraction primer in the development workflow section. The Play button is surfaced in Testing as the fastest feedback loop.

## [2.33.3] - 2026-04-24

### Fixed
- **Mode-maker "Play" opened a black window in packaged desktop builds** — Play spawns a child pneuma process with `--dev` (Vite dedup is required because `Bun.build` would duplicate the Zustand store), but the packaged app's `extraResources` shipped only the built `dist/`, not the sources Vite needs to serve in dev mode (`src/`, `vite.config.ts`, `public/`, `tsconfig.json`). Vite booted with nothing to serve, never printed its ready signal, the 30s timeout fired, the launcher fell back to a hardcoded URL, and the user saw `ERR_CONNECTION_REFUSED` in the new log viewer. Packaging now ships the missing sources.

## [2.33.2] - 2026-04-24

### Fixed
- **Auto-restore the Continue list for users hit by the pre-2.33.1 Play pollution bug** — users who updated from a version where mode-maker Play was silently pushing real workspaces out of the 50-entry registry cap would open the new launcher to an empty Continue list, with no obvious sign that their project files were still safe under `~/pneuma-projects/`. The launcher now scans that directory on boot and re-registers any `.pneuma/session.json` it finds but that the registry has lost — purely additive, dedupes by the same `${workspace}::${mode}` key `recordSession` uses, preserves existing entries' `sessionName`, and derives `lastAccessed` from the latest mtime across `session.json`/`history.json`/`thumbnail.png` so the list sorts by last-worked-on. Also exposed as `pneuma sessions rebuild` for users who want to trigger it manually.

## [2.33.1] - 2026-04-24

### Fixed
- **Mode-maker Play no longer pollutes the session registry** — every click of Play created a fresh UUID temp workspace under `os.tmpdir()` (e.g. `/var/folders/.../T/pneuma-play-<uuid>`) and wrote a new session record for it. Power users who iterated quickly on a mode could push 50+ legit workspace records out of the 50-entry cap in a single session, making their real sessions vanish from the launcher's Continue list. `recordSession()` now skips workspaces inside `os.tmpdir()` — the Play sandbox was never resumable (it's deleted when the play child exits), so it never belonged in the registry. The cap was also raised from 50 to 200 so users with many projects don't silently lose history.

## [2.33.0] - 2026-04-24

### Added
- **Install remote modes from the launcher UI** — previously the only way to install a mode from a URL or github repo was the CLI (`pneuma mode add <url>`). The launcher Import modal now has a **Session / Mode** tab toggle, and the Mode Gallery's Local section renders a **"+ Add from URL"** button next to its heading (visible even when empty so first-time users have an obvious entry point). Both feed a new `POST /api/modes/install` endpoint that reuses the CLI's `resolveMode()` code path, so the CLI, modal tab, and gallery button all drop bits in `~/.pneuma/modes/<name>/` identically. On success the modal shows the installed display name + description with a one-click Launch.
- **`pneuma://mode/{encodedUrl}` URL schema** — the desktop app now handles mode-install deeplinks alongside the existing `pneuma://open` and `pneuma://import` schemes. The landing page gains a matching `?action=mode&url=<tarball>` branch, so `https://pneuma.deepaste.ai/?action=mode&url=<tarball>` yields a one-click install button for anyone with the desktop app installed. The launcher reads a new `?installModeUrl=...` query parameter and auto-opens the Import modal on the Mode tab with the URL pre-filled.

## [2.32.2] - 2026-04-24

### Added
- **Centralized desktop log collection + in-app viewer** — one sink captures main-process `console.*`, bun launcher stdout/stderr (including every session-child line the launcher forwards), and every renderer's console + error events. Writes JSONL to `<userData>/logs/pneuma-<YYYY-MM-DD>.log` with 7-day retention, keeps a 5000-entry in-memory ring, and exposes it via **View → Show Logs** (`Cmd+Opt+L`), **View → Reveal Log File**, and the tray. The viewer is a plain BrowserWindow with live tail, level filter, substring search, and pause — no extra React bundle.
- **Mode-maker Play debug logging** — `POST /api/mode-maker/play` now logs spawn args, every stdout/stderr line from the play child (stderr was previously discarded entirely), the ready-signal match or timeout fallback, and the child's exit code. Makes the "Play hangs with no UI feedback" failure mode visible for the first time.

### Fixed
- **Mode-maker Play could hang past the 30s timeout** — the play route set `stderr: "pipe"` but never read it, so a child that produced enough stderr to fill the OS pipe buffer would block indefinitely. The route now drains both streams and settles the ready promise on early child exit too, so a crashing child no longer costs a full 30s wait.

## [2.32.1] - 2026-04-24

### Fixed
- **Desktop port collision with terminal `bun run dev`** — the packaged desktop app hardcoded `17996` for its launcher, which fought with a parallel dev Vite server (also 17996) and with any prior packaged instance still shutting down. Packaged builds now ask the OS for a free ephemeral port at launch; the dev desktop keeps `17996` for predictable logs. Downstream callers already read the launcher URL from stdout, so no call sites change.

## [2.32.0] - 2026-04-23

### Added
- **Shared image-generation scripts across modes** — `generate_image.mjs` and `edit_image.mjs` now live once at `modes/_shared/scripts/`. Modes opt in via a new `SkillConfig.sharedScripts: string[]` field; at install time the installer copies the listed scripts into each mode's own `.claude/skills/<mode>/scripts/` alongside the mode's `.env`. Each mode keeps its own SKILL.md guidance inline (model picking, aesthetic rules, workflow) — no cross-skill references for the agent to chase, single source of truth for the script itself. (#79)
- **GPT-Image-2 (OpenAI) via fal.ai as the default model** — ported the full contextual-illustrator capability into the zero-dep `.mjs` stack. New flags: `--model gpt-image-2|gemini-3-pro`, `--quality low|medium|high`, `--image-size` (fal.ai preset name or `WxH`), `--image-urls` + `--mask-url` to switch `generate_image.mjs` into the `openai/gpt-image-2/edit` endpoint for precise URL+mask edits. GPT-Image-2 is especially strong at **legible typography, labels, signage, UI mockups with real copy, wordmark logos, and diagrams with text** — the things mode authors reach for constantly. The existing Gemini 3 Pro flags (`--resolution`, `--safety-tolerance`, `--seed`) still apply when opting back in with `--model gemini-3-pro`; Gemini runs on fal.ai or OpenRouter, GPT-Image-2 is fal.ai only.
- **webcraft image-gen** — new init params for `FAL_KEY` / `OPENROUTER_API_KEY`, sharedScripts opt-in, and a dedicated **Image Generation** section in the webcraft skill. The guidance centers on a webcraft-specific "Image Slop Test" that rejects the generic AI-hero aesthetic (glowing orbs, purple/cyan gradients, flat-vector dashboard heroes, waxy AI people) and a brand-word-anchored prompt discipline that extends webcraft's existing `<font_selection_procedure>` pattern into imagery: name the project's 3 brand words first, translate them into medium/palette/composition, reject the training-data reflex, then write the prompt.
- **kami image-gen** — new init params, sharedScripts opt-in (generate only — kami has no highlighter flow), and a paper-first image section in the kami skill. Includes a kami-flavored slop test (reject saturated HDR, neon, drop-shadow-inside-image, stock handshakes), palette-anchored prompt patterns (parchment ground + single ink-blue accent + editorial composition, with explicit no-fly clauses baked into each prompt), two worked examples (duotone portrait + 19th-century ink schematic), flag guidance in paper terms, and a reminder to re-read `.pneuma/kami-fit.json` after embedding because images change page height and can tip a previously-fitting page into overflow.

### Changed
- **illustrate + slide** now declare `sharedScripts` instead of carrying their own script copies. Their local `skill/scripts/` directories were removed; `SKILL.md` files kept full per-mode aesthetic/workflow guidance and were updated to document `gpt-image-2` as the new default model with the full flag surface. Kami's showcase `generate.sh` and `prompts.md` were repointed at the new shared script path.

## [2.31.1] - 2026-04-23

### Fixed
- **README kami row** — reflected kami's actual feature set after the 2.31.0 polish pass: two demo layouts (pneuma-one-pager + kaku-portfolio), Scroll / Focus / Book views, fit-discipline feedback loop, and the three-artifact export pipeline (PDF / PNG-ZIP / self-contained HTML). The 2.31.0 row had described the initial cut ("three demo layouts, Print-to-PDF") which no longer matched what shipped.

## [2.31.0] - 2026-04-22

### Added
- **`kami` mode** — new builtin for paper-canvas web design. Fixed paper surface (viewport-centered, non-scrolling) replaces the infinite-scroll webcraft assumption — the session picks a paper size at creation and locks it for the entire workspace, mirroring how you'd choose A4 portrait before starting a print layout. Ships with **3 demo content sets** ported from [tw93/kami](https://github.com/tw93/kami) (MIT) — Tesla, Musk profile, Kaku — showcasing three distinct paper-layout idioms (timeline, bento grid, mixed editorial), plus **1 blank starter** for fresh work. **5 paper sizes (A3/A4/A5/Letter/Legal) × 2 orientations (portrait/landscape)** selectable at session creation; the choice is persisted in `.pneuma/config.json` and surfaced to the viewer as CSS custom properties. Includes a condensed `pneuma-kami` skill with paper-canvas design principles, allowed CSS patterns, and layout playbooks.
- **`InitParam.type = "select"`** — core-level addition to the init param contract. Previous types were `"number" | "string"`; now `"select"` joins them with an `options: string[]` field. Launcher renders it as a native `<select>` populated from the options array; the interactive CLI resolver uses `@clack/prompts` `p.select` against the same list; `defaultValue` must be one of the options. Additive change — existing `"number"` / `"string"` param declarations are untouched.
- **Bundled typefaces in `modes/kami/`** — Newsreader, Inter, and JetBrains Mono (all OFL 1.1) ship as self-hosted WOFF2 assets so paper layouts don't depend on Google Fonts CDN. TsangerJinKai02 (仓耳今楷02) is bundled under personal-use license — commercial use requires a license from the foundry. Full attribution in `modes/kami/NOTICE.md`.

### Fixed
- **`bin/pneuma.ts` saveConfig ordering** — init params resolved after session init (paper size, orientation, etc.) weren't making it into `.pneuma/config.json` because the save was happening before derived params were merged. Reordered so every derived param lands in the on-disk config; viewers that read from the config source (including kami's paper-size CSS vars) now see the fully-resolved values on first load.

## [2.30.1] - 2026-04-20

### Fixed
- **Queued chat messages now keep their attachments** — submitting a message while the agent was busy silently dropped images, files, element selection, and annotations; the auto-dequeue also only forwarded text to the backend. The pending queue now carries the full payload and round-trips every field when the turn flushes. Attachment-only messages (previously blocked from queuing) also go through. (#76)
- **IME-safe chat submit + textarea scrollbar** — moved `ChatInput` submission onto native form submit so CJK composition no longer sends mid-IME, and tuned the textarea to hide the scrollbar unless the content exceeds the max height. (#77)

## [2.30.0] - 2026-04-18

### Added
- **webcraft mode bumped to 1.2.0** — synced with Impeccable.style 2.1.7
- **Two new commands**: `shape` (discovery interview that produces a design brief before any code) and `craft` (shape-then-build flow in one pass). New "Plan" category added to the command toolbar
- **New principles in the pneuma-webcraft skill**:
  - `<absolute_bans>` — strict CSS pattern bans for side-stripe borders and gradient text (the two most recognizable AI design tells)
  - `<font_selection_procedure>` — forces a 4-step procedure before naming any font, with an explicit `<reflex_fonts_to_reject>` list (Inter, Fraunces, DM Sans, Plus Jakarta Sans, etc.) that breaks training-data monoculture
  - `<theme_selection>` — derives light vs dark from audience/context instead of defaulting
  - OKLCH-first color guidance (replacing HSL), 4pt spacing scale, formalized 60-30-10 rule
- **Critique sub-references**: `cognitive-load.md`, `heuristics-scoring.md`, `personas.md` — ported from impeccable 2.1.7 as companion refs to `cmd-critique.md`
- **`cmd-layout.md`** — the `layout` command (renames `arrange`, content refreshed to 2.1.7)
- **`cmd-teach.md`** — the `teach` command (renames `teach-impeccable`, aligned with impeccable's new teach flow)

### Changed
- **webcraft command set** went from 20 (with `teach-impeccable`, `normalize`, `arrange`, `onboard`) to 20 (with `teach`, `shape`, `craft`, `layout`). `normalize` folded into `polish` (Design System Discovery); `onboard` folded into `harden` (empty states, onboarding flows). Command IDs changed — see upgrade path below
- **`server/skill-installer.ts`** — installer now purges the target skill directory before copying, preventing stale files from prior skill versions (e.g. `cmd-arrange.md`) from lingering after an upgrade. Applies to both mode skills and skill dependencies

### Upgrade path for existing webcraft workspaces

When a workspace resumes, the launcher detects the webcraft version change (1.1.0 → 1.2.0) and shows an inline "Skill update" prompt.

- **Accept the update**: the installer purges the old `.claude/skills/pneuma-webcraft/` directory and reinstalls fresh — old `cmd-teach-impeccable.md` / `cmd-arrange.md` / `cmd-normalize.md` / `cmd-onboard.md` are removed, new `cmd-shape.md` / `cmd-craft.md` / `cmd-layout.md` / `cmd-teach.md` are added. CLAUDE.md is re-injected with the new Impeccable section
- **Skip**: your workspace keeps the 1.1.0 skill indefinitely; the prompt won't reappear for this version. Toolbar will still show the new 20-command set from the runtime manifest, but clicking `shape` / `craft` / `layout` / `teach` won't find a matching reference file until you update
- **`.impeccable.md` files** from prior `teach-impeccable` runs remain valid — the design-context structure is unchanged

## [2.29.0] - 2026-04-13

### Added
- **`Source<T>` data-channel abstraction** — viewer-contract-layer infrastructure that realizes the "viewer is the whole app UI" vision from `docs/archive/proposals/2026-03-12-pneuma-3.0-design.md`. Every mode viewer now consumes typed, origin-aware, subscription-shaped data channels via `props.sources` instead of a raw `files: ViewerFileContent[]` prop
- **Four built-in source providers** in `core/sources/`:
  - `memory` — ephemeral in-process state
  - `file-glob` — multi-file aggregate read (domain is files)
  - `json-file` — single structured file with parse/serialize + self-echo drop
  - `aggregate-file` — multi-file domain aggregate with user-supplied `load(files) → T` + `save(T, current) → { writes, deletes }` pure functions
- **`BaseSource` abstract class** enforcing four invariants via TDD: single writer (Promise queue serialization), change-read-via-subscription, time-locked write Promises (await returns only after the `origin: "self"` event has been delivered to all subscribers), origin-tagged events. 46 bun:test cases pin the contract
- **Server-side origin tagging** — `pendingSelfWrites` + `pendingSelfDeletes` TTL maps in `server/file-watcher.ts` identify self-origin chokidar echoes at the source. The only place self/external origin is determined; viewers never reverse-engineer it
- **`DELETE /api/files?path=...`** route — symmetric with POST, wired to `pendingSelfDeletes` so unlink events are origin-tagged
- **`BrowserFileChannel`** in `src/runtime/file-channel.ts` — bridges the Zustand store + WebSocket + `/api/files` into the `FileChannel` interface that providers consume via `SourceContext.files`
- **`SourceRegistry`** + **`useSourceInstances`** React hook — builds `{sources, fileChannel}` per active mode with proper lifecycle cleanup on mode switch
- **`useSource<T>`** React hook wrapping `useSyncExternalStore` — returns `{value, write, status}` with `status.lastOrigin` tracking. StrictMode-safe
- **`PluginManifest.sources`** — extension point for third-party source providers; `PluginRegistry.collectSourceProviders()` flattens them
- **Domain types for Pattern C modes** — `modes/slide/domain.ts` defining `Deck`, `modes/webcraft/domain.ts` defining `Site`, `modes/illustrate/domain.ts` defining `Studio`. Each ships with `load`/`save` pure functions that the aggregate-file provider calls. Viewers consume `Source<Deck>` / `Source<Site>` / `Source<Studio>` directly — zero `files.find()` or inline JSON.stringify in viewer code
- **Migration documentation**:
  - `docs/migration/2.29-source-abstraction.md` — decision tree + 4 patterns (A read-only, B headless opt-out, C typed aggregate, D dynamic write target) + common pitfalls + escape hatch for staying on 2.28.x
  - `docs/superpowers/plans/2026-04-13-source-abstraction.md` — 5768-line implementation plan
  - `docs/superpowers/plans/clipcraft-source-migration.md` — focused guide for the ClipCraft mode author
  - `docs/reference/viewer-agent-protocol.md` gained a new "Sources — Viewer 的数据通道" section + design principle 7 "Files 归 agent, Domain 归 viewer" + new `基本立场` three-layer framing (Layer 1 = files for agents, Layer 2 = runtime transport, Layer 3 = `Source<T>` for viewers)
- **`viewer-as-player` framing pass** across README, CLAUDE.md, viewer-agent-protocol.md, pneuma-3.0-design.md, ADR-007

### Changed — ⚠️ Breaking for external mode authors
- **`ViewerPreviewProps.files` is removed.** Every viewer now receives `props.sources: Record<string, Source<unknown>>` + `props.fileChannel: FileChannel` instead. Viewers destructure `sources` and derive their file list via `useSource(sources.files as Source<ViewerFileContent[]>)`. Local variable `files` inside the component works identically to the old prop after one line of setup.
- **`ModeManifest.sources` is required.** Every manifest must declare a `sources` field (possibly `{}` for headless modes like evolve). The synthesis fallback that auto-generated a `sources.files` file-glob from `viewer.watchPatterns` has been removed. Any external mode without a `sources` field will throw on load with a clear error message pointing at the migration guide.
- **Error message for pre-2.29 modes** is extensively self-documenting: it prints which mode is broken, shows the 4-line fix inline, points at `docs/migration/2.29-source-abstraction.md` for the full guide, and tells users how to pin to `pneuma-skills@2.28` as an escape hatch. No guessing required.
- **`FileUpdate` (server-side)** gained required `origin: "self" | "external"` and optional `deleted?: boolean` fields. The WebSocket `content_update` message shape is unchanged at the protocol level but the per-file entries now carry `origin`
- **All 10 in-repo builtin modes migrated** to the new contract. 29-file diff across `modes/doc/`, `modes/diagram/`, `modes/draw/`, `modes/evolve/`, `modes/gridboard/`, `modes/illustrate/`, `modes/mode-maker/`, `modes/remotion/`, `modes/slide/`, `modes/webcraft/`. Deleted echo-detection refs: `lastExternalRef` (doc), `lastSavedContentRef` + `isUpdatingFromFileRef` + load-bearing ref-before-fetch ordering (draw), `lastFileContentRef` + `currentFilePathRef` skip-guard (diagram). Deleted 6 inline `saveFile` helpers + ~8 inline `fetch('/api/files')` call sites.
- **CLAUDE.md builtin modes list** no longer mentions `clipcraft` (it was stale — clipcraft lives in the `feat/clipcraft-by-pneuma-craft` branch, not as a builtin)

### Migration path for external mode authors

If you maintain a mode that's installed via `pneuma mode add github:...` or similar, you have three options:

1. **Migrate (recommended).** Follow `docs/migration/2.29-source-abstraction.md`. 4–15 minutes for most modes. Add a `sources` field to your manifest, destructure `sources` instead of `files` in your viewer, optionally use `fileChannel.write` for dynamic-target saves.
2. **Pin to 2.28.x.** `npm install -g pneuma-skills@2.28` or download the last 2.28.x desktop installer. Your mode keeps working unchanged. 2.28 is the last release with the pre-Source contract.
3. **For ClipCraft-class modes** (typed single-file aggregate with echo-loop concerns): follow `docs/superpowers/plans/clipcraft-source-migration.md` — it covers the three-ref dance → single `json-file` source migration with before/after code.

No intermediate compat layer ships — the new contract is the only contract going forward. The error message at `SourceRegistry.effectiveSources` walks you through the fix the first time it fires.

## [2.28.0] - 2026-04-08

### Added
- **Plugin system** — extensible plugin architecture with hooks, slots, routes, settings, and skills. Plugins choose their injection points; soft error everywhere
- **Builtin deploy plugins** — Vercel and Cloudflare Pages refactored as builtin plugins with dynamic provider loading, `/api/deploy` orchestrator, and `deploy:before/after` hooks
- **Slot system** — declarative form injection into deploy modal via `deploy:pre-publish` slot, plus custom React component dynamic import via `/@fs/`
- **Hook lifecycle** — `deploy:before/after`, `session:start/end`, `export:before/after`, `preferences:build` hooks with waterfall execution
- **MemorySource protocol** — standard search/read/write contract for external knowledge stores
- **Obsidian Memory plugin** — builtin plugin (disabled by default) connecting to Obsidian vaults via Local REST API. Provides independent skill for agent-driven search + preference memory source registration. User-customizable skill description and guidance
- **Plugin CLI** — `pneuma plugin add <path|github|url>`, `pneuma plugin list`, `pneuma plugin remove <name>` with manifest-based name resolution
- **Launcher plugin management** — Settings panel with enable/disable toggles, auto-rendered forms from plugin settings schema, CLI connection status for deploy plugins
- **Plugin skill injection** — plugins can ship independent skills installed to `.claude/skills/` with template params from user settings

### Improved
- **Deploy dropdown** — dynamically loaded from plugin registry; disabled plugins hidden; provider-scoped pre-publish forms
- **Vercel CLI debug logs** — demoted from stderr to stdout to avoid `[launcher:err]` noise

## [2.27.2] - 2026-04-07

### Fixed
- **Slide first-page black screen** — force a visibility transition on the first slide's iframe to trigger Chromium paint inside the transform:scale() container
- **Webcraft iframe scrollbar** — inject thin semi-transparent scrollbar styles into iframe srcdoc to match the app's dark theme

## [2.27.1] - 2026-04-07

### Fixed
- **Vercel deploy in Electron** — add missing HOME environment variable to Vercel CLI deploy spawn, fixing auth/config lookup failures in packaged Electron app (checkVercelCli was fixed in 2.26.1 but deployViaCli was missed)

## [2.27.0] - 2026-04-06

### Added
- **Diagram mode** — new builtin mode for creating draw.io diagrams via natural language. Powered by draw.io's `viewer-static.min.js` (Apache 2.0) with rough.js for sketch/hand-drawn style support
- **Diagram viewer** — offscreen mxGraph renderer with tight SVG extraction, center-based CSS transform pan/zoom, multi-page tab switching, hover highlights, and element selection for contextual editing
- **Diagram streaming** — real-time incremental XML merge renders shapes and connections as the agent generates them, with edge resolution for out-of-order cell creation
- **Diagram skill** — agent skill with draw.io XML/style references, color palette, shape library guide, and layout best practices

## [2.26.2] - 2026-04-02

### Improved
- **File watcher ignore list consolidation** — expanded `DEFAULT_IGNORE` in `file-watcher.ts` to cover agent config files (`CLAUDE.md`, `AGENTS.md`), environment/secrets (`.env*`), log files, framework build directories (`.next`, `.nuxt`, `.svelte-kit`, `.output`, `.parcel-cache`, `.turbo`), test coverage output, and TypeScript build info. Removed redundant per-mode `ignorePatterns` that duplicated defaults — modes now only declare mode-specific exclusions
- **File watcher error handling** — added `watcher.on("error")` handler to gracefully log permission errors (`EACCES`/`EPERM`) during directory traversal instead of emitting unhandled warnings

## [2.26.1] - 2026-04-01

### Fixed
- **Electron CLI deploy environment** — ensure HOME is set when spawning Vercel/Wrangler CLI in packaged Electron app, where launchd provides a minimal process environment
- **CLAUDE.md injection cleanup** — removed accidentally committed skill prompt, viewer API, and endpoint tables that were injected by running Pneuma in its own project directory

### Improved
- **Single-page webcraft deploy** — skip the aggregation index page when deploying a single-page webcraft site; deploy the content directly as `index.html`
- **CLAUDE.md optimization** — slimmed from 614 to 300 lines; replaced exhaustive API tables with source pointers, condensed flowcharts, consolidated related gotchas

## [2.26.0] - 2026-04-01

### Added
- **Claude Code protocol sync** — new message types for streamlined text, streamlined tool use summaries, prompt suggestions, and permission cancel requests. Enriched permission request fields (title, display name, blocked path, decision reason). System init now carries prompt suggestion and agent progress summary capabilities
- **Preference skill CC memory insights** — file size discipline (~2KB), auto-detection of critical constraints from absolute user language, reverse verification when corrections conflict with recorded preferences, optimistic concurrency for multi-session safety, and evolution mode integration for background "dreaming" style preference refresh

## [2.25.0] - 2026-03-31

### Added
- **User Preference Analysis** — all modes now ship with a `pneuma-preferences` global skill that gives agents persistent memory of user aesthetics, collaboration style, and per-mode habits. Preferences are stored in `~/.pneuma/preferences/` as agent-managed Markdown, with critical constraints auto-injected at session startup. Includes three-layer preference model, living-document philosophy, and incremental refresh via changelog tracking
- **Preference file scaffolding** — first launch auto-creates `profile.md` and `mode-{name}.md` with empty `pneuma-critical` and `changelog` markers, so agents naturally fill in the structure

### Fixed
- **Webcraft viewport switch white screen** — switching between Full and Device viewport presets unmounted the iframe but the srcdoc effect didn't re-fire because its dependency list missed the viewport state change
- **Webcraft export blank content** — scroll-reveal elements (IntersectionObserver-triggered fade-ins) stayed invisible in export iframes because there's no scrolling to trigger them. Export now forces animations to their end state and adds common reveal classes
- **Webcraft export excessive whitespace** — pages with `min-height: 100vh` hero sections caused oversized iframes in export. Export now scans iframe stylesheets and overrides vh-based height rules to auto
- **Deploy CLI resolution** — Vercel/Wrangler CLI detection and slide image inlining fixes

## [2.24.3] - 2026-03-31

### Fixed
- **Desktop CLI detection** — Vercel and Wrangler CLIs were not detected in the Electron desktop app because `checkVercelCli()` / `checkWranglerCli()` used bare `which` with the limited GUI process PATH. Now uses `resolveBinary()` and enriched PATH from `path-resolver.ts`, which captures the user's shell PATH and probes common install directories

## [2.24.2] - 2026-03-30

### Fixed
- **Slide export text reflow** — snapdom's foreignObject produced slightly wider text when capturing visible iframes, causing unexpected line breaks in slides with tight text (CJK + Latin mixed with letter-spacing). Fixed by hiding the capture iframe before snapdom runs, forcing CSS computed values instead of live layout metrics
- **Slide thumbnail overflow crop** — decorative elements with negative offsets (e.g. glow effects at `right: -200px`) caused snapdom to capture beyond the slide bounds. Captured images are now cropped to the expected slide dimensions
- **Export page font timing** — added `document.fonts.ready` wait before snapdom capture in both thumbnail and export paths to prevent text reflow from incomplete font rendering
- **Export image oversize** — removed redundant `scale:2` from export snapdom capture; on Retina displays this produced 4x images (5120×2880) instead of the expected 2x (2560×1440)

### Improved
- **snapdom upgrade** — `@zumer/snapdom` 2.0.2 → 2.7.0 (plugin system, font stylesheet domains, Safari warmup, debug mode)
- **Export page default mode** — export page now defaults to HTML mode instead of auto-converting to Image on load, avoiding stale captures from early rendering state

## [2.24.0] - 2026-03-30

### Added
- **Slide Inspiration Pool** — opt-in style preset browser in the slide viewer toolbar. 8 curated styles (Bold Signal, Electric Studio, Creative Voltage, Dark Botanical, Notebook Tabs, Neon Cyber, Swiss Modern, Paper & Ink) with live iframe preview. Presets serve as design starting points — the agent adapts them to the user's content

### Fixed
- **Notification queue flush** — viewer notifications (e.g. preset selection) were stuck unsent on fresh sessions. Root cause: `cli_connected` didn't restore `sessionStatus` to `"idle"` after `cli_disconnected` set it to `null`

## [2.23.3] - 2026-03-30

### Improved
- **Slide export isolation** — replaced shadow DOM with iframe-based rendering for export page slides. Each slide renders in its own `<iframe srcdoc>`, providing complete CSS/JS isolation and better snapdom compatibility for image capture
- **Image mode caching** — captured PNG is cached in `<img>` elements; switching between HTML/Image modes no longer re-captures
- **Print flow** — dedicated `printSlides()` with `createMaterializedSlides()` materializes iframe content for printing; `beforeprint`/`afterprint` event handling for automatic cleanup
- **PPTX export** — refactored to async/await with proper materialization from iframe content

## [2.23.2] - 2026-03-29

### Fixed
- **Slide export CSS isolation (player)** — player page slides render inside shadow DOM boundaries, preventing inline `<style>` blocks from polluting the player chrome
- **Image mode pseudo-elements** — `::before`/`::after` elements (e.g. decorative bars) were lost during snapdom capture inside shadow DOM. Fixed by flattening shadow content into a hidden iframe before capture
- **Body attribute preservation** — `<body style>` and `<body class>` attributes from slide HTML are now propagated into shadow DOM `:host` styles and host element classes

### Improved
- **Player slide switching** — uses `visibility`/`z-index` instead of `display:none/block` for smoother transitions
- **CSS selector rewriting** — `adaptCssForShadow` regex hardened with negative lookahead to avoid matching identifiers like `body-text`

## [2.23.1] - 2026-03-28

### Added
- **Import local archives** — launcher import dialog now supports selecting local `.tar.gz` files alongside share URLs. New `POST /api/import/upload` endpoint for multipart file upload

## [2.23.0] - 2026-03-28

### Added
- **Slide presentation player** — new `/export/slides/player` route generates a self-contained interactive player for deployed slides. Single-slide view with auto-fit scaling, outline panel (left/hidden), keyboard navigation (arrows/Home/End), zoom controls (50-200% + Fit), and auto-hiding bottom bar for immersive viewing
- **Theme-adaptive player chrome** — player auto-detects light/dark mode from `theme.css` (`--color-bg` luminance) and adapts all UI colors. Accent color from `--color-primary`. Each deck gets its own visual style
- **Preview in deploy dropdown** — slides export page deploy menu includes Preview button to open player in new tab before publishing
- **Deploy dropdown preview support** — `getDeployToolbarHTML()` accepts optional `previewUrl` for mode-specific preview pages

### Improved
- **Deploy dropdown** — auto-fit width, linked project name shown inline

## [2.22.1] - 2026-03-27

### Improved
- **Deploy dropdown** — show linked project name inline (right-aligned, truncated), auto-fit width (min 200px, max 360px)

## [2.22.0] - 2026-03-27

### Added
- **Vercel deployment** — deploy projects to Vercel directly from export pages. CLI (`vercel deploy`) prioritized, API token as fallback. Config in Launcher settings, deploy binding per contentSet in `.pneuma/deploy.json`
- **Cloudflare Pages deployment** — deploy to CF Pages via Wrangler CLI or Direct Upload API. Multipart form with SHA-256 manifest for file deduplication. Compatible with wrangler < 4.78 (auto-creates project)
- **Shared deploy UI** — `server/routes/deploy-ui.ts` provides reusable CSS, toolbar button (cloud icon + provider dropdown), modal (form/progress log/result/error), and deploy script. Modes only implement `collectDeployFiles()`
- **Deploy on all export pages** — webcraft (multi-page site with aggregation index), slides (single inline HTML), and remotion (standalone player HTML) all support both Vercel and Cloudflare Pages
- **Deploy log** — real-time progress output during deployment (collecting files, uploading, result)
- **Deploy binding per contentSet** — each contentSet deploys to its own project independently, stored as `vercel[contentSet]` and `cfPages[contentSet]` in `.pneuma/deploy.json`
- **Launcher settings** — Vercel (token + team) and Cloudflare Pages (API token + account ID) configuration sections

## [2.21.0] - 2026-03-26

### Added
- **Native bridge** — generic Electron API bridge at `/api/native/:module/:method`. Dynamic module-level proxy auto-discovers methods from Electron modules (clipboard, shell, app, screen, nativeTheme) with override map for special cases (NativeImage serialization, os/process, BrowserWindow, Notification). Web environments gracefully return `{ available: false }`
- **Native bridge agent awareness** — skill-installer auto-injects native API docs into CLAUDE.md with discovery endpoint. Agent calls `GET /api/native` to list capabilities, then invokes methods via REST
- **Clipboard image support** — `clipboard.readImage` returns base64 PNG, `clipboard.writeImage` accepts base64 PNG

## [2.20.0] - 2026-03-26

### Added
- **Editing state** — protocol-level `editing: boolean` toggle for creating vs consuming. When `editing: false`, Agent stops, Viewer hides editing UI (drag/resize/grid/gallery), content interactions preserved. Modes opt in via `editing: { supported: true }` in manifest
- **Editing toggle in TopBar** — eye/pencil icon + "View"/"Edit" label, left of share button. Only appears for modes that support editing state
- **App settings popover** — gear icon in TopBar opens settings for window size and resizable toggle, persisted per-workspace in `.pneuma/app-settings.json`
- **Viewing layout** — `layout: "app"` modes with `editing: false` render full-screen viewer with hover-reveal Edit button (zero visual footprint until mouse approaches top edge)
- **`--viewing` CLI flag** — cold-start in viewing mode (skips skill install + agent spawn)
- **`POST /api/session/editing`** — toggle editing state with agent lifecycle management (launch on true, kill on false)
- **`GET/POST /api/app-settings`** — per-workspace app window configuration
- **Launcher "My Apps" section** — filters `editing: false` sessions, auto-starts them on launcher boot
- **Electron window IPC** — `pneuma:set-editing` switches between maximized (editing) and fixed-size centered (viewing)
- **GridBoard app mode** — `layout: "app"` + `editing: { supported: true }` in manifest; viewing mode fills board to container, no scrollbars

### Improved
- **Viewer-Agent protocol docs** — new "Editing state" section documenting three-party behavior, data flow, and opt-in mechanism

## [2.19.1] - 2026-03-26

### Improved
- **GridBoard seed redesign** — new onboarding layout: intro card (8x3 with shimmer title, contextual illustration, 4-tier responsive) + small weather tile that triggers agent redesign on resize, teaching the core interaction
- **Design philosophy in SKILL.md** — "Small tiles show data, large tiles show craft" resize philosophy; visual toolkit guidance (inline SVG, data-driven color, typography contrast); anti-slop rules
- **Design references** — `references/tile-visual-design.md` and `references/resize-adaptation.md` following webcraft's skill organization pattern
- **Weather auto-detect** — weather tile defaults to IP-based geolocation instead of hardcoded Tokyo

### Fixed
- **Error boundary reset** — tile error boundary now resets on recompilation so fixed code renders immediately instead of staying stuck on the error screen
- **Locked tile error suppression** — compilation and render errors are suppressed while a tile is locked (agent mid-edit), eliminating noisy intermediate-state notifications
- **Locator gallery leak** — `scrollIntoView()` was scrolling ancestor containers, exposing the hidden gallery panel; replaced with scoped scroll calculation
- **Locator open-gallery action** — navigate request handler now processes `action:"open-gallery"` locators correctly

### Added
- **JSX tag limitation docs** — documented that locally-defined components cannot be used as JSX tags in tiles (runtime scope limitation); added to SKILL.md constraints and CLAUDE.md gotchas

## [2.19.0] - 2026-03-26

### Added
- **Workspace proxy** — reverse proxy middleware at `/proxy/<name>/*` solves CORS issues when viewer components fetch external APIs. Mode authors declare routes in `manifest.proxy`; agents/users can add more at runtime via `proxy.json` (hot-reloaded, no restart needed)
- **Proxy header injection** — proxy routes support `headers` config with `{{ENV_VAR}}` template syntax for auth tokens, User-Agent, and other request headers
- **Proxy agent awareness** — skill installer auto-generates proxy docs in CLAUDE.md; gridboard SKILL.md includes decision rules and patterns; mode-maker skill + manifest reference document the proxy field
- **Bilibili Hot tile** — new gridboard seed tile showcasing proxy header injection (Bilibili API requires browser User-Agent)

### Changed
- **Crypto ticker tile** — switched from CoinGecko (unreachable in many regions) to CryptoCompare free API

## [2.18.0] - 2026-03-26

### Added
- **GridBoard mode** — interactive dashboard builder with draggable tile grid on a fixed-size canvas (8×8 default). Tiles are React components defined via `defineTile()` protocol, compiled JIT in the browser with @babel/standalone
- **10 built-in seed tiles** — clock, weather (wttr.in), todo, AI news (HN Algolia), crypto ticker (CoinGecko), pomodoro, countdown, quotes, world clock, habit tracker
- **Shadow DOM tile isolation** — each tile renders in its own Shadow DOM; CSS custom properties penetrate for theming
- **Smart resize** — tiles declare `isOptimizedFor()` size breakpoints; resizing beyond them captures a snapdom screenshot and notifies the agent for visual optimization
- **Tile Gallery** — slide-in panel showing available and disabled tiles with live mini-previews and "Create New Tile" with inline description input
- **Capture viewer actions** — `capture-tile` and `capture-board` actions take snapdom screenshots, save to `.pneuma/captures/`, and return the path to the agent
- **Viewer notification queue** — user messages and viewer notifications share a unified pending queue with store-subscriber auto-flush; ws-bridge queues notifications when CLI is busy

### Improved
- **Gallery create flow** — "Create New Tile" now prompts for a description inline before sending to the agent, eliminating the agent round-trip question
- **Optimistic tile operations** — drag positions, resize sizes, and tile removals update the UI immediately before file save completes

### Fixed
- **Data fetch interval stability** — tile refresh intervals no longer reset on every recompilation; uses stable dependency key derived from active tile set
- **Crypto ticker API** — switched from Binance (blocked in some regions) to CoinGecko free API

## [2.17.0] - 2026-03-25

### Added
- **PPTX export for Slide mode** — "Download PPTX" button in the slide export toolbar; uses `dom-to-pptx` (PptxGenJS) in-browser to convert slides into an editable PowerPoint file, no external server needed
- **SVG preprocessing for PPTX** — inline SVGs are converted to data URI images with CSS variable resolution, `currentColor` expansion, and `getBBox`-based viewBox fitting for accurate positioning
- **PPTX CSS compatibility layer** — export preprocessor resolves CSS custom properties, converts `display: grid` to flexbox, bakes `opacity` into color alpha channels, and strips unsupported `backdrop-filter`

## [2.16.1] - 2026-03-25

### Improved
- **Evolution dual analysis** — evolve agent now detects stale skill instructions to prune (not just add), with confidence ratings (high/medium/low) on each proposed change
- **Evolution fork naming** — fork dialog now requires a custom name and optional description instead of auto-generating opaque directory names
- **Visual verification convention** — CLAUDE.md now instructs using chrome-devtools-mcp to screenshot-verify frontend changes before reporting completion

### Fixed
- **Slide scaffold content set scoping** — scaffold action now accepts a `contentSet` parameter; creating a new deck no longer clears the active seed content set

## [2.16.0] - 2026-03-25

### Added
- **Inspired by attribution** — modes can declare an `inspiredBy` field with name + URL; displayed as a small tag with GitHub/X.com icon in the launcher (gallery, featured header, launch dialog)
- **Remotion attribution** — credits `troyhua/claude-code-remotion` as inspiration

## [2.15.2] - 2026-03-24

### Fixed
- **Import deep link with existing launcher** — `pneuma://import` now works when the launcher window is already open, navigating to the import URL instead of just focusing

## [2.15.1] - 2026-03-24

### Added
- **Remotion showcase** — launcher gallery images for Remotion mode (hero, live preview, frame-perfect animation, export to video)
- **`/showcase` command** — reusable slash command for generating mode showcase materials with contextual illustration

## [2.15.0] - 2026-03-24

### Added
- **`pneuma://import` deep link** — one-click import of shared workspaces via URL scheme; landing page supports `?action=import&url=...` to show "Import in Pneuma" button

### Fixed
- **Result share mode detection** — shared result packages now include `.pneuma-snapshot.json` with mode metadata, fixing incorrect fallback to webcraft on import
- **Import URL encoding** — share URLs in `pneuma://import/` are properly `encodeURIComponent`'d to prevent URL parsing errors

## [2.14.0] - 2026-03-24

### Added
- **Landing page** — standalone static site at `web/` introducing Pneuma Skills with OS-specific download buttons, CLI install snippet, and deep link support; deployed to Cloudflare Pages
- **`pneuma://` URL scheme** — desktop client registers custom protocol handler for deep linking; supports `pneuma://open` and `pneuma://open/{mode}` routes with cold-launch queuing on macOS
- **Deep link landing UX** — landing page accepts `?action=open&mode=webcraft` query params to show an "Open in Pneuma" button alongside download CTA

## [2.13.1] - 2026-03-24

### Fixed
- **Download HTML is pure player** — standalone HTML export now hides all toolbar controls (composition selector, export buttons, format/quality options), showing only the player with playback bar
- **Compiler flash on startup** — skip compilation when files haven't loaded yet, preventing brief "Root.tsx not found" error

### Improved
- **Remotion seed updated** — replaced PneumaSkills demo with PneumaIntro (60s, 9 scenes) featuring editorial typography, illustration reveals, and matter.js physics; 14 curated public assets

## [2.13.0] - 2026-03-24

### Added
- **Remotion export page** — standalone HTML export with embedded player, MP4/WebM video export via `@remotion/web-renderer` (WebCodecs API), format and quality selectors, custom playback controls
- **Remotion viewer export button** — one-click export of the currently selected composition from the preview info bar

### Improved
- **Remotion skill rewrite** — restructured as a content-first workflow guide (Research → Motion Intent → Design Outline) instead of a system prompt, following skill best practices

### Fixed
- **Remotion asset refresh** — preview now auto-refreshes when `public/` images are replaced (content hash includes asset paths + cache-busting on `staticFile()` URLs)
- **Export composition filtering** — export page receives the selected composition from viewer, no redundant selector
- **Autoplay button state** — play/pause button now correctly reflects autoplay-on-load state

## [2.12.2] - 2026-03-24

### Fixed
- **Auto-update asset check** — desktop app now verifies platform-specific update artifact exists before checking for updates, preventing 404 errors during CI build window

## [2.12.1] - 2026-03-24

### Fixed
- **Viewer action abort** — viewer-triggered agent commands now set `turnInProgress`, enabling the Stop button during agent response

## [2.12.0] - 2026-03-24

### Added
- **Remotion mode** — new built-in mode for programmatic video creation with React; JIT compilation via `@remotion/player` + `@babel/standalone` with live preview
- **Custom playback controls** — timeline scrubber, play/pause, speed selector (0.5–2×), fullscreen; keyboard shortcuts (Space, [, ], I, O, L, arrows)
- **Loop range markers** — set in/out points on timeline for section loop playback; locator cards support frame ranges (`{"file":"X","inFrame":0,"outFrame":90}`)
- **Remotion content sets** — multiple Remotion projects detected by `src/Root.tsx`; compositions appear as workspace items in TopBar
- **Resolution init params** — `compositionWidth`/`compositionHeight` choosable at launch (default 1280×720)
- **Impeccable.style design references** — 5 reference files (typography, color, spatial, motion, ux-writing) guide agent toward high-quality video aesthetics
- **37 Remotion API rule files** — official Remotion skill rules for animations, timing, transitions, audio, 3D, charts, and more
- **PneumaSkills seed** — demo composition (45s, 8 scenes) with 4 image assets as starter template

### Fixed
- **Shadow-git init ordering** — move `initShadowGit()` after seed + bun install so initial checkpoint includes seed files (affects all modes' replay)
- **Rev-parse stdout fallback** — read git ref file directly when `Bun.spawn` stdout pipe returns empty (prevents empty checkpoint hashes)
- **Launcher number input** — hide browser-default spinner arrows on number type inputs in init params

## [2.11.0] - 2026-03-22

### Added
- **Session naming** — sessions can be given custom names at creation time (default: `{mode}-{timeTag}`); names are stored in `sessionName` field on `SessionRecord`, independent of mode `displayName`
- **Session rename** — inline rename via pencil icon on hover in both card and compact session views; `PATCH /api/sessions/:id` endpoint; Enter/blur to save, Escape to cancel
- **Session search** — search bar in All Sessions overlay; filters by session name, mode name, and workspace path (case-insensitive)
- **`--session-name` CLI flag** — pass custom session name when launching from CLI or launcher

### Fixed
- **Webcraft viewer state normalization** — fix viewer state not being properly normalized on load

## [2.10.0] - 2026-03-21

### Added
- **Shadow-git checkpoints** — auto-snapshot workspace at each agent turn via isolated `.pneuma/shadow.git` bare repo; serial queue prevents git lock conflicts; graceful degradation if git unavailable
- **History export** — bundle messages + checkpoints into shareable `.tar.gz` packages (`pneuma history export`); mechanical session summary generation (overview, key decisions, recent conversation)
- **History sharing** — upload process packages to R2 (`pneuma history share`); download and import from URL via Launcher import dialog with custom workspace picker
- **Replay player** — time-travel playback with progress bar, checkpoint dots, speed control (1x/2x/4x/8x); auto-navigate to edited files after checkpoint loads
- **Two-phase replay session** — replay is a phase within a normal session; "Continue Work" applies final checkpoint, installs skill, restores API keys from global storage, launches agent (irreversible transition)
- **Viewer readonly mode** — all 5 mode viewers (webcraft/doc/slide/draw/illustrate) suppress editing, selection, and annotation when `readonly` prop is true; navigation (scroll, zoom, page switch) preserved
- **Replay tab restrictions** — all TopBar tabs except Chat disabled during replay; auto-switch to Chat on replay entry
- **Launcher replay button** — sessions with shadow-git data show a replay icon on hover; launches replay in the session's workspace
- **CLI history commands** — `pneuma history export`, `pneuma history share`, `pneuma history open <path-or-url>`
- **CLI replay flags** — `--replay <path>` loads a replay package; `--replay-source <path>` replays from an existing workspace's shadow-git

### Fixed
- **Share dropdown z-index** — ChatPanel status bar no longer overlaps the Share dropdown menu
- **Replay progress bar overflow** — removed `backdrop-blur` (containing block gotcha), clamped progress to 0–100%
- **Replay content set navigation** — auto-navigate runs after checkpoint loads so newly created content sets are matched correctly

## [2.9.3] - 2026-03-20

### Fixed
- **Codex protocol compatibility** — handle 6 breaking changes in codex-cli 0.114+: `thread/status/changed` object format, `turn/completed` restructured payload, `initialize` response, MCP field renames, token usage format, new server request types
- **Codex session resume** — fall back to new thread when `thread/resume` fails (e.g. rollout not found after CLI upgrade), instead of crashing
- **Codex browser connection** — fix `cli_disconnected` being sent on browser connect for Codex sessions (uses stdio, not WebSocket), which prevented the UI from sending messages
- **Codex session routing** — `getActiveSessionId` now recognizes Codex adapter sessions, fixing viewer actions and other features that depend on finding the active session
- **Bun subprocess stdout bug** — Codex launcher switched from `Bun.spawn` to `node:child_process` to work around Bun's `ReadableStream` from `proc.stdout` closing prematurely while the process is still alive

### Improved
- **Codex security** — unknown JSON-RPC request types now default to decline instead of auto-accept; added explicit handlers for `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`
- **Codex model tracking** — handle `model/rerouted` notification to update active model; parse version from new `userAgent` response format

## [2.9.2] - 2026-03-20

### Fixed
- **Electron export kill-on-close** — opening export pages (slide/webcraft) in Electron no longer kills the session process when the export window is closed; `/export/` paths now open in a lightweight window without the kill-on-close handler
- **Slide export CSS broken** — `@import` regex now correctly handles `url()` containing semicolons (e.g. Google Fonts `wght@300;400;500`), which previously truncated the import and invalidated the entire `<style>` block
- **Slide snapdom conversion hang** — added try-catch around each slide capture so an `EncodingError` on one slide no longer freezes the entire conversion loop at "Converting X/Y..."
- **Slide snapdom CDN dependency** — replaced external unpkg CDN reference with local `/vendor/snapdom.js` for reliability in iframe and offline contexts

### Improved
- **Electron export window** — export pages now open maximized for a full-screen experience

### Removed
- **WebCraft Print / Save PDF button** — removed from webcraft export page due to unreliable behavior in multi-page contexts; slide export retains its Print button

## [2.9.0] - 2026-03-19

### Added
- **App layout mode** — new `layout: "app"` option in ModeManifest renders the viewer fullscreen with a floating agent bubble instead of the default split-panel editor layout; existing modes unaffected (default `"editor"`)

### Fixed
- **Security: path traversal & command injection** — patched thumbnail endpoint validation, showcase asset path resolution, and process kill to prevent path traversal (C1-C2) and command injection (C3); added 15 security tests

### Improved
- **Zustand store architecture** — split monolithic 681-line store into 7 protocol-aligned slices (session, chat, workspace, viewer, mode, agent-data, ui) with zero consumer-facing changes
- **Server decomposition** — extracted export routes (1275 lines) into `server/routes/export.ts` and shared utilities into `server/utils.ts`, halving `server/index.ts`
- **Code deduplication** — consolidated `getApiBase()` (10 copies → 1 in `src/utils/api.ts`) and `startViteDev()` (3 copies → 1 in `bin/pneuma-cli-helpers.ts`)
- **Test discovery** — added `bunfig.toml` to exclude `desktop/` from test runner, preventing false failures from vendored modules

## [2.8.1] - 2026-03-18

### Fixed
- **File watcher flooding** — added `node_modules`, `dist`, `.vite`, and `build` to the default ignore list so chokidar doesn't push irrelevant file changes to the browser
- **Thumbnail capture OOM** — snapdom now scales to thumbnail dimensions instead of device pixel ratio, and skips DOM cloning entirely for fullscreen/near-fullscreen viewers

## [2.8.0] - 2026-03-18

### Added
- **3 new Impeccable commands** — `typeset` (typography), `arrange` (layout & spacing), `overdrive` (technically ambitious implementations) — WebCraft now has 20 design commands
- **Action/Command protocol separation** — new `ViewerCommandDescriptor` type for User → Agent commands, distinct from `ViewerActionDescriptor` (Agent → Viewer actions); manifest gains `viewerApi.commands[]` field
- **Viewer-Agent Protocol doc** — `docs/reference/viewer-agent-protocol.md` documenting the 6 communication directions between User, Viewer, and Agent with architectural diagrams

### Improved
- **Impeccable v1.5 sync** — updated 13 existing command references and design principles from upstream; typography reference now distinguishes fixed type scales (app UI) from fluid typography (marketing pages)
- **Viewer decoupled from manifest** — WebCraft viewer reads commands from `props.commands` (runtime-injected) instead of importing manifest directly; sidebar built via `useMemo` from props
- **Richer design anti-patterns** — DON'T guidelines now include explanations (e.g. "modals are lazy", "hero metric layout template"), Context Gathering Protocol added for design work

## [2.7.4] - 2026-03-17

### Fixed
- **Slide thumbnail misalignment** — full-bleed background images (`position: absolute`) caused snapdom to produce shifted thumbnails; now hidden via CSS during capture so foreground content renders correctly
- **Slide export CSS scoping** — theme CSS in exported slides no longer pollutes toolbar/UI styles
- **Large file attachment crash** — prevented oversized file attachments from crashing the CLI WebSocket connection
- **CORS for `/content/*`** — added CORS headers to workspace file serving, enabling cross-origin image inlining for thumbnail capture in dev mode

### Improved
- **Slide layout guidance** — strengthened vertical centering as the default; `.slide` (centered) is now the clear default for light/medium content, with heading-top + body-centered pattern reserved for dense slides only
- **Slide image generation guidance** — rewritten to encourage proactive AI image generation instead of CSS-first default; design outline template now includes image planning tips
- **Slide thumbnail image handling** — external images are pre-fetched and inlined as data URLs before snapdom capture, working around srcdoc iframe cross-origin limitations

## [2.7.3] - 2026-03-17

### Fixed
- **Content set persistence** — reopening a session now correctly restores the last active content set; fixed a race condition where files loaded before the mode viewer, causing `resolveContentSets` to return empty and skipping the saved state restore

## [2.7.2] - 2026-03-17

### Fixed
- **Slide export subdirectory images** — export page and downloaded HTML now correctly resolve image paths for content sets in subdirectories (same root cause as 2.7.1 viewer fix, applied to server-side export with `<base href>` and inline data URI resolution)

## [2.7.1] - 2026-03-16

### Fixed
- **Slide subdirectory image paths** — images in content sets stored in subdirectories (e.g. `sop-report/assets/`) now resolve correctly; `<base href>` uses the active content set prefix from the store instead of deriving it from the (already-stripped) manifest path

## [2.7.0] - 2026-03-16

### Added
- **Message queue** — users can type and submit messages while the agent is working; messages appear as pending pills above the input and auto-send one-at-a-time when each turn completes
- **Reconnect button** — status pill shows a clickable ↻ icon when WebSocket is disconnected, allowing manual reconnection instead of waiting for auto-retry

## [2.6.11] - 2026-03-16

### Fixed
- **WebCraft multi-page tabs** — page navigator now accepts both `pages`/`files` array keys and `file`/`path` entry keys in `manifest.json`, so AI-generated manifests in either format are correctly parsed

### Improved
- **WebCraft skill guidance** — added "Multi-Page Sites" section to SKILL.md with explicit `manifest.json` format example, preventing AI from using incompatible key names

## [2.6.10] - 2026-03-16

### Fixed
- **Tray "Check for Updates" freeze (for real)** — when no windows exist, a temporary hidden window is created as the dialog parent, preventing macOS app-modal dialog from freezing the process

## [2.6.9] - 2026-03-16

### Fixed
- **WebCraft scroll preservation** — iframe no longer resets scroll position when unrelated file changes occur; `srcDoc` React prop removed in favor of imperative-only updates with content equality check
- **File watcher noise** — added default ignore list for OS junk (`.DS_Store`, `Thumbs.db`), editor swap files (`*.swp`, `*~`, `#*#`), VCS directories (`.git/`), IDE metadata (`.idea/`, `.vscode/`), and Pneuma internals (`.pneuma/`, `.claude/`, `.agents/`)

### Improved
- **ResizeObserver efficiency** — container size updates are rounded and deduplicated, preventing unnecessary re-renders from sub-pixel changes

## [2.6.8] - 2026-03-16

### Fixed
- **Tray "Check for Updates" freeze** — update dialogs now attach to a visible parent window; if launcher is hidden it's shown first, preventing macOS app-modal dialog from freezing the process

## [2.6.7] - 2026-03-16

### Fixed
- **Desktop auto-update 404** — release artifact filenames now use consistent `Pneuma-Skills` naming (no spaces/dots) so `latest-mac.yml` URLs match actual GitHub Release assets

## [2.6.6] - 2026-03-16

### Fixed
- **WebCraft hash anchor navigation** — clicking `href="#section"` links in preview iframe no longer triggers "MacOS does not support sending non-regular files" error; anchor links now scroll in-place via injected `scrollIntoView` handler instead of navigating away from srcdoc
- **Content route resilience** — `/content/*` endpoint now rejects empty paths and non-regular files (directories) with 404 instead of crashing

## [2.6.5] - 2026-03-15

### Fixed
- **Auto-updater silent failures** — download errors were silently swallowed because `isCheckingForUpdates` was reset before download completed; now properly shows error dialog on download failure
- **Auto-updater logging** — enabled `electron-updater` console logging for diagnosing update issues

### Added
- **Tray download progress** — tray icon shows download percentage (`↓ 42%`) during update download, and "Update ready" tooltip when complete

## [2.6.4] - 2026-03-15

### Added
- **WebCraft screenshot export** — "Screenshot PNG" button on the export page captures all pages as full-height images via snapdom, stitches them vertically, and downloads as a single long PNG
- **Local snapdom vendor route** — `/vendor/snapdom.js` serves snapdom from node_modules, eliminating CDN dependency for export pages

## [2.6.3] - 2026-03-12

### Fixed
- **Light mode scrollbars** — scrollbar colors now properly follow light/dark theme switching across all child elements

### Added
- **macOS code signing & notarization** — desktop builds are now signed with Developer ID and notarized with Apple, eliminating Gatekeeper warnings
- **CI signing pipeline** — GitHub Actions workflow imports signing certificate and notarizes macOS builds automatically

## [2.6.2] - 2026-03-12

### Improved
- **Documentation hierarchy** — restructured `docs/` into `design/`, `reference/`, `adr/`, and `archive/` with clear lifecycle rules
- **CLAUDE.md accuracy** — fixed stale content: missing builtin modes (webcraft, illustrate), outdated "dual WebSocket" references, missing API endpoints, chokidar version
- **Root file roles** — clarified `CLAUDE.md` (Claude Code) vs `AGENT.md` (Codex/other agents) as same-role files for different backends
- **3.0 design document** — initial design for AI-native micro-app platform with app layout and agent bubble

## [2.6.1] - 2026-03-12

### Fixed
- **CI test failures** — updated test expectations for Codex `modelSwitch: true` and backend-aware skill install (no `CLAUDE.md` for Codex sessions)

## [2.6.0] - 2026-03-12

### Added
- **Codex agent backend** — full OpenAI Codex integration via `app-server` stdio JSON-RPC transport, including session lifecycle, streaming, permission approval, and file change tracking
- **Dynamic model switching for Codex** — fetches available models from Codex `model/list` API, applies selected model per-turn via `turn/start` params
- **Codex slash commands** — fetches skills from Codex `skills/list` API and populates the composer's "/" menu dynamically
- **Backend availability detection** — launcher checks if CLI binaries (`claude`/`codex`) exist on PATH and grays out unavailable backends in session cards and launch dialog
- **Backend-aware skill installation** — skills install to `.agents/skills/` with `AGENTS.md` for Codex, `.claude/skills/` with `CLAUDE.md` for Claude Code

### Fixed
- **Codex session crash** — adapter's partial session state (missing `agent_capabilities`) was broadcast directly to browser, causing React crash in ModelSwitcher; now merges with server's full state before broadcasting
- **Cross-platform PATH delimiter** — Codex CLI launcher now uses `node:path` delimiter instead of hardcoded `:`

### Improved
- **ModelSwitcher** — rewritten to be backend-agnostic with dynamic model list support from `SessionState.available_models`
- **Launcher backend picker** — compact pill-style buttons with backend logos, auto-selects first available backend
- **Session cards** — show unavailable overlay with reason when backend CLI is not found

## [2.5.5] - 2026-03-11

### Improved
- **Dependency upgrades** — Electron 35→41, Vite 6→7, chokidar 4→5, @vitejs/plugin-react 4→5, electron-builder and electron-updater to latest
- **Thumbnail capture quality** — rewrote image capture strategy to use high-resolution source images (e.g. slide thumbnails at native 2560×1440) instead of compositing from small display sizes

### Fixed
- **Evolve mode fails to launch** — launcher now passes `targetMode` via initParams so the evolve CLI knows which mode to analyze
- **Vite 7 HMR** — updated `server.ws.send` to `server.hot.send` for workspace file change notifications

## [2.5.4] - 2026-03-11

### Fixed
- **Windows ARM64 desktop build** — electron-builder config listed both x64 and arm64 under one target, causing the x64 CI job to build both archs and the ARM64 job to fail on duplicate asset upload; each CI job now builds only its own arch

## [2.5.3] - 2026-03-11

### Fixed
- **Desktop app fails to start** — CLI update checker blocked Electron startup with an interactive prompt; now skipped in non-interactive mode (`--no-prompt`)

## [2.5.2] - 2026-03-11

### Improved
- **CI actions** — upgraded `actions/checkout` and `actions/setup-node` from v4 to v5 for Node.js 24 compatibility

## [2.5.1] - 2026-03-11

### Added
- **Desktop frameless launcher** — hidden title bar with macOS traffic lights, custom drag region on header
- **Tray icon redesign** — logo intaglio (white circle + logo cutout), high visibility on both light and dark menu bars
- **Tray session switcher** — live running session list fetched from launcher API, click to activate window
- **Close window → kill session** — closing a mode window in Electron automatically kills the corresponding session process
- **Window reuse** — opening the same session URL reuses the existing window instead of creating duplicates
- **Splash loading screen** — solid-background splash with animated logo while launcher starts

### Fixed
- **Production image 404** — SPA fallback was intercepting `/content/*` requests, returning `index.html` instead of workspace files; added path exclusions for `/content/`, `/api/`, `/ws/`, `/export/`
- **Production logo 404** — static file catch-all now serves all `dist/` files, not just `/assets/*`
- **Desktop tray icons missing in packaged app** — added tray icon files to `extraResources` in electron-builder config

### Improved
- **Tray menu** — left-click and right-click both show menu (previously left-click opened launcher directly)
- **Desktop icons** — regenerated all icons (icns, ico, png, tray) from new logo

## [2.5.0] - 2026-03-11

### Added
- **Launcher redesign** — editorial layout with mode showcase system (carousel images per mode), light/dark theme toggle, sticky header with animated close button
- **Smart thumbnail capture** — generic 3-tier strategy (canvas → img elements → snapdom) eliminates per-viewer captureViewport implementations; works for Excalidraw, React Flow, and DOM-based viewers automatically
- **Session card animations** — framer-motion powered transitions for running/recent state changes in Continue section
- **Mode showcase system** — `showcase/` directories with curated images for each builtin mode, displayed in LaunchDialog carousel

### Improved
- **Gallery card expand/collapse** — replaced janky grid-template-rows with height-based animation using RAF measurement for silky smooth transitions
- **LaunchDialog** — theme-aware showcase captions, vertically centered form layout, streamlined button styling
- **Overlay system** — Gallery and AllSessions render below sticky header with Escape key dismissal and animated header close button; removed redundant per-overlay close buttons
- **Thumbnail refresh** — debounce reduced from 30s to 10s with dedup (skip upload if identical to last capture)
- **UI polish** — globally disabled image dragging, focus outlines, and logo text selection; light/dark aware running badge; compact header with centered content

## [2.4.10] - 2026-03-10

### Improved
- **Slide skill reference restructuring** — merged `style_reference.md` and `aesthetics.md` into a single `references/design-guide.md` following progressive disclosure pattern; extracted refinement practices into `references/refinement.md`; moved `layout_patterns.md` and `design_outline_template.md` into `references/` for consistency
- **Slide SKILL.md** — rewritten Supporting Reference Documents section with clear "when to read" guidance for each reference file; all internal cross-references updated to new paths

### Removed
- **Redundant slide skill files** — deleted `style_reference.md`, `references/aesthetics.md`, top-level `layout_patterns.md`, and `design_outline_template.md` (content merged into new reference structure)

## [2.4.9] - 2026-03-10

### Added
- **Slide mode aesthetics guide** — new `references/aesthetics.md` with design thinking for typography selection, OKLCH color theory, visual hierarchy, presentation writing, and AI image usage (conditionally loaded when image generation is enabled)
- **Slide refinement workflow** — six refinement practices (critique, polish, distill, bolder, quieter, colorize) adapted for the fixed-viewport slide context, triggered by natural language requests

### Improved
- **Slide style reference** — default color palettes and font stacks now reference the aesthetics guide for intentional customization; design philosophy reframed from prescriptive ("Apple HIG minimalism") to principle-based ("intentional and coherent")
- **Slide core principles** — added "Design with intention" as a first-class principle with link to aesthetics reference

## [2.4.8] - 2026-03-10

### Fixed
- **Mode Maker play on `bunx`** — seed `package.json` Vite toolchain moved to `dependencies` (not devDeps) so they're installed; `vite.config.ts` React alias uses `require.resolve` for hoisted node_modules; all frontend deps restored to root `dependencies` (Vite dev mode needs them at runtime)
- **macOS desktop build** — switched from universal to arm64-only; universal merge fails with native binaries (esbuild) because `prepare-deps` runs on a single architecture; also removed `.bin/` symlinks from bundled node_modules
- **macOS desktop build failure** — `prepare-deps.mjs` recursively removes all `.bin/` directories from production node_modules; broken symlinks in nested `.bin/` crashed electron-builder's universal merge
- **Desktop `.gitignore` typo** — removed duplicate trailing slash in `pneuma-node-modules//`

## [2.4.4] - 2026-03-10

### Fixed
- **Mode Maker play crash on `bunx`** — `vite.config.ts` React alias used hardcoded `node_modules/react` path which doesn't exist when dependencies are hoisted; switched to `require.resolve` for correct resolution in any install layout

## [2.4.3] - 2026-03-10

### Fixed
- **Mode Maker play/test 404 on `bunx`** — moved Vite toolchain from `devDependencies` to `dependencies` in seed `package.json` so they're actually installed when creating a new mode; added `src/` and `vite.config.ts` to npm `files` array so Vite dev server can resolve the entry point
- **Desktop `.gitignore` typo** — removed duplicate trailing slash in `pneuma-node-modules//`

### Improved
- **Dependency hygiene** — moved mode-specific deps (`@xyflow/react`, `@excalidraw/excalidraw`, `@dnd-kit/*`, `@zumer/snapdom`, `@tailwindcss/typography`) from root `dependencies` to `devDependencies`; they're bundled into `dist/` at publish time and don't need runtime installation

## [2.4.2] - 2026-03-10

### Added
- **Windows ARM64 desktop build** — NSIS installer for Windows on ARM (Snapdragon laptops etc.)

## [2.4.1] - 2026-03-10

### Fixed
- **Illustrate skill not activating** — updated SKILL.md description to use the "Use for ANY task in this workspace" trigger pattern, so Claude Code's skill matching loads it on first interaction
- **Illustrate claudeMdSection too thin** — added Architecture and AI Image Generation sections with command reference so the agent has enough context even without the skill loaded

### Improved
- **Blog-heroes seed images** — regenerated all 5 images with cinematic Pneuma aesthetic (dark background, orange particles, glassmorphism, volumetric lighting)

## [2.4.0] - 2026-03-10

### Added
- **Illustrate mode** — new builtin mode with React Flow canvas viewer, AI image generation skill (OpenRouter/fal.ai), 3 seed content sets (pneuma-brand, feature-cards, blog-heroes) with 16 generated images
- **Viewer locator system** — `<viewer-locator>` tags in agent messages render as clickable navigation cards; supports cross-content-set navigation with auto-detection and prefix stripping
- **Resilient manifest parsing** — `useResilientParse` hook catches JSON parse errors and notifies agent instead of crashing viewer
- **Debug locator payload** — collapsible JSON payload display under locator cards in `--debug` mode

### Fixed
- **Binary seed file corruption** — seed copy now skips UTF-8 template param processing for image/font/media files
- **Illustrate image error handling** — shows "Not yet generated" placeholder instead of infinite "Loading..." when images are missing
- **Slide context fallback** — `extractContext` falls back to first slide when no selection exists
- **Content set context filtering** — `ws.ts` filters files by active content set and strips prefixes before passing to viewer

### Improved
- **Desktop setup wizard** — larger window (720x600), platform-specific install instructions
- **React Flow fitView** — `requestAnimationFrame` wrapper ensures internal store sync before `fitView` calls

## [2.3.9] - 2026-03-10

### Added
- **Content set context** — active content set (label + prefix) is now injected into `<viewer-context>` for all modes, so the agent knows which content variant the user is viewing

## [2.3.8] - 2026-03-10

### Fixed
- **Mode Maker fork** — builtin mode import now rewrites escaping relative imports (`../../../src/store.js`) to correct paths, so forked viewers resolve correctly
- **Mode Maker play** — always use Vite dev mode to prevent Zustand store duplication from Bun.build bundling `src/store.ts` separately
- **External mode resolve** — Vite plugin and Bun.build plugin now redirect both `/src/` and `/core/` imports to pneuma project root (previously only `/core/`)
- **react-dom vendor shim** — export `createPortal`, `flushSync`, `createRoot`, `hydrateRoot` as named exports for production external mode bundles
- **Mode name validation** — sanitize input to only allow lowercase letters, numbers, and hyphens

## [2.3.7] - 2026-03-10

### Fixed
- **macOS code signing** — set `identity: null` to skip code signing in CI (no Apple Developer certificate)

## [2.3.6] - 2026-03-10

### Fixed
- **Desktop version sync** — `prepare-deps` script now auto-syncs root `package.json` version into desktop `package.json`, ensuring local and CI builds use the correct version

## [2.3.5] - 2026-03-10

### Fixed
- **Windows desktop build** — replaced `renameSync` with `copyFileSync` in Bun download script to avoid `EXDEV` cross-device error on CI
- **Linux deb package** — added required `author` and `homepage` fields to desktop `package.json`

## [2.3.4] - 2026-03-10

### Fixed
- **Desktop CI** — added missing `tsup` build step to compile Electron main/preload TypeScript before packaging

## [2.3.3] - 2026-03-10

### Fixed
- **Desktop production build** — pruned node_modules to production-only dependencies (8 packages / 5MB instead of 551 / 230MB), fixing missing transitive deps and bloated DMG size
- **App icons** — added proper icon set (icns/ico/png) and tray icons generated from helix logo

## [2.3.2] - 2026-03-09

### Fixed
- **macOS desktop build** — replaced deprecated `macos-13` runner with universal build on `macos-latest` (single DMG for both ARM64 and Intel)

## [2.3.1] - 2026-03-09

### Fixed
- **Desktop CI** — merged desktop build into `release.yml` as a dependent job (GitHub Actions tokens can't trigger cross-workflow events)

## [2.3.0] - 2026-03-09

### Added
- **Electron desktop client** — cross-platform native app wrapping the full Pneuma runtime
  - Bundles Bun binary per platform — no runtime install required for end users
  - Claude CLI detection with guided setup wizard
  - System tray app: left-click opens launcher, right-click shows sessions/updates/quit menu
  - Launcher window (80% screen) + maximized mode session windows
  - Native OS folder picker for workspace selection (Electron), fallback to in-page browser (web)
  - macOS app menu with About dialog and GitHub link
  - Auto-updater via `electron-updater` + GitHub Releases (download progress bar, restart prompt)
- **Desktop CI workflow** — `desktop.yml` builds on GitHub Release for macOS arm64/x64, Windows x64, Linux x64
  - DMG + ZIP (macOS), NSIS installer (Windows), AppImage + deb (Linux)
  - Artifacts uploaded to the same GitHub Release as the npm package

## [2.2.1] - 2026-03-09

### Fixed
- **Export white screen** — `</script>` in page HTML no longer breaks the export preview's JSON script block
- **Download HTML** — returns the original page with inlined assets instead of the export wrapper
- **Vite proxy for `/export`** — export routes now correctly proxied in dev mode

### Added
- **Viewer position persistence** — `activeContentSet` + `activeFile` saved to `.pneuma/viewer-state.json` and restored on session resume

## [2.2.0] - 2026-03-09

### Added
- **WebCraft Mode** — new builtin mode for live web development with [Impeccable.style](https://impeccable.style) AI design intelligence
  - 17 AI design commands: Audit, Critique, Polish, Bolder, Colorize, Animate, Distill, Clarify, Optimize, Harden, Delight, Extract, Adapt, Onboard, Normalize, Quieter, Teach Impeccable
  - Responsive viewport presets (Mobile/Tablet/Desktop/Full), element selection, annotation mode
  - Export: Download HTML (self-contained with inlined assets), Download ZIP, Print/PDF
  - Two seed sites: Pneuma project showcase (dark/light toggle, parallax, scroll-reveal) and The Gazette (newspaper editorial with AI-generated illustrations)
- **Centralized viewer context enrichment** — all message paths to CLI agent auto-prepend `<viewer-context>` with active content set, file, and viewport info
- **Content set import guidance** — agent instructions for webcraft & slide: imported content always goes into a new content set to preserve seeds and enable switching/comparison

### Fixed
- False "Scheduled task" labels on history page reload
- Content set ordering now preserves filesystem discovery order (not alphabetical)
- Impeccable commands now include viewer context (content set + active file)
- Annotate mode in WebCraft works correctly (popover UI for contextual comments)

### Improved
- Launcher widened to 4 cards per row, builtins reordered: webcraft > slide > doc > draw
- Updated all mode descriptions to highlight key features and positioning
- Unread indicator on content set selector when files change in inactive sets

## [2.1.1] - 2026-03-09

### Added
- **Schedules tab** — view and manage cron/loop scheduled tasks from a dedicated top-level tab
  - Job list with prompt, schedule, recurring/one-shot/durable badges
  - Cancel and refresh buttons (agent-mediated)
  - Badge count on tab header
- **Cron trigger visual indicator** — "SCHEDULED TASK" bubble before each cron-triggered turn showing the job's prompt
- **Claude Code version check** — warns in Schedules tab if CC version is below 2.1.0 (cron minimum)
- **Cron protocol documentation** — full reverse-engineered docs for CronCreate/CronDelete/CronList

### Fixed
- **Cron job extraction** — use optimistic tool_use extraction since SDK stream does not forward tool_result blocks

## [2.1.0] - 2026-03-09

### Improved
- **Skill effectiveness optimization** — all 5 builtin skills refined based on Anthropic skill-creator best practices
  - Added Pneuma identity to claudeMdSection (doc/draw/slide) for co-creation workspace context
  - `<system-info>` tag in greetings for natural skill association at session start
  - Trimmed generic knowledge from SKILL.md bodies, extracted heavy references to `references/` files
  - Added "why" explanations to constraints for better LLM compliance
  - Broadened SKILL.md descriptions for wider trigger coverage
- **Slide content set workflow** — new presentation tasks create a new top-level directory instead of overwriting seed content
- **Evolution agent** — embeds current skill content in system prompt, briefing-first interaction protocol, installs target mode skill in evolve workspace

## [2.0.0] - 2026-03-06

### Added
- **Evolution Agent** — AI-native continuous skill learning system. Analyzes cross-session conversation history to extract user preferences, generates proposals with evidence citations, and augments skill files. Modes declare an `evolution.directive` in their manifest to guide the analysis direction.
  - `pneuma evolve <mode>` CLI command to launch the evolution agent
  - Evolve Mode (`modes/evolve/`) with dashboard viewer for proposal review
  - Proposal lifecycle: pending → apply/rollback/discard/fork
  - Fork proposals into standalone custom modes (`~/.pneuma/modes/<name>-evolved-<date>/`)
  - Automatic CLAUDE.md sync — "Learned Preferences" section injected on apply, removed on rollback
  - Session analysis tools: list sessions, search messages, session digest, tool flow extraction
  - Evolution API routes (`/api/evolve/*`) for proposal management
- **`EvolutionConfig`** contract — new optional `evolution` field on `ModeManifest` with `directive` and `tools`
- **Skill effectiveness optimization** — standardized `claudeMdSection` across all built-in modes following Anthropic best practices (identity → skill reference → core rules pattern)
- **YAML frontmatter** on doc and draw SKILL.md files for Claude Code native skill discovery
- **Mode-maker seed improvements** — expanded skill template with structured sections, YAML frontmatter placeholders, and claudeMdSection best practices guidance

### Changed
- Slide mode claudeMdSection directs agent to use native skill tool instead of file path reference
- Doc mode SKILL.md expanded from 24 to ~95 lines with workflow patterns and markdown conventions

## [1.18.9] - 2026-03-06

### Fixed
- **Chat input IME conflict**: Enter key now checks `isComposing` to avoid sending messages while selecting Chinese/Japanese/Korean IME candidates

## [1.18.8] - 2026-03-06

### Fixed
- **Bun.build resolve plugin bundles React**: The `onResolve` plugin with `/.+/` filter was resolving React/ReactDOM to file paths via `require.resolve`, bypassing the `external` option and bundling them into the output (89KB → 34KB)

## [1.18.7] - 2026-03-06

### Added
- **Third-party dependency support for custom modes**: Modes can now use any npm package; dependencies auto-installed on seed and inlined at publish via `Bun.build()`
- **Mode build pipeline** (`snapshot/mode-build.ts`): Shared build module used by both UI publish and CLI publish to produce self-contained bundles
- **CSS support in production mode serving**: Compiled mode bundles can include CSS files, served with correct content type and injected via `<link>` tags
- **Network topology documentation** (`docs/network-topology.md`): Comprehensive developer reference for ports, scenarios, and connection diagrams
- **Seed `package.json`** for mode-maker: New modes start with `react-markdown` and `remark-gfm` as default dependencies

### Fixed
- **Production mode-maker Play**: Play subprocess no longer forces `--dev` in production; uses `Bun.build()` compilation instead of Vite when parent is not in dev mode
- **Bun.build resolve plugin**: Handles macOS `/tmp` → `/private/tmp` symlinks via `realpathSync`, uses `/.+/` filter for reliable bare specifier matching, and resolves imports from both mode workspace and project `node_modules`
- **Pre-built bundle detection**: Skips recompilation when `.build/pneuma-mode.js` already exists (published modes)
- **Publish pre-build step**: Both UI and CLI publish now build viewer bundle before creating archive, then clean `.build/` from workspace

### Improved
- **Protected directories**: `.build/` added to mode-maker's protected dirs to prevent accidental deletion
- **Mode-maker skill docs**: Added "Third-Party Dependencies" section explaining npm package usage in modes

## [1.18.6] - 2026-03-06

### Fixed
- **External mode import resolution in Vite**: `pneumaWorkspaceResolve` plugin now handles `PNEUMA_EXTERNAL_MODE_PATH` in addition to mode-maker workspace, fixing white screen when Play loads external mode files with relative `core/` imports

## [1.18.5] - 2026-03-06

### Fixed
- **Mode-maker Play port collision**: Play subprocess now uses dedicated ports (backend 18997, Vite 18996) to avoid conflicts with the parent instance
- **Play subprocess hang**: Added `--no-prompt` flag to prevent interactive prompt blocking when stdout is piped
- **Play fallback URL**: Fixed fallback URL to use Vite port instead of backend port

### Improved
- **Launcher dialog**: Added explicit close button, timestamp in default workspace path, auto-sync displayName from modeName
- **Vite dev watcher**: Excluded `.claude/worktrees/` from file watching to prevent spurious reloads

## [1.18.4] - 2026-03-05

### Fixed
- **Viewer action curl uses `$PNEUMA_API` env var**: no more hardcoded port in CLAUDE.md; base URL injected at agent launch time, works across port changes and session resume
- **Scaffold scoped to current view**: doc mode only clears viewed files, draw mode only clears active canvas (not all files matching glob)
- **Scaffold protects system files**: `.claude/`, `.pneuma/`, `CLAUDE.md`, `.gitignore`, `.mcp.json` are never deleted by scaffold clear
- **Scaffold content set support**: optional `contentSet` param scopes clear and file writes to a subdirectory (slide mode passes `activeContentSet`)
- **Doc mode hardcoded port**: `saveFile` and scaffold API calls use `VITE_API_PORT` instead of `localhost:17007`

## [1.18.3] - 2026-03-05

### Fixed
- **ScaffoldConfirm not visible in launcher**: use `createPortal` to `document.body` in slide/draw/doc modes to escape `backdrop-filter` containing block
- **Slide navigator crash**: remove leftover `getSrcdoc` reference from vertical layout (pre-existing bug from Safari fallback cleanup)
- **Duplicate React key warnings**: deduplicate assistant messages in server `messageHistory` to prevent duplicate entries on page load/reconnect
- **Doc mode edit not saving in launcher**: use `VITE_API_PORT` instead of hardcoded `17007` for `saveFile` and scaffold API calls

## [1.18.2] - 2026-03-05

### Fixed
- **Slide export 404 in launcher**: use `VITE_API_PORT` instead of hardcoded `17007` so child processes resolve the correct backend port
- **Slide export trailing blank page**: add `break-after: auto` on last slide to prevent extra page when printing
- **Slide export print guard**: disable Print button while image conversion is in progress
- **Debug payload display**: replace modal with inline collapsible panel to avoid `backdrop-filter` containing block issue

## [1.18.1] - 2026-03-05

### Added
- **Launcher: Mode Maker card** — special full-width card with shimmer border animation between built-in and local modes
- **Launcher: GitHub link** — repo link in header area
- **Launcher: Directory browser** — Browse button on workspace path inputs with inline directory navigator (breadcrumbs, dir list, Select)
- **Launcher: Existing workspace detection** — auto-loads config params and locks them read-only when selecting a directory with `.pneuma/session.json`
- **Launcher: "Open in Mode Maker" button** — local mode cards have a wrench icon to open in Mode Maker
- **Mode Maker: Import dialog upgrade** — card-based UI with icons and source badges, Modes + URL tabs
- **Mode Maker: URL import** — download tar.gz from URL, extract to `~/.pneuma/modes/`, and fork into workspace
- **Server: `GET /api/browse-dirs`** — filesystem directory browsing for workspace path picker
- **Server: `GET /api/workspace-check`** — detect existing sessions and load config

### Changed
- **Mode Maker seed templates** — synced with latest architecture: icon placeholder, serveDir, topBarNavigation, resolveItems, createEmpty
- **Mode Maker SKILL.md** — added icon format docs, workspace model section, supportsContentSets, updated mode examples
- **Mode Maker import** — `GET /api/mode-maker/modes` now scans both builtin and `~/.pneuma/modes/` local modes
- **Mode Maker version** — bumped to 1.1.0 with icon

### Fixed
- **Local mode workspace path** — extract mode name from path instead of using full absolute path
- **LaunchDialog init params** — hidden when defaultWorkspace is provided (existing content won't be re-seeded)

## [1.17.0] - 2026-03-05

### Added
- **Inline AskUserQuestion** — moved from floating overlay into the chat message stream; interactive picker when pending, collapsed `<details>` summary when answered, with per-question-answer pair rendering
- **Mode icons as manifest property** — `icon` field on `ModeManifest` (inline SVG string), parsed via `extractBacktickString()` in manifest-parser, served through `/api/registry`; Launcher renders data-driven icons via `ModeIcon` component
- **Custom Warm Craft CodeMirror theme** — editor panel uses project design tokens instead of default dark theme

### Changed
- **TopBar redesign** — floating pills layout, agent status indicator moved to chat area
- **Launcher visual overhaul** — gradient animations, glassmorphism cards, hover micro-interactions
- **Registry endpoint refactored** — builtins now dynamically parsed from manifest.ts files instead of hardcoded metadata
- **README refresh** — updated positioning, built-in modes table, screenshot

### Fixed
- **Slide seed overflow** — dark/light theme h1 line-height, slide-02 content trimming across all 4 variants (en/zh × light/dark)
- **Curly quote sanitization** — smart quotes in HTML attributes sanitized at render time
- **Slide export with content sets** — correct workspace resolution for content set directories
- **Print CSS Chrome hang** — strip expensive CSS effects (box-shadow/filter) that caused Chrome print renderer to hang; softer fallback preserving glass effects
- **Doc mode gray icon** — key mismatch `"document"` vs `"doc"` caused fallback; now driven by manifest data
- **Launcher --dev/--debug passthrough** — child processes spawned by launcher inherit dev mode and debug flags
- **AskUserQuestion stale replay** — prevent ghost questions on page refresh, hide empty assistant bubbles

## [1.16.0] - 2026-03-05

### Added
- **Launcher process management** — track child pneuma processes spawned by `/api/launch`; new `GET /api/processes/children` and `POST /api/processes/children/:pid/kill` endpoints; launcher SIGINT/SIGTERM handlers kill all tracked children (no more orphaned processes)
- **Running panel** — launcher UI shows running instances alongside recent sessions in a side-by-side grid layout, with RunningCard component (green pulse indicator, Open/Stop actions, 3s polling)

### Changed
- **Next-gen visual design** — darker zinc palette (`#09090b` bg), neon orange primary (`#f97316`), glassmorphism surfaces with backdrop-blur, mesh gradient backgrounds, refined animations across all components
- **Visual design spec** — added `docs/visual-design-spec.md` documenting the new design system

### Fixed
- **AskUserQuestion bypass** — `AskUserQuestion` now always requires user interaction even in `bypassPermissions` mode

## [1.15.0] - 2026-03-05

### Added
- **Content Set system** — directory-based workspace variants (e.g. slide decks in `en-dark`/`zh-light`), auto-selected by user locale/theme preferences, switchable via TopBar dropdown
- **Unified TopBar navigation** — workspace items and content sets rendered in TopBar left side, driven by each viewer's `topBarNavigation` flag; Doc mode's internal FileTabBar removed
- **`createEmpty` protocol** — "+" button in TopBar creates new content per mode: new file (doc/draw) or new deck directory (slide, inherits theme from existing deck)
- **Draw mode multi-file** — upgraded from single-file to multi-file workspace with file selector and "+" support
- **Slide seed content sets** — seed restructured into 4 variants: en-dark, en-light, zh-dark, zh-light

### Fixed
- **Windows: launcher default path** — use absolute `homeDir` instead of `~/` which Windows shells can't expand
- **Windows: slide blank screen** — normalize file paths to forward slashes at server source points (`path.relative()` and `Bun.Glob` return backslashes on Windows); all frontend path matching silently failed
- **File watcher missed .json/.css** — `extractWatchExtensions` now correctly handles glob patterns like `**/manifest.json`
- **Hidden dirs in content sets** — content set resolver skips `.`-prefixed directories (`.pneuma`, `.claude`)

## [1.14.3] - 2026-03-04

### Fixed
- **Windows compatibility** — added `win32` platform branches across 9 core files: PATH resolution (`delimiter`, `where`, Windows candidate dirs), terminal shell (`COMSPEC`/`cmd.exe`), browser opener (`cmd /c start`), process management (graceful degrade), path security checks (case-insensitive), `/dev/null` → `NUL`, `basename()` for cross-platform path extraction

## [1.14.2] - 2026-03-04

### Fixed
- **Launcher default URL** — bare URL (`http://localhost:17996/`) now opens the Launcher directly, no `?launcher=1` param needed
- **Launch in new tab** — launching a mode from Launcher opens it in a new tab instead of navigating away, keeping the Launcher available
- **"Launching..." state stuck** — SessionCard now properly resets its loading state after launch completes
- **Frontend deps moved to devDependencies** — reduced `bunx` install from ~500 packages to ~7 (all frontend code already bundled in `dist/`)

## [1.14.1] - 2026-03-04

### Fixed
- **Slide auto-fit zoom** — slide viewer now defaults to continuous auto-fit mode, adapting zoom to container size via ResizeObserver. Fixes horizontal scrollbar on small screens (#28)
- **Panel ratio** — adjusted default split to 65/35 (viewer/chat) for more preview space

## [1.14.0] - 2026-03-04

### Added
- **Mode Marketplace Launcher** — running `pneuma` with no arguments opens a browsable UI for discovering and launching modes from the registry
- **`--no-prompt` CLI flag** — skip interactive prompts, used internally by the marketplace launcher to streamline mode launch
- **Registry index auto-update** — `pneuma mode publish` now automatically updates `registry/index.json` with the published mode metadata
- **Launcher server routes** — new `/api/registry`, `/api/launch/prepare`, `/api/launch` endpoints for marketplace browsing and mode launch orchestration
- **Launcher UI component** — `Launcher.tsx` marketplace interface with search, mode cards, and launch configuration dialog
- **Local mode management** — scan `~/.pneuma/modes/` and display user-installed modes in Launcher with inline delete
- **`pneuma mode add <url>`** — CLI command to download and install remote modes locally
- **Session history** — track launched sessions in `~/.pneuma/sessions.json`, display "Recent Sessions" in Launcher with one-click resume
- **Skill update detection** — on session resume, detect mode version changes and prompt for skill update (with dismiss/skip support)
- **`--skip-skill` CLI flag** — skip skill installation on launch, used when resuming sessions with dismissed skill updates
- **Warm Craft design theme** — updated UI with warm copper/sand palette, rounded corners, and refined typography

## [1.13.2] - 2026-03-03

### Fixed
- **JSX dev runtime shim** — Bun.build v1.3+ emits `jsxDEV` (dev runtime) even in production builds. The vendor shim now maps `jsxDEV` to `jsx` from the production runtime, fixing "jsxDEV is not a function" errors in external mode viewers.
- **Dev mode compatibility** — added Vite plugin to mark `/mode-assets/` and `/vendor/` URLs as external during dev transforms, preventing import analysis errors.

## [1.13.1] - 2026-03-03

### Fixed
- **Production external mode loading** — viewer no longer shows "Loading" forever when running published modes via `bunx`. External mode viewer components are now pre-compiled with `Bun.build()` at startup, served as ES modules with React resolved via import maps and vendor shims.

## [1.13.0] - 2026-03-03

### Added
- **Mode publish API** — `POST /api/mode-maker/publish` endpoint with structured error codes (VALIDATION_ERROR, NO_CREDENTIALS, VERSION_EXISTS)
- **CLI mode subcommands** — `mode publish` and `mode list` for publishing and listing mode packages on R2
- **URL mode resolution** — run published modes via `https://*.tar.gz` specifier
- **Mode archive utility** — `createModeArchive()` for packaging mode source files

### Changed
- **Overview tab redesign** — AI-native Package Structure cards with content-aware summaries, expandable detail panels (Manifest fields, Mode Definition bindings, Skill heading outline), and click-to-navigate (Viewer → Preview, Seed → Preview)
- Default workspace path in run command: `~/pneuma-projects/{mode-name}-workspace`
- Publish success UI shows copyable run command instead of raw URL

## [1.12.0] - 2026-03-03

### Added
- **Mode Maker** — builtin mode for creating new Pneuma modes, with live dashboard viewer, skill reference, seed templates, and Vite workspace resolve plugin
- **MCP server declarations** — modes can declare MCP tool servers in manifest; auto-installed to workspace `.mcp.json` with idempotent managed-entry tracking
- **Skill dependencies** — modes can bundle external skills; auto-copied to `.claude/skills/` with template params and CLAUDE.md injection
- **File attachments** — chat input accepts any file type (not just images); files saved to `.pneuma/uploads/`, small text files inlined in agent message
- **System Bridge API** — `/api/system/open`, `/api/system/open-url`, `/api/system/reveal` endpoints for viewer-triggered OS operations with path traversal protection
- **Smart init defaults** — derive `modeName`/`displayName` from workspace directory name
- **Agent env mapping** — pass `envMapping` init param values as agent process environment variables

### Changed
- CLI parses Vite stdout for actual port instead of assuming fixed port
- Snapshot archive excludes `.mcp.json` (regenerated on startup)

## [1.11.0] - 2026-03-03

### Added
- **Doc annotate mode** — popover-based comment UX for markdown elements with CSS selector path, human-readable label, and nearby text context
- **Doc user action tracking** — line-level diff tracking for markdown editor edits (additions, deletions, changes)
- **Draw annotate mode** — select Excalidraw elements to add comments via popover, with element thumbnail capture
- **Draw user action tracking** — element-level diff tracking for canvas edits (additions, deletions, text changes)
- **Draw richer select context** — human-readable labels for selected Excalidraw elements

### Fixed
- **Draw view mode** — use Excalidraw native `viewModeEnabled` for proper pan/zoom (was blocked by overlay div)

### Changed
- Doc and draw `extractContext` updated with annotation and label-based context support
- All three built-in modes (slide, doc, draw) now have consistent View / Edit / Select / Annotate modes

## [1.10.0] - 2026-03-03

### Added
- **Workspace scaffold actions** — modes can declare initialization actions (e.g. "Create slide deck"), with confirmation UI and template-based workspace creation
- **User action event stream** — user operations (text edits, slide reorder, deletions) tracked via `pushUserAction()` and injected as `<user-actions>` XML into agent messages
- **Viewer → agent notification channel** — viewer can proactively push notifications to the agent (e.g. content overflow warnings) via WebSocket bridge
- **Slide auto-fit** — automatic CSS transform scaling when slide content overflows the viewport
- **Slide select mode** — click elements in iframe to get rich context (tag, classes, CSS selector, thumbnail, nearby text, accessibility info)
- **Slide annotate mode** — popover-based comment UX for marking up elements across multiple slides, structured annotation extraction for agent context
- **Slide edit mode** — inline contentEditable text editing inside iframes, debounced save with diff-formatted action descriptions, two-click slide deletion pattern
- **`--dev` CLI flag** — force dev mode even when `dist/` exists, avoiding stale build issues
- **Shared iframe selection module** (`core/iframe-selection/`) — modular selection script with classify, identify, selector, thumbnail, context, and message-handler sections

### Changed
- `ViewerSelectionContext` extended with `annotations`, `selector`, `label`, `nearbyText`, `accessibility` fields
- Slide mode `extractContext` generates structured context for select, annotate, and viewing modes

## [1.9.1] - 2026-03-02

### Fixed
- Suppress React 19 peer dependency warnings via `overrides` in package.json

## [1.9.0] - 2026-03-02

### Added
- Auto-update check on startup — queries npm registry for latest version, prompts to update when major/minor differs, re-executes via `bunx pneuma-skills@{version}` on confirmation (3s timeout, silent skip on network failure)

## [1.8.0] - 2026-03-02

### Changed
- Upgraded CLI TUI from raw console.log/readline to @clack/prompts — modern terminal UI with styled intro/outro, step indicators, confirm/text prompts, and graceful cancel handling

## [1.7.3] - 2026-03-02

### Fixed
- Release workflow changelog extraction — awk regex treated `[x.y.z]` as character class; switched to `index()` for literal matching

## [1.7.2] - 2026-03-02

### Added
- GitHub Actions CI workflow for automated releases (GitHub Release + npm publish via OIDC Trusted Publishing)
- `repository`, `homepage`, `bugs` fields in package.json

## [1.7.1] - 2026-03-02

### Fixed
- Draw mode text rendering — replace `updateScene` with key-based remount to prevent Excalidraw Virgil font initialization issues
- Draw mode seed content switched to English (Virgil font lacks CJK glyph support)
- Draw mode viewing card and seed content font alignment

## [1.7.0] - 2026-03-02

### Added
- **ViewerContract v2** — Agent-Human alignment protocol with perception alignment (`<viewer-context>` XML enrichment, viewport tracking, selection screenshots) and capability alignment (ViewerActionDescriptor, bidirectional action execution channel)
- **File workspace model** — `FileWorkspaceModel` standardizes how modes organize files ("all"/"manifest"/"single"), with `WorkspaceItem` navigation and `resolveItems` runtime resolver
- **Viewer action protocol** — `ws-bridge-viewer.ts` routes action requests from agent to viewer and responses back; `POST /api/viewer/action` HTTP endpoint
- **Skill template engine** — `{{viewerCapabilities}}` auto-injects Viewer self-description into skill prompts; dual CLAUDE.md markers for skill and viewer-api sections
- **CLI debug mode** — `--debug` flag enables payload inspection; each user message shows a `{ }` icon to view enriched content + images sent to Claude Code
- **Draw mode selection screenshots** — selected elements exported as PNG via `exportToBlob`, including bound text, excluding connected arrows

### Fixed
- **Draw mode text vanishing** — skip redundant first `updateScene` that disrupted Excalidraw's Virgil font initialization
- **Draw mode view/edit/select** — CSS overlay for view mode instead of toggling `viewModeEnabled` prop; auto-switch to selection tool on entering Select mode

## [1.6.2] - 2026-03-02

### Added
- Server layer test coverage: `skill-installer`, `file-watcher`, `ws-bridge-replay`, `ws-bridge-controls`, `ws-bridge-browser` (105 new tests, 186 total)

### Fixed
- Added `@vite-ignore` to dynamic imports in `core/mode-loader.ts` to suppress Vite warnings for external mode loading
- Added 30s timeout to `runGit()` in `core/mode-resolver.ts` to prevent GitHub clone commands from hanging indefinitely

## [1.6.1] - 2026-03-01

### Changed
- Slide skill workflow: scaffold all empty slides + manifest first so the viewer shows the full deck structure immediately, then fill content slide-by-slide
- Updated CLAUDE.md, README.md with draw mode, mode-resolver, snapshot module, and accurate component/test counts

### Fixed
- Draw mode not registered in builtin mode tables (`mode-loader.ts` and `mode-resolver.ts`)

## [1.6.0] - 2026-03-01

### Added
- **Draw Mode** — Excalidraw whiteboard mode for `.excalidraw` file editing with live preview
- Remote mode loading — load custom modes from local paths (`pneuma /path/to/mode`) or GitHub repositories (`pneuma github:user/repo#branch`)
- New `core/mode-resolver.ts` for mode source resolution and GitHub clone caching (`~/.pneuma/modes/`)
- External mode registration in `core/mode-loader.ts` with support for both Bun backend and browser frontend (Vite `/@fs/` imports)
- `/api/mode-info` server endpoint for frontend external mode discovery
- Vite config `server.fs.allow` support for external mode directories
- AskUserQuestion interactive UI with option cards in PermissionBanner

### Changed
- Slide image generation script rewritten from Python (`generate_image.py`) to Node.js (`generate_image.mjs`) — zero external dependencies

### Fixed
- Slide sandboxed iframe image reload — uses meta tag injection instead of `location.reload()`

## [1.5.0] - 2026-02-28

### Added
- Self-contained HTML download for slide export — "Download HTML" button inlines all local assets (images, CSS, fonts) as base64 data URIs for fully offline viewing

### Fixed
- Export page slides not centered in viewport — body width moved to `@media print` only
- Export download failing with non-ASCII titles — RFC 5987 Content-Disposition encoding

## [1.4.1] - 2026-02-28

### Fixed
- Slide navigator thumbnails not showing images — proper URL resolution and base64 inlining for SVG foreignObject (#10)
- Grid view selected slide ring extending beyond thumbnail — removed redundant ring wrapper (#12)
- Export page losing styles: preserves `<head>` resources, `<body>` attributes, and theme background colors (#15)
- Export/print CJK text invisible — inject explicit CJK system fonts (PingFang SC, Noto Sans CJK SC, Microsoft YaHei) into `--font-sans` before `sans-serif`
- Export print missing backgrounds — add `print-color-adjust: exact` and `break-inside: avoid` for slides

### Changed
- Slide skill font guidance: `style_reference.md` and `SKILL.md` now require CJK system fonts in `--font-sans`

## [1.4.0] - 2026-02-28

### Added
- Element thumbnail capture: selected elements shown as SVG snapshots in ChatInput chip and SelectionCard
- CSS selector displayed in selection UI labels (replaces `<tag.class>` format)
- SVG icons directly selectable (added to semantic element list)

### Changed
- Simplified context sent to Claude Code: just `[User selected: <css-selector>]` instead of verbose 4-line format
- Selection bubble-up threshold lowered from 150×80 to 40×40 for better small element selection

### Fixed
- Clicking X on selection chip now clears highlight in viewer iframe (#13)
- `selector` field properly passed through full chain (iframe → store → extractContext)
- Selection with CSS selector but empty text content no longer silently dropped

## [1.3.2] - 2026-02-28

### Fixed
- Slide thumbnails missing viewport meta and base href, causing lost padding and broken assets

## [1.3.1] - 2026-02-28

### Fixed
- Default slide outline position to bottom for narrow screens (was left sidebar)
- Chat panel narrowed to 40% (from 45%), preview widened to 60%
- Arrow keys no longer captured by slide navigation when typing in input fields (#7, #8)

## [1.3.0] - 2026-02-28

### Added
- `pneuma snapshot push/pull/list` commands for workspace distribution via Cloudflare R2
- `--include-skills` flag to optionally bundle `.claude/skills/` in snapshots
- `InitParam.sensitive` field in ModeManifest — sensitive config values stripped on snapshot push
- Pull prompts before overwriting existing directory
- Pull offers to launch immediately after extraction
- Auto port retry on EADDRINUSE (up to 10 consecutive ports)
- Skill editing workflow: scope determination step (deck-wide vs single slide)

### Changed
- Slide API key params (`openrouterApiKey`, `falApiKey`) marked as `sensitive: true`
- CLI hint commands now use `bunx pneuma-skills` prefix
