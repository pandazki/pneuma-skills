/**
 * Native Bridge — exposes Electron + Node.js APIs to the Pneuma runtime.
 *
 * Architecture: module-level allowlist with automatic method proxying.
 * Most methods are auto-proxied; a small override map handles special cases
 * (non-serializable return values, property accessors, constructors).
 */
import { clipboard, shell, app, nativeTheme, screen, nativeImage, Notification, BrowserWindow } from "electron";
import * as os from "node:os";

// ── Module allowlist ─────────────────────────────────────────────────────────
// Each entry: the actual module/object whose methods will be auto-proxied.
const modules: Record<string, unknown> = {
  clipboard,
  shell,
  app,
  screen,
  nativeTheme,
};

// ── Overrides ────────────────────────────────────────────────────────────────
// Methods that need special handling (non-serializable returns, property access,
// constructors, or synthetic namespaces like `system` / `window`).
type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

const overrides: Record<string, Record<string, Handler>> = {
  // clipboard: NativeImage isn't serializable — convert to/from base64
  clipboard: {
    readImage: () => {
      const img = clipboard.readImage();
      if (img.isEmpty()) return null;
      return img.toPNG().toString("base64");
    },
    writeImage: (...args) => {
      const img = nativeImage.createFromBuffer(Buffer.from(String(args[0]), "base64"));
      clipboard.writeImage(img);
    },
  },

  // nativeTheme: properties, not methods
  nativeTheme: {
    shouldUseDarkColors: () => nativeTheme.shouldUseDarkColors,
    themeSource: () => nativeTheme.themeSource,
  },

  // screen: Display objects have circular refs — extract safe subset
  screen: {
    getPrimaryDisplay: () => {
      const d = screen.getPrimaryDisplay();
      return { id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, rotation: d.rotation };
    },
    getAllDisplays: () => screen.getAllDisplays().map((d) => ({
      id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, rotation: d.rotation,
    })),
  },

  // system: synthetic namespace wrapping Node.js os + process
  system: {
    platform: () => process.platform,
    arch: () => process.arch,
    cpus: () => os.cpus().length,
    cpuModel: () => os.cpus()[0]?.model ?? "unknown",
    totalMemory: () => os.totalmem(),
    freeMemory: () => os.freemem(),
    hostname: () => os.hostname(),
    homedir: () => os.homedir(),
    tmpdir: () => os.tmpdir(),
    uptime: () => os.uptime(),
    version: () => process.version,
    env: (...args) => args[0] ? process.env[String(args[0])] : undefined,
  },

  // notification: constructor-based, not a module with methods
  notification: {
    show: (...args) => {
      const opts = args[0] as { title: string; body?: string; silent?: boolean };
      new Notification({ title: opts.title, body: opts.body, silent: opts.silent }).show();
    },
    isSupported: () => Notification.isSupported(),
  },

  // window: operates on the focused BrowserWindow
  window: {
    minimize: () => { BrowserWindow.getFocusedWindow()?.minimize(); },
    maximize: () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
    },
    isMaximized: () => BrowserWindow.getFocusedWindow()?.isMaximized() ?? false,
    isFullScreen: () => BrowserWindow.getFocusedWindow()?.isFullScreen() ?? false,
    setFullScreen: (...args) => { BrowserWindow.getFocusedWindow()?.setFullScreen(!!args[0]); },
    setAlwaysOnTop: (...args) => { BrowserWindow.getFocusedWindow()?.setAlwaysOnTop(!!args[0]); },
    getBounds: () => BrowserWindow.getFocusedWindow()?.getBounds(),
    setBounds: (...args) => { BrowserWindow.getFocusedWindow()?.setBounds(args[0] as any); },
    setSize: (...args) => { BrowserWindow.getFocusedWindow()?.setSize(Number(args[0]), Number(args[1])); },
    center: () => { BrowserWindow.getFocusedWindow()?.center(); },
    setTitle: (...args) => { BrowserWindow.getFocusedWindow()?.setTitle(String(args[0])); },
    getTitle: () => BrowserWindow.getFocusedWindow()?.getTitle(),
  },
};

// ── Invoke logic ─────────────────────────────────────────────────────────────

export function handleNativeInvoke(capability: string, method: string, ...args: unknown[]): unknown {
  // 1. Check overrides first (special handling)
  const overrideNs = overrides[capability];
  if (overrideNs?.[method]) {
    return overrideNs[method](...args);
  }

  // 2. Auto-proxy: look up the module and call the method directly
  const mod = modules[capability] as Record<string, unknown> | undefined;
  if (!mod) {
    // capability might be override-only (system, notification, window)
    if (overrideNs) throw new Error(`Unknown method: ${capability}.${method}`);
    throw new Error(`Unknown capability: ${capability}`);
  }

  const member = mod[method];
  if (typeof member === "function") {
    return member.call(mod, ...args);
  }
  if (member !== undefined) {
    // Property accessor
    return member;
  }

  throw new Error(`Unknown method: ${capability}.${method}`);
}

// ── Capability listing ───────────────────────────────────────────────────────

export function listCapabilities(): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  // Collect from modules (auto-proxied methods + properties)
  for (const [name, mod] of Object.entries(modules)) {
    const methods = new Set<string>();
    const obj = mod as Record<string, unknown>;
    // Get own enumerable methods/properties
    for (const key of Object.keys(obj)) {
      if (key.startsWith("_")) continue;
      methods.add(key);
    }
    // Also check prototype for class instances (app, clipboard, etc.)
    const proto = Object.getPrototypeOf(obj);
    if (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === "constructor" || key.startsWith("_")) continue;
        methods.add(key);
      }
    }
    // Merge with overrides
    if (overrides[name]) {
      for (const key of Object.keys(overrides[name])) {
        methods.add(key);
      }
    }
    result[name] = [...methods].sort();
  }

  // Add override-only capabilities (system, notification, window)
  for (const [name, handlers] of Object.entries(overrides)) {
    if (!modules[name]) {
      result[name] = Object.keys(handlers).sort();
    }
  }

  return result;
}
