# Project collaboration authority

The selected LAN service or cloud Project Durable Object owns accepted shared
metadata. Working files and private Agent sessions remain in each owner's local
Session. A local bridge never writes a second membership or discussion store.

## LAN authority with optional Internet access

### Configuration guidance

Launcher Settings and the private Session collaboration panel provide the same
setup guide for LAN, temporary Internet access, and a user-owned hostname.
`GET /api/collaboration/setup` returns `CollaborationSetupStatus`: platform,
application version, executable detection, and the shipped guide's local path.
Detection uses the tunnel runtime's executable lookup on each request; it does
not test login, DNS, or connectivity. Errors remain visible instead of being
reported as a missing executable.

`GET /api/collaboration/setup/guide` serves the packaged
`server/collaboration/SETUP.md`. Both routes exist only on private launcher and
Session servers, not LAN or cloud authorities. They do not read credentials,
install software, change configuration, or start a connector. Copying an AI
setup request includes the chosen connection option and guide location, never
member tokens or invitations; the user sends it to their local coding agent.
The guide uses existing private setup APIs and retains the user's Project and
sharing scope. Opening the guide does not grant access or send an Agent turn.

### Access lifecycle

A locally hosted Project can have a LAN entry and a public HTTPS entry at the
same time. Both reach the same process, accepted-state store, credentials,
rooms, discussions, and references. Enabling a public entry does not migrate
the authority to the cloud. A separately deployed cloud Project remains a
different placement choice.

`core/types/collaboration-access.ts` defines the private access configuration
and state. The detached LAN service owns the public listener, provider process,
and idle timer. The private Session requests changes through an authenticated
loopback control listener; neither collaboration entry mounts that control API.
Only an administrator on the machine owning the matching local authority can
change it. A remote member's local Project never starts a replacement authority.

The public ingress is a separate loopback listener forwarded by `cloudflared`.
Ingress identity comes from the listener, never a request header. Publications,
member operations and authorized publishers retain their usual permissions.
Private Session files, Agent APIs, terminals and provisioning are not exposed.
Responses use the caller's entry origin; resource grants are scoped to their
ingress and are revoked when that ingress closes.

Public access starts disabled after every authority restart. Explicit enable
uses a free temporary Quick Tunnel unless the user selects an existing locally
managed named Tunnel with its UUID, local credentials JSON file and HTTPS
origin. The named hostname must already route to that Tunnel. Configuration
failure is reported without switching providers. The runtime creates no cloud
account, DNS record, Worker, Durable Object, storage bucket or subscription.
It requires an installed or packaged `cloudflared` executable.

The connector uses HTTP/2 transport. In the 2026-10-14 local acceptance run,
the same isolated Quick Tunnel configuration repeatedly timed out over QUIC
while HTTP/2 completed HTTPS and WebSocket round trips and verified shutdown.
This selects a transport for the owned connector; it does not alter the user's
global Cloudflare configuration.

