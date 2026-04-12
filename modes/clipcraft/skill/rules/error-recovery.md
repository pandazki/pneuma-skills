# Error Recovery

Generation tools can fail for various reasons. This document defines fallback strategies to keep production moving. The goal is to never leave the user stuck — always have a next step.

## General Principles

1. **Update the storyboard immediately** — when an error occurs, set `status: "error"` and `errorMessage` so the viewer shows the problem to the user
2. **Attempt one fallback automatically** — try the first fallback strategy without asking
3. **Inform the user** — after attempting fallback, report what happened and what alternatives remain
4. **Do not retry the same call blindly** — if it failed once, retrying with identical parameters will likely fail again. Change something.
5. **Keep partial progress** — never discard successfully generated scenes because one scene failed

---

## Content Moderation Blocks

**Symptom:** The generation tool returns a content policy violation or moderation error.

**Cause:** The prompt contains language that triggers the provider's safety filters. Common triggers: celebrity names, real-person likenesses, violent imagery, suggestive content.

**Fallback chain:**

1. **Rephrase the prompt:**
   - Remove any real person names or celebrity references
   - Replace specific likeness descriptions with generic traits ("a wise elderly scientist" instead of "an Einstein-like professor")
   - Soften any aggressive or intense language
   - Remove brand names or copyrighted character references
2. **Simplify the scene:**
   - Reduce the number of characters
   - Make the action less dynamic
   - Use a more neutral setting
3. **Switch to a different visual approach:**
   - Try illustration style instead of photorealistic
   - Use a more abstract or symbolic representation
4. **Inform the user:**
   - Explain what was blocked and why
   - Suggest the user rephrase their original request
   - Offer alternative creative directions

**Example recovery:**

```
Original prompt (blocked): "Albert Einstein explaining relativity at a chalkboard"
Rephrased prompt: "An elderly scientist with wild gray hair and kind eyes explaining a physics equation at a chalkboard in a warm lecture hall"
```

---

## Image Generation Failures

**Symptom:** `generate_image` returns an API error, timeout, or empty result.

**Fallback chain:**

1. **Retry once** with a simplified prompt (shorter, fewer details)
2. **Try a different style** — if photorealistic fails, try illustration or flat design
3. **Lower resolution** — request a smaller image if the error suggests resource limits
4. **Mark as error** and inform the user — suggest checking API key validity or switching provider

---

## Video Generation Failures

**Symptom:** `generate_video_from_text` or `generate_video_from_image` fails.

**Fallback chain:**

1. **If `generate_video_from_image` failed:**
   - Try `generate_video_from_text` with the same prompt (bypasses the image input path)
   - If both fail, fall back to static image

2. **If `generate_video_from_text` failed:**
   - Generate a static image instead with `generate_image`
   - Set `visual.type` to `"image"` in the storyboard
   - Note in the scene that this was a fallback — during export, the image will be displayed for the scene's duration (Ken Burns pan/zoom effect can be applied in ffmpeg)

3. **If all visual generation fails for this scene:**
   - Set `visual.status: "error"` with a clear message
   - Move on to other scenes — do not block the entire production
   - Return to this scene later, possibly with a rephrased prompt

**Ken Burns fallback note:** When a video scene falls back to a static image, the export script can apply a slow zoom or pan using ffmpeg:
```bash
ffmpeg -loop 1 -i scene.jpg -vf "zoompan=z='min(zoom+0.001,1.5)':d=150:s=1920x1080" -t 5 -pix_fmt yuv420p output.mp4
```
This creates gentle motion from a still, which is better than a completely static frame in a video.

---

## TTS Generation Failures

**Symptom:** `generate_speech` returns an error.

**Fallback chain:**

1. **Try a different voice** — some voices may be unavailable or have issues with certain text
2. **Simplify the text** — remove special characters, unusual punctuation, or very long sentences
3. **Split the text** — if the narration is long, try generating it in shorter chunks
4. **Skip audio for this scene:**
   - Set `audio.status: "error"` with a message
   - The scene will play with BGM only (or silence)
   - Inform the user that this scene's narration will need manual recording or a different TTS provider
