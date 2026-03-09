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
  return {
    title: "Claude Code CLI Required",
    steps: [
      'Install Claude Code CLI via npm: <code>npm install -g @anthropic-ai/claude-code</code>',
      "Or use the official installer from Anthropic's website",
      'Once installed, click <strong>"Check Installation"</strong> below',
    ],
    links: [
      {
        label: "Claude Code Documentation",
        url: "https://docs.anthropic.com/en/docs/claude-code",
      },
      {
        label: "npm Package",
        url: "https://www.npmjs.com/package/@anthropic-ai/claude-code",
      },
    ],
  };
}
