# Pneuma Skills: Next-Gen Visual Design Specification

## 1. Design Philosophy
The redesign moves Pneuma from a "traditional dashboard" to an **Ethereal Ethereal Tech (Next-Gen AI)** aesthetic. As a "WYSIWYG Delivery Platform for Code Agents", the interface should feel immersive, intelligent, and fluid—minimizing cognitive load while maximizing the sense of collaborating with an advanced AI entity.

**Keywords**: Glassmorphism, Cinematic, Ethereal, Fluid, Minimalist, High-Contrast.

## 2. Global Aesthetics (Tokens)

### 2.1 Color Palette
- **Background (`--color-cc-bg`)**: `#09090b` (Deepest Zinc/Pitch Black) — creates depth.
- **Surface (`--color-cc-surface`)**: `#18181b` (Zinc-900) — for base structural panels.
- **Card (`--color-cc-card`)**: `rgba(24, 24, 27, 0.6)` with heavy `backdrop-blur-xl`.
- **Primary (`--color-cc-primary`)**: `#f97316` (Neon Orange) — represents AI energy and life force.
- **Primary Hover (`--color-cc-primary-hover`)**: `#fdba74`.
- **Primary Glow (`--color-cc-glow`)**: `rgba(249, 115, 22, 0.15)`.
- **Foreground (`--color-cc-fg`)**: `#fafafa` (Pure contrast).
- **Muted text (`--color-cc-muted`)**: `#a1a1aa`.
- **Borders (`--color-cc-border`)**: `rgba(255, 255, 255, 0.08)` — ultra-thin and subtle.

### 2.2 Typography
- Switch to modern sans-serif stack prioritized for ultra-crisp rendering (`Inter`, `Geist`, `system-ui`).
- Generous line-heights for readability in chat interfaces.
- Agent intelligence highlights use gradient text.

### 2.3 Animations & Interactions
- **Micro-animations**: Smooth `.3s ease-out` standard transitions for all hover states.
- **Pulse/Glow**: Agent's active state (thinking/working) uses breathing cyan glows.
- **Entrance**: Staggered fade and slide-up animations for cards and messages.

## 3. Launcher UI Redesign (`Launcher.tsx`)
**Goal**: Make the entry point feel like a portal to a sophisticated workspace.
- **Background**: Deep black with a subtle, animated radial gradient glow at the top center.
- **Header**: "Pneuma" title rendered with a sleek, animated text gradient (e.g., Violet to Cyan).
- **Mode Cards**:
  - Glass effect: translucent backgrounds with `backdrop-filter: blur(16px)`.
  - Border: 1px subtle white border that brightens on hover.
  - Hover effect: Slight upward lift (`translateY(-4px)`) and a soft cyan/violet drop shadow.
- **Search Bar**: Centered, large, translucent pill shape with glowing focus state.

## 4. Workspace UI Redesign (Chat & Editor)
**Goal**: The workspace should get out of the way of the content and the conversation.
- **Layout**: Borderless edge-to-edge panels separated by thin, elegant lines or just gutters.
- **TopBar**: Floating, pill-shaped or highly minimalist bar, rather than a heavy full-width block.
- **Chat Panel (`ChatPanel.tsx`, `MessageBubble.tsx`)**:
  - **User Bubbles**: Solid, understated dark gray (`#27272a`), aligned right.
  - **Agent Bubbles**: No bubble background—pure text rendering for breathing room, with glowing accent lines on the left edge for emphasis.
  - **Thinking Blocks**: Collapsible sections with an "Ethereal" pulsating border.
  - **Tool Calls**: Translucent, compact blocks that expand elegantly context.
- **Chat Input**: Floating pill design at the bottom, detaching from the rigid bottom edge. Glowing ring on focus.
- **Terminal**: Deep black background (`#000`), flush edges, neon text accents.
- **Context Panel**: Use glassmorphism cards for tasks and MCP server statuses.

## 5. Technical Approach
- We will update `src/index.css` to inject the new CSS variable tokens and keyframes.
- We will update the corresponding React components (`Launcher.tsx`, `TopBar.tsx`, `ChatPanel.tsx`, `ChatInput.tsx`, `MessageBubble.tsx`, `App.tsx`) to utilize Tailwind's advanced features (`backdrop-blur`, `bg-clip-text`, etc.) matching the philosophy.

## 6. Phase 2 Vision: Spatial & Holographic Depth
To push the design beyond simple web styling and fully embrace a next-generation feel:
- **Ambient App Shell**: The main workspace (`App.tsx`) will be detached from the window edges to form a floating glassmorphic window over an animated, deep mesh gradient background.
- **Holographic Tooling**: Terminal and Tool blocks will adopt a retro-futuristic amber CRT aesthetic with subtle scanlines and glitch-reveal animations.
- **Immersive Typing**: The chat input will float completely as a standalone island at the bottom, breaking free from the standard sidebar.
