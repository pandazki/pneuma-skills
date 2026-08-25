# Cloud Surfaces

> Two different ways a mode's work leaves the local app: the **hosted read-only player** (a share link renders the real viewer in a browser with no Pneuma installed) and **artifact deploy** (the mode's output is published as a live site). Two surfaces, two gates, two sets of obligations — and neither is implied by the other. Decide both while designing, because retrofitting a viewer that assumed a Bun backend is expensive. Sources: `core/player-support.ts`, `src/player/PlayerApp.tsx`, `src/replay/provider.ts`, `public/player-content-sw.js`, `server/play-export.ts`, `plugins/vercel/manifest.ts`, `plugins/cf-pages/manifest.ts`.

| Surface | What the user gets | Gate | Where the gate is read |
|---|---|---|---|
| **Hosted player** | `pneuma history share` → a `/s/<id>` link. The **real mode viewer** mounts read-only over a materialized snapshot, with the conversation on a scrub timeline. | `WEB_PLAYER_SUPPORTED_MODES` in `core/player-support.ts` | `server/play-export.ts::materializePlayPackage` stamps `index.supported`; `src/player/PlayerApp.tsx` mounts the viewer or `LocalClientFallback` |
| **Artifact deploy** | A Deploy button that publishes the workspace artifact to Vercel / Cloudflare Pages. | `compatibleModes` in each deploy plugin's manifest | `core/plugin-registry.ts::resolveForSession` |

Never enumerate the whitelist from memory — open `core/player-support.ts`. It grows per release.

---

## Surface 1 — the hosted player

### What the environment actually is

The player is **the same frontend code in a different state**, not a separate renderer. `PlayerApp.tsx` calls the same `loadMode()`, the same `useViewerProps()`, and mounts the same `PreviewComponent` the live session does. What it does *not* have:

- **No Bun backend.** It's a static SPA on Cloudflare Pages next to the landing page (`scripts/deploy-player.sh`). Every `/api/*` route except the two the service worker fakes is dead.
- **No agent, no WebSocket.** Nothing dispatches `actionRequest`; nothing flushes notifications; nothing answers a write.
- **No `/proxy/*`.** Proxy routes are a server feature. In the player an external host must be directly reachable from the browser.

What it *does* have:

- **Every file of every checkpoint.** `materializePlayPackage` walks each shadow-git checkpoint tree and writes a content-addressed blob store plus a per-checkpoint path→blob manifest. The complete workspace tree at each turn is in the package.
- **A content service worker.** `public/player-content-sw.js` intercepts same-origin `/content/*` and exact-path `/api/file?path=…`, resolving them against the active checkpoint's manifest and streaming the blob from R2 (with Range support, so media scrubs). It also knows the active content set, so content-set-relative asset paths resolve the way the Bun server resolves them.
- **A hydrated store.** Checkpoint checkout calls `setFiles`, which recomputes `contentSets` + `workspaceItems` via your `workspace.resolveItems` and publishes the batch to the source layer. `useSource(...)` works exactly as in the live app.

### What hydrates and what does not

| Prop / channel | In the player |
|---|---|
| `sources` / `useSource` | ✓ — from the materialized checkpoint (see the text-extension limit below) |
| `workspaceItems`, `contentSets`, `activeContentSet` | ✓ — computed by the store from the same resolvers |
| `theme`, `locale` | ✓ — from system preferences |
| `commands` | ✓ **rendered, but inert** — `PlayerApp` injects `manifest.viewerApi.commands` into props |
| `editing` | always `false` (passed explicitly by `PlayerApp`) |
| `readonly` | `true` — the player runs the replay engine, and `readonly` is `replayMode` |
| `staticPlayer` (store) | `true` — set by `loadStaticReplay` |
| `initParams` | **`{}`** — nothing populates it; a viewer that branches on an init param sees an empty object |
| `actionRequest` | always `null` — nothing dispatches viewer actions |
| `onNotifyAgent` | queues into `pendingMessages` and **is never flushed** — no WS |
| `fileChannel.write/delete` | POSTs `/api/files` — **not** intercepted by the SW; there is no server |

### The compatibility checklist

A viewer is web-playable when all of these hold. Check them against your design *before* answering "yes" to the cloud question.

