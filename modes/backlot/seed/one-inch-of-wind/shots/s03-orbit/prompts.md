# 绕阵交锋 · 成片提示包

```prompt
@Video1 = geometry, timing, camera only; replace grey placeholders.
@Image1 = opening look; @Image2 = storyboard intent.
@Image3 = ivory keeper; @Image4 = teal challenger; preserve identities.
@Image5 = courtyard materials; @Image6 = keyframe look.
@Image7 = previous used out-frame; continue its pose in this camera.
Painted 3D wuxia, dusk stone courtyard. Blue-grey pawn=challenger; ivory pawn=keeper.
Open three metres apart, challenger sword lowered, keeper grounded.
Seconds 0–1.5: Brisk weighted steps advance1.3m; keeper tracks calmly without retreat.
Seconds 1.5–2: Sudden diagonal cut; compact parry, eyes track blades, sleeves snap afterward.
Seconds 2–2.5: Contact at2s; keeper redirects, steel glint follows impact; challenger recoil checked.
Seconds 2.5–4.5: Measured half-step recoil northwest, blade to ribs; sash swings then falls.
Seconds 4.5–6: Slowly sink loaded, challenger left, keeper right; jaw set, low swords separated.
Camera: One continuous 240-degree orbit ends west of both fighters in a settled wide two-shot; no cut.
Whole limbs, weighted steps, stable costumes; no text. No music. No speech.
```

## Reference manifest and exact design

Source: prompts.skeleton.md; the approved action details are compacted in the block; full originals remain in prompts.skeleton.md. Camera implementation: greybox revision 3.


Entry / exit (approved):
{
  "from": "s02-landing",
  "entry": "Challenger at (0,3,0.15), facing south toward the offscreen keeper, upright after landing, right-hand sword lowered, feet planted; keeper at (0,0,0.15), facing north, sword lowered; three metres apart, dust settled, no contact.",
  "exit": "Challenger screen left at (-0.3,2.3,0.15), facing the keeper, right foot behind, weight loaded, right-hand sword chambered beside ribs; keeper screen right at (0,0,0.15), facing challenger, sword low, calm; blades separated."
}

## 完整detail审计

发送块仅压缩同义表述，时间范围、招式、因果、动作结果沿用skeleton；完整原文保留于prompts.skeleton.md。
