import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PATH = join(
  import.meta.dir,
  "..",
  "skill",
  "workflows",
  "writing.workflow.js",
);
const SOURCE = readFileSync(PATH, "utf8");
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

describe("writing.workflow.js", () => {
  it("declares the source project's two-level phases", () => {
    expect(SOURCE).toContain("name: 'wordtaste-writing-loop'");
    for (const phase of ["Shape", "Write", "Check"]) {
      expect(SOURCE).toContain(`title: '${phase}'`);
      expect(SOURCE).toContain(`phase('${phase}')`);
    }
  });

  it("returns at the layout boundary before writing", () => {
    const layoutReturn = SOURCE.indexOf("stage: 'layout'");
    const writePhase = SOURCE.indexOf("phase('Write')");
    expect(layoutReturn).toBeGreaterThan(-1);
    expect(writePhase).toBeGreaterThan(layoutReturn);
    expect(SOURCE).toContain("if (!A.approved)");
  });

  it("writes units sequentially and passes finished preceding prose", () => {
    expect(SOURCE).toContain("for (const unit of layout.units)");
    expect(SOURCE).toContain("Functional role:");
    expect(SOURCE).toContain("Finished prose before this unit:");
    expect(SOURCE).not.toContain("parallel(");
  });

  it("makes unit function the first layout dimension", () => {
    expect(SOURCE).toContain(
      "required: ['id', 'role', 'brief', 'rhythm', 'targetChars']",
    );
    expect(SOURCE).toContain("role: { type: 'string'");
    expect(SOURCE).toContain("function before length or rhythm");
    expect(SOURCE).toContain("same force");
  });

  it("repairs any reported issue, then rechecks the same list", () => {
    expect(SOURCE).toContain("if (check.issues.length > 0)");
    expect(SOURCE).toContain("Previous issues:");
    expect(SOURCE).toContain("label: 'recheck'");
  });

  it("routes hard failures and subjective residue to finite terminal states", () => {
    expect(SOURCE).toContain(
      "check.kernelOk === false ? 'blocked' : check.pass ? 'done' : 'needs-review'",
    );
    expect(SOURCE).toContain("do not overwrite an existing source draft");
    expect(SOURCE).toContain("do not start another internal repair loop");
  });

  it("contains no nondeterministic or sandbox-forbidden escape", () => {
    expect(CODE).not.toContain("Date.now(");
    expect(CODE).not.toContain("Math.random(");
    expect(CODE).not.toMatch(/new Date\(\s*\)/);
    expect(CODE).not.toMatch(/\brequire\s*\(/);
    expect(CODE).not.toMatch(/\bprocess\./);
    expect(CODE).not.toMatch(/from\s+['"]node:/);
  });
});
