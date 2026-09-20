# Upstream reference — kept verbatim

`blender-video-workflows/` is an unmodified snapshot of
[modengsir/blender-video-workflows](https://github.com/modengsir/blender-video-workflows)
at commit `8dbcdc4b7d1f1d8b701e8de6e9258b63d63a5afb` (2026-09-20), MIT — its
`LICENSE` travels with it. It is two instruction-only Codex skills
(`blender-video-original`, `blender-video-recreate`) and the practice this mode
was built from: 3D greybox animation → prompt pack → video model.

It is here as the original reference, to be read next to what this mode became.
Nothing in this directory is installed into a workspace or loaded by the mode —
the agent's skill is `../skill/`. What was borrowed, adapted, added and
deliberately dropped (notably: limb animation and the gait checks) is recorded in
[`../NOTICE.md`](../NOTICE.md); the evidence behind those choices is in
`docs/proposals/2026-09-20-previz-experiments.md`.

Do not edit these files. To track upstream, replace the whole snapshot and
update the commit above and in `NOTICE.md`.
