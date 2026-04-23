# Scene Generation Strategies

This document covers when and how to generate visual assets for scenes, including prompt engineering, resolution handling, and thumbnail management.

## Image vs Video Decision

### Use Image Generation When

- The scene is a static establishing shot (landscape, room, setting)
- The scene shows a character portrait or close-up with no motion
- The scene is a diagram, infographic, or text-heavy visual
- You want maximum control over composition (images are more predictable than video)
- Budget is a concern (images are significantly cheaper than video clips)
- You plan to add motion later via image-to-video (two-step approach)

### Use Video Generation When

- The scene requires visible motion (walking, gesturing, turning)
- Camera movement is important (pan, zoom, dolly, tracking shot)
- The scene depicts natural motion (flowing water, wind, fire, clouds)
- The scene is an action sequence or transition
- Ambient/atmospheric motion adds value (rain, crowd, traffic)

### The Two-Step Approach (Recommended for Quality)

For the best results, especially with characters:

1. Generate a still image with `generate_image` — this gives you precise control over composition, framing, and character appearance
2. Animate the image with `generate_video_from_image` — this preserves the visual quality while adding natural motion

This approach yields more consistent and higher-quality results than `generate_video_from_text` alone, because the image anchors the visual identity. It is especially important for character scenes where consistency matters.

---

## Prompt Engineering

### Prompt Structure

Build prompts with these components, roughly in this order:

1. **Subject** — Who or what is in the frame. Be specific about appearance.
2. **Action** — What is happening (essential for video, optional for stills)
3. **Setting** — Where the scene takes place. Include background details.
4. **Lighting** — Quality, direction, and color of light. This dramatically affects mood.
5. **Camera** — Shot type, angle, and movement (for video)
6. **Style** — Artistic style, rendering approach, quality descriptors
7. **Character reference** — If a character from `characterRefs` appears, include their full description

### Shot Types

Use standard cinematography terms in prompts:

| Shot | Description | When to Use |
|------|-------------|-------------|
| Extreme wide shot (EWS) | Subject tiny in vast environment | Establishing location, scale |
| Wide shot (WS) | Full body visible with environment | Scene context, multiple characters |
| Medium shot (MS) | Waist up | Conversation, presentation |
| Close-up (CU) | Face or object fills frame | Emotion, detail, emphasis |
| Extreme close-up (ECU) | Single feature (eye, hand) | Drama, tension, detail |
| Over-the-shoulder (OTS) | Looking past one subject to another | Dialogue, perspective |
| Bird's eye / top-down | Looking straight down | Maps, layouts, pattern |
| Low angle | Camera below subject looking up | Power, authority, scale |
| High angle | Camera above subject looking down | Vulnerability, overview |

### Camera Movement (Video Only)

| Movement | Prompt Phrase | Effect |
|----------|--------------|--------|
| Static | "locked camera", "static shot" | Stability, focus |
| Pan | "camera pans left/right" | Reveal, follow action |
| Tilt | "camera tilts up/down" | Reveal height, drama |
| Push in | "camera slowly pushes in" | Increasing tension/focus |
| Pull out | "camera pulls back to reveal" | Context reveal |
| Tracking | "camera tracks alongside" | Following movement |
| Orbit | "camera orbits around" | 3D presence, showcase |

### Lighting Descriptions

| Lighting | Prompt Phrase | Mood |
|----------|--------------|------|
| Golden hour | "warm golden hour sunlight" | Warmth, nostalgia |
| Blue hour | "soft blue twilight" | Calm, melancholy |
| High key | "bright, even studio lighting" | Clean, professional |
| Low key | "dramatic shadows, single light source" | Mystery, tension |
| Backlit | "strong backlight, silhouette" | Drama, anonymity |
| Neon | "neon-lit, colorful urban night" | Energy, modern |
| Overcast | "soft diffused light, overcast sky" | Neutral, natural |

### Style Descriptors

Match style to the video's tone:

| Style | Phrase | Best For |
|-------|--------|----------|
| Cinematic | "cinematic photography, shallow DOF, film grain" | Narrative, dramatic |
| Documentary | "documentary style, natural lighting, handheld feel" | Educational, authentic |
| Animation | "3D animated, Pixar style, colorful" | Explainer, kids content |
| Illustration | "digital illustration, flat design, vector style" | Infographics, tech |
| Watercolor | "watercolor painting style, soft edges, muted palette" | Artistic, gentle |
| Photorealistic | "photorealistic, 8K, hyperdetailed" | Product, architecture |
| Retro | "VHS aesthetic, 80s color palette, film grain" | Nostalgic, creative |

---

## Aspect Ratio and Resolution

### Matching Project Aspect Ratio

