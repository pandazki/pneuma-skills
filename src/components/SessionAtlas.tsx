/**
 * SessionAtlas — controlled view of THIS session's Pneuma-managed
 * state. Renders inside the Editor tab as one of two selectable
 * "files" in the sidebar (alongside the real file tree); selecting it
 * returns the user from any open file back to this overview.
 *
 * The Editor tab's mental model:
 *   - File tree shows real user content (free-form CodeMirror).
 *   - Pneuma-managed files (`session.json`, `history.json`, `CLAUDE.md`,
 *     `shadow.git/`, `.claude/skills/`, init `config.json`, etc.) are
 *     filtered out of the tree because editing them as raw JSON is
 *     hostile.
 *   - Instead, this Atlas surfaces them as labeled, structured cards.
 *     Today everything is read-only; the planned next step is to turn
 *     the cards with stable schemas into proper edit forms (e.g.
 *     `session.json`'s display name, init `config.json`'s paper size,
 *     `project.json`'s description).
 *
 * Project-level meta (project preferences, sessions roll-up across
 * the project) deliberately does NOT live here — it belongs on the
 * Project chip / panel. This view is per-session.
 */
import { useStore } from "../store.js";

interface MetaRowProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function MetaRow({ label, value, mono }: MetaRowProps) {
  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className="w-32 shrink-0 text-cc-muted/60 uppercase tracking-wider text-[10px]">
        {label}
      </span>
      <span
        className={`flex-1 min-w-0 truncate ${
          mono ? "font-mono-code text-cc-fg/80" : "text-cc-fg"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 rounded-lg border border-cc-border/40 bg-cc-bg/20">
      <div className="text-[10px] uppercase tracking-wider text-cc-muted/60">
        {label}
      </div>
      <div className="text-base text-cc-fg font-medium tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-cc-muted/50">{hint}</div> : null}
    </div>
  );
}

export default function SessionAtlas() {
  const session = useStore((s) => s.session);
  const modeManifest = useStore((s) => s.modeManifest);
  const projectContext = useStore((s) => s.projectContext);

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-cc-muted/40 text-sm">
        Session info loading…
      </div>
    );
  }

  const modeLabel =
    modeManifest?.displayName ?? session.cwd.split("/").pop() ?? "Session";
  const sessionShort = session.session_id.slice(0, 8);
  const cost =
    session.total_cost_usd > 0 ? `$${session.total_cost_usd.toFixed(4)}` : "—";
  const lines =
    session.total_lines_added + session.total_lines_removed > 0
      ? `+${session.total_lines_added} / −${session.total_lines_removed}`
      : "—";
  const ctx =
    Number.isFinite(session.context_used_percent) && session.context_used_percent > 0
      ? `${session.context_used_percent.toFixed(0)}%`
      : "—";

  // Shorten the home directory prefix to ~/. We don't have homedir in
  // the store, but stripping a `/Users/<name>/` or `/home/<name>/`
  // prefix is fine for the common cases.
  const cwdShort = session.cwd
    .replace(/^\/(Users|home)\/[^/]+\//, "~/")
    .replace(/^\/root\//, "~/");

  return (
    <div className="h-full overflow-y-auto px-8 py-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-10">
        {/* Header — mode + identity */}
        <header className="flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium">
            Session
          </div>
          <h2 className="font-display text-2xl text-cc-fg leading-tight">
            {modeLabel}
          </h2>
          <p className="text-sm text-cc-muted/70 leading-relaxed">
            What you're looking at is everything Pneuma keeps for this session — the
            things that aren't in the file tree because editing them as raw JSON
            would be more friction than help. They live under{" "}
            <span className="font-mono-code text-cc-muted">
              .pneuma/sessions/{sessionShort}…/
            </span>{" "}
            on disk.
          </p>
          {projectContext?.projectRoot ? (
            <p className="text-xs text-cc-muted/60">
              Part of project{" "}
              <span className="text-cc-fg/80">
                {projectContext.projectName ??
                  projectContext.projectRoot.split("/").pop()}
              </span>
              . Project-level info (cover, sibling sessions, project preferences) is on
              the Project chip in the top-left.
            </p>
          ) : null}
        </header>

        {/* Activity stats */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Turns"
            value={session.num_turns}
            hint="agent ↔ user round-trips"
          />
          <StatCard label="Cost" value={cost} hint="this session" />
          <StatCard label="Context" value={ctx} hint="of the model's window" />
          <StatCard label="Lines" value={lines} hint="net file edits" />
        </section>

        {/* Session metadata — labeled, mono for ids/paths. Future: each
            row gets an inline edit affordance for the editable fields
            (display name, model picker, etc.). */}
        <section className="flex flex-col gap-3">
          <h3 className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium flex items-center justify-between">
            <span>Identity</span>
            <span className="text-cc-muted/40 normal-case tracking-normal text-[10px]">
              read-only · controlled edit forms coming
            </span>
          </h3>
          <div className="flex flex-col gap-2 px-4 py-4 rounded-lg border border-cc-border/40 bg-cc-bg/20">
            <MetaRow label="Mode" value={modeLabel} />
            <MetaRow label="Backend" value={session.backend_type} mono />
            <MetaRow label="Model" value={session.model || "—"} mono />
            <MetaRow label="Session id" value={session.session_id} mono />
            <MetaRow label="Working dir" value={cwdShort} mono />
            {session.pid ? <MetaRow label="PID" value={session.pid} mono /> : null}
            <MetaRow
              label="Agent version"
              value={session.agent_version || session.claude_code_version || "—"}
              mono
            />
          </div>
        </section>

        {/* Skills installed in this session — managed by the skill
            installer. These would be hidden in `.claude/skills/` in
            the file tree; surfaced here so the user can see what the
            agent reads on every turn. */}
        {session.skills && session.skills.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium">
              Skills installed
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {session.skills.map((skill) => (
                <span
                  key={skill}
                  className="px-2 py-0.5 text-[11px] rounded-md border border-cc-border/40 bg-cc-bg/30 text-cc-fg/80 font-mono-code"
                >
                  {skill}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {/* MCP servers (when present). Hidden when empty so the view
            stays calm for sessions without these. */}
        {session.mcp_servers && session.mcp_servers.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium">
              MCP servers
            </h3>
            <div className="flex flex-col gap-1.5">
              {session.mcp_servers.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center gap-3 text-xs px-3 py-1.5 rounded-md border border-cc-border/40 bg-cc-bg/20"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      s.status === "ready" || s.status === "connected"
                        ? "bg-cc-success"
                        : s.status === "failed"
                          ? "bg-cc-error"
                          : "bg-cc-muted/40"
                    }`}
                    aria-hidden
                  />
                  <span className="text-cc-fg/80 flex-1 truncate font-mono-code">
                    {s.name}
                  </span>
                  <span className="text-cc-muted/60 text-[11px]">{s.status}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* What's hidden — explainer. Removes the "where did my files
            go?" mystery without dumping every internal name on screen. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] uppercase tracking-wider text-cc-muted/60 font-medium">
            Hidden from the file tree
          </h3>
          <p className="text-sm text-cc-muted/70 leading-relaxed">
            The file tree intentionally drops Pneuma's bookkeeping —{" "}
            <span className="font-mono-code text-cc-muted">session.json</span>,{" "}
            <span className="font-mono-code text-cc-muted">history.json</span>,{" "}
            <span className="font-mono-code text-cc-muted">CLAUDE.md</span>,{" "}
            <span className="font-mono-code text-cc-muted">shadow.git/</span>,{" "}
            <span className="font-mono-code text-cc-muted">checkpoints.jsonl</span>,
            and the installed{" "}
            <span className="font-mono-code text-cc-muted">.claude/skills/</span>.
            They're managed by the agent and runtime; raw JSON edits would usually
            break something. The cards above show what they contain. As parts of
            them grow stable schemas, each will get its own controlled edit form.
          </p>
        </section>
      </div>
    </div>
  );
}
