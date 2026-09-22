# 杀招·起 · 成片提示包

```prompt
@Video1 = geometry, timing, camera only; replace grey placeholders.
@Image1 = opening look; @Image2 = storyboard intent.
@Image3 = ivory keeper; @Image4 = teal challenger; preserve identities.
@Image5 = courtyard materials; @Image6 = keyframe look.
@Image7 = previous used out-frame; continue its pose in this camera.
Camera: Locked-off oblique wide shot, both bodies and path visible through the final frame; one continuous shot, no cut.
Painted 3D wuxia, dusk stone courtyard. Blue-grey pawn=challenger; ivory pawn=keeper.
Open loaded, challenger sword at ribs, keeper blade low.
Seconds 0–1: Sharp burst: rear-foot drive, left foot reaches, sword at ribs; sash snaps, narrowed eyes.
Seconds 1–2: Accelerate from planted left foot, thrust upper chest; keeper slides east, raises blade, sleeves trail.
Seconds 2–2.5: Contact at2s; slow-motion redirect, subsequent glint, hanging dust, taut faces.
Seconds 2.5–2.75: Sudden speed release; thrust passes shoulder, coat whips, eyes surprised.
Seconds 2.75–3: Slow-motion returning tip stops3cm from side neck; wide-eyed freeze, cloth travels, no injury.
Seconds 3–4: Tip stationary; challenger slowly lowers sword to thigh, jaw releases, cloth settles.
Whole limbs, weighted steps, no text. No music. No speech.
```

## Reference manifest and exact design

Source: prompts.skeleton.md; the approved action details are compacted in the block; full originals remain in prompts.skeleton.md. Camera implementation: greybox revision 4.

Edit uses [0,1)s only; source continues the shared master action for all4s. Handoff is frame24, not final source frame.

Entry / exit (approved):
{
  "from": "s03-orbit",
  "entry": "Challenger screen left at (-0.3,2.3,0.15), facing the keeper, right foot behind, weight loaded, right-hand sword chambered beside ribs; keeper screen right at (0,0,0.15), facing challenger, sword low, calm; blades separated.",
  "exit": "Challenger screen left at (-0.15,1.3,0.15), facing screen right toward keeper, left foot just planted, right heel lifted, sword still chambered beside ribs; keeper screen right at (0,0,0.15), sword low; sash trails screen left, no blade contact."
}

## 完整detail审计

发送块仅压缩同义表述，时间范围、招式、因果、动作结果沿用skeleton；完整原文保留于prompts.skeleton.md。
