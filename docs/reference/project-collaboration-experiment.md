# Project collaboration experiment

Status: opt-in LAN and cloud Webcraft validation on the 3.57.3 baseline. This is not a 4.0
release, a production authentication system, or a replacement for the normal
session server. No Agent is started or exposed by the experiment.

## Run

```sh
bun run dev:collab
# Reuse experiment state, comments, roles, and member credentials:
bun run dev:collab --project /tmp/pneuma-collab-demo
# Share an explicit static site directory instead of the included one-page fixture:
bun run dev:collab --project /tmp/pneuma-collab-existing --workspace /path/to/public-site --page index.html
# Reproduce transport and file-observation measurements:
bun run bench:collab
```

The command builds a separate React viewer with Bun and starts a dedicated
HTTP/WebSocket host, on port 17997 by default. `--port` and `--hostname` override
the listener. It prints administrator, writer, and strict reader links. Open the
administrator link, enable collaboration, and open the others in separate tabs
or devices. For LAN testing, replace `localhost` with a printed LAN address.

The default project is a fresh directory under the system temporary directory.
Its `website/index.html` is a self-contained Webcraft fixture. Edit that file
with an editor or an Agent to test external file updates. Existing files passed
through `--workspace` are real files: the writer's source editor changes them.
Use a disposable copy when testing.

Bootstrap links are local bearer credentials, stored with mode 0600 in
`<project>/.pneuma/collaboration-lab/lab.json` and `access.json`. Their purpose is
to test roles with separate browsers; they are not account login or identity
verification. A restart loads durable permissions and does not restore revoked
members from the bootstrap file. A previously revoked link printed at startup
therefore remains invalid. Never expose an Agent session directory as a public
site root.

## Model and scope

- A project owns membership: `reader`, `writer`, and `admin`.
- A collaboration room identifies one running work instance, not a mode type.
  The host accepts multiple explicitly configured roots; the CLI starts one
  single-page Webcraft room to keep the experiment small.
- The owner with write permission, or an administrator, can enable/disable its
  collaboration and create/revoke temporary room links.
- A project reader and a view-only guest cannot perform **any durable write**:
  no content edits, comments, replies, resolution, chat messages, invitations,
  role changes, deletion, or room changes. Cursor/view presence is ephemeral
  observation state, not a document edit.
- Cloud invitations may explicitly grant discussion access. Redeeming one
  creates a named, room-scoped guest session with `guestAccess: "comment"`.
  These visitors can create/reply to comments and chat, but cannot edit files,
  resolve comments, manage members, or share the project. Omitted guest access
  remains view-only; it never upgrades a project reader.
- Anonymous credentials grant one room only. They do not expose project
  membership, other room records, or room chat. An administrator can remove a
  room's sharing registration; this does not recursively delete source files.
- Private Agent sessions, history, permission requests, terminal access, and
  system/proxy endpoints are absent from this host. Public titles are explicit
  metadata, never derived from private conversation history.

The experiment implements real room presence, independent browsing, follow,
anchored comment threads with resolve/reopen, member chat, role invitations,
revocation, source saves with a base revision, external file refresh, and
reconnect snapshots. Cross-workspace artifact references, account identities,
integration into the normal launcher/session shell, distributed Agent execution,
and same-file CRDT editing remain subsequent work.

## Definitions, owners, and consumers

| Boundary | Definition / implementation | Consumer |
|---|---|---|
| Public collaboration state and messages | `core/types/collaboration.ts` | Isolated host and React collaboration client |
| Publication paths, MIME types, resource limits and file records | `core/types/collaboration-publication.ts` | Both LAN snapshot collection and cloud manifest validation |
| Durable project ACL, comments, chat, operation receipts, snapshots | `server/collaboration/store.ts` | `server/collaboration/host.ts` |
| Explicit static publication roots, content hashes, limits | `server/collaboration/content.ts` | HTTP asset grants and revision publishing |
| Public HTTP/WebSocket service | `server/collaboration/host.ts::startCollaborationHost` | Lab harness and integration tests |
| Project/room interface | `src/collaboration/` | Separate browser entry, built by the lab harness |
| Page coordinates, anchors, overlays and follow | `modes/webcraft/viewer/collaboration-frame.ts` | Instrumented sandboxed Webcraft page |
| Composition, bootstrap and fixture | `modes/webcraft/harness/collab-lab.ts` | `bun run dev:collab` |
| Cloud project authority and private resources | `cloud/collaboration/src/` | Worker, SQLite Durable Object, R2, and browser clients |
| Local cloud publisher and loopback host window | `server/collaboration/cloud-connector.ts` | `modes/webcraft/harness/collab-cloud.ts` |

