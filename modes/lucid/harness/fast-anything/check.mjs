// Run inside the profiling copy after fast-anything enables the port.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { decodePng, roughnessMap as original } from './original.mjs';
import { roughnessMap as enabled } from './texture.mjs';

// The generated shim falls back to JS on load failure. Prove which function runs.
const require = createRequire(import.meta.url);
const [port] = Object.values(require('./.fast/state.json').ports);
assert.equal(enabled, require(`./.fast/lib/${port.ext}.node`).roughnessMap);

const inputs = readdirSync('textures').sort().map(file => [file, decodePng(readFileSync(`textures/${file}`))]);
for (const [width, height] of [[1, 1], [1, 9], [9, 1], [2, 2], [3, 7], [17, 13], [127, 61]]) {
  const rgba = Uint8Array.from({ length: 4 + width * height * 4 }, (_, i) => (i * 43 ^ (i >>> 3)) & 255);
  inputs.push([`${width}x${height}`, { width, height, data: rgba.subarray(4) }]);
}
const options = [undefined, { invert: true }, { min: 0, max: 1 }, { min: 0.41, max: 0.42, invert: true }];
for (const [name, image] of inputs) {
  for (const settings of options) {
    const expected = original(image, settings);
    const actual = enabled(image, settings);
    const label = `${name}, options ${JSON.stringify(settings)}`;
    const { data: originalBytes, ...originalImage } = expected.image;
    const { data: nativeBytes, ...nativeImage } = actual.image;
    assert.equal(nativeBytes.constructor, originalBytes.constructor, label);
    assert.equal(Buffer.compare(nativeBytes, originalBytes), 0, label);
    assert.deepEqual(nativeImage, originalImage, label);
    assert.deepEqual(actual.stats, expected.stats, label);
  }
}
const args = ['roughness', 'textures/slate.png', 'out.png', '--json'];
const report = execFileSync(process.execPath, ['original.mjs', ...args]);
const png = readFileSync('out.png');
unlinkSync('out.png');
assert.ok(execFileSync(process.execPath, ['texture.mjs', ...args]).equals(report), 'CLI JSON differs');
assert.ok(readFileSync('out.png').equals(png), 'CLI PNG differs');
console.log(`${inputs.length * options.length} exact comparisons passed. CLI PNG and JSON are byte-identical.`);
