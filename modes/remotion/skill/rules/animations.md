---
name: animations
description: Fundamental animation skills for Remotion
metadata:
  tags: animations, transitions, frames, useCurrentFrame
---

All animations are driven by the `useCurrentFrame()` hook.  
Write animations in seconds and multiply them by the `fps` value from `useVideoConfig()`.

```tsx
import { useCurrentFrame } from "remotion";

export const FadeIn = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 2 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  return <div style={{ opacity }}>Hello World!</div>;
};
```

CSS transitions and animations, including Tailwind's `transition-*` / `animate-*` classes, do not render correctly: each frame is rendered independently, so time-based CSS has no consistent state to animate from.
