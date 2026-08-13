# T12 — ` ```graph ` structure blocks (G7 evidence)

Captured from the render harness (`bun modes/bansho/harness/index.html`,
viewport 1280×1000), whose demo board now carries the spec's own 数据流
example plus a second same-name block that continues it:

````
```graph 数据流
讲稿 → 推断 → 时间轴 → 播放
推断 → 语音合成
语音合成 → 播放
推断: 把讲稿变成串行 step
```

后面还能往同一张图上接着画。

```graph 数据流
播放 → 导出
```
````

| File | State | Evidences |
|------|-------|-----------|
| `01-light-complete.jpeg` | light, t = end | Six boxes, six arrows, one canvas. The second block's 导出 hangs off 播放 **without any earlier box having moved** — the frame laid out against the container's union, so a later block only adds ink. Boxes are hand-drawn (four edges in one stroke, visible closing overshoot at the corners); arrows bend through the corridor the layout reserved and every tip sits on the target box's border. The annotated node writes its explanation under its name in `--accent`, one line, no mid-word break. |
| `02-light-mid-single-pen.jpeg` | light, t = 36.9 / 41.9 s | G1 in the browser: exactly ONE unit is in progress — the 时间轴 → 播放 arrow, half drawn. Every box before it is finished with its name written; 导出 has not started. Drawing order confirmed by eye: box → its name, per node, then the arrows. (Programmatic sample over five instants: never more than one path mid-stroke.) |
| `03-dark-complete.jpeg` | dark, t = end | The same board under the dark tokens — chalk-white boxes and arrows, `--accent` explanation. Every color resolves, which is G8-D holding: they ride `element.style`, never an SVG presentation attribute. |
