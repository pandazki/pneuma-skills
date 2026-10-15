# Configure Pneuma collaboration (Beta)

Collaboration is in Beta, with Webcraft as the first supported mode. It shares
the selected workspace for live viewing and feedback; private Agent conversations
remain with their owners.

This guide ships with Pneuma and is intended for the person or local coding agent
helping configure it. Use the connection option and optional hostname in the
copied setup request. The request authorizes the corresponding setup work; ask
for missing choices or an interactive login when needed. Opening Settings or
copying the request does not install software, share content, or enable access.

## 1. Identify the running Project

Keep Pneuma open. The private guide URL in the request identifies a running
launcher or Session; its origin is the private API base. If that process has
restarted, copy a fresh request from Settings instead of guessing a port.

- `GET /api/collaboration/setup` reports the host platform, application version,
  whether an executable `cloudflared` was found, and this guide's local path.
  Detection does not test installation health, login, DNS, or connectivity.
- A Session's `GET /api/session` identifies its `workspace` and nullable
  `project.projectRoot`. A launcher's `GET /api/running` lists running Session
  URLs; inspect `/api/session` on the selected URL's origin. Ask which Project
  to use if several are open. An empty launcher is not a Project: have the user
  create/open a Project and its Webcraft Session.
- `GET /api/collaboration` on that Session reports `projectAvailable`,
  `supported`, `sharing`, `publisherStatus`, and any existing connection. This
  response also contains a private member token: read only the fields needed
  and never print, copy, or share the entire response.

The UI entry is **Collaborate**, renamed **Sharing** once sharing is active;
both display a Beta badge.
Webcraft is the first supported mode. A visitor following an invitation only
needs a browser; the setup below belongs on the host computer.

## 2. Create or reuse the local collaboration space

For all three connection options, use the existing local Project binding when
present. Do not replace its identity, membership, room, or database. If it is
connected to someone else's Project or to a cloud authority, explain that its
host controls Internet access; do not create a competing local authority.

For a new host, choose **Collaborate → Local network**, enter the user's display
name, and create collaboration. The equivalent private Session request is:

```http
POST /api/collaboration/create
Content-Type: application/json

{"name":"The user's display name"}
```

Select the intended site in the viewer and choose **Share this workspace**.
The equivalent request is `POST /api/collaboration/share` with:

```json
{"title":"The selected site's title","contentSet":"chosen-relative-directory","activeFile":"chosen-relative-directory/index.html"}
```

Use the user's selected content scope and paths relative to the Session's
workspace. Do not infer them from the Project directory. `contentSet: null`
selects the whole eligible workspace, so use it only when that is the intended
scope; `activeFile` may be null if there is no selected page. If the scope is
unknown, ask for the intended workspace-relative directory, or have the user
select the site and click **Share this workspace** in the viewer. In the latter
case, reread `sharedContentSet` and `roomId` from the private collaboration
status; these APIs do not expose the browser's unshared selection. Reuse an
already shared room.
A scope/build compatibility error needs diagnosis; deleting the registration
is not a routine setup fix.

For **Same network**, no Cloudflare account, domain, or `cloudflared` is needed.
Continue to invitations and verification below. Both devices must be able to
reach the host's LAN address; guest Wi-Fi isolation or a firewall may prevent it.

## 3. Prepare Internet access, if selected

