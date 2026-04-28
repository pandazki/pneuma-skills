/**
 * InitParamForm smoke tests.
 *
 * Following the project convention (see ProjectChip.test.ts) — bun:test runs
 * without a DOM harness, so we verify two stable contracts the form relies
 * on rather than render the React tree:
 *
 *   1. The module exports a callable default plus a named `InitParamForm`,
 *      i.e. the import resolves and parses (catches accidental rename / re-
 *      export drift between Launcher and ProjectPanel).
 *   2. The shape contract — given the InitParam shape declared in
 *      `core/types/mode-manifest.ts`, the component prop signature accepts
 *      it (compile-time check) and the value-merge convention used inside
 *      the form (`{ ...values, [name]: val }`) is a plain object spread the
 *      consumers depend on.
 */
import { describe, expect, test } from "bun:test";
import InitParamForm, { type InitParamWithAutoFill } from "../InitParamForm.js";
import { InitParamForm as NamedInitParamForm } from "../InitParamForm.js";

describe("InitParamForm", () => {
  test("module exports a callable component (default + named)", () => {
    expect(typeof InitParamForm).toBe("function");
    expect(typeof NamedInitParamForm).toBe("function");
    expect(InitParamForm).toBe(NamedInitParamForm);
  });

  test("InitParamWithAutoFill accepts the auto-fill annotations the server adds", () => {
    // `/api/launch/prepare` augments the base InitParam with `autoFilled` +
    // `maskedPreview` when a stored API key matches. The shared form needs
    // to accept these as optional fields. This test fails to compile if a
    // future refactor drops them.
    const param: InitParamWithAutoFill = {
      name: "openrouterApiKey",
      label: "OpenRouter API key",
      type: "string",
      defaultValue: "sk-or-v1-1234567890abcdef",
      sensitive: true,
      autoFilled: true,
      maskedPreview: "sk-o****cdef",
    };
    expect(param.autoFilled).toBe(true);
    expect(param.maskedPreview).toBe("sk-o****cdef");
  });

  test("value-merge convention preserves untouched fields", () => {
    // The form invokes `onChange({ ...values, [name]: val })`. Verify the
    // spread produces the merge ProjectPanel + Launcher both rely on for
    // their submit-time read of `values`.
    const before: Record<string, string | number> = { a: "1", b: 2 };
    const after = { ...before, b: 99 };
    expect(after).toEqual({ a: "1", b: 99 });
  });
});
