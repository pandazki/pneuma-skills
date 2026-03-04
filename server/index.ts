import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import { join, resolve, relative, basename, extname, dirname } from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { WsBridge } from "./ws-bridge.js";
import type { SocketData } from "./ws-bridge.js";
import type { TerminalSocketData } from "./ws-bridge-types.js";
import type { ServerWebSocket } from "bun";
import { TerminalManager } from "./terminal-manager.js";
import { registerModeMakerRoutes } from "./mode-maker-routes.js";
import { openPath, revealPath, openUrl } from "./system-bridge.js";

const DEFAULT_PORT = 17007;

export interface ServerOptions {
  port?: number;
  workspace: string;
  distDir?: string; // Path to built frontend assets (production mode)
  watchPatterns?: string[]; // Glob patterns for content files (from ModeManifest.viewer)
  initParams?: Record<string, number | string>; // Mode init params (immutable per session)
  externalMode?: { name: string; path: string; type: string }; // External mode info for frontend
  modeBundleDir?: string; // Pre-compiled mode bundle directory (production external modes)
  projectRoot?: string; // Pneuma project root (for mode-maker routes to access builtin modes)
  modeName?: string; // Current mode name (for conditional route registration)
  launcherMode?: boolean; // Lightweight launcher server (no workspace, no agent, no watcher)
}

