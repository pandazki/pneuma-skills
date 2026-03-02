/**
 * ViewerContract 契约测试
 *
 * 验证 ViewerContract 接口约束：
 * - PreviewComponent 是有效的 React 组件类型
 * - extractContext 返回格式正确的上下文字符串
 * - updateStrategy 是合法枚举值
 * - workspace model 约束
 * - action descriptors 结构
 * - 向后兼容
 */

import { describe, test, expect } from "bun:test";
import type {
  ViewerContract,
  ViewerPreviewProps,
  ViewerSelectionContext,
  ViewerFileContent,
  FileWorkspaceModel,
  WorkspaceItem,
  ViewerActionDescriptor,
} from "../types/index.js";

// ── 辅助：创建 mock viewer ─────────────────────────────────────────────────

function createMockViewer(
  overrides?: Partial<ViewerContract>,
): ViewerContract {
  return {
    PreviewComponent: (() => null) as unknown as ViewerContract["PreviewComponent"],
    extractContext: () => "",
    updateStrategy: "full-reload",
    ...overrides,
  };
}

// ── ViewerContract 基本约束 ─────────────────────────────────────────────────

describe("ViewerContract", () => {
  test("PreviewComponent is a function (React component)", () => {
    const viewer = createMockViewer();
    expect(typeof viewer.PreviewComponent).toBe("function");
  });

  test("extractContext returns empty string when no selection", () => {
    const viewer = createMockViewer({
      extractContext: (selection) => {
        if (!selection) return "";
        return `[Selected: ${selection.type}]`;
      },
    });
    expect(viewer.extractContext(null, [])).toBe("");
  });

  test("extractContext returns context string with selection", () => {
    const viewer = createMockViewer({
      extractContext: (selection, files) => {
        const parts: string[] = [];
        if (files.length > 0) {
          parts.push(`[User is viewing: ${files[0].path}]`);
        }
        if (selection) {
          parts.push(`[User selected: ${selection.type} "${selection.content}"]`);
        }
        return parts.join("\n");
      },
    });

    const selection: ViewerSelectionContext = {
      type: "heading",
      content: "Introduction",
      level: 2,
    };
    const files: ViewerFileContent[] = [
      { path: "README.md", content: "# Hello" },
    ];

    const result = viewer.extractContext(selection, files);
    expect(result).toContain("[User is viewing: README.md]");
    expect(result).toContain('[User selected: heading "Introduction"]');
  });

  test("updateStrategy is a valid enum value", () => {
    const validValues = ["full-reload", "incremental"];

    const viewer1 = createMockViewer({ updateStrategy: "full-reload" });
    expect(validValues).toContain(viewer1.updateStrategy);

    const viewer2 = createMockViewer({ updateStrategy: "incremental" });
    expect(validValues).toContain(viewer2.updateStrategy);
  });
});

// ── ViewerPreviewProps 完整性 ───────────────────────────────────────────────

describe("ViewerPreviewProps shape", () => {
  test("contains all required fields", () => {
    const props: ViewerPreviewProps = {
      files: [],
      selection: null,
      onSelect: () => {},
      mode: "view",
      contentVersion: 0,
      imageVersion: 0,
    };

    expect(props.files).toEqual([]);
    expect(props.selection).toBeNull();
    expect(typeof props.onSelect).toBe("function");
    expect(["view", "edit", "select"]).toContain(props.mode);
    expect(typeof props.contentVersion).toBe("number");
    expect(typeof props.imageVersion).toBe("number");
  });

  test("mode has three valid values", () => {
    const modes: ViewerPreviewProps["mode"][] = ["view", "edit", "select"];
    expect(modes).toHaveLength(3);
  });
});

// ── extractContext 边界条件 ──────────────────────────────────────────────────

describe("extractContext edge cases", () => {
  test("handles selection without file context", () => {
    const viewer = createMockViewer({
      extractContext: (selection, files) => {
        if (!selection) return "";
        return `[User selected: ${selection.type} "${selection.content}"]`;
      },
    });

    const result = viewer.extractContext(
      { type: "paragraph", content: "Some text" },
      [],
    );
    expect(result).toBe('[User selected: paragraph "Some text"]');
  });

  test("handles file context without selection", () => {
    const viewer = createMockViewer({
      extractContext: (selection, files) => {
        if (files.length > 0) {
          return `[User is viewing: ${files[0].path}]`;
        }
        return "";
      },
    });

    const result = viewer.extractContext(null, [
      { path: "doc.md", content: "content" },
    ]);
    expect(result).toBe("[User is viewing: doc.md]");
  });

  test("handles empty files and no selection", () => {
    const viewer = createMockViewer({
      extractContext: () => "",
    });
    expect(viewer.extractContext(null, [])).toBe("");
  });
});

// ── FileWorkspaceModel ─────────────────────────────────────────────────────