Always read `project.json` to get the target aspect ratio and resolution. Pass the correct dimensions to generation tools:

| Ratio | Resolution | Use Case |
|-------|-----------|----------|
| 16:9 | 1920x1080 | YouTube, presentations, TV |
| 9:16 | 1080x1920 | TikTok, Reels, Shorts |
| 1:1 | 1080x1080 | Instagram, square format |
| 4:3 | 1440x1080 | Classic, some presentations |

When calling `generate_image`, pass `width` and `height` matching the project resolution.
When calling `generate_video_from_text` or `generate_video_from_image`, pass `aspect_ratio` as the string (e.g. `"16:9"`).

### Resolution for Thumbnails

Thumbnails should be smaller versions of the scene visual, used by the viewer for the scene strip. When a generation tool returns a `thumbnail_path`, use that. If it does not, generate a separate smaller image or note that the full-size image serves as the thumbnail.

Thumbnail naming convention: `assets/images/{scene-id}-thumb.jpg`

---

## Thumbnail Management

Every scene should have a `visual.thumbnail` set. The viewer uses thumbnails for:
- Scene strip cards (160px wide)
- Track overview filmstrip
- Video preview placeholder (when not playing)

### Getting Thumbnails

**From video generation:** Most video generation tools return a `thumbnail_path` along with the video. Use it directly.

**From image generation:** The generated image itself can serve as the thumbnail. Set `visual.thumbnail` to the same path as `visual.source`, or generate a smaller version.

**Missing thumbnails:** If a tool does not return a thumbnail, set `visual.thumbnail` to the same path as `visual.source`. The viewer will scale it down for display.

---

## Prompt Examples by Scene Type

### Establishing Shot

> "A sweeping wide shot of a futuristic cityscape at sunset. Towering glass skyscrapers reflect orange and pink clouds. Flying vehicles trace light trails between buildings. Cinematic photography, atmospheric haze, warm golden hour lighting, 4K quality."

### Character Introduction

> "A young woman scientist in a white lab coat stands confidently in a modern research lab. She has short black hair, rectangular glasses, and a warm smile. Bright fluorescent lighting, clean white surfaces, microscopes and equipment in the background. Medium shot, eye level. Professional photography style."

### Action Scene (Video)

> "A chef rapidly chops vegetables on a wooden cutting board. Close-up of hands and knife. Fresh herbs and colorful ingredients surround the board. Warm kitchen lighting from overhead pendants. Camera slowly pushes in. Documentary style, shallow depth of field, smooth 24fps motion."

### Diagram/Infographic

> "A clean infographic showing the water cycle. Blue arrows indicate evaporation rising from the ocean, cloud formation, precipitation as rain over mountains, and water flowing back to the sea. White background, flat design style, clear labels, educational illustration, minimal and professional."

### Emotional Close-Up (Video)

> "Close-up of an elderly man's face as he reads a handwritten letter. His eyes glisten with emotion. Soft window light illuminates one side of his face. Camera is static, shallow depth of field. Cinematic, warm color grading, intimate and quiet mood."

---

## Consistency Across Scenes

To maintain visual consistency throughout a video:

1. **Define a style anchor** — in the first scene, establish the visual style. Write it down as a note.
2. **Reuse style descriptors** — copy the style portion of the prompt across all scenes (e.g., "cinematic photography, warm color grading, shallow DOF").
3. **Consistent lighting** — if scene 1 uses golden hour lighting, maintain that across scenes unless the story calls for a change (e.g., transition from day to night).
4. **Character descriptions** — always pull from `characterRefs` rather than writing freehand descriptions. This prevents drift.
5. **Same model** — when possible, use the same generation model for all scenes of the same type.

---

## Generation Order Strategy

For a multi-scene video, generate in this order:

1. **Character reference sheets** — if characters exist, generate their reference images first
2. **Key scenes** — generate the most important or complex scenes first (gives user something to react to early)
3. **Supporting scenes** — fill in remaining scenes
4. **Audio** — generate TTS for all scenes after visuals are in place (so you can calibrate duration)
5. **BGM** — search/select background music last (needs total duration)

This order maximizes early feedback and minimizes wasted regeneration.

---

## Batch Generation

When generating multiple scenes at once:

1. Write ALL scene placeholders to `storyboard.json` with `status: "generating"` in one write
2. Generate each scene sequentially (MCP tools are called one at a time)
3. After each scene completes, re-read `storyboard.json`, update that scene, and write back
4. Include a locator card after each completed scene so the user can review progressively
5. After all scenes complete, provide a summary with locator cards for the full sequence

Do not wait until all scenes are done to update the storyboard — incremental updates give the user real-time progress.
