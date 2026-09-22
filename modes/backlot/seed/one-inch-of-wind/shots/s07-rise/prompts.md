# 高处余风 · 成片提示包

```prompt
@Video1 = geometry, timing, camera only; replace grey placeholders.
@Image1 = opening look; @Image2 = storyboard intent.
@Image3 = ivory keeper; @Image4 = teal challenger; preserve identities.
@Image5 = courtyard materials; @Image6 = keyframe look.
@Image7 = previous used out-frame; continue its pose in this camera.
Camera: One continuous crane rising backward ends still on the whole courtyard, fixed focal length; one continuous shot, no cut.
Painted 3D wuxia, dusk stone courtyard. Blue-grey pawn=challenger; ivory pawn=keeper.
Open with keeper tip at neck; challenger sword already lowered.
Seconds 0–1: Only after seeing the lowered opponent sword, the keeper slowly withdraws his tip and lowers his blade; challenger exhales, shoulders easing, no foot movement.
Seconds 1–4.5: In calm stillness both swords stay lowered, faces soften and robes settle; flags resume their gentle motion while the men recede into the courtyard.
Seconds 4.5–6: Hold a quiet wide ending, two small grounded figures beneath the dusk mountains; flags and leaves move gently, no new action or on-screen text.
Whole limbs, weighted steps, stable costumes; no text. Sound: gentle wind and cloth; no music, no speech.
```

## Reference manifest and exact design

Source: prompts.skeleton.md; every registered action detail above is carried verbatim. Camera implementation: greybox revision 3.


Entry / exit (approved):
{
  "from": "s06-strike-stop",
  "entry": "Challenger at (-0.3,-0.45,0.15), facing south, shoulders rigid, right-hand sword lowered beside thigh; keeper at (0.35,0,0.15), turned southwest, sword tip stationary 3 cm from challenger side neck; shoulders staggered, feet planted, no wound, cloth settled.",
  "exit": "Both fighters remain on their final marks, challenger sword lowered and keeper sword withdrawn down to his right side, shoulders relaxed, no contact; the whole courtyard is visible and flags move in the wind."
}
