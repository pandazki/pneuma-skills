# 杀招·迫 · 成片提示包

```prompt
@Video1 = geometry, timing, camera only; replace grey placeholders.
@Image1 = opening look; @Image2 = storyboard intent.
@Image3 = ivory keeper; @Image4 = teal challenger; preserve identities.
@Image5 = courtyard materials; @Image6 = keyframe look.
@Image7 = previous used out-frame; continue its pose in this camera.
Camera: Locked-off low close two-shot, faces and sword path visible through the final frame; one continuous shot, no cut.
Stylized animated wuxia, matte painted faces and brush textures, dusk stone courtyard. Blue-grey pawn=challenger; ivory pawn=keeper.
Open mid-lunge, left foot planted, challenger sword still at ribs.
Seconds 0–1: Accelerate from planted left foot, thrust upper chest; keeper slides east, raises blade, sleeves trail.
Seconds 1–1.5: Contact at1s; slow-motion redirect, subsequent glint, hanging dust, taut faces.
Seconds 1.5–1.75: Sudden speed release; thrust passes shoulder, coat whips, eyes surprised.
Seconds 1.75–2: Slow-motion tip stops3cm from side neck; wide-eyed freeze, cloth travels, no injury.
Seconds 2–3.5: Tip stationary; challenger slowly lowers sword to thigh, jaw releases, cloth settles.
Seconds 3.5–4: Hold staggered stances and neck gap; keeper composed, challenger accepting, breathing and flags only.
Whole limbs, weighted steps, no text. No music. No speech.
```

## Reference manifest and exact design

Source: prompts.skeleton.md; the approved action details are compacted in the block; full originals remain in prompts.skeleton.md. Camera implementation: greybox revision 4.

Edit uses [0,1)s only; source continues the shared master action for all4s. Handoff is frame24, not final source frame.

Entry / exit (approved):
{
  "from": "s04-strike-start",
  "entry": "Challenger screen left at (-0.15,1.3,0.15), facing screen right toward keeper, left foot just planted, right heel lifted, sword still chambered beside ribs; keeper screen right at (0,0,0.15), sword low; sash trails screen left, no blade contact.",
  "exit": "Challenger screen left at (-0.05,0.8,0.15), left knee forward, right-hand blade extended toward keeper upper chest; keeper screen right at (0.25,0,0.15), beginning a small eastward sidestep, raised blade a hair short of the incoming blade; no contact yet."
}

## 完整detail审计

发送块仅压缩同义表述，时间范围、招式、因果、动作结果沿用skeleton；完整原文保留于prompts.skeleton.md。


## 参考重绘后待复核

05分镜和两张锚点改为明确动画插画，人物服装与动作保留。此提示包待用户确认参考图后才用于重试，尚未发送。