The reusable server has no Webcraft-specific branching. The mode harness owns
the page fixture and supplies its instrumentation script. This keeps the
prototype's domain rendering separate from shared transport and persistence.

## Realtime paths

Presence is sent over WebSocket with client-side latest-value scheduling,
bounded coordinates/payloads, and server-side flood/backpressure limits. Normal
traffic is relayed immediately; excess updates coalesce rather than accumulating
old mouse positions. Presence never writes SQLite. A view is scoped to one
connection, so two tabs for one member do not fight for a single cursor.

Comments and chat use durable HTTP operations and WebSocket notifications.
Operation receipts are scoped by actor and operation ID. A retry with the same
payload returns the original result; reusing that ID for different input is a
conflict. The host checks current permissions on every request and socket
message, and revalidates connected sessions when membership changes.

Direct source saves are accepted only against the current base revision. The
host scans current disk content before the comparison so an external edit inside
the watcher's stability window is not blindly overwritten. This protects
mediated saves; an unrelated native filesystem writer can still race a save.
There is no claim of arbitrary multi-Agent same-file conflict resolution.

External updates reuse the repository's workspace watcher and its 200 ms write
stability check, then publish without the normal session file-watcher's
additional 300 ms debounce. Each accepted revision copies resource bytes into a
content-addressed store before publishing its immutable file manifest. If the
declared page disappears or publication fails, the last complete revision stays
available and clients receive a visible error. Restoring a valid page resumes
publication. This is a static file snapshot, not a transaction across a running
build's independently written files.

The UI reports WebSocket RTT. That is a round-trip connectivity measure, not
cursor-to-paint latency. `bench:collab` separately measures publisher-to-peer
WebSocket delivery, accepted source save to peer event, native file write to
peer event, and the existing session watcher callback as a baseline. All those
measurements use one machine's monotonic clock; they do not infer one-way
latency from unsynchronized device clocks.

### Recorded experiment, 2026-10-14

Bun 1.4.0 on macOS arm64, a 5,424-byte self-contained page, three WebSocket
clients, and one publisher sending approximately 30 presence updates/second:

| Path | Samples | Median | p95 |
|---|---:|---:|---:|
| Presence send to another client's event | 90 | 0.22 ms | 0.80 ms |
| Source save request to another client's revision event | 8 | 1.39 ms | 3.04 ms |
| External file write to another client's revision event | 8 | 215.53 ms | 252.95 ms |
| Existing session watcher callback, same fixture | 8 | 515.57 ms | 524.63 ms |

These are loopback observations, not service-level guarantees. Eight samples
are a smoke comparison; their p95 is effectively their maximum. Browser paint,
physical LAN hops, Internet routing, and larger workspaces need separate
measurement. The change removes the established second debounce rather than
weakening the shared watcher's stable-file detection.

Separate Chrome browser contexts verified administrator/writer/reader/guest
views, cursor placement, scroll following, idle follow traffic settling,
comment creation/reply/resolve/reopen, source publishing, external file changes,
guest revocation, room off/on rejoin, and 390 px read-only layout without
horizontal overflow. A forced WebSocket close with offline HTTP retained the
reader's visibly stale revision while the host advanced, then a reconnect
loaded the new revision and resources. Plain HTTP access through this machine's LAN address also
completed a writer chat operation while `isSecureContext` was false. Operation
IDs use `crypto.getRandomValues`, which is available in insecure contexts,
unlike `crypto.randomUUID` ([browser API reference](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)).

Browser automation must account for the preview's CSS transform when sending
pointer input: convert iframe CSS coordinates by the outer iframe's scale.
The tested Playwright version's child-frame bounding boxes omitted that scale;
direct pointer input at the actual visible coordinates confirmed the pin hit.

Validation ran the ordinary repository suite (7,082 passed, 617 opt-in tests
skipped, no failures), followed by the final affected collaboration/Webcraft
suite (85 passed, no failures) after browser-review amendments. TypeScript,
the normal Vite production build, the standalone Bun browser build, and the
guidance check passed. Live backend and expensive media tiers were not run.

## Player isolation and lifecycle

The parent stores a member credential per tab and removes it from the URL
fragment after reading it. The page iframe receives a separate, read-only,
room-scoped asset grant. It runs with `sandbox="allow-scripts"`, without
same-origin access, top navigation, forms, or private API access. Both sides
check the source window of frame messages. Frame input can propose a visual
anchor; it cannot automatically invoke a privileged content or comment write.
Responses and iframe requests use `no-referrer` to avoid forwarding grant URLs.

Page resources are served only from the retained manifest after validating the
grant and current access. Closing a room, revoking a guest link, or removing a
member also invalidates affected resource grants and existing connections.
Revocation stops future access; it cannot retract bytes already downloaded.

