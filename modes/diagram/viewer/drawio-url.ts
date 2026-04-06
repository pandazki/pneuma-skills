/**
 * Generate "Open in draw.io" URLs using pako compression.
 */
import pako from "pako";

export function generateDrawioEditUrl(xml: string): string {
  const encoded = encodeURIComponent(xml);
  const compressed = pako.deflateRaw(encoded);
  const base64 = btoa(
    Array.from(compressed, (b: number) => String.fromCharCode(b)).join(""),
  );
  const createObj = { type: "xml", compressed: true, data: base64 };
  return (
    "https://app.diagrams.net/?pv=0&grid=0#create=" +
    encodeURIComponent(JSON.stringify(createObj))
  );
}
