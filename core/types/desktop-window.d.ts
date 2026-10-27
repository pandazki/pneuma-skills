export type AppWindowRequest =
  | { kind: "session"; url: string }
  | { kind: "export"; url: string };

export interface DesktopWindowBridge {
  openAppWindow(request: AppWindowRequest): Promise<void>;
}
