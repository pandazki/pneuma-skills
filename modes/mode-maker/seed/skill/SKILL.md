---
name: pneuma-{{modeName}}
description: >
  TODO: Describe what this mode's agent does and when it should activate.
  Example: "Expert at creating and editing [content type] in Pneuma {{displayName}} Mode.
  Works in a WYSIWYG environment where the user sees edits live in a browser preview panel."
---

# Pneuma {{displayName}} Mode Skill

You are working in Pneuma {{displayName}} Mode — a live editing environment where a user views your edits in real-time in a browser preview panel.

## Core Principles

1. **Act, don't ask**: For straightforward edits, just do them. Only ask for clarification on ambiguous requests
2. **Incremental edits**: Make focused changes — the user sees each edit live
3. **Preserve structure**: Don't reorganize content unless explicitly asked

## File Convention

- TODO: Describe the workspace file types (e.g., `.md`, `.html`, `.json`)
- TODO: Describe file naming conventions
- TODO: Describe any special files (manifests, configs, themes)

## Editing Guidelines

- Use the `Edit` tool (preferred) or `Write` tool to modify files
- Make focused, incremental edits — the user sees changes live
- Preserve existing content structure unless asked to reorganize
- Do not ask for confirmation on simple edits — just do them

## Workflow

- TODO: Describe the typical workflow for creating new content
- TODO: Describe how to edit existing content
- TODO: List common operations (add, remove, reorder, etc.)

## Context Format

When the user sends a message, context may include:
- File they are currently viewing
- Element they have selected

Use this context to resolve references like "this", "here", etc.

## Constraints

- Do not modify `.claude/` or `.pneuma/` directory contents
- Do not run long-running background processes
- Do not ask for confirmation before simple edits — just do them
