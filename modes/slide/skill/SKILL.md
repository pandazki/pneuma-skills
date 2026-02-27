# Pneuma Slide Mode Skill

You are working in Pneuma Slide Mode — a WYSIWYG presentation editing environment where a user views your slide edits in real-time in a browser preview panel.

## File Conventions

- `manifest.json` — Slide deck metadata and ordering
- `slides/slide-XX.html` — Individual HTML files per slide (zero-padded numbering)
- `theme.css` — Shared theme using CSS custom properties
- `assets/` — Images and other media

## Slide Dimensions

Each slide is designed for a **{{slideWidth}}×{{slideHeight}}px** virtual viewport. All content must fit within this fixed resolution. The preview panel scales slides proportionally.

**Important**: Do not create slides with different dimensions. All slides in a deck share the same viewport size.

## manifest.json Structure

```json
{
  "title": "Deck Title",
  "slides": [
    { "file": "slides/slide-01.html", "title": "Title Slide" },
    { "file": "slides/slide-02.html", "title": "Key Points" }
  ]
}
```

**Always update manifest.json** when adding, removing, or reordering slides.

## Slide HTML Template

Each slide is a standalone HTML fragment (no `<html>`, `<head>`, or `<body>` tags). The theme CSS is injected automatically.

```html
<div class="slide">
  <h1>Slide Title</h1>
  <p>Content goes here</p>
</div>
```

Use the `.slide` wrapper class. Available layout helpers:
- `.slide` — Base slide container (centered flexbox)
- `.slide-title` — Large centered title layout
- `.slide-content` — Standard content layout with left-aligned text
- `.slide-split` — Two-column layout
- `.slide-image` — Full-bleed image layout

## Design Principles

- **Whitespace**: Use generous padding and margins; avoid cramming content
- **Typography**: Use heading hierarchy (h1 for titles, h2 for subtitles, h3 for section headers)
- **Lists**: Keep bullet points concise (< 10 words each); max 5-6 items per slide
- **Colors**: Use CSS custom properties from theme.css (e.g., `var(--color-primary)`)
- **Images**: Place in `assets/` directory, reference as `../assets/filename.png`

## Editing Guidelines

- Use the `Edit` tool (preferred) or `Write` tool to modify slide HTML files
- Make focused, incremental edits — the user sees changes live
- When creating new slides, follow the zero-padded naming convention (slide-03.html, slide-04.html, etc.)
- After adding/removing slides, always update `manifest.json`

## Context Format

When the user sends a message, context may include:
- `[Context: slide, viewing: slide-03.html "Slide Title"]` — which slide the user is looking at
- `[User selected: heading "Some Title"]` — which element the user clicked on

Use this context to understand what the user wants to change.

## What NOT to do

- Do not create non-HTML/CSS/JSON files unless explicitly asked
- Do not modify `.claude/` directory contents
- Do not add `<html>`, `<head>`, or `<body>` tags to slide files
- Do not ask for confirmation before simple edits — just do them
