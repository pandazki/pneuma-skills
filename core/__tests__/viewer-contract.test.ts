/**
 * ViewerContract 契约测试
 *
 * 验证 ViewerContract 接口约束：
 * - PreviewComponent 是有效的 React 组件类型
 * - extractContext 返回格式正确的上下文字符串
 * - updateStrategy 是合法枚举值
 */

import { describe, test, expect } from "bun:test";
import type {
  ViewerContract,
  ViewerPreviewProps,
  ViewerSelectionContext,
  ViewerFileContent,
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
