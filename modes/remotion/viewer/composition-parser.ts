/**
 * Parse Root.tsx to extract <Composition> metadata.
 * Uses regex — no AST parser needed for this predictable structure.
 */

export interface CompositionMeta {
  id: string;
  componentName: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

/**
 * Extract all <Composition> declarations from Root.tsx source.
 * Handles both single-line and multi-line JSX prop formats.
 */
export function parseCompositions(source: string): CompositionMeta[] {
  const compositions: CompositionMeta[] = [];

  // Match <Composition ... /> blocks (single-line or multi-line, self-closing)
  const compositionRegex = /<Composition\b([\s\S]*?)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = compositionRegex.exec(source)) !== null) {
    const props = match[1];
    const id = extractProp(props, "id");
    const componentName = extractComponentProp(props);
    const durationInFrames = extractNumericProp(props, "durationInFrames");
    const fps = extractNumericProp(props, "fps");
    const width = extractNumericProp(props, "width");
    const height = extractNumericProp(props, "height");

    if (id && componentName && durationInFrames && fps && width && height) {
      compositions.push({ id, componentName, durationInFrames, fps, width, height });
    }
  }

  return compositions;
}

/** Extract a string prop value: id="value" */
function extractProp(props: string, name: string): string | null {
  const regex = new RegExp(`${name}=(?:"([^"]+)"|{["']([^"']+)["']})`);
  const match = props.match(regex);
  return match?.[1] ?? match?.[2] ?? null;
}

/** Extract component={Name} prop value */
function extractComponentProp(props: string): string | null {
  const match = props.match(/component=\{(\w+)\}/);
  return match?.[1] ?? null;
}

/** Extract a numeric prop: name={123} */
function extractNumericProp(props: string, name: string): number | null {
  const regex = new RegExp(`${name}=\\{(\\d+)\\}`);
  const match = props.match(regex);
  return match ? parseInt(match[1], 10) : null;
}