Follower coordinates are applied only to the same page and revision. The
canonical preview width preserves a consistent responsive layout between
participants. Local user input exits following. Comments retain their creation
revision, object selector, relative position, and quote; a missing or rewritten
target stays visible as a stale anchor rather than being silently reassigned.

On connection loss the client retains a visibly stale preview, disables durable
controls, and reconnects with a fresh authorized snapshot. Persistent operations
and comments survive host restart. Presence and active resource grants do not.
The prototype does not promise offline mutation queues.

## Deliberate limits and next validation

The publication root is a static, local-resource site. Its CSP does not permit
external scripts, network-backed application requests, nested frames, or forms.
Hidden/private files and symlinks are excluded. The current bounds are 256 files,
4 MiB per file, 16 MiB per room, eight retained resource revisions, and a 1 MiB
source-edit request. The fixture uses no external resources, making network
measurements reproducible.

WebSocket plus one authority is sufficient for this observation/review slice;
a CRDT would not improve its transport latency or make native whole-file writes
merge safely. A future structured shared editor can introduce Yjs at its domain
data boundary. Public projection and actor identity are prerequisites either way.

## Cloud prototype

The cloud variant has a separate Worker deployment, one SQLite Durable Object
for the prototype project, and one private Standard R2 bucket. It is an isolated
prototype with one Webcraft room, not integration into the normal desktop or
launcher project UI. Account login and a multi-project directory are not included.

The local publisher opens an outbound WebSocket. The cloud accepts one publisher
at a time and returns a connection identity. Every publication commit carries
that identity in `X-Publisher-Id`; a disconnected or superseded publisher cannot
commit. Operation IDs remain independent of the connection identity, so a retry
after reconnect can recover an already accepted receipt. Bytes upload first;
only checksum-verified, present resources may enter a committed manifest.

The local host window binds `127.0.0.1`, proxies collaboration HTTP/WebSockets
to the cloud, and provides an owner-only source editor for its declared local
site. It verifies current cloud permission and the published/local file version
before a save. A failed cloud response after a local write reports the local
save and uncertain publication explicitly. Native filesystem races outside
this mediated path retain the LAN prototype's limits.

Cloud visitors open a link, enter a display name, and receive a separate guest
credential. A link's expiration and revocation apply to all sessions redeemed
from it, including their existing WebSockets and resource grants. Invitation
tokens cannot directly authorize API requests. Project readers stay strictly
read-only. Source writes are absent from the public Worker API.

The cloud owns membership, comments, chat, and accepted publication versions.
The local filesystem owns working content. Remote access requires both the
local publisher and a joined browser view belonging to the designated room
owner. A different administrator or the publisher alone cannot keep the room
open. Closing the last owner view, leaving the room, or losing the publisher
disconnects every non-owner participant. HTTP requests, invitation redemption,
WebSocket upgrades, discussions, and private resources reject remote access
with HTTP 423 while the host is absent. The owner retains recovery access.

Server-timed leases detect silent failures: owner views expire 15 seconds after
their last heartbeat or validated presence, and publishers expire after 45
seconds. A Durable Object alarm checks the nearest lease or invitation expiry;
no permanent server interval is needed. Connection attachments preserve the
timestamps through hibernation. Expired connections are closed before processing
late messages. Normal socket closure is handled as soon as the cloud receives
it; silent failures wait for their lease deadline and alarm delivery.

Hosting transitions invalidate resource grants. A `closed` message with
`code: "host_offline"` clears the visitor's preview and discussion state and
stops reconnect polling. The visitor explicitly rejoins once the owner returns.
Multiple owner tabs count together; closing one does not eject visitors while
another remains joined. The designated owner cannot be removed or downgraded
below writer while its room remains registered, preserving the recovery path.

Published content and discussions remain stored between hosted sessions.
Reconnect scans the current local files and publishes any change.
Local filesystem error details remain in local logs; public errors omit paths.

Incoming chat and comment replies have red unread counts on their tabs and
workspace entry, plus a document-title count. The first snapshot is historical
context; own messages and duplicate reconnect events do not count. A channel
is marked read only while its discussion panel is visible in a focused document.
Read state is per browser tab and survives a reload via session storage.

### Versioned viewer delivery

`bun run build:collab:cloud` builds the standalone collaboration shell using the
repository's Vite dependency. React is a separate shared chunk. Shell JS/CSS
paths carry the core version and emitted-content hash. Webcraft's frame bridge
uses `/viewer/webcraft/v<mode-version>/<sha256>/frame.js` and is referenced by
the room HTML; it is no longer repeated inline on every published page.

