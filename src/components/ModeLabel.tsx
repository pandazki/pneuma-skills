/**
 * ModeLabel — read-only label of the current session's mode.
 *
 * Replaced the v1 ModeSwitcherDropdown. Mode switching now lives
 * exclusively in the Project Panel's launch sheet — the user opens the
 * Project chip, picks a mode tile, fills params (and optionally Smart
 * Handoff), and confirms. Putting a second switcher here on the Mode chip
 * itself muddied the mental model: this is **the Mode you're in**, not a
 * place to leave from.
 *
 * Visually unified with the ContentSet / workspace-item selector behind it
 * in TopBar — together they read as "you are looking at <ContentSet> inside
 * <Mode>". This component contributes the Mode part and intentionally has
 * no caret, no hover treatment, no border — to mark itself as a label.
 */
import { useStore } from "../store.js";

export default function ModeLabel() {
  const sessionMode = useStore((s) => s.modeManifest?.name);
  const sessionDisplayName = useStore((s) => s.modeDisplayName);
  const label = sessionDisplayName || sessionMode;
  if (!label) return null;
  return (
    <span className="text-xs font-medium text-cc-fg px-1 select-none">
      {label}
    </span>
  );
}