5. **Suggest provider switch** — different TTS providers handle different languages and text patterns better

---

## BGM Failures

**Symptom:** `search_music` returns no results or `download_track` fails.

**Fallback chain:**

1. **Broaden the search** — use more generic terms ("calm background music" instead of "lo-fi hip-hop jazz piano")
2. **Try `generate_music`** — AI-generated music as an alternative to stock search
3. **Skip BGM** — the video works without background music. Set `bgm: null` and inform the user
4. **Suggest user-provided music** — the user can place their own audio file in `assets/bgm/` and you can reference it

---

## API Rate Limiting

**Symptom:** HTTP 429 or explicit rate limit error.

**Strategy:**

1. **Do not retry immediately** — this makes rate limiting worse
2. **Queue remaining work** — note which scenes still need generation
3. **Inform the user:**
   - "Rate limited by [provider]. X scenes still need generation."
   - "I'll continue with other work (audio, captions, BGM) and retry visuals shortly."
4. **Work on non-rate-limited tasks:**
   - Generate audio for scenes that already have visuals
   - Set up BGM
   - Write captions
   - Prepare the export script structure
5. **Retry after a pause** — after completing other work, try the visual generation again

---

## Provider Downtime

**Symptom:** Connection errors, 500/502/503 responses, timeouts.

**Strategy:**

1. **Retry once** — transient errors are common
2. **If retry fails**, inform the user:
   - "The [provider] API appears to be down. Would you like to switch providers?"
   - Explain how to change the provider in project settings
3. **Continue with available tools** — if image gen is down but TTS works, generate audio first
4. **Mark affected scenes** — set `status: "error"` with message "Provider unavailable, retry later"

---

## Budget and Credit Awareness

Generation costs real money. Be mindful:

### Cost Hierarchy (typical)

| Operation | Relative Cost |
|-----------|--------------|
| Image generation | Low ($0.01-0.05 per image) |
| TTS generation | Low ($0.01-0.03 per scene) |
| Video generation | High ($0.10-0.50 per clip) |
| Music generation | Medium ($0.05-0.15 per track) |

### Budget-Conscious Practices

1. **Confirm before mass generation** — if generating visuals for 10+ scenes, inform the user of approximate cost
2. **Use images first** — generate stills, get user approval, THEN upgrade to video where needed
3. **Do not regenerate unnecessarily** — if the user says "make scene 3 a bit different," regenerate only scene 3
4. **Reuse assets** — if two scenes share the same background, generate it once and reference the same file
5. **Test with one scene** — when trying a new style or approach, test on a single scene before applying to all

### When Credits Run Out

1. Set remaining scenes to `status: "error"` with message "API credits exhausted"
2. Inform the user of which scenes are complete and which need generation
3. Suggest:
   - Adding more credits to the current provider
   - Switching to a different (possibly free-tier) provider
   - Using placeholder images from the user's own files

---

## Error Message Format

When setting `errorMessage` in the storyboard, use clear, actionable language:

**Good:**
- "Content moderation blocked this prompt. Rephrased and retrying with fictional character description."
- "Video generation failed (API timeout). Fell back to static image — consider retrying later."
- "TTS voice 'en-narrator-2' unavailable. Try a different voice or check provider status."
- "Rate limited by fal.ai. Continuing with audio generation, will retry visuals shortly."

**Bad:**
- "Error" (not helpful)
- "HTTP 429" (technical, not actionable)
- "Failed" (no context)

---

## Recovery Decision Tree

```
Generation failed
├── Content moderation? → Rephrase prompt → Retry
├── API error (4xx)?
│   ├── 429 Rate limit → Queue, work on other tasks, retry later
│   ├── 401/403 Auth → Check API key, inform user
│   └── Other → Simplify prompt → Retry once
├── API error (5xx)? → Retry once → Inform user of provider issue
├── Timeout? → Retry once with simpler prompt
└── Unknown error → Set error status, inform user, suggest alternatives

Visual fallback chain:
  video_from_image → video_from_text → static_image → error

Audio fallback chain:
  primary_voice → alternate_voice → simplified_text → skip_audio → error
```
