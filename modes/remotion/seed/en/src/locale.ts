// locale.ts — everything language-specific in the video: copy, text faces, size tweaks.
// Scenes import from here; swap this file to change the language without touching them.
//
// English faces: Fraunces carries headlines and captions (theme.tsx loads it for every
// language); DM Sans sets paragraphs, labels and mock-UI text.

const LOCALE = "en";

const FONT = {
  css: ["https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..600;1,9..40,300..600&display=swap"],
  /** CSS font shorthands that must be loaded before any frame is drawn. */
  faces: ["400 1em 'DM Sans'", "500 1em 'DM Sans'"],
  head: "'Fraunces', Georgia, serif",
  body: "'DM Sans', 'Helvetica Neue', sans-serif",
  monoFallback: "'DM Sans'",
  headWeight: 400,
  titleWeight: 500,
};

const SIZE = {
  /** Pillar titles ("Visual environment" …) — longer than their Chinese counterparts. */
  pillarTitle: 50,
  pillarTitleTracking: -0.5,
  /** The h1 on the mock slide in the hero scene (clears the sun disc). */
  slideTitle: 36,
  /** Width of the selection box around the picked slide item. */
  pickW: 226,
  finaleTagline: 25,
};

const T = {
  opening: {
    kicker: "Greek · n. · breath, spirit",
    gloss: "Greek for “breath”: what brings a thing to life.",
    tagline: "Where people and code agents create together.",
  },
  gap: {
    kicker: "How we work with agents today",
    agentCaption: "The agent works in files.",
    humanCaption: "You get a wall of diffs.",
    missingPre: "What’s missing: ",
    missingEm: "a surface you can see",
    missingPost: ".",
  },
  loop: {
    headline: "One file, two views.",
    aside: "the agent writes files · you watch the viewer",
    code: [
      `<section class="slide">`,
      `  <h1>Kyoto in Autumn</h1>`,
      `  <p>Three days, taken slowly</p>`,
      `  <ol>`,
      `    <li>Day 1 · Higashiyama</li>`,
      `    <li>Day 2 · Arashiyama</li>`,
      `    <li>Day 3 · Fushimi Inari</li>`,
      `  </ol>`,
      `</section>`,
    ],
    newLine: `    <li>Day 2 · Bamboo Grove</li>`,
    title: "Kyoto in Autumn",
    subtitle: "Three days, taken slowly",
    items: ["Day 1 · Higashiyama", "Day 2 · Arashiyama", "Day 3 · Fushimi Inari"],
    itemAfter: "Day 2 · Bamboo Grove",
    ask: "Make it the bamboo grove",
    steps: [
      { k: "See", d: "The moment a file lands, the viewer renders it." },
      { k: "Point", d: "Select it in the viewer; the agent gets the context." },
      { k: "Join in", d: "The agent edits the file while you watch it change." },
    ],
  },
  pillars: {
    rail: "Four pillars",
    items: [
      {
        title: "Visual environment",
        kicker: "What you see",
        rail: "Visual",
        body: "Whatever the agent writes becomes a live view you can watch, point at and edit.",
      },
      {
        title: "Domain skills",
        kicker: "What it knows",
        rail: "Skills",
        body: "Every mode ships a skill — conventions, workflows, references — that the agent reads when it needs them.",
      },
      {
        title: "Continuous learning",
        kicker: "What it remembers",
        rail: "Learning",
        body: "Your preferences carry over between sessions, so you never start from zero.",
      },
      {
        title: "Distribution",
        kicker: "How it spreads",
        rail: "Sharing",
        body: "Package a way of working as a mode.\nShare it, and anyone can install it.",
      },
    ],
    viewerKinds: ["Docs", "Slides", "Boards", "Video", "Charts"],
    viewerNote: "a viewer built for each kind of content",
    skillNotes: ["conventions & flow", "design references", "read on demand"],
    learningNote: "Correct it once, and next time it’s done your way.",
    destinations: ["your team", "the community", "another project"],
    /** Real text set over the two chat bubbles in the visual-environment painting. */
    visualChat: ["Agent: I’ve timed the title card\nto the beat of the music.", "Agent: Done — see 0:04."],
  },
  modes: {
    kicker: "The mode catalog",
    headline: "Nineteen ways of working, already packaged.",
    sub: "Install one and start, or fork it into your own.",
    counter: "modes",
    here: "this video",
    yours: "The next one is yours.",
    yourTile: "your way of working",
    labels: {
      slide: "Slides",
      doc: "Documents",
      webcraft: "Web design",
      kami: "Paper layouts",
      diagram: "Diagrams",
      draw: "Whiteboard",
      gridboard: "Dashboards",
      remotion: "Video",
      clipcraft: "AI shorts",
      backlot: "Film pipeline",
      illustrate: "Illustration",
      bansho: "Chalk talks",
      eli5: "Explainers",
      plotwise: "Story courses",
      cosmos: "Idea maps",
      lucid: "3D scenes",
      sprite: "Sprite sheets",
      wordtaste: "Chinese essays",
      "mode-maker": "Make a mode",
    } as Record<string, string>,
  },
  finale: {
    caption: "People and agents, making things in one place.",
    tagline: "Where people and code agents create together.",
    pillars: ["Visual environment", "Skills", "Learning", "Distribution"],
    credit: "This video was written by an agent in Pneuma’s Remotion mode",
  },
};

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { LOCALE, FONT, SIZE, T };
