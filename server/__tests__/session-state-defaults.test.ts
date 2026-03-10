import { describe, expect, test } from "bun:test";
import { makeDefaultState } from "../ws-bridge-types.js";

describe("makeDefaultState", () => {
  test("initializes sessions with Claude Code as the current default backend", () => {
    const state = makeDefaultState("session-1");

    expect(state.session_id).toBe("session-1");
    expect(state.backend_type).toBe("claude-code");
    expect(state.agent_capabilities).toEqual({
      streaming: true,
      resume: true,
      permissions: true,
      toolProgress: true,
      modelSwitch: true,
    });
  });

  test("preserves the existing Claude-oriented defaults used by the bridge", () => {
    const state = makeDefaultState("session-2");

    expect(state.model).toBe("");
    expect(state.cwd).toBe("");
    expect(state.permissionMode).toBe("default");
    expect(state.agent_version).toBe("");
    expect(state.claude_code_version).toBe("");
    expect(state.tools).toEqual([]);
    expect(state.mcp_servers).toEqual([]);
    expect(state.agents).toEqual([]);
    expect(state.slash_commands).toEqual([]);
    expect(state.skills).toEqual([]);
    expect(state.total_cost_usd).toBe(0);
    expect(state.num_turns).toBe(0);
    expect(state.context_used_percent).toBe(0);
    expect(state.is_compacting).toBe(false);
    expect(state.total_lines_added).toBe(0);
    expect(state.total_lines_removed).toBe(0);
  });
});
