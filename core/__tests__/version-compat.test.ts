/**
 * Tests for the version compatibility utility.
 *
 * Covers: exact / caret / tilde / range / compound / wildcard / pre-release.
 * Drift classification: match / minor-drift / major-drift / unknown.
 */

import { describe, it, expect } from "bun:test";
import { checkCompat } from "../version-compat.js";

describe("checkCompat — match cases", () => {
  it("exact match", () => {
    expect(checkCompat("3.8.0", "3.8.0").level).toBe("match");
  });

  it("caret allows minor + patch within same major", () => {
    expect(checkCompat("^3.8.0", "3.8.0").level).toBe("match");
    expect(checkCompat("^3.8.0", "3.8.2").level).toBe("match");
    expect(checkCompat("^3.8.0", "3.9.0").level).toBe("match");
    expect(checkCompat("^3.8.0", "3.99.99").level).toBe("match");
  });

  it("caret rejects next major", () => {
    expect(checkCompat("^3.8.0", "4.0.0").level).not.toBe("match");
  });

  it("tilde allows patch only", () => {
    expect(checkCompat("~3.8.0", "3.8.0").level).toBe("match");
    expect(checkCompat("~3.8.0", "3.8.5").level).toBe("match");
    expect(checkCompat("~3.8.0", "3.9.0").level).not.toBe("match");
  });

  it("compound range", () => {
    expect(checkCompat(">=3.7.0 <4.0.0", "3.8.0").level).toBe("match");
    expect(checkCompat(">=3.7.0 <4.0.0", "3.7.0").level).toBe("match");
    expect(checkCompat(">=3.7.0 <4.0.0", "3.6.0").level).not.toBe("match");
    expect(checkCompat(">=3.7.0 <4.0.0", "4.0.0").level).not.toBe("match");
  });

  it("wildcard always matches", () => {
    expect(checkCompat("*", "3.8.0").level).toBe("match");
    expect(checkCompat("x", "0.1.0").level).toBe("match");
    expect(checkCompat("*", "10.0.0").level).toBe("match");
  });

  it("v-prefixed runtime tolerated", () => {
    expect(checkCompat("^3.8.0", "v3.8.0").level).toBe("match");
  });
});

describe("checkCompat — drift classification", () => {
  it("minor-drift when same major but range doesn't admit runtime", () => {
    // Range targets 3.8 specifically; running 3.7
    const r = checkCompat(">=3.8.0 <3.9.0", "3.7.5");
    expect(r.level).toBe("minor-drift");
    expect(r.reason).toContain("same major");
  });

  it("minor-drift on tilde mismatch within same major", () => {
    const r = checkCompat("~3.7.0", "3.8.0");
    expect(r.level).toBe("minor-drift");
  });

  it("major-drift across majors", () => {
    const r = checkCompat("^3.8.0", "4.0.0");
    expect(r.level).toBe("major-drift");
    expect(r.reason).toContain("different major");
  });

  it("major-drift down from runtime", () => {
    const r = checkCompat("^4.0.0", "3.8.0");
    expect(r.level).toBe("major-drift");
  });
});

describe("checkCompat — unknown cases", () => {
  it("null declared → unknown", () => {
    const r = checkCompat(null, "3.8.0");
    expect(r.level).toBe("unknown");
    expect(r.declared).toBe(null);
  });

  it("undefined declared → unknown", () => {
    expect(checkCompat(undefined, "3.8.0").level).toBe("unknown");
  });

  it("garbage declared → unknown", () => {
    expect(checkCompat("not-a-version", "3.8.0").level).toBe("unknown");
  });

  it("garbage runtime → unknown", () => {
    expect(checkCompat("^3.8.0", "not-a-version").level).toBe("unknown");
  });
});

describe("checkCompat — pre-release versions", () => {
  it("pre-release treated as < the same M.m.p without pre-release", () => {
    // 3.8.0-rc.1 should NOT satisfy ^3.8.0 (which requires >=3.8.0)
    expect(checkCompat("^3.8.0", "3.8.0-rc.1").level).not.toBe("match");
  });

  it("explicit pre-release-lower range matches pre-release runtime", () => {
    expect(checkCompat(">=3.8.0-rc.1 <4.0.0", "3.8.0-rc.1").level).toBe("match");
  });
});

describe("checkCompat — result shape", () => {
  it("match returns no reason", () => {
    const r = checkCompat("^3.8.0", "3.8.1");
    expect(r.level).toBe("match");
    expect(r.reason).toBeUndefined();
  });

  it("drift returns explanatory reason", () => {
    const r = checkCompat("^3.8.0", "4.0.0");
    expect(r.reason).toBeDefined();
    expect(r.declared).toBe("^3.8.0");
    expect(r.runtime).toBe("4.0.0");
  });
});
