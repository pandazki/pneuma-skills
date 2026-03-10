import { describe, expect, test } from "bun:test";
import { WsBridge } from "../ws-bridge.js";
import type { CLISystemInitMessage } from "../session-types.js";

describe("WsBridge session init", () => {
  test("stores both generic and Claude-compatible version fields on init", () => {
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("session-1", "claude-code");

    const msg: CLISystemInitMessage = {
      type: "system",
      subtype: "init",
      cwd: "/tmp/demo",
      session_id: "agent-1",
      tools: ["Read"],
      mcp_servers: [],
      model: "claude-sonnet-4",
      permissionMode: "default",
      apiKeySource: "user",
      claude_code_version: "2.1.99",
      slash_commands: [],
      agents: [],
      skills: [],
      output_style: "text",
      uuid: "uuid-1",
    };

    (bridge as any).handleSystemMessage(session, msg);

    expect(session.state.agent_version).toBe("2.1.99");
    expect(session.state.claude_code_version).toBe("2.1.99");
    expect(session.state.model).toBe("claude-sonnet-4");
  });
});
