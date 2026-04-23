# Character Consistency

Maintaining consistent character appearance across scenes is one of the hardest challenges in AI video production. This document defines the workflow for creating and using character references.

## When to Create a CharacterRef

Create a character reference when:

- A person, animal, or mascot appears in more than one scene
- The user describes a specific character (named or unnamed) who recurs
- The video has a presenter, host, or narrator who appears on screen
- Any entity needs to look the same across multiple generations

Do NOT create a character reference for:
- Generic crowd members or background people
- Characters that appear in exactly one scene
- Abstract or symbolic visuals

## The CharacterRef Workflow

### Step 1: Define the Character

Add the character to `storyboard.json` under `characterRefs`:

```json
{
  "id": "chef-maria",
  "name": "Chef Maria",
  "referenceSheet": null,
  "description": "A woman in her 30s with olive skin, dark brown hair pulled back in a neat bun, bright hazel eyes, wearing a crisp white chef's coat with gold buttons, confident and warm expression"
}
```

**Description guidelines:**
- Be specific about distinctive features: hair color/style, eye color, skin tone, build
- Include clothing and accessories that define the character
- Mention expression and demeanor (these affect the overall feel)
- Keep descriptions to 2-3 sentences — enough detail for consistency but not so much that generation models struggle
- Avoid celebrity references — models may refuse or produce inconsistent results

### Step 2: Generate a Reference Sheet

Use `generate_image` to create a multi-angle reference sheet:

**Prompt template for reference sheets:**
> "Character reference sheet of [FULL DESCRIPTION]. Multiple angles showing front view, 3/4 view, and side profile. White background, clean studio lighting, consistent style across all views. Professional character design reference, high quality."

Example:
> "Character reference sheet of a woman in her 30s with olive skin, dark brown hair in a neat bun, bright hazel eyes, wearing a crisp white chef's coat with gold buttons, confident warm expression. Multiple angles showing front view, 3/4 view, and side profile. White background, clean studio lighting, consistent style across all views. Professional character design reference, high quality."

**Settings for reference sheets:**
- Aspect ratio: `1:1` or `4:3` (square or slightly wide to fit multiple angles)
- Resolution: highest available (the reference image is your anchor for all future generations)
- Output path: `assets/reference/{character-id}-sheet.png`

### Step 3: Update the CharacterRef

After generating the reference sheet, update the character's `referenceSheet` field:

```json
{
  "id": "chef-maria",
  "name": "Chef Maria",
  "referenceSheet": "assets/reference/chef-maria-sheet.png",
  "description": "A woman in her 30s with olive skin, dark brown hair pulled back in a neat bun, bright hazel eyes, wearing a crisp white chef's coat with gold buttons, confident and warm expression"
}
```

### Step 4: Reference in Scene Prompts

When generating scenes featuring this character, ALWAYS include:

1. The character's full description from the `description` field (copy verbatim)
2. A reference to the reference sheet image via `reference_image` parameter (if the tool supports it)

**Scene prompt example:**
> "A woman in her 30s with olive skin, dark brown hair pulled back in a neat bun, bright hazel eyes, wearing a crisp white chef's coat with gold buttons, confident and warm expression. She is chopping fresh herbs on a wooden cutting board in a modern kitchen. Warm pendant lighting, medium shot, documentary style."

Note how the character description comes first, followed by the scene-specific action, setting, and style.

---

## Using Reference Images

When the MCP tool supports a `reference_image` parameter:

1. Pass the reference sheet path: `reference_image: "assets/reference/chef-maria-sheet.png"`
2. The generation model uses this to maintain visual similarity
3. Still include the text description — the reference image helps but the text guides composition

When the tool does NOT support reference images:
- Rely on the text description alone
- Be extra detailed in the description
- Use the same style descriptors across all scenes
- Consider using image-to-video (generate a consistent still first, then animate)

---

## Multiple Characters in One Scene

When a scene has multiple recurring characters:

1. Include ALL characters' descriptions in the prompt
2. Specify their spatial relationship ("Maria stands on the left, the Professor sits on the right")
3. If using reference images, pass the primary character's reference (most tools accept only one reference)
4. Describe the interaction: "Maria hands a plate to the Professor"

**Example prompt with two characters:**
> "On the left, a woman in her 30s with olive skin, dark brown hair in a bun, hazel eyes, white chef's coat (Chef Maria). On the right, an elderly man with wild white hair, warm brown eyes, tweed vest over white shirt (the Professor). Maria is handing the Professor a beautifully plated dish. They are in a warm, wood-paneled dining room. Soft evening light from candles. Medium wide shot, cinematic style."

---

## Character Appearance Changes

If a character changes costume or appearance across the video:

1. Keep the core facial features and body type consistent in the description
2. Only change the clothing/accessory part of the description
3. Note the change explicitly in the scene's prompt: "Same woman (Chef Maria), now wearing a casual blue sweater instead of her chef's coat"
4. Consider generating a new reference image for the alternate look

---

## Troubleshooting Consistency Issues

### Character looks different across scenes

- Check that you are using the EXACT same description text (copy from `characterRefs`, do not retype)
- Try using `generate_video_from_image` instead of `generate_video_from_text` — generate a still first, then animate
- If a reference image is available, always pass it
- Reduce the amount of action in the prompt — complex poses create more variation

### Character does not match the reference sheet

- Simplify the description — too many details can confuse the model
- Generate the scene image at the same aspect ratio and style as the reference sheet
- Try rewording distinctive features (e.g., "curly red hair" instead of "auburn ringlets cascading past shoulders")

### Celebrity or real-person refusal

- Never use real person names in prompts
- Describe the visual characteristics you want without referencing who they resemble
- Use fictional character archetypes: "a wise elderly scientist" rather than "an Einstein-like professor"
- If moderation blocks the prompt, remove any identity-adjacent language and focus on generic physical traits

---

## CharacterRef Best Practices

1. **Create refs early** — generate reference sheets before any scenes. This is your visual anchor.
2. **One ref per character** — do not create multiple refs for the same character (confusing). Use one canonical description.
3. **Description is the contract** — the `description` field is what you paste into every scene prompt. Keep it stable.
4. **Reference sheets are investments** — spend time getting a good reference sheet. Regenerate it if the first attempt is not satisfactory. All subsequent scenes depend on it.
5. **Update, don't replace** — if the user asks to change a character's appearance, update the description in `characterRefs` and regenerate the reference sheet. Then regenerate affected scenes.