1. **It renders from Source data + workspace files alone.** No render-time round trip. If the first paint needs an endpoint to answer, the mode is not playable.
2. **Its content files carry an extension the package feeds to the store.** `src/replay/provider.ts::TEXT_EXTENSIONS` is an allowlist — `html htm css js mjs cjs ts tsx jsx json jsonl md markdown txt xml svg yaml yml csv tsv excalidraw drawio mmd` — and text files over 5 MB are dropped. Everything else reaches the viewer **only** through `/content/*`, never through `useSource`. A mode that invents `.board` or `.lecture` as its content extension renders an empty viewer in the player until the allowlist is extended, and extending it is a runtime change with its own tests — name it as an obligation in the brief, don't discover it during verification.
3. **Assets are referenced by workspace-relative paths the service worker can resolve.** `/content/<rel>` and `/api/file?path=<workspace-relative>` both work; the SW tries the path as-is, then with the active content-set prefix, then progressively stripped, then as a suffix match. Absolute local paths and cross-origin asset URLs do not resolve.
4. **Every `/api/*` call other than `/api/file` is optional and degrades visibly.** The seam is the store flag `staticPlayer`, not a `try/catch`. Precedent: `modes/cosmos/viewer/CosmosPreview.tsx::canOpenSourceRef` reads `useStore((s) => s.staticPlayer)` and marks file/passage refs un-openable instead of firing `/api/system/*` and toasting an error on every click. Do the same for scaffold routes, capture routes, and any mode-specific route.
5. **Nothing writes.** `fileChannel.write`, `Source.write`, `/api/workspace/scaffold` — all dead ends. Gate write affordances on `editing !== false`.
6. **Agent-coupled affordances are inert or hidden when not editing.** Command buttons still render (the manifest supplies them) and `onNotifyAgent` still accepts calls — both silently do nothing. Hide them behind `props.editing === false`, and note this applies even to modes that never declared `manifest.editing: { supported: true }`: the player passes `editing={false}` regardless.
7. **No Electron / native-only calls.** `/api/native/*` is routed through the browser WS to the desktop shell; in the player it cannot resolve. Same for `/vendor/*` (snapdom) — `vite.player.config.ts` marks those URLs external, so anything reaching for them is absent from the player build.
8. **External hosts are loaded directly and are publicly reachable.** There is no `/proxy/*` in the player, so a viewer that loads a third-party SDK must fetch it from the vendor's own origin, CORS-permitting. This works today because the player deploy sets **no restrictive CSP** — `scripts/deploy-player.sh` writes only `Cache-Control` into `_headers`. Two precedents recorded in the `core/player-support.ts` comment: diagram's `viewer/drawio-loader.ts` injects `<script>` tags straight at `viewer.diagrams.net` and `cdn.jsdelivr.net`, and remotion's in-browser Babel `eval` is allowed to run. Treat the absence of a CSP as a fact about the current deploy, not a licence to add new external hosts casually — each one is a new runtime dependency on someone else's uptime.
9. **The mode is builtin.** `vite.player.config.ts` marks `/mode-assets/*` external, so the external-mode load path does not exist in the player build. Modes installed from GitHub or a library always take the fallback.

### The static-web fast path

If the mode's artifact is a self-contained static page with no other dependency, copy **webcraft** and both surfaces come nearly free.

The shape (`modes/webcraft/viewer/WebPreview.tsx`, `modes/webcraft/manifest.ts`):

- Sources are plain file channels over the workspace (`**/*.html`, `**/*.css`, `**/*.js`, images, fonts) plus an `aggregate-file` for the site's structure. Nothing is fetched to know what to render.
- The viewer picks the active page and builds the iframe document **in memory** — `buildSrcdoc(fileContent.content, baseHref)` takes the HTML text straight from the Source and injects a `<base href>` plus two small scripts, then assigns it to `iframe.srcdoc`. The *document* never round-trips.
- Sub-assets (stylesheets, scripts, images, fonts) resolve relative to that `<base href>`, which points at `/content/<activeContentSet>/`. In the live app the Bun server serves those; in the player the content service worker serves the same paths out of the checkpoint's blobs. Same URLs, different resolver — that is precisely the seam that makes an iframe-based viewer portable.
- Because the artifact is already a plain static site, the deploy plugins' `collectDeployFiles()` has something obvious to collect.

Copy that structure — content inlined from sources for the document, workspace-relative URLs for everything else — and steps 1–5 of the checklist are satisfied by construction. Then it is two one-line registrations: the whitelist entry and the `compatibleModes` entries.