The [Quick Tunnel service](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
requires no Cloudflare account or domain. Its temporary hostname changes on
each start, it has no uptime guarantee, and it is intended for development and
testing. Stopping a user-configured Tunnel connection does not cancel other
subscriptions in that user's Cloudflare account.

The idle deadline starts when public access becomes active. After the last
authenticated public participant connection leaves or its heartbeat lease
expires, ten continuous minutes with no such connections close public access.
LAN participants, the private editor, publisher-only connections, HTTP probes
and unauthenticated requests do not extend that deadline. Activity checks use
wall time before admitting a connection, so sleeping past the deadline does
not let a new request revive the expired entry. Closing the settings tab does
not stop the timer. Expiry requires explicit enable to open a fresh entry.

Manual stop and idle expiry first refuse public admissions, close public
connections and grants, then terminate the provider process. LAN access and
accepted Project state remain available. A child supervisor observes the
authority's liveness pipe and releases its owned provider after authority death,
including an abrupt kill. Shutdown escalates from termination to forced kill;
failure to confirm cleanup produces `failed`, not a successful `off` state.

Temporary public URLs can be reconnected without changing Project or workspace
identity. The host can copy the current credential-free Project URL from Public
access. An already connected member pastes that URL into Reconnect to Project;
the Session reuses its private credential only after verifying authority
continuity. A first connection still requires a member invitation. The LAN
authority persists an Ed25519 identity key. A private binding
pins its public key at trusted initial connection. Before moving credentials to
a different origin, the Session fetches an unauthenticated nonce challenge and
verifies the pinned key and canonical signature over
`{ version: 1, kind: "lan", projectId, origin, nonce }`. The returned origin must
equal the candidate URL; relaying a proof from an old URL cannot authorize a
new one. Legacy bindings obtain their pin only through their previously trusted
entry. Cloud bindings retain their original origin. This is explicit reconnect,
not discovery, automatic failover, or permission renewal.

A persisted replacement binding is configuration progress, not a connected
browser. The private UI withholds reference operations while configuration is
pending. Opening a reference then requires the current entry's WebSocket welcome
and an available source room; existing local import receipts retain their
[recovery semantics](collaboration-reference-import.md). Connection status belongs to its entry and credential. Polling and
reference responses from an earlier connection cannot restore stale state or
mount a view with an obsolete resource grant.

The private connection also projects `referenceOperationAuthority`, a non-secret
recovery scope. Pinned LAN authorities use their public-key digest; cloud and
unpinned legacy bindings retain strict origin scopes. Reference operation IDs
are scoped by this authority identity, Project, destination workspace, target,
action and revision, so a verified temporary-link change does not create a new
operation after an uncertain response.

Before enabling reference operations on the new connection, the private UI can migrate only the exact
current trusted binding's legacy receipt prefix. A verified transition must
retain the Project, workspace and owner; two pinned LAN scopes must be equal.
The first legacy-origin-to-pinned transition follows the Session's verified
reconnect. It does not scan historical origins or merge unrelated authorities.
Destination records are written before old records are removed. Conflicting or
unreadable receipts produce a visible recovery error instead of choosing a new
operation ID.
Recovery errors block reference actions while leaving connection status and
public-access shutdown available.

### Package upgrades and detached ownership

The detached LAN authority belongs to its Project, independently of the desktop
window or private Session. Its private service record captures the package
location/version, public viewer catalog digest, and a random process-instance
identity. Opening an owning Project compares that build with the current package
before reusing it. A changed build uses the authenticated loopback lifecycle
control to retire only the identified idle instance. Retirement closes new
admissions atomically; a live participant or publisher lease prevents it and
returns instructions to close sharing Sessions and participant windows before
reopening. Until that check succeeds, private Session status withholds connection
credentials and sharing readiness so a newly opened client cannot keep the old
authority busy. The error and explicit public-access shutdown remain available.
The authority also checks its installed build periodically and retires
when changed and idle. No PID is signaled to perform an upgrade.

Restart reuses the same Project database, private authority key, configured LAN
hostname and port. Rooms, members, guest credentials/invitations, discussion,
references and operation receipts remain intact. Public ingress restarts off;
a temporary public hostname therefore needs explicit enable and verified
reconnect as described above. An unrecognized process or a pre-release Preview
service without lifecycle identity is never replaced automatically. End that
original runtime through the application or terminal that started it, or restart
the computer, then reopen the Project; do not delete collaboration state or infer
process ownership from a PID alone.

## Identity and registration

Canonical endpoints are scoped by `/projects/:projectId`. The cloud deployment
routes each stable Project ID to its own Durable Object; a LAN service hosts one
Project and refuses requests for another Project ID. Existing bare prototype
endpoints remain available for the configured experiment.

Provisioned member credentials establish stable member identities. They do not
claim verified account login. Workspace ownership is separate from runtime
placement: a workspace records `id`, `projectId`, `ownerId`, `name`, and
`placement`. The first implementation registers `local` placement only. Shared
state never includes local paths, Agent sessions, or credentials.

- `POST /api/workspaces { id, name, placement: "local" }` registers a workspace
  for the authenticated writer/admin. Reusing another owner's ID is forbidden.
- `POST /api/rooms { opId?, workspaceId, modeInstanceId, mode, title, page,
  compatibility, frameScript?, enabled? }` requires the caller's own registered
  workspace. Compatibility carries `coreVersion`, `modeVersion`, `viewerHash`,
  and `publicationSchema`; the hash identifies a built viewer artifact.
- A new room returns `{ room, publisherToken }`. Ownership comes from the
  authenticated member, including when an administrator registers a room.
  Room IDs are stable registrations, independent of publisher process placement.
- A registration retry with the same authenticated actor, operation ID, and
  request returns its original room and publisher credential. Different input
  with the same operation ID fails. Callers persist the pending request before
  sending it. An existing binding with a different operation ID returns the
  room without its secret.

## Publishers and complete revisions

Publisher credentials belong to one room and have no member or discussion
privileges. The room's owner must retain writing membership. Publishers connect
to `/publisher/ws?roomId=:roomId&token=:publisherToken`; each room permits one
live publisher. The `publisher_ready` frame returns a connection ID used as
`X-Publisher-Id` for commit/error requests.

Publisher endpoints are `/api/publisher/rooms/:roomId/state`, `/blobs/:sha256`,
`/commit`, and `/error`. Blob uploads verify their SHA-256 and byte length.
Commit accepts `{ opId, baseRevision, fingerprint, files, projection?, viewer? }` and
checks the current publisher lease, confirmed resource bytes, and compare-and-swap
revision before accepting metadata and its operation receipt together.

Formal rooms require a projection matching `compatibility.publicationSchema`.
The projection carries only bounded plain JSON `sources`, optional public
`initParams`, and `entryAddress`. Its fingerprint is SHA-256 of the shared
canonical encoding of `{ files, projection }`. Legacy resource-only publications
retain SHA-256 of `JSON.stringify(files)`.

Normal Sessions supply `viewer: { compatibility, frameScript?, frameScriptUrl? }`
from their current packaged viewer catalog on every publication. The authority
checks the exact core/mode/schema/artifact identity and instrumentation asset URL
against its own installed catalog. A stale or unavailable build is rejected.
Publisher state returns the registered `viewer` for comparison. A changed viewer
or instrumentation forces a new revision even when source bytes are unchanged;
the complete snapshot, viewer metadata and receipt are accepted atomically.
The current publisher connection still fences commits, so an old connection
cannot write after replacement. Opening a persisted sharing Session automatically
republishes using its current adapter and viewer; it retains the room and scope.

A viewer change records `room.viewerRevisionStart`, the first revision rendered
by the current build. Earlier manifests and pinned-reference metadata remain
stored and retain their original revision and captured compatibility, but their
resources and reference resolution fail with HTTP 410 and
`code: "publication_viewer_unavailable"`. The response explains the retired build
and explicit reference-refresh action. Old snapshots are never relabeled as
compatible with a new viewer. This permits ordinary package builds to replace
public assets without promising historical viewer availability. Content-only
updates within the same build retain ordinary pinned-revision access. Publishers
omitting viewer metadata cannot update a room after its first viewer transition.

`GET /api/rooms/:roomId` and `content` WebSocket frames carry a complete
`publication: { revision, files, projection? }` paired with their room revision
and read-only resource grant. Consumers do not combine a content event with a
later mutable head. Failed updates retain the previous complete revision and an
explicit publication error. Expired hosting blocks those retained bytes.

The headless `startCollaborationPublisher` accepts a project authority URL, room
credential, snapshot callback, and optional subscription to an existing watcher.
It returns `sync`, `stop`, and observable `status`. Uncertain commits retry their
original operation before sending a newer publication. An explicit validation
rejection can be replaced by a corrected snapshot; it is not a rollback of any
local file write.

## Hosting, permissions, and browser transport

Each room independently requires both a joined designated-owner view and its
publisher. Owner receipt-time leases expire at 15 seconds; publisher leases
expire at 45 seconds. LAN and cloud share these deadline calculations. Multiple
owner views count together. Another administrator cannot keep a room hosted.

Room owners and administrators can disable or remove a registration while its
host is offline. Administrative access does not open its preview or discussions.

Owner/publisher loss closes that room's non-owner participant connections,
invalidates old resource grants, and leaves other hosted rooms available.
Returning hosts do not restore prior participants. Rejoin is explicit. Authority
restart preserves accepted membership, room heads, discussions, and receipts;
connections must establish fresh hosting and joins.

Project readers cannot perform durable mutations. View invitations grant one
room's viewing only; comment invitations additionally grant comments, replies,
and chat. Guests cannot resolve threads, edit content, manage rooms or members,
or enumerate another room or workspace directory. Source writes in the rooted
prototype host require the caller to own that local workspace; cloud authority
endpoints never mutate source files.

Comment anchors may include optional display-only `preview` metadata: label,
file, type, text excerpt, and an image data URL. `core/collaboration/comment-preview.ts`
defines the shared LAN/cloud limits and validation; thumbnails are limited to
48 KiB and rendered only as images. Viewer capture is best effort, so absent or
oversized thumbnails fall back to text without blocking a comment. Existing
anchors remain valid. Preview labels and filenames never replace the anchor's
`ViewerAddress` or authorize navigation into another publication.

The owning private Session can explicitly attach a collaboration chat message
or comment thread to its Agent composer. This creates a session-scoped draft
reference containing the source, author, quoted feedback, and comment location;
it neither sends a message nor queues an Agent notification. The host can remove
references, add instructions, or send the feedback alone. Only the normal send
action serializes the references into the existing user-message path. Public
viewers never receive the private composer capability or its state.

Semantic presence uses `type: "presence"`, nullable legacy `view`, optional
`semanticView` and `semanticPointer`, and a required publication `revision` when
semantic payloads are supplied. The authority validates that revision and stamps
per-connection increasing `sequence`. Caller-supplied member identity and
sequence cannot impersonate another view. Presence remains ephemeral.

Canonical project APIs permit cross-origin bearer requests and preflight;
canonical sockets authenticate explicit credentials rather than cookies. Error
responses expose the same CORS contract. Public resource frames remain opaque
sandboxed documents with no private host API or Agent connectivity. Public
Google font styles/fonts and HTTPS images are permitted by the shared resource
CSP. The loopback owner bridge retains its stricter private origin policy.

## Pinned references

References preserve an explicit relationship to one immutable publication. They
record source Project/workspace/room, publication revision, ViewerAddress,
captured viewer compatibility, label, and destination owner/workspace. They
contain neither source bytes nor grants and never widen access.

- `GET /api/references?workspaceId=...` returns `{ references }` to current Project
  members. Guests cannot enumerate reference metadata.
- `POST /api/references { opId, destinationWorkspaceId, label, source }` creates
  a reference for a writing member's own registered destination workspace.
  Administration does not grant another member's destination ownership.
- `PATCH /api/references/:id { opId, source, label? }` explicitly refreshes a
  reference and its revision reservation. `DELETE /api/references/:id { opId }`
  releases the relationship and reservation. Both require the destination owner
  to retain writing membership; neither requires an unavailable source to return
  merely to unpin it.
- `GET /api/references/:id/resolve` rechecks current source access and hosting,
  then returns `{ reference, compatibility, room, publication, pageUrl }` for the
  exact pinned revision. The room and publication revision agree. There is no
  latest-head substitution or offline source fetch.

Pinning and refresh require the same Project authority, an exact source workspace
and formal room binding, a live source host, and an existing immutable manifest.
A source's loss of hosting produces 423; disabled sharing produces 403; removed
source rooms, references or unavailable manifests produce 410. Revoked identities
and existing grants stop working. Pin metadata can remain after source removal
so the destination owner can understand and explicitly remove the relationship.

A room retains at most eight manifests. At most seven distinct pinned revisions
can be reserved, preserving one rolling-head slot. Multiple references to one
revision count once. Publication retains all reserved revisions and the newest
remaining revisions within that budget. Refresh checks the replacement quota
before atomically replacing the old reservation; unpin releases it. Capacity
failure preserves accepted references and reservations and reports an error.

Reference mutations commit metadata, reservations and operation receipts together.
Identical accepted retries return their original result, including after later
refresh or removal; they do not recreate a deleted reference. Resolve still
checks the current relationship and permissions. Real LAN and workerd tests pin
an original revision through more than eight publications, exercise quota and
reservation changes, and verify authority restart and revoked/offline sources.

Materialization is a separate explicit local Session operation: resolve and verify
authorized pinned resources, then create a destination-owned attributed copy.
The authority never writes local workspaces or private Agent state. Previously
imported copies follow destination retention and cannot be recalled by source
revocation.

Authorized materializers request original resource bytes by sending
`X-Pneuma-Publication-Bytes: 1` to the existing exact pinned resource-grant URL.
This preserves every room/revision/grant/identity/host check and skips only HTML
instrumentation and HTML/CSS URL rewriting. Responses use
`application/octet-stream`, `Content-Disposition: attachment`, and `nosniff`;
their hashes and byte lengths match the accepted manifest. Ordinary renderer
requests remain instrumented. The choice is an explicit header, never an inherited
URL parameter. Import cannot bypass revoked credentials or offline source hosts.

## Project removal

`DELETE /api/project { opId }` requires a current administrator credential and
returns `{ ok: true, removed: true, projectId, removedAt }`. This atomically
persists a sharing tombstone and the administrator's operation receipt, disables
all rooms and invalidates every resource grant. Participant and publisher
connections close with WebSocket code 1008 and reason `Project removed`.

Only the same administrator credential and exact accepted operation can replay
the removal receipt. Every other Project API, resource, socket upgrade, and
bootstrap attempt returns HTTP 410 with `{ error: "Project was removed", code:
"project_removed" }`, including after authority restart. A source-reference
410 without this code does not mean its whole Project was removed. Clients
retain their binding and require explicit recovery; they must not automatically
create another writable authority.

The tombstone preserves source references, accepted manifests, storage and
provisioned credential hashes for replay. It does not promise immediate blob
collection, delete local working files, or touch private Agent state.

## Private action deadlines

Private action deadlines begin when dispatch reaches the selected socket.
Queued actions share its ordering but do not spend their execution deadline
waiting. A deadline cannot establish that browser execution stopped. The server
rejects queued work, retires the socket's timed-out mount UUID, and returns a
registration failure instructing the user to `Reload viewer`. That UUID cannot
register again on the same connection; an explicit fresh mount UUID can recover.
Socket, mount UUID and request ID must all match a response, so late retired
responses cannot settle a fresh action. This fences protocol outcomes; it does
not cancel or undo browser work that may already have happened.

The `OPTIONS /api/project` transport preflight remains available for browser
replay of the accepted removal. It grants no Project read or mutation access.
Private `capture` reserves `params.publicationReference` with the complete
`CollaborationReferenceSource` shape. Supplying it returns `success: false`
with an explicit unsupported-capability message before dispatch. Local capture
supports a selected mount and its navigation outcome; it does not verify an
immutable shared publication revision. The pinned preview and explicit local
copy are separate supported operations.

Trusted shared runtime assets and the static public shell remain available after
removal, as they contain no Project metadata. Reloading that shell can report
the authority's `project_removed` response. This does not preserve any granted
publication access.

## Private Session network placement

All normal Project Sessions keep their API, browser/CLI/terminal WebSockets and
Vite API proxy on `127.0.0.1` from startup, independent of the share toggle.
The backend derives this from the existing Project Session context; the CLI
passes a path-free boolean to the Vite child. Public LAN publication uses its
separate authority listener. Project member/publisher credentials, Agent state
and working files remain on the private Session side of that split.
