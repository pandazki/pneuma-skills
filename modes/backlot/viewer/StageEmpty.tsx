/**
 * What an empty stage says.
 *
 * A stage with nothing in it is a normal state of this mode — the film moves
 * through eight of them in order and seven are empty on the first day. So it
 * gets a sentence naming what the agent will produce here, never a blank
 * pane the user has to interpret (the brief's "partial states are drawn as
 * such").
 */

import type { StageId } from "../domain.js";
import { stageLabel } from "../domain.js";

export const STAGE_BLURB: Record<StageId, string> = {
  idea: "Tell the agent what the film is — the agent writes the logline, the tone, the length and who it is for, and you read it back here before anything else starts.",
  script:
    "Once the idea is approved the agent writes the screenplay: scenes with their headings, the action, and every line of dialogue — plus the scene list this stage is checked against.",
  bible:
    "Every character and every place gets a written look, a generated sheet or concept frame, and — for the characters who speak — a voice sample. This is what keeps the same face across shots.",
  boards:
    "The scenes are broken into shots, and each shot gets one concept frame generated from the bible images, so the wardrobe and the set dressing hold before a single take is bought.",
  previz:
    "The shot is blocked in 3D first: a timed plan, a Blender script, and a greybox render that fixes the room, the action and the camera — the exact clip the video model is conditioned on.",
  takes:
    "An accepted greybox is sent to the video model with the board and the bible as references. Every take is checked, and one is selected as the shot's delivery.",
  sound:
    "Voice-over lines are recorded as TTS and the music is generated from a written brief. The takes' own audio stays as ambience; nothing is dubbed over a mouth the model animated.",
  cut: "The selected takes are assembled in shot order with the voice-over placed and the music laid under. A reel with greybox stand-ins can be built for free at any time.",
};

export function StageEmpty({ stage, note }: { stage: StageId; note?: string | null }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <p className="text-[10px] uppercase tracking-[0.2em] text-cc-muted">
          {stageLabel(stage)} — nothing yet
        </p>
        <p className="mt-2 text-sm leading-relaxed text-cc-muted">{STAGE_BLURB[stage]}</p>
        {note ? <p className="mt-2 text-[11px] leading-relaxed text-cc-warning">{note}</p> : null}
      </div>
    </div>
  );
}

export default StageEmpty;
