import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useStore } from "../store.js";

const FONT_SIZE = 13;
const FONT_FAMILY =
  "'MesloLGS Nerd Font Mono', 'MesloLGS NF', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

const THEME = {
  background: "#141413",
  foreground: "#faf9f5",
  cursor: "#d97757",
  selectionBackground: "rgba(217, 119, 87, 0.3)",
  black: "#1a1a18",
  red: "#fc8181",
  green: "#48bb78",
  yellow: "#f6e05e",
  blue: "#63b3ed",
  magenta: "#d6bcfa",
  cyan: "#76e4f7",
  white: "#faf9f5",
};

function getWsUrl(terminalId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const host = import.meta.env.DEV
    ? `${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`
    : location.host;
  return `${proto}//${host}/ws/terminal/${terminalId}`;
}

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

export default function TerminalPanel() {
  const terminalId = useStore((s) => s.terminalId);
  const setTerminalId = useStore((s) => s.setTerminalId);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const spawnTerminal = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/terminal/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.terminalId) {
        setTerminalId(data.terminalId);
      }
    } catch (err) {
      console.error("[terminal] Failed to spawn:", err);
    }
  }, [setTerminalId]);

  const killTerminal = useCallback(async () => {
    if (!terminalId) return;
    try {
      await fetch(`${getApiBase()}/api/terminal/kill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminalId }),
      });
    } catch {}
    setTerminalId(null);
  }, [terminalId, setTerminalId]);

  // Auto-spawn on mount if no terminal exists
  useEffect(() => {
    if (!terminalId) {
      spawnTerminal();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize xterm + WebSocket when terminalId changes
  useEffect(() => {
    if (!terminalId || !containerRef.current) return;

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: FONT_SIZE,
      fontFamily: FONT_FAMILY,
      theme: THEME,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);

    // Fit after open
    try {
      fitAddon.fit();
    } catch {}

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const ws = new WebSocket(getWsUrl(terminalId));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // Send initial resize
      try {
        fitAddon.fit();
      } catch {}
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: xterm.cols,
          rows: xterm.rows,
        }),
      );
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary PTY data
        xterm.write(new Uint8Array(event.data));
      } else {
        // JSON control message
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "exit") {
            xterm.writeln(`\r\n[Process exited with code ${msg.exitCode}]`);
            setTerminalId(null);
          }
        } catch {}
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    // User input → server
    const inputDisposable = xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: xterm.cols,
              rows: xterm.rows,
            }),
          );
        }
      } catch {}
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      inputDisposable.dispose();
      resizeObserver.disconnect();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [terminalId, setTerminalId]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-cc-border bg-cc-card">
        <span className="text-xs text-cc-muted font-medium">Terminal</span>
        <div className="flex-1" />
        {terminalId && (
          <button
            onClick={killTerminal}
            className="text-xs px-2 py-0.5 rounded bg-cc-hover hover:bg-cc-active text-cc-muted hover:text-cc-error transition-colors"
          >
            Kill
          </button>
        )}
        <button
          onClick={spawnTerminal}
          className="text-xs px-2 py-0.5 rounded bg-cc-hover hover:bg-cc-active text-cc-muted hover:text-cc-fg transition-colors"
        >
          New
        </button>
      </div>
      {/* Terminal container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ backgroundColor: THEME.background, padding: "4px 0 0 4px" }}
      />
    </div>
  );
}
