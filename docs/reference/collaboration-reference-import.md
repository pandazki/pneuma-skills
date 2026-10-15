# Explicit local reference copies

The private normal Session exposes `POST /api/collaboration/references/:id/import`
with `{ "requestId": "stable-operation-id" }`. This action deliberately copies
the reference's authorized pinned publication into the running Session workspace.
The caller cannot supply a destination workspace or filesystem path. Importing
does not notify or invoke the Agent.

`ImportCollaborationReference` and `CollaborationReferenceImportReceipt` are defined
in `core/types/collaboration-reference-import.ts`; the implementation is
`server/collaboration/reference-import.ts`. The private References UI consumes the
receipt's `path`, `paths`, `attributionPath`, `label`, `source`, and
`publicationRevision`. Every returned file path is relative to this workspace.

Only the public resource manifest is copied. Private `projectionInputs`, including
metadata manifests used to derive the public Sources, are not available for import.
The importer does not invent a mode manifest or promise automatic discovery as a
new content set. The returned paths let the person or Agent use the local files.

Before a new copy, the server reads the current private collaboration binding,
checks current writing membership and ownership of that bound workspace, and
resolves the reference with its member credential. The resolved reference must
belong to the same member and destination workspace. Source identity, room,
publication revision, resource grant scope, file count, total size, and every
public file path are validated before fetching resources. It never falls back to
the latest revision or reads private source files.

The existing pinned resource grant serves exact immutable bytes when the private
server supplies `X-Pneuma-Publication-Bytes: 1`. HTML and CSS are copied before any
viewer instrumentation or URL rewriting. Ordinary resource authorization still
applies to every fetch. No member credential is sent with resource requests or
written into the copy. Transfers are bounded by the publication limits, reject
redirects, and must match each manifest entry's exact byte length and SHA-256.

All files first enter a hidden stage. A workspace-scoped SQLite lease prevents
competing Session processes from committing the same destination. The complete
stage is atomically renamed to `imports/<reference-id>-r<revision>/`, with a
`.pneuma-import.json` attribution receipt recording the source address, label,
identity, revision and import time. Existing user directories are never replaced.
The shared public-path rule excludes the attribution and hidden incomplete stages
from future publication. A failed transfer removes its stage and exposes no
partial copied directory.

The private Session state retains a request receipt before committing the copy,
so the same `requestId` can recover a completed atomic rename after a disconnected
response or restart. Reusing that ID for another reference or a refreshed revision
fails. A fresh request for an already completed identical reference revision may
recover the existing receipt after live authorization; it does not create a second
copy. Removing or editing the attribution can prevent automatic retry recovery.
The completed receipt describes the original authorized copy. Subsequent edits to
its local files are preserved on retry; recovery does not rehash or replace them.

A completed copy is local work, independent of subsequent source removal,
revocation, host absence or reference refresh. Revocation cannot retract bytes
already copied with authorization. Retrying a completed request can therefore
return its local receipt without contacting the source; a new import still checks
live access and rejects an unavailable source. Cancelling the browser request does
not prove that the server's authorized copy failed: retry the same request ID to
recover its outcome.
