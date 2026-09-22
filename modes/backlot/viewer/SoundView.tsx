/**
 * Sound — every line in the film, and the music under it.
 *
 * The two kinds of line are shown as two kinds, because they are produced by
 * two different machines: a `spoken` line is rendered BY THE VIDEO MODEL
 * inside its take (there is no file here, and there should not be one), a
 * `vo` line is a TTS file mixed into the cut. A row with no file says which
 * of those it is waiting for rather than offering a dead play button.
 */

import type { Project, SoundLine } from "../domain.js";
import { recordRev, resolveLinePath } from "../domain.js";
import { AudioButton } from "./AudioButton.js";
import { MusicIcon } from "./icons.js";
import { StageEmpty } from "./StageEmpty.js";

export interface SoundViewProps {
  project: Project;
  selectedLine: string | null;
  onSelectLine: (id: string) => void;
  /** Workspace-relative path + cache buster → `/content/…` URL. */
  urlFor: (path: string, rev: number | string) => string | null;
}

export function SoundView({ project, selectedLine, onSelectLine, urlFor }: SoundViewProps) {
  const { lines, music } = project.sound;
  if (lines.length === 0 && !music) {
    return <StageEmpty stage="sound" />;
  }

  const spend = project.stages.find((s) => s.id === "sound")?.usd ?? 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <section className="mb-5">
        <header className="mb-2 flex items-baseline gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-cc-fg">Lines</h2>
          <span className="text-[10px] tabular-nums text-cc-muted">{lines.length}</span>
          {spend > 0 ? (
            <span className="ml-auto text-[10px] tabular-nums text-cc-muted">
              ${spend.toFixed(2)} on this stage
            </span>
          ) : null}
        </header>

        {lines.length === 0 ? (
          <p className="max-w-lg text-[11px] leading-relaxed text-cc-muted">
            No line has been written yet. Lines are registered on the shot they belong to — a
            spoken line is rendered by the video model, a voice-over is recorded here.
          </p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-cc-muted">
                <th className="py-1 pr-2 font-normal">Shot</th>
                <th className="py-1 pr-2 font-normal">Speaker</th>
                <th className="py-1 pr-2 font-normal">Kind</th>
                <th className="py-1 pr-2 font-normal">Line</th>
                <th className="py-1 pr-2 text-right font-normal">At</th>
                <th className="py-1 pr-2 text-right font-normal">Sec</th>
                <th className="py-1 font-normal">Play</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <LineRow
                  key={`${line.shot}:${line.id}`}
                  line={line}
                  active={line.id === selectedLine}
                  projectDir={project.dir}
                  onSelect={() => onSelectLine(line.id)}
                  urlFor={urlFor}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-cc-fg">Music</h2>
        {music ? (
          <div className="flex items-start gap-3 rounded-md border border-cc-border bg-cc-card px-3 py-2.5">
            <AudioButton
              url={urlFor(
                project.dir ? `${project.dir}/sound/${music.file}` : `sound/${music.file}`,
                recordRev(music),
              )}
              label="the music"
              seconds={music.seconds}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-relaxed text-cc-fg">
                {music.prompt || "No brief recorded for this track."}
              </p>
              <p className="mt-1 text-[9px] text-cc-muted">
                {music.model || "unknown model"}
                {music.cost ? ` · $${music.cost.usd.toFixed(2)} (${music.cost.basis})` : ""}
              </p>
            </div>
          </div>
        ) : (
          <p className="flex max-w-lg items-center gap-2 text-[11px] leading-relaxed text-cc-muted">
            <MusicIcon size={13} />
            No music yet. The agent writes a brief — instruments, tempo, where it lifts — and the
            track is generated from it, then laid under the cut.
          </p>
        )}
      </section>
    </div>
  );
}

function LineRow({
  line,
  active,
  projectDir,
  onSelect,
  urlFor,
}: {
  line: SoundLine;
  active: boolean;
  projectDir: string;
  onSelect: () => void;
  urlFor: SoundViewProps["urlFor"];
}) {
  const url = line.file ? urlFor(resolveLinePath(projectDir, line.shotDir, line.file), recordRev(line)) : null;
  return (
    <tr
      onClick={onSelect}
      className={`cursor-default border-t border-cc-border/60 align-top ${
        active ? "bg-cc-primary/10" : ""
      }`}
    >
      <td className="py-1.5 pr-2 text-cc-muted" title={line.shotTitle}>
        {line.shot}
      </td>
      <td className="py-1.5 pr-2 text-cc-fg">{line.speaker || "—"}</td>
      <td className="py-1.5 pr-2">
        <span
          className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
            line.kind === "spoken"
              ? "border-cc-primary/50 bg-cc-primary/10 text-cc-primary"
              : "border-cc-border text-cc-muted"
          }`}
        >
          {line.kind}
        </span>
      </td>
      <td className="py-1.5 pr-2 text-cc-fg">{line.text || "—"}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-cc-muted">
        {line.at === null ? "—" : `${line.at.toFixed(1)} s`}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-cc-muted">
        {line.seconds === null ? "—" : line.seconds.toFixed(1)}
      </td>
      <td className="py-1.5">
        {url ? (
          <AudioButton url={url} label={`${line.speaker}: ${line.text}`} />
        ) : (
          <span className="text-[9px] text-cc-muted">
            {line.kind === "spoken" ? "in the take" : "not recorded"}
          </span>
        )}
      </td>
    </tr>
  );
}

export default SoundView;
