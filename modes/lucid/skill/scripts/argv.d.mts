/** Join `--name -90` into `--name=-90` so node's parseArgs reads a negative number as a value. */
export function joinNegativeNumbers(args: string[]): string[];
