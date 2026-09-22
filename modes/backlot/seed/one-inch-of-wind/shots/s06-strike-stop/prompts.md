# 杀招·止 · 成片提示包

```prompt
@Video1 = geometry, timing, camera only; replace grey placeholders.
@Image1 = opening look; @Image2 = storyboard intent.
@Image3 = ivory keeper; @Image4 = teal challenger; preserve identities.
@Image5 = courtyard materials; @Image6 = keyframe look.
@Image7 = previous used out-frame; continue its pose in this camera.
Camera: Locked-off rear-side medium two-shot, one tiny contact impact settles immediately; end on the held neck gap, one continuous shot, no cut. Northwest camera fixed; preserve accepted opening blade occlusion, then reveal safe neck gap.
Original fictional wuxia characters, painted 3D dusk courtyard; no existing franchise characters or recognizable soundtrack. Blue-grey pawn=challenger; ivory pawn=keeper.
Open at blade contact; accepted rear-side occlusion lasts 0–0.5s.
Seconds 0–0.5: Contact at0s; slow-motion redirect, glint afterward, dust suspended; accepted blade occlusion.
Seconds 0.5–0.75: Sudden speed release; thrust passes shoulder, coat whips, eyes surprised.
Seconds 0.75–1: Slow-motion tip stops3cm from side neck; wide-eyed freeze, cloth travels, no injury.
Seconds 1–2.5: Tip stationary; challenger slowly lowers sword to thigh, jaw releases, cloth settles.
Seconds 2.5–4: Hold staggered stances and safe gap; keeper composed, challenger accepting, breathing and flags only.
Whole limbs, weighted steps, no text. Sound: steel ring, cloth, stone steps; no music, no speech.
```

## Reference manifest and exact design

Source: prompts.skeleton.md; the approved action details are compacted in the block; full originals remain in prompts.skeleton.md. Camera implementation: greybox revision 5.

创作者接受（本轮白模批准）：西北侧后机位接触瞬间前0.5秒守剑人挡住剑刃是该机位的语言，保持机位；generate使用 --allow-failing 并把原因存入take记录。

Entry / exit (approved):
{
  "from": "s05-strike-close",
  "entry": "Challenger screen left at (-0.05,0.8,0.15), left knee forward, right-hand blade extended toward keeper upper chest; keeper screen right at (0.25,0,0.15), beginning a small eastward sidestep, raised blade a hair short of the incoming blade; no contact yet.",
  "exit": "Challenger at (-0.3,-0.45,0.15), facing south, shoulders rigid, right-hand sword lowered beside thigh; keeper at (0.35,0,0.15), turned southwest, sword tip stationary 3 cm from challenger side neck; shoulders staggered, feet planted, no wound, cloth settled."
}

## 完整detail审计

发送块仅压缩同义表述，时间范围、招式、因果、动作结果沿用skeleton；完整原文保留于prompts.skeleton.md。


## 输出拒绝后的修正

首次请求由服务以generated_video潜在版权问题拒绝，未返回视频。重试明确原创虚构角色与无既有作品配乐，保持自建设定、已批准机位和动作，不变更或绕过服务过滤。
