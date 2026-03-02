/**
 * Slide scaffold generator — pure function that produces file list from params.
 * Used by both agent-triggered scaffold action and user UI initialization.
 */

export interface SlideSpec {
  title: string;
  subtitle?: string;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

/**
 * Generate a minimal slide workspace from a title and slide specs.
 * Each slide gets an extremely simple HTML placeholder — CC fills in content later.
 */
export function generateSlideScaffold(
  title: string,
  slides: SlideSpec[],
): ScaffoldFile[] {
  const files: ScaffoldFile[] = [];

  // manifest.json
  const manifest = {
    title,
    slides: slides.map((s, i) => ({
      file: `slides/slide-${String(i + 1).padStart(2, "0")}.html`,
      title: s.title,
    })),
  };
  files.push({ path: "manifest.json", content: JSON.stringify(manifest, null, 2) });

  // Individual slide HTML files — minimal placeholders
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const num = String(i + 1).padStart(2, "0");
    const subtitle = s.subtitle
      ? `\n    <p style="font-size: 1.2rem; color: var(--color-secondary); margin-top: 16px;">${escapeHtml(s.subtitle)}</p>`
      : "";
    const html = `<div class="slide" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 60px;">
    <h1 style="font-size: 2.5rem;">${escapeHtml(s.title)}</h1>${subtitle}
</div>
`;
    files.push({ path: `slides/slide-${num}.html`, content: html });
  }

  return files;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
