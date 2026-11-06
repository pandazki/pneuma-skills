/** Types for the `sticker.mjs` CLI module (its importable surface). */

export const HELP: string;
/** One command's usage, or null for an unknown command. */
export function commandHelp(command: string): string | null;
/** Run one command; resolves to the exit code (0, 1, or 130 when a paid call was interrupted). */
export function main(argv?: string[]): Promise<number>;