describe("FileWorkspaceModel", () => {
  test("type 'all' — multi-file, unordered", () => {
    const ws: FileWorkspaceModel = {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
    };
    expect(ws.type).toBe("all");
    expect(ws.multiFile).toBe(true);
    expect(ws.ordered).toBe(false);
  });

  test("type 'manifest' — ordered, with manifest file", () => {
    const ws: FileWorkspaceModel = {
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: true,
      manifestFile: "manifest.json",
    };
    expect(ws.type).toBe("manifest");
    expect(ws.manifestFile).toBe("manifest.json");
    expect(ws.hasActiveFile).toBe(true);
  });

  test("type 'single' — single file", () => {
    const ws: FileWorkspaceModel = {
      type: "single",
      multiFile: false,
      ordered: false,
      hasActiveFile: false,
    };
    expect(ws.type).toBe("single");
    expect(ws.multiFile).toBe(false);
  });

  test("resolveItems parses manifest-based workspace", () => {
    const ws: FileWorkspaceModel = {
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: true,
      manifestFile: "manifest.json",
      resolveItems: (files) => {
        const mf = files.find((f) => f.path === "manifest.json");
        if (!mf) return [];
        const parsed = JSON.parse(mf.content);
        return parsed.slides.map(
          (s: { file: string; title: string }, i: number) => ({
            path: s.file,
            label: s.title,
            index: i,
          }),
        );
      },
    };

    const files: ViewerFileContent[] = [
      {
        path: "manifest.json",
        content: JSON.stringify({
          slides: [
            { file: "slides/s1.html", title: "Intro" },
            { file: "slides/s2.html", title: "Content" },
          ],
        }),
      },
    ];

    const items = ws.resolveItems!(files);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ path: "slides/s1.html", label: "Intro", index: 0 });
    expect(items[1]).toEqual({ path: "slides/s2.html", label: "Content", index: 1 });
  });

  test("resolveItems returns empty for missing manifest", () => {
    const ws: FileWorkspaceModel = {
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: true,
      resolveItems: (files) => {
        const mf = files.find((f) => f.path === "manifest.json");
        if (!mf) return [];
        return [];
      },
    };
    expect(ws.resolveItems!([])).toEqual([]);
  });
});

// ── ViewerActionDescriptor ────────────────────────────────────────────────

describe("ViewerActionDescriptor", () => {
  test("shape validation", () => {
    const action: ViewerActionDescriptor = {
      id: "navigate-to",
      label: "Go to Slide",
      category: "navigate",
      agentInvocable: true,
      params: {
        file: { type: "string", description: "Slide file path", required: true },
      },
      description: "Navigate to a specific slide",
    };

    expect(action.id).toBe("navigate-to");
    expect(action.category).toBe("navigate");
    expect(action.agentInvocable).toBe(true);
    expect(action.params?.file.type).toBe("string");
    expect(action.params?.file.required).toBe(true);
  });

  test("action with no params", () => {
    const action: ViewerActionDescriptor = {
      id: "ui:toggle-outline",
      label: "Toggle Outline",
      category: "ui",
      agentInvocable: true,
    };
    expect(action.params).toBeUndefined();
  });

  test("non-agent-invocable action", () => {
    const action: ViewerActionDescriptor = {
      id: "internal:refresh",
      label: "Refresh",
      category: "custom",
      agentInvocable: false,
    };
    expect(action.agentInvocable).toBe(false);
  });
});

// ── Backward compatibility ────────────────────────────────────────────────

describe("Backward compatibility", () => {
  test("ViewerContract without workspace/actions is valid", () => {
    const viewer = createMockViewer();
    expect(viewer.workspace).toBeUndefined();
    expect(viewer.actions).toBeUndefined();
    // Should still work
    expect(viewer.extractContext(null, [])).toBe("");
    expect(typeof viewer.PreviewComponent).toBe("function");
  });

  test("ViewerContract with workspace and actions", () => {
    const viewer = createMockViewer({
      workspace: {
        type: "all",
        multiFile: true,
        ordered: false,
        hasActiveFile: false,
      },
      actions: [
        { id: "test", label: "Test", category: "custom", agentInvocable: true },
      ],
    });
    expect(viewer.workspace?.type).toBe("all");
    expect(viewer.actions).toHaveLength(1);
  });

  test("ViewerPreviewProps with new optional fields", () => {
    const props: ViewerPreviewProps = {
      files: [],
      selection: null,
      onSelect: () => {},
      mode: "view",
      imageVersion: 0,
      // New optional fields
      workspaceItems: [{ path: "test.md", label: "Test" }],
      actionRequest: { requestId: "r1", actionId: "test" },
      onActionResult: () => {},
      onViewportChange: () => {},
    };
    expect(props.workspaceItems).toHaveLength(1);
    expect(props.actionRequest?.actionId).toBe("test");
    expect(typeof props.onViewportChange).toBe("function");
  });

  test("ViewerSelectionContext with viewport", () => {
    const sel: ViewerSelectionContext = {
      type: "heading",
      content: "Introduction",
      file: "README.md",
      viewport: { startLine: 10, endLine: 40, heading: "## Introduction" },
    };
    expect(sel.viewport?.startLine).toBe(10);
    expect(sel.viewport?.endLine).toBe(40);
    expect(sel.viewport?.heading).toBe("## Introduction");
  });

  test("ViewerContract with captureViewport", () => {
    const viewer = createMockViewer({
      captureViewport: async () => ({ data: "base64data", media_type: "image/png" }),
    });
    expect(typeof viewer.captureViewport).toBe("function");
  });
});
