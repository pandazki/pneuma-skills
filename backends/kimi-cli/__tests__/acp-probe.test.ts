import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeAcpSubcommand } from "../acp-probe.js";

test.skipIf(process.platform === "win32")("a pending ACP probe yields to the launcher and shares one subprocess", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pneuma-acp-probe-"));
  const binary = join(dir, "kimi");
  const gate = join(dir, "ready");
  try {
    writeFileSync(binary, `#!/bin/sh
cd "$(dirname "$0")" || exit 1
[ "$1 $2" = "acp --help" ] || exit 2
echo probe >> calls
for i in 1 2 3 4 5 6 7 8 9 10; do
  [ -f ready ] && exit 0
  sleep 0.1
done
exit 1
`, { mode: 0o755 });
    const first = probeAcpSubcommand(binary);
    const second = probeAcpSubcommand(binary);
    writeFileSync(gate, "ready");
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(readFileSync(join(dir, "calls"), "utf8").trim()).toBe("probe");
    writeFileSync(binary, "#!/bin/sh\nexit 1\n");
    expect(await probeAcpSubcommand(binary)).toBe(false);
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    expect(await probeAcpSubcommand(binary)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing executable reports an unavailable ACP probe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pneuma-missing-kimi-"));
  try {
    expect(await probeAcpSubcommand(join(dir, "kimi"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
