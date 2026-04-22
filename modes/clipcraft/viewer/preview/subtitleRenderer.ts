import type { SubtitleRenderer, SubtitleRenderParams } from "@pneuma-craft/video";
import type { CaptionStyle } from "../../persistence.js";

// Paddings / radius live here in composition pixels alongside fontSize, so
// they scale together with the composition when the compositor stretches the
// returned layer to full composition size.
const COMP_PADDING_Y = 14;
const COMP_PADDING_X = 20;
const COMP_BORDER_RADIUS = 10;
const LINE_HEIGHT = 1.4;
const FONT_FAMILY = "'Inter', system-ui, -apple-system, sans-serif";
const TEXT_SHADOW_COLOR = "rgba(0,0,0,0.6)";

/**
 * Returns a stable-identity SubtitleRenderer that reads current caption
 * style through a getter on every invocation. The PneumaCraftProvider
 * captures this renderer once at mount, so the getter (not the factory) is
 * what lets live style edits reach the draw loop.
 *
 * The returned canvas is always sized to the composition's pixel
 * dimensions — the compositor draws it at (0, 0) stretched to full size, so
 * the caption must be drawn at its target bottom-centered position within
 * that canvas with the rest transparent.
 */
export function createSubtitleRenderer(
  getStyle: () => Required<CaptionStyle>,
): SubtitleRenderer {
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;

  return (params: SubtitleRenderParams): OffscreenCanvas | null => {
    const { clip, width, height } = params;
    const text = clip?.text;
    if (!text || text.trim() === "") return null;

    if (!canvas || !ctx || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) return null;
    }

    const style = getStyle();
    ctx.clearRect(0, 0, width, height);

    const fontSize = style.fontSize;
    ctx.font = `${style.fontWeight} ${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const maxPillWidth = style.maxWidthPercent * width;
    const maxTextWidth = Math.max(1, maxPillWidth - 2 * COMP_PADDING_X);

    const lines = wrapLines(ctx, text, maxTextWidth);

    let longest = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > longest) longest = w;
    }
    const pillWidth = Math.min(maxPillWidth, longest + 2 * COMP_PADDING_X);
    const pillHeight = lines.length * fontSize * LINE_HEIGHT + 2 * COMP_PADDING_Y;

    const pillX = (width - pillWidth) / 2;
    const pillBottom = height - style.bottomPercent * height;
    const pillY = pillBottom - pillHeight;

    ctx.fillStyle = style.background;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillWidth, pillHeight, COMP_BORDER_RADIUS);
      ctx.fill();
    } else {
      drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, COMP_BORDER_RADIUS);
      ctx.fill();
    }

    ctx.fillStyle = style.color;
    ctx.shadowColor = TEXT_SHADOW_COLOR;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.shadowBlur = 3;
    const xCenter = pillX + pillWidth / 2;
    // Baseline of the first line sits ~0.85 * fontSize below the line's top,
    // matching alphabetic baseline placement for most Latin fonts.
    const firstBaselineY = pillY + COMP_PADDING_Y + fontSize * 0.85;
    for (let i = 0; i < lines.length; i++) {
      const y = firstBaselineY + i * fontSize * LINE_HEIGHT;
      ctx.fillText(lines[i], xCenter, y);
    }
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 0;

    return canvas;
  };
}

function wrapLines(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const segment of text.split("\n")) {
    if (segment === "") {
      out.push("");
      continue;
    }
    const words = segment.split(/(\s+)/);
    let current = "";
    for (const token of words) {
      const candidate = current + token;
      if (ctx.measureText(candidate).width <= maxWidth || current === "") {
        current = candidate;
        continue;
      }
      out.push(current.trimEnd());
      current = token.trimStart();
    }
    if (current !== "") out.push(current);
  }
  return out.length > 0 ? out : [""];
}

function drawRoundedRect(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