export function startServer(options: ServerOptions) {
  const port = options.port ?? DEFAULT_PORT;
  const workspace = resolve(options.workspace);
  const wsBridge = new WsBridge();
  wsBridge.setWorkspace(workspace);
  const terminalManager = new TerminalManager();

  const app = new Hono();

  // Dev mode: allow cross-origin requests from Vite dev server
  app.use("/api/*", cors({ origin: "*" }));

  // ── Launcher Mode (lightweight — no workspace, no agent, no watcher) ────
  if (options.launcherMode) {
    const REGISTRY_URL = "https://pneuma-storage.vibecoding.icu";

    app.get("/api/registry", async (c) => {
      const builtins = [
        { name: "doc", displayName: "Document", description: "Markdown document editing with live preview", version: "builtin", type: "builtin" as const },
        { name: "slide", displayName: "Slide", description: "Professional presentation creation and editing", version: "builtin", type: "builtin" as const, hasInitParams: true },
        { name: "draw", displayName: "Draw", description: "Excalidraw whiteboard for diagrams and visual thinking", version: "builtin", type: "builtin" as const },
      ];

      let published: Array<{ name: string; displayName: string; description?: string; version: string; publishedAt: string; archiveUrl: string }> = [];
      try {
        const res = await fetch(`${REGISTRY_URL}/registry/index.json`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json() as { modes?: typeof published };
          published = data.modes || [];
        }
      } catch {}

      // Scan local modes from ~/.pneuma/modes/
      const modesDir = join(homedir(), ".pneuma", "modes");
      let local: Array<{ name: string; displayName: string; description?: string; version: string; path: string }> = [];
      try {
        if (existsSync(modesDir)) {
          const { parseManifestTs } = await import("../core/utils/manifest-parser.js");
          const entries = readdirSync(modesDir);
          for (const entry of entries) {
            const entryPath = join(modesDir, entry);
            if (!statSync(entryPath).isDirectory()) continue;
            // Look for manifest.ts or manifest.js
            const manifestFile = ["manifest.ts", "manifest.js"].find((f) => existsSync(join(entryPath, f)));
            if (!manifestFile) continue;
            try {
              const content = readFileSync(join(entryPath, manifestFile), "utf-8");
              const parsed = parseManifestTs(content);
              local.push({
                name: parsed.name || entry,
                displayName: parsed.displayName || entry,
                description: parsed.description,
                version: parsed.version || "local",
                path: entryPath,
              });
            } catch {}
          }
        }
      } catch {}

      return c.json({ builtins, published, local });
    });

    // Delete a local mode
    app.delete("/api/modes/:name", async (c) => {
      const name = c.req.param("name");
      if (!name || name.includes("..") || name.includes("/")) {
        return c.json({ error: "Invalid mode name" }, 400);
      }
      const modesDir = join(homedir(), ".pneuma", "modes");
      const targetDir = join(modesDir, name);
      // Safety: resolved path must be inside modesDir
      if (!resolve(targetDir).startsWith(resolve(modesDir) + "/")) {
        return c.json({ error: "Invalid mode name" }, 400);
      }
      if (!existsSync(targetDir)) {
        return c.json({ error: "Mode not found" }, 404);
      }
      const { rmSync } = await import("node:fs");
      rmSync(targetDir, { recursive: true, force: true });
      return c.json({ ok: true });
    });

    // List recent sessions
    app.get("/api/sessions", (c) => {
      const registryPath = join(homedir(), ".pneuma", "sessions.json");
      let sessions: Array<{ id: string; mode: string; displayName: string; workspace: string; lastAccessed: number }> = [];
      try {
        sessions = JSON.parse(readFileSync(registryPath, "utf-8"));
      } catch {}
      // Filter out sessions whose workspace no longer exists
      sessions = sessions.filter((s) => existsSync(s.workspace));
      // Sort by lastAccessed descending
      sessions.sort((a, b) => b.lastAccessed - a.lastAccessed);
      return c.json({ sessions, homeDir: homedir() });
    });

    // Delete a session record
    app.delete("/api/sessions/:id", (c) => {
      const id = decodeURIComponent(c.req.param("id"));
      const registryPath = join(homedir(), ".pneuma", "sessions.json");
      let sessions: Array<{ id: string; mode: string; displayName: string; workspace: string; lastAccessed: number }> = [];
      try {
        sessions = JSON.parse(readFileSync(registryPath, "utf-8"));
      } catch {}
      sessions = sessions.filter((s) => s.id !== id);
      try {
        writeFileSync(registryPath, JSON.stringify(sessions, null, 2));
      } catch {}
      return c.json({ ok: true });
    });

    // Check if a session's skill needs updating
    app.post("/api/launch/skill-check", async (c) => {
      const { specifier, workspace: rawWorkspace } = await c.req.json<{ specifier: string; workspace: string }>();
      try {
        const resolvedWorkspace = resolve(rawWorkspace.replace(/^~/, homedir()));
        const { resolveMode } = await import("../core/mode-resolver.js");
        const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
        const resolved = await resolveMode(specifier, projectRoot);

        if (resolved.type !== "builtin") {
          const { registerExternalMode } = await import("../core/mode-loader.js");
          registerExternalMode(resolved.name, resolved.path);
        }

        const { loadModeManifest } = await import("../core/mode-loader.js");
        const manifest = await loadModeManifest(resolved.name);
        const currentVersion = manifest.version || "unknown";

        // Read installed version
        let installedVersion = "";
        try {
          const data = JSON.parse(readFileSync(join(resolvedWorkspace, ".pneuma", "skill-version.json"), "utf-8"));
          installedVersion = data.version || "";
        } catch {}

        // Read dismissed version
        let dismissedVersion = "";
        try {
          const data = JSON.parse(readFileSync(join(resolvedWorkspace, ".pneuma", "skill-dismissed.json"), "utf-8"));
          dismissedVersion = data.version || "";
        } catch {}

        const needsUpdate = installedVersion !== "" && installedVersion !== currentVersion;
        const dismissed = needsUpdate && dismissedVersion === currentVersion;

        return c.json({ needsUpdate, currentVersion, installedVersion, dismissed });
      } catch (err) {
        // Can't check — just let them launch
        return c.json({ needsUpdate: false, currentVersion: "", installedVersion: "", dismissed: false });
      }
    });

    // Dismiss a skill update for a specific version
    app.post("/api/launch/skill-dismiss", async (c) => {
      const { workspace: rawWorkspace, version } = await c.req.json<{ workspace: string; version: string }>();
      try {
        const resolvedWorkspace = resolve(rawWorkspace.replace(/^~/, homedir()));
        const dir = join(resolvedWorkspace, ".pneuma");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "skill-dismissed.json"), JSON.stringify({ version }));
      } catch {}
      return c.json({ ok: true });
    });

    app.post("/api/launch/prepare", async (c) => {
      const { specifier } = await c.req.json<{ specifier: string }>();
      try {
        // Resolve mode → load manifest → return initParams
        const { resolveMode } = await import("../core/mode-resolver.js");
        const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
        const resolved = await resolveMode(specifier, projectRoot);

        if (resolved.type !== "builtin") {
          const { registerExternalMode } = await import("../core/mode-loader.js");
          registerExternalMode(resolved.name, resolved.path);
        }

        const { loadModeManifest } = await import("../core/mode-loader.js");
        const manifest = await loadModeManifest(resolved.name);

        return c.json({
          name: resolved.name,
          displayName: manifest.displayName,
          initParams: manifest.init?.params || [],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 400);
      }
    });

    app.post("/api/launch", async (c) => {
      const { specifier, workspace: targetWorkspace, initParams, skipSkill } = await c.req.json<{
        specifier: string;
        workspace: string;
        initParams?: Record<string, string | number>;
        skipSkill?: boolean;
      }>();

      try {
        const resolvedWorkspace = resolve(targetWorkspace.replace(/^~/, homedir()));

        // 1. Create workspace dir
        mkdirSync(resolvedWorkspace, { recursive: true });

        // 2. Save initParams to .pneuma/config.json if provided
        if (initParams && Object.keys(initParams).length > 0) {
          const pneumaDir = join(resolvedWorkspace, ".pneuma");
          mkdirSync(pneumaDir, { recursive: true });
          writeFileSync(join(pneumaDir, "config.json"), JSON.stringify(initParams, null, 2));
        }

        // 3. Spawn pneuma process
        const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
        const pneumaBin = join(projectRoot, "bin", "pneuma.ts");
        const args = ["bun", pneumaBin, specifier, "--workspace", resolvedWorkspace, "--no-prompt", "--no-open"];
        if (skipSkill) args.push("--skip-skill");

        const child = Bun.spawn(args, {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env as Record<string, string> },
        });

        // 4. Wait for "[pneuma] ready <url>" (30s timeout)
        const readyUrl = await new Promise<string>((resolveUrl, reject) => {
          const timeout = setTimeout(() => reject(new Error("Launch timeout (30s)")), 30_000);
          const decoder = new TextDecoder();

          const readStream = async (stream: ReadableStream<Uint8Array>) => {
            const reader = stream.getReader();
            let buffer = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                console.log(`[launcher] ${line}`);
                const match = line.match(/\[pneuma\] ready (.+)/);
                if (match) {
                  clearTimeout(timeout);
                  resolveUrl(match[1]);
                  return;
                }
              }
            }
          };

          if (child.stdout) readStream(child.stdout);
          if (child.stderr) {
            const readErr = async (stream: ReadableStream<Uint8Array>) => {
              const reader = stream.getReader();
              const decoder = new TextDecoder();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                console.error(`[launcher:err] ${decoder.decode(value, { stream: true })}`);
              }
            };
            readErr(child.stderr);
          }

          child.exited.then((code) => {
            clearTimeout(timeout);
            if (code !== 0) reject(new Error(`Process exited with code ${code}`));
          });
        });

        return c.json({ url: readyUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 500);
      }
    });

    // Serve frontend assets in launcher mode too
    if (options.distDir) {
      const distDir = options.distDir;
      app.get("/assets/*", async (c) => {
        const filePath = join(distDir, c.req.path);
        const file = Bun.file(filePath);
        if (await file.exists()) return new Response(file);
        return c.notFound();
      });
      app.get("*", async (c) => {
        const html = await Bun.file(join(distDir, "index.html")).text();
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      });
    }

    // Start server (no WebSocket needed for launcher)
    const MAX_PORT_ATTEMPTS = 10;
    let serverPort = port;
    let server!: ReturnType<typeof Bun.serve>;

    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
      try {
        server = Bun.serve({
          port: serverPort,
          hostname: "0.0.0.0",
          fetch: app.fetch,
        });
        break;
      } catch (err: any) {
        if (err?.code === "EADDRINUSE") {
          console.log(`[server] Port ${serverPort} is in use, trying ${serverPort + 1}...`);
          serverPort++;
        } else {
          throw err;
        }
      }
    }

    console.log(`[server] Launcher server running on http://localhost:${server.port}`);
    return { server, wsBridge, terminalManager, port: server.port as number, modeMakerCleanup: undefined };
  }

  // ── API Routes ─────────────────────────────────────────────────────────

  // Return the current active session ID so browsers can auto-connect
  app.get("/api/session", (c) => {
    return c.json({ sessionId: wsBridge.getActiveSessionId() });
  });

  // Return mode init params for the frontend
  app.get("/api/config", (c) => {
    return c.json({ initParams: options.initParams || {} });
  });

  // Return external mode info for the frontend (needed for /@fs/ imports)
  app.get("/api/mode-info", (c) => {
    if (options.externalMode) {
      return c.json({
        external: true,
        name: options.externalMode.name,
        path: options.externalMode.path,
        type: options.externalMode.type,
      });
    }
    return c.json({ external: false });
  });

  // ── Viewer Action API ───────────────────────────────────────────────
  app.post("/api/viewer/action", async (c) => {
    try {
      const body = await c.req.json<{ actionId: string; params?: Record<string, unknown> }>();
      if (!body.actionId) {
        return c.json({ success: false, message: "actionId is required" }, 400);
      }
      const result = await wsBridge.dispatchViewerAction(body.actionId, body.params);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, message }, 500);
    }
  });

  // ── System Bridge API (OS-level operations for Viewer) ──────────────
  app.post("/api/system/open", async (c) => {
    const body = await c.req.json<{ path: string }>();
    if (!body.path) return c.json({ success: false, message: "path is required" }, 400);
    return c.json(await openPath(workspace, body.path));
  });

  app.post("/api/system/open-url", async (c) => {
    const body = await c.req.json<{ url: string }>();
    if (!body.url) return c.json({ success: false, message: "url is required" }, 400);
    return c.json(await openUrl(body.url));
  });

  app.post("/api/system/reveal", async (c) => {
    const body = await c.req.json<{ path: string }>();
    if (!body.path) return c.json({ success: false, message: "path is required" }, 400);
    return c.json(await revealPath(workspace, body.path));
  });

  // ── Workspace Scaffold API ───────────────────────────────────────────
  app.post("/api/workspace/scaffold", async (c) => {
    try {
      const body = await c.req.json<{ clear?: string[]; files: { path: string; content: string }[] }>();
      if (!Array.isArray(body.files)) {
        return c.json({ success: false, message: "files array is required" }, 400);
      }

      // Validate all paths before performing any mutations
      for (const f of body.files) {
        if (!f.path || f.path.includes("..") || f.path.startsWith("/")) {
          return c.json({ success: false, message: `Invalid path: ${f.path}` }, 400);
        }
        const abs = join(workspace, f.path);
        if (!abs.startsWith(workspace)) {
          return c.json({ success: false, message: `Path escapes workspace: ${f.path}` }, 403);
        }
      }

      // 1. Delete files matching clear globs
      let filesDeleted = 0;
      if (Array.isArray(body.clear)) {
        for (const pattern of body.clear) {
          try {
            const matches = new Bun.Glob(pattern).scanSync({ cwd: workspace, absolute: false });
            for (const relPath of matches) {
              const absPath = join(workspace, relPath);
              if (absPath.startsWith(workspace) && existsSync(absPath)) {
                unlinkSync(absPath);
                filesDeleted++;
              }
            }
          } catch {
            // skip invalid globs
          }
        }
      }

      // 2. Write files
      for (const f of body.files) {
        const absPath = join(workspace, f.path);
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, f.content, "utf-8");
      }

      return c.json({ success: true, filesWritten: body.files.length, filesDeleted });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, message }, 500);
    }
  });

  // ── Slide export: shared builder + routes ─────────────────────────────

  const ASSET_MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
  };

  /** Read a workspace-relative file and return as a data: URI, or null on failure. */
  function readAsDataUri(ref: string): string | null {
    let cleaned = ref.split("?")[0].split("#")[0];
    if (cleaned.startsWith("/content/")) cleaned = cleaned.slice(9);
    if (cleaned.startsWith("/")) return null;
    const absPath = join(workspace, cleaned);
    if (!absPath.startsWith(workspace) || !existsSync(absPath)) return null;
    try {
      const ext = extname(cleaned).toLowerCase();
      const mime = ASSET_MIME[ext] || "application/octet-stream";
      const data = readFileSync(absPath);
      return `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
    } catch {
      return null;
    }
  }

  /** Replace local asset references with inline data: URIs. */
  function inlineAssets(html: string): string {
    // Inline <link rel="stylesheet" href="..."> as <style> blocks
    html = html.replace(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi, (match) => {
      const hrefMatch = match.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!hrefMatch) return match;
      const ref = hrefMatch[1];
      if (/^(https?:|data:|\/\/|#)/i.test(ref)) return match;
      let cleaned = ref.split("?")[0].split("#")[0];
      if (cleaned.startsWith("/content/")) cleaned = cleaned.slice(9);
      if (cleaned.startsWith("/")) return match;
      const absPath = join(workspace, cleaned);
      if (!absPath.startsWith(workspace) || !existsSync(absPath)) return match;
      try {
        const css = readFileSync(absPath, "utf-8");
        return `<style>/* inlined: ${cleaned} */\n${css}\n</style>`;
      } catch {
        return match;
      }
    });

    // Inline src="..." attributes pointing to local files
    html = html.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, ref, suffix) => {
      if (/^(https?:|data:|\/\/|#)/i.test(ref)) return match;
      const dataUri = readAsDataUri(ref);
      return dataUri ? `${prefix}${dataUri}${suffix}` : match;
    });

    // Inline url(...) in CSS pointing to local files
    html = html.replace(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi, (match, ref) => {
      if (/^(https?:|data:|\/\/|#)/i.test(ref)) return match;
      const dataUri = readAsDataUri(ref);
      return dataUri ? `url("${dataUri}")` : match;
    });

    return html;
  }

  /** Build the full export HTML. When inline=true, assets are inlined and toolbar/base removed. */
  function buildExportHtml(opts: { inline: boolean }): { html: string; title: string } | { error: string; status: number } {
    const manifestPath = join(workspace, "manifest.json");
    if (!existsSync(manifestPath)) {
      return { error: "No manifest.json found in workspace", status: 404 };
    }
    let manifest: { title: string; slides: { file: string; title: string }[] };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      return { error: "Failed to parse manifest.json", status: 500 };
    }
    if (!manifest.slides?.length) {
      return { error: "No slides in manifest.json", status: 404 };
    }

    // Read theme.css and patch font stacks for CJK print compatibility
    const themePath = join(workspace, "theme.css");
    let themeCSS = existsSync(themePath) ? readFileSync(themePath, "utf-8") : "";
    const CJK_FONTS = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei"';
    themeCSS = themeCSS.replace(
      /(--font-sans\s*:\s*)([^;]*?)(,\s*)(sans-serif\s*;)/,
      `$1$2, ${CJK_FONTS}$3$4`,
    );

    const W = (options.initParams?.slideWidth as number) || 1280;
    const H = (options.initParams?.slideHeight as number) || 720;

    // Read each slide HTML, extract <head> resources, and build page sections
    const headResourceSet = new Set<string>();
    const slidePages = manifest.slides
      .map((slide) => {
        const slidePath = join(workspace, slide.file);
        let html = existsSync(slidePath) ? readFileSync(slidePath, "utf-8") : `<p>Missing: ${slide.file}</p>`;
        let bodyStyle = "";
        let bodyClass = "";
        if (html.includes("<!DOCTYPE") || html.includes("<html")) {
          const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
          if (headMatch) {
            const headContent = headMatch[1];
            const resourceRe = /<(link\b[^>]*(?:\/>|>)|script\b[^>]*>[\s\S]*?<\/script>|style\b[^>]*>[\s\S]*?<\/style>)/gi;
            let m;
            while ((m = resourceRe.exec(headContent)) !== null) {
              const tag = m[0].trim();
              if (/<link\b/i.test(tag) && !/rel\s*=\s*["']stylesheet["']/i.test(tag) && !/\.css/i.test(tag)) continue;
              headResourceSet.add(tag);
            }
          }
          const bodyTagMatch = html.match(/<body([^>]*)>/i);
          if (bodyTagMatch) {
            const attrs = bodyTagMatch[1];
            const styleMatch = attrs.match(/style\s*=\s*["']([^"']*)["']/i);
            if (styleMatch) bodyStyle = styleMatch[1];
            const classMatch = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
            if (classMatch) bodyClass = classMatch[1];
          }
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          if (bodyMatch) {
            html = bodyMatch[1].trim();
          } else {
            html = html
              .replace(/<!DOCTYPE[^>]*>/gi, "")
              .replace(/<\/?html[^>]*>/gi, "")
              .replace(/<head[\s\S]*?<\/head>/gi, "")
              .replace(/<\/?body[^>]*>/gi, "")
              .trim();
          }
        }
        const wrapStyle = bodyStyle ? ` style="${bodyStyle}"` : "";
        const wrapClass = bodyClass ? ` ${bodyClass}` : "";
        return `<div class="slide-page${wrapClass}"${wrapStyle}>${html}</div>`;
      })
      .join("\n");
    const headResources = Array.from(headResourceSet).join("\n");

    const title = manifest.title || "Slides";
    const baseTag = opts.inline ? "" : '\n<base href="/content/">';
    const toolbarHtml = opts.inline
      ? ""
      : `\n<div class="export-toolbar">
  <h1>${title}</h1>
  <span class="meta">${manifest.slides.length} slides \u00b7 ${W}\u00d7${H}</span>
  <div class="export-toolbar-actions">
    <button onclick="downloadSlides()">Download HTML</button>
    <button onclick="window.print()">Print / Save PDF</button>
  </div>
</div>`;

    const downloadScript = opts.inline
      ? ""
      : `\n<script>
function downloadSlides(){
  var btn=event.target;btn.textContent="Preparing...";btn.disabled=true;
  fetch("/export/slides/download").then(function(r){
    if(!r.ok)throw new Error("HTTP "+r.status);return r.blob();
  }).then(function(b){
    var a=document.createElement("a");a.href=URL.createObjectURL(b);
    a.download=document.title.replace(/\\s*\\u2014\\s*Export$/,"")+".html";
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }).catch(function(e){alert("Download failed: "+e.message)})
  .finally(function(){btn.textContent="Download HTML";btn.disabled=false});
}
<\/script>`;

    let exportHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${W}, initial-scale=1">${baseTag}
<title>${title} \u2014 Export</title>
${headResources}
<style>
${themeCSS}

@page {
  size: ${W}px ${H}px;
  margin: 0;
}

* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

html {
  margin: 0;
  padding: 0;
}

body {
  margin: 0;
  padding: 0;
}

.slide-page {
  width: ${W}px;
  height: ${H}px;
  overflow: hidden;
  break-after: page;
  position: relative;
  background: var(--color-bg, #fff);
}
${opts.inline ? `
/* Standalone: same preview chrome but no toolbar gap at top */
@media screen {
  html { background: #1a1a1a; }
  body { padding: 0 0 40px 0; }
  .slide-page {
    margin: 20px auto;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    border-radius: 4px;
  }
  body { padding-top: 20px; }
}
` : `
/* Screen preview: dark chrome with spacing and shadow */
@media screen {
  html { background: #1a1a1a; }
  body { padding: 0 0 40px 0; }
  .slide-page {
    margin: 20px auto;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    border-radius: 4px;
  }
  .export-toolbar {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    background: #111;
    border-bottom: 1px solid #333;
    color: #ccc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .export-toolbar h1 {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
    color: #fff;
  }
  .export-toolbar .meta {
    font-size: 13px;
    color: #888;
  }
  .export-toolbar-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .export-toolbar button {
    padding: 8px 16px;
    background: #d97757;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .export-toolbar button:hover {
    background: #c56645;
  }
}
`}
/* Print: set body width, preserve slide backgrounds */
@media print {
  body { padding: 0; width: ${W}px; }
  .export-toolbar { display: none; }
  .slide-page {
    margin: 0;
    box-shadow: none;
    border-radius: 0;
    break-inside: avoid;
  }
}
</style>
</head>
<body>${toolbarHtml}
${slidePages}${downloadScript}
</body>
</html>`;

    if (opts.inline) {
      exportHtml = inlineAssets(exportHtml);
    }

    return { html: exportHtml, title };
  }

  app.get("/export/slides", (c) => {
    const result = buildExportHtml({ inline: false });
    if ("error" in result) return c.text(result.error, result.status as any);
    return c.html(result.html);
  });

  app.get("/export/slides/download", (c) => {
    const result = buildExportHtml({ inline: true });
    if ("error" in result) return c.text(result.error, result.status as any);
    const safeFilename = result.title.replace(/[^\w\s.-]/g, "_") + ".html";
    const utf8Filename = encodeURIComponent(result.title + ".html");
    return new Response(result.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${utf8Filename}`,
      },
    });
  });

  app.get("/api/files", (c) => {
    const files: { path: string; content: string }[] = [];
    const patterns = options.watchPatterns || ["**/*.md"];
    try {
      for (const pattern of patterns) {
        const entries = new Bun.Glob(pattern).scanSync({ cwd: workspace, absolute: false });
        for (const relPath of entries) {
          // Skip config files
          if (relPath === "CLAUDE.md" || relPath.startsWith(".claude/")) continue;
          // Skip duplicates (patterns may overlap)
          if (files.some((f) => f.path === relPath)) continue;
          const absPath = join(workspace, relPath);
          try {
            const content = readFileSync(absPath, "utf-8");
            files.push({ path: relPath, content });
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // glob failed
    }
    return c.json({ files, workspace });
  });

  // ── Save file ────────────────────────────────────────────────────────
  app.post("/api/files", async (c) => {
    const body = await c.req.json<{ path: string; content: string }>();
    const relPath = body.path;
    if (!relPath || typeof body.content !== "string") {
      return c.json({ error: "Missing path or content" }, 400);
    }
    const absPath = join(workspace, relPath);
    if (!absPath.startsWith(workspace)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    try {
      writeFileSync(absPath, body.content, "utf-8");
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: "Failed to write file" }, 500);
    }
  });

  // ── Read single file ────────────────────────────────────────────────
  app.get("/api/files/read", (c) => {
    const relPath = c.req.query("path");
    if (!relPath) return c.json({ error: "Missing path" }, 400);
    const absPath = join(workspace, relPath);
    if (!absPath.startsWith(workspace)) return c.json({ error: "Forbidden" }, 403);
    try {
      const content = readFileSync(absPath, "utf-8");
      return c.json({ path: relPath, content });
    } catch {
      return c.json({ error: "File not found" }, 404);
    }
  });

  // ── File tree ──────────────────────────────────────────────────────
  app.get("/api/files/tree", (c) => {
    interface TreeNode {
      name: string;
      path: string;
      type: "file" | "directory";
      children?: TreeNode[];
    }
    function buildTree(dir: string, relBase: string): TreeNode[] {
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return entries.map((e) => {
        const rel = relBase ? `${relBase}/${e.name}` : e.name;
        if (e.isDirectory()) {
          return { name: e.name, path: rel, type: "directory" as const, children: buildTree(join(dir, e.name), rel) };
        }
        return { name: e.name, path: rel, type: "file" as const };
      });
    }
    return c.json({ tree: buildTree(workspace, "") });
  });

  // ── Git: availability check ────────────────────────────────────────
  app.get("/api/git/available", (c) => {
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd: workspace, encoding: "utf-8", timeout: 3_000, stdio: ["pipe", "pipe", "pipe"] });
      return c.json({ available: true });
    } catch {
      return c.json({ available: false });
    }
  });

  // ── Git: branch info (for Context panel) ────────────────────────────
  app.get("/api/git/info", (c) => {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: workspace, encoding: "utf-8", timeout: 3_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      let ahead = 0;
      let behind = 0;
      try {
        const counts = execSync("git rev-list --left-right --count HEAD...@{upstream}", { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        const [a, b] = counts.split(/\s+/);
        ahead = parseInt(a, 10) || 0;
        behind = parseInt(b, 10) || 0;
      } catch { /* no upstream set */ }
      return c.json({ branch, ahead, behind });
    } catch {
      return c.json({ branch: null, ahead: 0, behind: 0 });
    }
  });

  // ── Git: changed files ─────────────────────────────────────────────
  app.get("/api/git/changed-files", (c) => {
    const base = c.req.query("base") || "last-commit";
    const files = new Map<string, string>(); // relPath → status (A/M/D)
    try {
      // Uncommitted changes vs HEAD
      const nameStatus = execSync("git -c core.quotePath=false diff HEAD --name-status", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      for (const line of nameStatus.split("\n").filter(Boolean)) {
        const [status, ...parts] = line.split("\t");
        const filePath = parts.join("\t");
        if (status && filePath) files.set(filePath, status.charAt(0));
      }
      // Untracked files
      const untracked = execSync("git -c core.quotePath=false ls-files --others --exclude-standard", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      for (const filePath of untracked.split("\n").filter(Boolean)) {
        if (!files.has(filePath)) files.set(filePath, "A");
      }
      // Branch diff (if requested)
      if (base === "default-branch") {
        try {
          const defaultBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD --short", { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          const branchStatus = execSync(`git -c core.quotePath=false diff ${defaultBranch}...HEAD --name-status`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          for (const line of branchStatus.split("\n").filter(Boolean)) {
            const [status, ...parts] = line.split("\t");
            const filePath = parts.join("\t");
            if (status && filePath && !files.has(filePath)) files.set(filePath, status.charAt(0));
          }
        } catch { /* no default branch info available */ }
      }
    } catch {
      // Not a git repo or git not available
    }
    const result = Array.from(files.entries()).map(([path, status]) => ({ path, status }));
    return c.json({ files: result });
  });

  // ── Git: file diff ─────────────────────────────────────────────────
  app.get("/api/git/diff", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "Missing path" }, 400);
    const base = c.req.query("base") || "last-commit";
    try {
      let diff = "";
      const absPath = join(workspace, filePath);
      // Check if file is untracked
      const tracked = execSync(`git -c core.quotePath=false ls-files -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (!tracked) {
        // Untracked new file — diff against /dev/null
        try {
          diff = execSync(`git -c core.quotePath=false diff --no-index -- /dev/null "${absPath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        } catch (e: any) {
          // git diff --no-index exits with 1 when there are differences
          diff = e.stdout?.toString() || "";
        }
      } else if (base === "default-branch") {
        try {
          const defaultBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD --short", { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          diff = execSync(`git -c core.quotePath=false diff ${defaultBranch}...HEAD -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        } catch { /* fallback to HEAD */ }
        if (!diff) {
          try {
            diff = execSync(`git -c core.quotePath=false diff HEAD -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          } catch (e: any) { diff = e.stdout?.toString() || ""; }
        }
      } else {
        try {
          diff = execSync(`git -c core.quotePath=false diff HEAD -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        } catch (e: any) { diff = e.stdout?.toString() || ""; }
      }
      return c.json({ path: filePath, diff });
    } catch {
      return c.json({ path: filePath, diff: "" });
    }
  });

  // ── Git: status (for editor file tree badges) ──────────────────────
  app.get("/api/git/status", (c) => {
    try {
      const output = execSync("git -c core.quotePath=false status --porcelain", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trimEnd();
      const statuses: Record<string, string> = {};
      for (const line of output.split("\n").filter(Boolean)) {
        const status = line.substring(0, 2).trim();
        let filePath = line.substring(3);
        // Git wraps paths containing special chars in quotes — strip them
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
          filePath = filePath.slice(1, -1);
        }
        if (status === "??" || status === "A") statuses[filePath] = "A";
        else if (status === "D") statuses[filePath] = "D";
        else statuses[filePath] = "M";
      }
      return c.json({ statuses });
    } catch {
      return c.json({ statuses: {} });
    }
  });

  // ── Process management ──────────────────────────────────────────────
  app.get("/api/processes/system", (c) => {
    const DEV_COMMANDS = new Set(["node", "bun", "deno", "python", "python3", "uvicorn", "vite", "next", "nuxt", "webpack", "esbuild", "tsx"]);
    const EXCLUDE_COMMANDS = new Set(["launchd", "nginx", "docker", "dockerd", "com.docker", "Cursor", "cursor", "Code", "code"]);
    const processes: { pid: number; command: string; fullCommand: string; ports: number[]; cwd?: string; startedAt?: number }[] = [];
    try {
      const lsofOutput = execSync("lsof -iTCP -sTCP:LISTEN -P -n", { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
      const pidPorts = new Map<number, Set<number>>();
      const pidCommand = new Map<number, string>();
      for (const line of lsofOutput.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 9) continue;
        const cmd = parts[0];
        const pid = parseInt(parts[1], 10);
        if (isNaN(pid)) continue;
        if (EXCLUDE_COMMANDS.has(cmd)) continue;
        if (!DEV_COMMANDS.has(cmd)) continue;
        pidCommand.set(pid, cmd);
        // lsof NAME field is "addr:port (LISTEN)" — port is in the second-to-last field
        const nameField = parts.length >= 10 ? parts[parts.length - 2] : parts[parts.length - 1];
        const portMatch = nameField.match(/:(\d+)$/);
        if (portMatch) {
          if (!pidPorts.has(pid)) pidPorts.set(pid, new Set());
          pidPorts.get(pid)!.add(parseInt(portMatch[1], 10));
        }
      }
      for (const [pid, ports] of pidPorts) {
        let fullCommand = "";
        let cwd: string | undefined;
        try { fullCommand = execSync(`ps -p ${pid} -o args=`, { encoding: "utf-8", timeout: 3_000 }).trim(); } catch {}
        try {
          const cwdOutput = execSync(`lsof -a -p ${pid} -d cwd -Fn`, { encoding: "utf-8", timeout: 3_000 });
          const cwdMatch = cwdOutput.match(/\nn(.+)/);
          if (cwdMatch) cwd = cwdMatch[1];
        } catch {}
        processes.push({
          pid,
          command: pidCommand.get(pid) || "",
          fullCommand,
          ports: Array.from(ports),
          cwd,
        });
      }
    } catch { /* lsof not available or failed */ }
    return c.json({ processes });
  });

  app.post("/api/processes/:taskId/kill", async (c) => {
    const taskId = c.req.param("taskId");
    if (!/^[a-f0-9]+$/i.test(taskId)) return c.json({ error: "Invalid taskId" }, 400);
    try {
      execSync(`pkill -f "${taskId}"`, { timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] });
    } catch { /* process may already be gone */ }
    return c.json({ ok: true, taskId });
  });

  app.post("/api/processes/system/:pid/kill", async (c) => {
    const pid = parseInt(c.req.param("pid"), 10);
    if (isNaN(pid) || pid <= 0) return c.json({ error: "Invalid PID" }, 400);
    if (pid === process.pid) return c.json({ error: "Cannot kill self" }, 403);
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    return c.json({ ok: true, pid });
  });

  // ── Terminal management ──────────────────────────────────────────────
  app.post("/api/terminal/spawn", async (c) => {
    const body = await c.req.json<{ cwd?: string; cols?: number; rows?: number }>();
    const cwd = body.cwd || workspace;
    const terminalId = terminalManager.spawn(cwd, body.cols, body.rows);
    return c.json({ terminalId });
  });

  app.get("/api/terminal", (c) => {
    const terminalId = c.req.query("terminalId");
    const info = terminalManager.getInfo(terminalId);
    if (info) {
      return c.json({ active: true, terminalId: info.id, cwd: info.cwd });
    }
    return c.json({ active: false });
  });

  app.post("/api/terminal/kill", async (c) => {
    const body = await c.req.json<{ terminalId?: string }>();
    terminalManager.kill(body.terminalId);
    return c.json({ ok: true });
  });

  // ── Mode Maker routes (conditional) ──────────────────────────────────
  let modeMakerCleanup: (() => void) | undefined;
  if (options.modeName === "mode-maker" && options.projectRoot) {
    modeMakerCleanup = registerModeMakerRoutes(app, {
      workspace,
      projectRoot: options.projectRoot,
    });
  }

  // ── Static content serving (workspace files) ──────────────────────────
  app.get("/content/*", async (c) => {
    const relPath = decodeURIComponent(c.req.path.replace(/^\/content\//, ""));
    const absPath = join(workspace, relPath);
    // Basic path traversal protection
    if (!absPath.startsWith(workspace)) {
      return c.text("Forbidden", 403);
    }
    if (!existsSync(absPath)) {
      return c.text("Not found", 404);
    }
    try {
      const file = Bun.file(absPath);
      return new Response(file, {
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
    } catch {
      return c.text("Error reading file", 500);
    }
  });

  // ── External mode bundle serving (production) ───────────────────────
  if (options.modeBundleDir) {
    const bundleDir = options.modeBundleDir;

    // Vendor shims — re-export React from window globals set by main bundle
    const REACT_SHIM = `const R = window.__PNEUMA_REACT__;
export default R;
export const { useState, useEffect, useCallback, useMemo, useRef, useContext, createContext, forwardRef, memo, Fragment, createElement, cloneElement, Children, isValidElement, Component, PureComponent, Suspense, lazy, startTransition, useTransition, useDeferredValue, useId, useSyncExternalStore, useImperativeHandle, useLayoutEffect, useDebugValue, useReducer } = R;`;

    const JSX_RUNTIME_SHIM = `const J = window.__PNEUMA_JSX_RUNTIME__;
export const { jsx, jsxs, Fragment } = J;`;

    // Bun.build uses jsx-dev-runtime (jsxDEV) due to a Bun v1.3+ regression.
    // jsxDEV(type, props, key, isStatic, source, self) is signature-compatible
    // with jsx(type, props, key) — extra dev args are simply ignored.
    const JSX_DEV_RUNTIME_SHIM = `const J = window.__PNEUMA_JSX_RUNTIME__;
export const jsxDEV = J.jsx;
export const Fragment = J.Fragment;`;

    app.get("/vendor/react.js", (c) => new Response(REACT_SHIM, { headers: { "Content-Type": "application/javascript" } }));
    app.get("/vendor/react-dom.js", (c) => new Response(`export default window.__PNEUMA_REACT_DOM__;`, { headers: { "Content-Type": "application/javascript" } }));
    app.get("/vendor/react-jsx-runtime.js", (c) => new Response(JSX_RUNTIME_SHIM, { headers: { "Content-Type": "application/javascript" } }));
    app.get("/vendor/react-jsx-dev-runtime.js", (c) => new Response(JSX_DEV_RUNTIME_SHIM, { headers: { "Content-Type": "application/javascript" } }));

    // Serve compiled mode bundle
    app.get("/mode-assets/*", async (c) => {
      const relPath = c.req.path.replace("/mode-assets/", "");
      const filePath = join(bundleDir, relPath);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, { headers: { "Content-Type": "application/javascript" } });
      }
      return c.notFound();
    });
  }

  // ── Built frontend serving (production) ─────────────────────────────
  if (options.distDir) {
    const distDir = options.distDir;
    const hasModeBundleDir = !!options.modeBundleDir;

    app.get("/assets/*", async (c) => {
      const filePath = join(distDir, c.req.path);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      return c.notFound();
    });

    // SPA fallback — serve index.html for all non-API routes
    // When external mode bundle exists, inject importmap for React resolution
    app.get("*", async (c) => {
      let html = await Bun.file(join(distDir, "index.html")).text();

      if (hasModeBundleDir) {
        const importMap = `<script type="importmap">
{"imports":{"react":"/vendor/react.js","react-dom":"/vendor/react-dom.js","react/jsx-runtime":"/vendor/react-jsx-runtime.js","react/jsx-dev-runtime":"/vendor/react-jsx-dev-runtime.js"}}
</script>`;
        html = html.replace("<head>", `<head>\n${importMap}`);
      }

      return new Response(html, { headers: { "Content-Type": "text/html" } });
    });
  }

  // ── Bun.serve with WebSocket ──────────────────────────────────────────
  const MAX_PORT_ATTEMPTS = 10;
  let serverPort = port;
  let server!: ReturnType<typeof Bun.serve<SocketData>>;

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      server = Bun.serve<SocketData>({
        port: serverPort,
        hostname: "0.0.0.0",
    async fetch(req, server) {
      const url = new URL(req.url);

      // CLI WebSocket — Claude Code CLI connects here via --sdk-url
      const cliMatch = url.pathname.match(/^\/ws\/cli\/([a-f0-9-]+)$/);
      if (cliMatch) {
        const sessionId = cliMatch[1];
        const upgraded = server.upgrade(req, {
          data: { kind: "cli" as const, sessionId },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Browser WebSocket — connects to a specific session
      const browserMatch = url.pathname.match(/^\/ws\/browser\/([a-f0-9-]+)$/);
      if (browserMatch) {
        const sessionId = browserMatch[1];
        const upgraded = server.upgrade(req, {
          data: { kind: "browser" as const, sessionId },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Terminal WebSocket — connects to a PTY terminal
      const terminalMatch = url.pathname.match(/^\/ws\/terminal\/([a-f0-9-]+)$/);
      if (terminalMatch) {
        const terminalId = terminalMatch[1];
        const upgraded = server.upgrade(req, {
          data: { kind: "terminal" as const, terminalId },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Hono handles the rest
      return app.fetch(req, server);
    },
    websocket: {
      open(ws: ServerWebSocket<SocketData>) {
        const data = ws.data;
        if (data.kind === "cli") {
          wsBridge.handleCLIOpen(ws, data.sessionId);
        } else if (data.kind === "browser") {
          wsBridge.handleBrowserOpen(ws, data.sessionId);
        } else if (data.kind === "terminal") {
          terminalManager.addBrowserSocket(ws as ServerWebSocket<TerminalSocketData>);
        }
      },
      message(ws: ServerWebSocket<SocketData>, msg: string | Buffer) {
        const data = ws.data;
        if (data.kind === "cli") {
          wsBridge.handleCLIMessage(ws, msg);
        } else if (data.kind === "browser") {
          wsBridge.handleBrowserMessage(ws, msg);
        } else if (data.kind === "terminal") {
          terminalManager.handleBrowserMessage(ws as ServerWebSocket<TerminalSocketData>, msg);
        }
      },
      close(ws: ServerWebSocket<SocketData>) {
        const data = ws.data;
        if (data.kind === "cli") {
          wsBridge.handleCLIClose(ws);
        } else if (data.kind === "browser") {
          wsBridge.handleBrowserClose(ws);
        } else if (data.kind === "terminal") {
          terminalManager.removeBrowserSocket(ws as ServerWebSocket<TerminalSocketData>);
        }
      },
    },
  });
      break; // success
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") {
        console.log(`[server] Port ${serverPort} is in use, trying ${serverPort + 1}...`);
        serverPort++;
      } else {
        throw err;
      }
    }
  }

  console.log(`[server] Pneuma server running on http://localhost:${server.port}`);
  console.log(`[server] Workspace: ${workspace}`);
  console.log(`[server] CLI WebSocket:     ws://localhost:${server.port}/ws/cli/:sessionId`);
  console.log(`[server] Browser WebSocket: ws://localhost:${server.port}/ws/browser/:sessionId`);

  return { server, wsBridge, terminalManager, port: server.port as number, modeMakerCleanup };
}
