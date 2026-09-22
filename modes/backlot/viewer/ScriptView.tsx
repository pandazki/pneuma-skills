/**
 * Idea and Screenplay — the two stages that are pure prose.
 *
 * The page is set like a script (scene headings in small caps, character cues
 * centred, dialogue in a narrow measure) but the FILE is ordinary markdown:
 * `screenplay.md` is what the creator reads, edits and hands to anybody else,
 * and the viewer must not need a second format to render it. Classification
 * lives in `screenplay.ts` and is deliberately reversible — anything it is
 * unsure about is set as action.
 *
 * The scene list on the left is the machine truth (`backlot.json.scenes`)
 * beside the prose: each scene names the shots that were broken out of it,
 * and a shot chip is a link into the boards.
 */

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Project, Scene, StageId } from "../domain.js";
import { hasInlineMarkdown, screenplayBlocks, type ScreenplayBlock } from "./screenplay.js";
import { SceneIcon } from "./icons.js";
import { StageEmpty } from "./StageEmpty.js";

export interface ScriptViewProps {
  project: Project;
  /** `idea` shows `idea.md`; `script` shows `screenplay.md` and the scenes. */
  stage: Extract<StageId, "idea" | "script">;
  selectedScene: string | null;
  onSelectScene: (scene: string) => void;
  /** Open a shot on the boards stage. */
  onOpenShot: (shot: string) => void;
  dark: boolean;
}

export function ScriptView({
  project,
  stage,
  selectedScene,
  onSelectScene,
  onOpenShot,
  dark,
}: ScriptViewProps) {
  const markdown = stage === "idea" ? project.idea : project.screenplay;
  const blocks = useMemo(() => (markdown ? screenplayBlocks(markdown) : []), [markdown]);

  if (!markdown && (stage === "idea" || project.scenes.length === 0)) {
    return <StageEmpty stage={stage} />;
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      {stage === "script" ? (
        <nav className="flex w-56 shrink-0 flex-col border-r border-cc-border bg-cc-surface/20">
          <header className="shrink-0 border-b border-cc-border px-3 py-2">
            <h2 className="text-[11px] font-medium text-cc-fg">Scenes</h2>
            <p className="text-[10px] text-cc-muted">
              {project.scenes.length} scene{project.scenes.length === 1 ? "" : "s"} ·{" "}
              {project.shots.length} shot{project.shots.length === 1 ? "" : "s"}
            </p>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {project.scenes.length === 0 ? (
              <p className="px-1 text-[10px] leading-relaxed text-cc-muted">
                No scene has been registered yet. The agent writes the screenplay first, then
                registers each scene so the shots can hang off it.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {project.scenes.map((scene) => (
                  <li key={scene.id}>
                    <SceneCard
                      scene={scene}
                      active={scene.id === selectedScene}
                      titleOf={(id) => project.shots.find((s) => s.id === id)?.title ?? id}
                      onSelect={() => onSelectScene(scene.id)}
                      onOpenShot={onOpenShot}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl">
          <header className="mb-5 border-b border-cc-border pb-3">
            <h1 className="text-base text-cc-fg">{project.title}</h1>
            {project.logline ? (
              <p className="mt-1 text-[12px] leading-relaxed text-cc-muted">{project.logline}</p>
            ) : null}
            <p className="mt-1.5 text-[10px] uppercase tracking-wide text-cc-muted">
              {project.defaults.seconds} s · {project.defaults.fps} fps ·{" "}
              {project.defaults.width}×{project.defaults.height}
            </p>
          </header>

          {markdown ? (
            <Screenplay blocks={blocks} dark={dark} />
          ) : (
            <p className="text-[12px] leading-relaxed text-cc-muted">
              The scenes are registered but <code>screenplay.md</code> has not been written yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SceneCard({
  scene,
  active,
  titleOf,
  onSelect,
  onOpenShot,
}: {
  scene: Scene;
  active: boolean;
  titleOf: (id: string) => string;
  onSelect: () => void;
  onOpenShot: (shot: string) => void;
}) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 transition-colors ${
        active ? "border-cc-primary/50 bg-cc-primary/10" : "border-cc-border bg-cc-card"
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <span className="flex items-center gap-1.5">
          <span className="text-cc-muted">
            <SceneIcon size={10} />
          </span>
          <span className="text-[10px] tabular-nums text-cc-muted">
            {String(scene.number).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-cc-fg" title={scene.heading}>
            {scene.heading}
          </span>
        </span>
        {scene.summary ? (
          <span className="mt-0.5 block text-[10px] leading-relaxed text-cc-muted">
            {scene.summary}
          </span>
        ) : null}
      </button>
      {scene.shots.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {scene.shots.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onOpenShot(id)}
              title={`${titleOf(id)} — open on the boards`}
              className="max-w-full truncate rounded-full border border-cc-border px-1.5 py-px text-[9px] text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-fg"
            >
              {id}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[9px] text-cc-muted/80">no shots broken out yet</p>
      )}
    </div>
  );
}

/** The typeset page. One `<div>` per block, styled by what the block is. */
function Screenplay({ blocks, dark }: { blocks: ScreenplayBlock[]; dark: boolean }) {
  return (
    <div className="flex flex-col">
      {blocks.map((block, index) => (
        <Block key={index} block={block} dark={dark} />
      ))}
    </div>
  );
}

function Block({ block, dark }: { block: ScreenplayBlock; dark: boolean }) {
  switch (block.kind) {
    case "scene":
      return (
        <h2
          className={`mb-2 border-b border-cc-border pb-1 font-medium uppercase tracking-[0.18em] text-cc-fg ${
            (block.level ?? 2) <= 1 ? "mt-6 text-[13px]" : "mt-5 text-[11px]"
          }`}
        >
          <Inline text={block.text} dark={dark} />
        </h2>
      );
    case "cue":
      return (
        <p className="mt-3 text-center text-[11px] uppercase tracking-[0.22em] text-cc-primary">
          <Inline text={block.text} dark={dark} />
        </p>
      );
    case "parenthetical":
      return (
        <p className="mx-auto max-w-[22rem] text-center text-[11px] italic leading-relaxed text-cc-muted">
          <Inline text={block.text} dark={dark} />
        </p>
      );
    case "dialogue":
      return (
        <p className="mx-auto mt-1 max-w-[26rem] whitespace-pre-line text-center text-[12.5px] leading-relaxed text-cc-fg">
          <Inline text={block.text} dark={dark} />
        </p>
      );
    case "markdown":
      return (
        <div
          className={`prose prose-sm my-2 max-w-none text-[12px] [&_pre]:whitespace-pre-wrap [&_table]:block [&_table]:overflow-x-auto ${
            dark ? "prose-invert prose-neutral" : "prose-neutral"
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
        </div>
      );
    default:
      return (
        <p className="mt-2.5 whitespace-pre-line text-[12.5px] leading-relaxed text-cc-fg/90">
          <Inline text={block.text} dark={dark} />
        </p>
      );
  }
}

/**
 * Inline markdown inside one typeset block.
 *
 * The same `react-markdown` the Plan tab uses, with `p` unwrapped so the
 * block's own element keeps the typography. Plain text skips it entirely —
 * a screenplay is mostly plain text and parsing every line twice would buy
 * nothing.
 */
function Inline({ text, dark }: { text: string; dark: boolean }) {
  if (!hasInlineMarkdown(text)) return <>{text}</>;
  return (
    <span className={dark ? "prose-invert" : undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <>{children}</>,
          a: ({ children, href }) => (
            <a href={href} className="text-cc-primary underline" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </span>
  );
}

export default ScriptView;
