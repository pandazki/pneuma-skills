import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

export interface ClaudeDetectionResult {
  found: boolean;
  path?: string;
  version?: string;
}

/**
 * Detect Claude Code CLI installation.
 * Checks PATH first, then common install locations per platform.
 */
export async function detectClaude(): Promise<ClaudeDetectionResult> {
  // 1. Try PATH lookup
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    const claudePath = execSync(cmd, {
      encoding: "utf-8",
      timeout: 5000,
    })
      .trim()
      .split("\n")[0];

    if (claudePath) {
      const version = getClaudeVersion(claudePath);
      return { found: true, path: claudePath, version };
    }
  } catch {}

  // 2. Try shell PATH (macOS/Linux GUI apps may have limited PATH)
  if (process.platform !== "win32") {
    try {
      const shell = process.env.SHELL || "/bin/sh";
      const claudePath = execSync(
        `${shell} -ilc 'which claude 2>/dev/null'`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();

      if (claudePath && existsSync(claudePath)) {
        const version = getClaudeVersion(claudePath);
        return { found: true, path: claudePath, version };
      }
    } catch {}
  }

  // 3. Check common install locations
  const commonLocations = getCommonLocations();
  for (const loc of commonLocations) {
    if (existsSync(loc)) {
      const version = getClaudeVersion(loc);
      return { found: true, path: loc, version };
    }
  }

  return { found: false };
}

function getClaudeVersion(claudePath: string): string | undefined {
  try {
    return execSync(`"${claudePath}" --version`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return undefined;
  }
}

function getCommonLocations(): string[] {
  const home = homedir();

  switch (process.platform) {
    case "darwin":
      return [
        path.join(home, ".claude", "local", "claude"),
        "/usr/local/bin/claude",
        path.join(home, ".local", "bin", "claude"),
        path.join(home, ".npm-global", "bin", "claude"),
      ];

    case "win32":
      return [
        path.join(
          process.env.LOCALAPPDATA || "",
          "Programs",
          "claude",
          "claude.exe"
        ),
        path.join(
          process.env.APPDATA || "",
          "npm",
          "claude.cmd"
        ),
      ].filter((p) => p.length > 0);

    case "linux":
      return [
        path.join(home, ".local", "bin", "claude"),
        "/usr/local/bin/claude",
        path.join(home, ".npm-global", "bin", "claude"),
      ];

    default:
      return [];
  }
}

/** Get platform-specific install instructions for the setup wizard */
export function getClaudeInstallInstructions(): {
  title: string;
  steps: string[];
  links: { label: string; url: string }[];
} {
  const installCmd =
    process.platform === "win32"
      ? 'Run in PowerShell: <code>irm https://claude.ai/install.ps1 | iex</code>'
      : 'Run in terminal: <code>curl -fsSL https://claude.ai/install.sh | bash</code>';

  const altMethod =
    process.platform === "darwin"
      ? 'Or install via Homebrew: <code>brew install --cask claude-code</code>'
      : process.platform === "win32"
        ? 'Or install via WinGet: <code>winget install Anthropic.ClaudeCode</code>'
        : 'The native installer auto-updates in the background';

  return {
    title: "Claude Code CLI Required",
    steps: [
      installCmd,
      altMethod,
      'Run <code>claude</code> once to log in and complete setup',
      'Then click <strong>"Check Installation"</strong> below',
    ],
    links: [
      {
        label: "Quickstart Guide",
        url: "https://code.claude.com/docs/en/quickstart",
      },
      {
        label: "Claude Code Documentation",
        url: "https://docs.anthropic.com/en/docs/claude-code",
      },
    ],
  };
}
