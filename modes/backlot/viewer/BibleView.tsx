/**
 * The bible — every character and every place, with the look that keeps them
 * the same across shots.
 *
 * Two grids, one card each. A card is the record `backlot.mjs` wrote: the
 * sheet or concept frame (cache-busted by its own revision, because media is
 * never watched), the name, the one-line description, and — for a character
 * — the voice sample, so the creator hears the voice before a line is
 * bought. A card with no image says what will appear there instead of
 * showing a hole.
 */

import type { Character, Project, SetPiece } from "../domain.js";
import { recordRev } from "../domain.js";
import { AudioButton } from "./AudioButton.js";
import { ImageIcon, VoiceIcon } from "./icons.js";
import { StageEmpty } from "./StageEmpty.js";

export interface BibleViewProps {
  project: Project;
  selectedCharacter: string | null;
  selectedSet: string | null;
  onSelectCharacter: (id: string) => void;
  onSelectSet: (id: string) => void;
  /** Workspace-relative path + cache buster → `/content/…` URL. */
  urlFor: (path: string, rev: number | string) => string | null;
}

export function BibleView({
  project,
  selectedCharacter,
  selectedSet,
  onSelectCharacter,
  onSelectSet,
  urlFor,
}: BibleViewProps) {
  if (project.characters.length === 0 && project.sets.length === 0) {
    return <StageEmpty stage="bible" />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <Section
        title="Characters"
        count={project.characters.length}
        empty="No character yet. The agent writes a look for each one, generates the sheet, and picks a voice."
      >
        {project.characters.map((character) => (
          <CharacterCard
            key={character.id}
            character={character}
            active={character.id === selectedCharacter}
            onSelect={() => onSelectCharacter(character.id)}
            urlFor={urlFor}
          />
        ))}
      </Section>

      <Section
        title="Sets"
        count={project.sets.length}
        empty="No place yet. A set is where a scene is played, and its concept frame is the wide view the greybox is built to match."
      >
        {project.sets.map((set) => (
          <SetCard
            key={set.id}
            set={set}
            active={set.id === selectedSet}
            onSelect={() => onSelectSet(set.id)}
            urlFor={urlFor}
          />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <header className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-cc-fg">{title}</h2>
        <span className="text-[10px] tabular-nums text-cc-muted">{count}</span>
      </header>
      {count === 0 ? (
        <p className="max-w-lg text-[11px] leading-relaxed text-cc-muted">{empty}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">{children}</ul>
      )}
    </section>
  );
}

function Card({
  active,
  onSelect,
  name,
  id,
  description,
  imageUrl,
  imageNote,
  footer,
}: {
  active: boolean;
  onSelect: () => void;
  name: string;
  id: string;
  description: string;
  imageUrl: string | null;
  imageNote: string;
  footer?: React.ReactNode;
}) {
  return (
    <li>
      <div
        className={`flex h-full flex-col overflow-hidden rounded-md border transition-colors ${
          active ? "border-cc-primary/50 bg-cc-primary/10" : "border-cc-border bg-cc-card"
        }`}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          className="block w-full text-left"
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/40">
            {imageUrl ? (
              <img src={imageUrl} alt={name} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center text-cc-muted">
                <ImageIcon size={16} />
                <span className="text-[9px] leading-relaxed">{imageNote}</span>
              </span>
            )}
          </div>
          <div className="px-2.5 py-2">
            <p className="truncate text-[12px] text-cc-fg">{name}</p>
            <p className="truncate text-[9px] text-cc-muted">{id}</p>
            {description ? (
              <p className="mt-1 line-clamp-3 text-[10.5px] leading-relaxed text-cc-muted">
                {description}
              </p>
            ) : null}
          </div>
        </button>
        {footer ? (
          <div className="mt-auto flex items-center gap-2 border-t border-cc-border px-2.5 py-1.5">
            {footer}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CharacterCard({
  character,
  active,
  onSelect,
  urlFor,
}: {
  character: Character;
  active: boolean;
  onSelect: () => void;
  urlFor: BibleViewProps["urlFor"];
}) {
  const sample = character.voice?.sample ?? null;
  return (
    <Card
      active={active}
      onSelect={onSelect}
      name={character.name}
      id={character.id}
      description={character.description}
      imageUrl={
        character.sheet
          ? urlFor(`${character.dir}/${character.sheet.file}`, character.sheet.revision)
          : null
      }
      imageNote="The character sheet goes here — the same face, three-quarter, front and profile, on a neutral background."
      footer={
        sample ? (
          <>
            <AudioButton
              url={urlFor(`${character.dir}/${sample.file}`, recordRev(sample))}
              label={`${character.name}'s voice`}
              seconds={sample.seconds}
              title={sample.text || `${character.name}'s voice sample`}
            />
            <span className="min-w-0 flex-1 truncate text-[9px] text-cc-muted" title={sample.text}>
              {character.voice?.style || character.voice?.voiceId || sample.text}
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-[9px] text-cc-muted">
            <VoiceIcon size={11} />
            no voice sample yet
          </span>
        )
      }
    />
  );
}

function SetCard({
  set,
  active,
  onSelect,
  urlFor,
}: {
  set: SetPiece;
  active: boolean;
  onSelect: () => void;
  urlFor: BibleViewProps["urlFor"];
}) {
  return (
    <Card
      active={active}
      onSelect={onSelect}
      name={set.name}
      id={set.id}
      description={set.description}
      imageUrl={set.concept ? urlFor(`${set.dir}/${set.concept.file}`, set.concept.revision) : null}
      imageNote="The concept frame goes here — one wide establishing view of the place, matching the layout the greybox will be built to."
    />
  );
}

export default BibleView;