This reuses the online player's cache policy: fresh HTML and immutable hashed
assets. Cloudflare Workers Static Assets distributes the current public runtime.
`cloud/collaboration/publish-assets.ts` archives the exact manifest-listed bytes
under `public-viewer/` in R2 before deployment. The Worker can serve an archived
runtime after a later deployment removes it from the current static assets.
Private room resources have a separate namespace and always require a current
grant; they never inherit public runtime cache headers.

The build writes `dist/viewer-manifest.json` with versions, paths, sizes and
SHA-256 checksums. The archive script validates it before upload. A measured
shell-only amendment changed its JS from 45,717 to 45,763 bytes while the
192,319-byte React chunk, 22,099-byte CSS and 11,688-byte frame bridge retained
their URLs. These sizes are uncompressed build bytes, not a network benchmark.

This Webcraft prototype renders a static website plus its bridge. It does not
compile an ordinary mode viewer a second way. Future full mode-viewer delivery
must use `snapshot/mode-build.ts::buildModeViewer` and its host ABI validation;
the existing mode catalog already pins core compatibility and archive hashes.

### Deploy and start

Use the isolated cloud package so Workers types and tooling do not replace the
main repository's Bun runtime or dependencies:

```sh
bun install --cwd cloud/collaboration --frozen-lockfile
bun run build:collab:cloud
bun run --cwd cloud/collaboration typecheck
bun run --cwd cloud/collaboration test
bun run --cwd cloud/collaboration check
```

The checked-in config names the prototype Worker and private R2 bucket
`pneuma-collaboration-prototype`. For a new deployment, create that bucket with
Wrangler, archive the viewer assets, and deploy:

```sh
cloud/collaboration/node_modules/.bin/wrangler --cwd cloud/collaboration r2 bucket create pneuma-collaboration-prototype
bun cloud/collaboration/publish-assets.ts
cloud/collaboration/node_modules/.bin/wrangler --cwd cloud/collaboration deploy --secrets-file /secure/cloud-secrets.json
```

The secrets file contains a randomly generated `BOOTSTRAP_SECRET`; keep both
that JSON file and a raw copy of the same secret outside the repository with
mode 0600. Do not put secret values in command arguments. Bootstrap is
create-once and refuses a different configuration for an existing project.

```sh
bun run dev:collab:cloud --cloud https://your-worker.workers.dev --project /tmp/cloud-demo --bootstrap-secret-file /secure/bootstrap-key
# Reconnect with the same local credentials and content:
bun run dev:collab:cloud --project /tmp/cloud-demo
# For an existing static site, pass --workspace on the first launch.
```

Open the printed local host link, choose **Share**, and create a link with
**Comment & chat** or **View only** access. Runtime credentials live only in
the local project's `.pneuma/collaboration-cloud/`, with a publisher lock to
prevent concurrent local launches. The deployment's single project ID is
intentional for this prototype. Keep the host page and local publisher open
while collaborating. Closing the last host page or stopping the publisher
ends remote access. Sharing off and link revocation also stop guest access.

The cloud has bounded retained manifests (eight), uploads (256 MiB and 4,096
blobs), metadata (8 MiB), and invitations. It rejects further work when a bound
is reached; it does not silently delete source files or old R2 blobs. There is
no cloud offline-edit queue or arbitrary same-file multi-agent merge.

### Cloud verification, 2026-10-14

The isolated real-workerd suite covers invitations and strict roles, private
resources, checksum/manifest publication, concurrent commit conflicts and
deduplication, publisher fencing, restart, and actual DO hibernation. Browser
checks use the deployed HTTPS Worker and a loopback host window, including
guest comments/chat and unread badges, source publication, mobile view-only
access, and publisher reconnect. These browsers run on one test
machine; physical multi-network latency is a separate user trial.

The host-required amendment passes 22 real-workerd cases (411 assertions),
including silent 15-second owner and 45-second publisher lease expiry. The
owner test hibernates the object and sends no traffic before its persisted
alarm ejects guests. An isolated browser room verifies offline invitation
rejection, multiple owner tabs, last-owner ejection, cleared preview/discussion,
no background reconnect polling, explicit rejoin, stale-grant rejection, and a
390 px mobile layout. The updated Worker is deployed to the existing prototype
origin; the isolated browser room avoids interrupting a user's live host view.

A first guest connection once stopped receiving presence while still showing
connected. Reload restored it. A fresh browser connection and the normal
follow path then passed; 480 local real-workerd join/ping/follow/hibernation
stress rounds did not reproduce it. This remains a prototype observation,
not evidence that the first failure's cause was fixed.

Relevant platform sources:

- [Cloudflare Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [SQLite Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [R2 Cache API](https://developers.cloudflare.com/r2/examples/cache-api/)
- [Yjs updates and state vectors](https://docs.yjs.dev/api/document-updates)
