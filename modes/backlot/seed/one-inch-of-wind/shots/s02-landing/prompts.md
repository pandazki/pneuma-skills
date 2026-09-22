# 跃下入局 · 成片提示包

```prompt
@Video1 = geometry, timing, camera only; replace grey placeholders.
@Image1 = opening look; @Image2 = storyboard intent.
@Image3 = ivory keeper; @Image4 = teal challenger; preserve identities.
@Image5 = courtyard materials; @Image6 = keyframe look.
@Image7 = previous used out-frame; continue its pose in this camera.
Painted 3D wuxia, dusk stone courtyard. Blue-grey pawn=challenger; ivory pawn=keeper.
Open on the loaded challenger atop the stairs; keeper stays offscreen.
Seconds 0–1.25: Explosively, challenger leaps south from loaded knees; eyes ahead, ponytail and sash streaming.
Seconds 1.25–1.5: Soles contact dais at1.25s; knees compress, dust follows impact, jaw clenched.
Seconds 1.5–2.5: Deliberately rise, lower sword, plant feet; coat settles, gaze steady.
Seconds 2.5–5.5: Hold torso and expression; background compresses, dust subsides, sash settles.
Seconds 5.5–6: Hold three metres apart, sword down; controlled breathing, no step.
Camera: One dolly zoom after landing holds torso scale and ends still, background compressed; one continuous shot, no cut.
Whole limbs, weighted steps, stable costumes; no text. No music. No speech.
```

## Reference manifest and exact design

Source: prompts.skeleton.md; the approved action details are compacted in the block; full originals remain in prompts.skeleton.md. Camera implementation: greybox revision 3.


Entry / exit (approved):
{
  "from": "s01-arrival",
  "entry": "Challenger screen left on the north landing (0,8.4,1.2), facing south, knees compressed, right-hand sword behind his hip; keeper screen right at (0,0,0.15), facing north, right-hand sword lowered; no contact.",
  "exit": "Challenger at (0,3,0.15), facing south toward the offscreen keeper, upright after landing, right-hand sword lowered, feet planted; keeper at (0,0,0.15), facing north, sword lowered; three metres apart, dust settled, no contact."
}

## 完整detail审计

发送块仅压缩同义表述，时间范围、招式、因果、动作结果沿用skeleton；完整原文保留于prompts.skeleton.md。
