# Project format

The authoritative executable schema is `../scripts/model.ts`. One directory is
one brand project. `brand.json` contains:

```json
{
  "version": 1,
  "title": "Morrow",
  "description": "A calmer way to make progress.",
  "brief": {
    "audience": "People seeking a kinder relationship with focused work",
    "promise": "Make room for focus.",
    "personality": ["Warm", "Intentional", "Encouraging"],
    "rules": ["Use the orange character as a companion, never a productivity judge."]
  },
  "palette": [{ "name": "Persimmon", "value": "#F57843" }],
  "contexts": [{ "id": "app", "title": "Digital product", "purpose": "Make focus approachable.", "guidance": "Keep controls clear; use character moments sparingly." }],
  "items": [{
    "id": "mascot", "title": "Core character", "stage": "assets", "kind": "image",
    "status": "ready", "file": "assets/mascot.png", "contexts": ["app"],
    "description": "Transparent master asset; adapt scale and pose without changing proportions.",
    "referenceIds": [], "regions": []
  }]
}
```

Stages: `references`, `identity`, `assets`, `applications`. These classify the work,
not a compulsory sequence. Contexts describe where the brand will be used.
An item may serve multiple contexts, or none while still exploring.

Kinds: `image` and `html`. HTML is for editable identity specimens or examples;
the mode does not require implementing a product. `width` / `height` declare its
preview dimensions (default 390 × 844). Images retain their intrinsic aspect ratio.

Status: `planned`, `generating`, `ready`, `failed`. Ready requires `file`; failed
requires a meaningful `error`. `prompt` records the generation brief. `referenceIds`
point to existing works in the same project; the first is the comparison target.

Optional image regions have `id`, `label`, `x`, `y`, `width`, `height`; coordinates
are fractions of the whole image, each rectangle contained within [0, 1]. Region
IDs are unique within an item. Item and context IDs are unique within the project.

The generated `brand-book.html` embeds ready image outputs; research references
are excluded. Editable HTML specimens remain in the source kit, and the book
states that explicitly rather than exporting broken external dependencies.