### Disqualifiers — reasons, not a list of names

State the *reason*; the membership list ages out within a release.

- **The viewer needs a live endpoint to render at all.** Not "one button 404s" — the first paint depends on a server answering. `modes/mode-maker/viewer/ModeMakerPreview.tsx` is the clear case: its whole surface is `/api/mode-maker/*` (list modes, fork, play, publish, reset). There is nothing to show without a backend.
- **The mode's value is an authoring surface with no read-only meaning.** If what a viewer shows is "controls for doing the work", freezing it produces a screenshot of disabled buttons, not a shared artifact. Ask: *if a stranger opened this link, would they see a result, or a tool?*
- **It depends on native / desktop-only capability.** `/api/native/*`, editor bridges, filesystem reveal, local process control. These are absent by construction, not merely degraded.
- **Its content lives in a form the package can't feed the viewer.** Custom text extensions outside the allowlist, or a domain assembled from files above the 5 MB text cap.
- **It's an internal mode** (`hidden: true`). Nothing shares an `evolve` or `project-onboard` session; don't whitelist them.

### Registering and verifying

Registration is one line in `core/player-support.ts`. **Earning it is the work.**

1. Build the player: `bunx vite build --config vite.player.config.ts`.
2. Produce a real package for **your** mode and serve it from one origin so the service worker and the provider both behave. `scripts/smoke-player.ts` is the harness (it builds a synthetic doc session, copies `dist-player` beside it, and serves both on `:18080`); `scripts/smoke-webcraft.ts` and `scripts/smoke-kami.ts` are the mode-specific precedents to copy.
3. Open it in a browser. Exercise the viewer read-only: switch content sets, navigate items, scrub the timeline across checkpoints, click the things a reader would click.
4. **Console clean.** No 404s for `/content/*` or `/api/file`, no unhandled rejections from an `/api/*` call that should have degraded, no missing-asset warnings.
5. Only then add the mode to `WEB_PLAYER_SUPPORTED_MODES`. **Never whitelist on the strength of reading the code** — the failure modes here (an empty viewer from a missing extension, an asset path the SW can't resolve, a pulsing "Loading…" because the viewer waits for a signal the player never sends) all look fine in source.

One consequence worth telling users about: `supported` is **baked into the package at export time** by `materializePlayPackage`. A session shared before the mode was whitelisted keeps rendering the "Best viewed in the Pneuma app" fallback until it is shared again.

---

## Surface 2 — artifact deploy

`plugins/vercel/manifest.ts` and `plugins/cf-pages/manifest.ts` each carry a `compatibleModes` array. `core/plugin-registry.ts::resolveForSession` filters plugins by it, so a mode absent from both arrays never sees a deploy provider.

**`compatibleModes` is necessary, not sufficient.** The deploy affordance itself lives on the mode's export page — `server/routes/export.ts` registers `/export/<mode>`, which composes the shared toolbar/modal from `server/routes/deploy-ui.ts` with a **mode-specific `collectDeployFiles()`** that decides which files constitute the deployable artifact; the viewer opens that page from its own toolbar. Proof that membership alone does nothing: `doc` and `gridboard` are listed in both plugins' `compatibleModes` and have no export route at all.

So "artifact deploy: yes" in the brief obligates two things:

1. Entries in **both** plugins' `compatibleModes` (they are maintained in parallel; adding one and not the other means the mode deploys to one cloud and mysteriously not the other).
2. An export surface for the mode — a `/export/<mode>` route with a `collectDeployFiles()` that returns `{ path, content }[]` for the static artifact, and a viewer toolbar entry that opens it. Read the webcraft block in `server/routes/export.ts` as the reference implementation.

If the mode's output is not a static site (a video project, a canvas, a document set), the honest answer is **none**. Say so in the brief and move on — export-to-file is a different feature.

---

## Writing it down

The brief's `## Cloud surfaces` section carries the decision and its consequences:

```markdown
## Cloud surfaces
- hosted player: <yes | no> — <the reason, in the vocabulary above>
- artifact deploy: <none | vercel + cf-pages>
- obligations: <whitelist entry / compatibleModes entries + export route /
  read-only degradation points / verification plan>
```

"No" is a perfectly good answer and costs nothing later — a mode can be whitelisted in a future release once its viewer earns it. "Yes" is a commitment to items 1–9 above holding for every subsequent change to the viewer.