For **Temporary internet** or **Own domain**, install a missing `cloudflared`
using the official package for the host OS, then run `cloudflared --version`.
On macOS with Homebrew, installation is `brew install cloudflared`. Use the
[official downloads](https://developers.cloudflare.com/tunnel/downloads/) for
Windows and Linux instructions. Recheck the setup endpoint afterward. If a
new PATH is not visible to the running app, save drafts before restarting it.

Pneuma looks in its packaged executable locations, the process PATH, and the
standard macOS Homebrew locations. The UI currently has no custom executable
path setting. Do not edit a global tunnel configuration or install a background
Cloudflare service: Pneuma owns the connector's configuration and lifecycle.

### Temporary internet

Choose **Public access → Free temporary address → Enable public access**, or:

```http
POST /api/collaboration/internet-access
Content-Type: application/json

{"enabled":true,"provider":{"kind":"quick"}}
```

No Cloudflare login or domain is required. The address changes on each start.
[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
are intended for testing and have no uptime guarantee.

### Own domain

Use a hostname the user controls in a Cloudflare-managed zone. Ask for it if the
request does not include one. This integration uses a **locally managed** Tunnel
with its UUID and generated JSON credentials file; a dashboard connector token
is not a substitute. Follow the current
[locally managed Tunnel guide](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/)
for account authorization and resource creation:

```sh
cloudflared tunnel login
cloudflared tunnel create <chosen-name>
cloudflared tunnel route dns <tunnel-uuid> <chosen-hostname>
```

Reuse a suitable existing Tunnel when appropriate. Complete browser login with
the user. Keep credentials local; do not paste their contents or the account
certificate into chat. If the hostname already routes elsewhere, resolve the
conflict with the user rather than overwriting its DNS. Do not follow the
generic guide's manual tunnel-run or system-service steps for this integration.

Choose **Public access → Your own Tunnel** and enter the HTTPS origin, Tunnel
UUID, and absolute credentials JSON path. The equivalent private request is:

```http
POST /api/collaboration/internet-access
Content-Type: application/json

{"enabled":true,"provider":{"kind":"named","publicOrigin":"https://collaboration.example.com","tunnelId":"the-tunnel-uuid","credentialsFile":"absolute-path-to-generated-credentials.json"}}
```

Use actual user-chosen values, never the example hostname. This saves configuration
for the selected local Project. The application's developer's domain and account
are not defaults for other users. Do not silently switch a failing named Tunnel
to a temporary address.

In both Internet options, use Pneuma's existing control API. Never point an
independently launched tunnel at the private Session or launcher port: those
ports contain private Agent, file, and terminal APIs. Pneuma forwards only its
separate collaboration listener.

## 4. Invite someone and verify the result

1. Check the private collaboration status for successful publication. For
   Internet access, wait for `internetAccess.status: "active"`; then verify the
   advertised hostname actually reaches this Project. Active connector status
   alone does not prove DNS works. An unauthenticated `GET /api/identity` on the
   public origin reports the Project ID without needing a member token.
2. In **Sharing → Links**, create a guest link with **Comment & chat** when
   feedback is wanted, or **View only** otherwise. Choose LAN or Internet as
   appropriate. An invitation is required for a new visitor; the credential-free
   Public Project URL is for existing members reconnecting to the same Project.
   Use **Members** to invite someone who will connect their own local Project.
3. Open the guest invitation in a separate browser profile or another device.
   Verify the selected site loads and the chosen permissions work. Create a
   test comment only if the user wants that test content; otherwise report that
   comment submission remains untested. Never replace a guest invitation with
   the host's administrator token.
4. Explain the feedback loop: Control-click starts a comment; the host's
   **Send to AI** attaches feedback above the private Agent composer. The host
   can add instructions and explicitly send it, then review and resolve the
   comment after the change. Anchored comments remain tied to their captured
   revision; later edits may make a target unavailable, and do not automatically
   re-anchor the comment. Copying this setup request does not send a turn.

Keep the host computer, owning Session tab, and publisher online. Public access
closes after ten minutes without authenticated public participants and starts
off after an authority restart. After a temporary address changes, resend links
using the current origin; their existing invitation credentials remain valid
until expiry or revocation. Preserve the Project path and invitation fragment
when updating an existing link. Existing members can use **Reconnect to Project**.

## Troubleshooting and completion

- A missing executable needs installation and **Check again**, not new account
  credentials. A failed public start currently requires **Retry stopping public
  access** before enabling again. The private equivalent is
  `POST /api/collaboration/internet-access` with `{"enabled":false}`; wait for
  confirmed `off` before retrying. If cleanup still fails, diagnose the reported
  error rather than starting another connector or killing unrelated processes.
- LAN connection failures need a reachable local address and allowed application
  traffic, not a router port-forward to the private Session.
- Upgrades must preserve the existing Project and collaboration state, including
  project files, comments, chat history, invitations, references, and membership.
  Do not hand-edit the collaboration database or reset it as a setup shortcut.
- An independently hosted **Cloud host** is a different, advanced deployment
  using a Worker, Durable Object, storage, and provisioning credentials. It is
  not required for these local-host options, and there is no built-in SaaS login.
  Preserve an existing cloud binding and follow its operator's deployment guide.

Report the chosen Project and connection option, prerequisite detection,
publication/connection checks actually completed, and the remaining user action
if login or invitation testing is pending. Never report a copied request,
detected executable, or partially completed login as a working shared link.
