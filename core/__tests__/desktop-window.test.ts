import { expectTypeOf, test } from "bun:test";
import type { AppWindowRequest, DesktopWindowBridge } from "../types/desktop-window.js";

test("desktop app windows have explicit session and export ownership", () => {
  expectTypeOf<AppWindowRequest>().toEqualTypeOf<
    { kind: "session"; url: string } | { kind: "export"; url: string }
  >();
  expectTypeOf<DesktopWindowBridge["openAppWindow"]>().toEqualTypeOf<
    (request: AppWindowRequest) => Promise<void>
  >();
});
