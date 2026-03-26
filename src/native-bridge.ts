const desktop = (window as any).pneumaDesktop as {
  invoke?: (capability: string, method: string, ...args: unknown[]) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  capabilities?: () => Promise<Record<string, string[]>>;
} | undefined;

export function isDesktopAvailable(): boolean {
  return !!desktop?.invoke;
}

export async function getNativeCapabilities(): Promise<Record<string, string[]> | null> {
  if (!desktop?.capabilities) return null;
  try {
    return await desktop.capabilities();
  } catch {
    return null;
  }
}

export async function handleNativeRequest(
  msg: { requestId: string; capability: string; method: string; args: unknown[] },
  send: (data: unknown) => void,
) {
  if (!desktop?.invoke) {
    send({ type: "native_result", requestId: msg.requestId, ok: false, error: "Not in desktop app" });
    return;
  }
  try {
    const result = await desktop.invoke(msg.capability, msg.method, ...msg.args);
    send({ type: "native_result", requestId: msg.requestId, ...result });
  } catch (err) {
    send({ type: "native_result", requestId: msg.requestId, ok: false, error: String(err) });
  }
}
