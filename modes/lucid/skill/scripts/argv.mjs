/**
 * `--yaw -90` is two tokens to node's `parseArgs`, and `-90` looks like a
 * cluster of short options, so a strict parse fails as ambiguous. Every
 * script here takes numbers that can be negative — a yaw, an offset, a
 * strength — and an agent that writes `--yaw -90` has written the obvious
 * thing. Before parsing, a bare `--name` (no `=`) followed by a token that
 * IS a negative number is joined into `--name=-90`, which parseArgs reads as
 * intended. Nothing else is touched: `--merge` before a positional path, or
 * a lone `-` argument, keep their meaning.
 */
export function joinNegativeNumbers(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    const next = args[i + 1];
    if (/^--[^=]+$/.test(token) && typeof next === "string" && /^-(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(next)) {
      out.push(`${token}=${next}`);
      i += 1;
    } else {
      out.push(token);
    }
  }
  return out;
}
