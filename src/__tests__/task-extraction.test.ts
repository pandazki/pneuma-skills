/**
 * Tests for task extraction logic from tool_use content blocks.
 *
 * Since extractTasksFromBlocks in ws.ts is tightly coupled to the Zustand store,
 * we replicate the pure extraction logic here for unit testing.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import type { TaskItem } from "../store.js";

// ── Replicated extraction logic (pure, no store dependency) ──────────────

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface TaskState {
  tasks: TaskItem[];
  taskCounter: number;
}

const seenIds = new Set<string>();

function extractTasks(state: TaskState, blocks: ToolUseBlock[]): TaskState {
  let { tasks, taskCounter } = state;

  for (const block of blocks) {
    if (seenIds.has(block.id)) continue;
    seenIds.add(block.id);

    const input = block.input;

    if (block.name === "TodoWrite") {
      const todos = input.todos as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(todos)) {
        tasks = todos.map((t, i) => ({
          id: String(i + 1),
          subject: (t.content as string) || (t.subject as string) || "Task",
          description: (t.description as string) || "",
          activeForm: (t.activeForm as string) || undefined,
          status: (t.status as "pending" | "in_progress" | "completed") || "pending",
          owner: (t.owner as string) || undefined,
          blockedBy: (t.blockedBy as string[]) || undefined,
        }));
        taskCounter = tasks.length;
      }
    } else if (block.name === "TaskCreate") {
      taskCounter++;
      tasks = [
        ...tasks,
        {
          id: String(taskCounter),
          subject: (input.subject as string) || "Task",
          description: (input.description as string) || "",
          activeForm: (input.activeForm as string) || undefined,
          status: "pending",
          owner: (input.owner as string) || undefined,
          blockedBy: (input.blockedBy as string[]) || undefined,
        },
      ];
    } else if (block.name === "TaskUpdate") {
      const taskId = input.taskId as string;
      if (!taskId) continue;
      const updates: Partial<TaskItem> = {};
      if (input.status) updates.status = input.status as TaskItem["status"];
      if (input.owner !== undefined) updates.owner = input.owner as string;
      if (input.activeForm !== undefined) updates.activeForm = input.activeForm as string;
      if (input.subject !== undefined) updates.subject = input.subject as string;
      if (input.description !== undefined) updates.description = input.description as string;
      if (input.addBlockedBy) updates.blockedBy = input.addBlockedBy as string[];
      tasks = tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
    }
  }

  return { tasks, taskCounter };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("task extraction", () => {
  beforeEach(() => {
    seenIds.clear();
  });

  const empty: TaskState = { tasks: [], taskCounter: 0 };

  // ── TodoWrite ──

  test("TodoWrite: replaces all tasks", () => {
    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tw-1",
        name: "TodoWrite",
        input: {
          todos: [
            { content: "Read store.ts", status: "completed" },
            { content: "Read ws.ts", status: "in_progress", activeForm: "Reading ws.ts" },
            { content: "Write tests", status: "pending" },
          ],
        },
      },
    ];

    const result = extractTasks(empty, blocks);
    expect(result.tasks).toHaveLength(3);
    expect(result.taskCounter).toBe(3);
    expect(result.tasks[0]).toMatchObject({ id: "1", subject: "Read store.ts", status: "completed" });
    expect(result.tasks[1]).toMatchObject({ id: "2", subject: "Read ws.ts", status: "in_progress", activeForm: "Reading ws.ts" });
    expect(result.tasks[2]).toMatchObject({ id: "3", subject: "Write tests", status: "pending" });
  });

  test("TodoWrite: uses 'subject' field as fallback", () => {
    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tw-2",
        name: "TodoWrite",
        input: {
          todos: [{ subject: "Fallback subject", status: "pending" }],
        },
      },
    ];

    const result = extractTasks(empty, blocks);
    expect(result.tasks[0].subject).toBe("Fallback subject");
  });

  test("TodoWrite: defaults to 'Task' when no content/subject", () => {
    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tw-3",
        name: "TodoWrite",
        input: { todos: [{ status: "pending" }] },
      },
    ];

    const result = extractTasks(empty, blocks);
    expect(result.tasks[0].subject).toBe("Task");
  });

  test("TodoWrite: replaces previous tasks entirely", () => {
    const initial: TaskState = {
      tasks: [
        { id: "1", subject: "Old task", description: "", status: "pending" },
      ],
      taskCounter: 1,
    };

    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tw-4",
        name: "TodoWrite",
        input: { todos: [{ content: "New task", status: "pending" }] },
      },
    ];

    const result = extractTasks(initial, blocks);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].subject).toBe("New task");
  });

  // ── TaskCreate ──

  test("TaskCreate: appends task with sequential ID", () => {
    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tc-1",
        name: "TaskCreate",
        input: { subject: "First task", description: "Do something" },
      },
      {
        type: "tool_use",
        id: "tc-2",
        name: "TaskCreate",
        input: { subject: "Second task", description: "Do more", activeForm: "Creating second task" },
      },
    ];

    const result = extractTasks(empty, blocks);
    expect(result.tasks).toHaveLength(2);
    expect(result.taskCounter).toBe(2);
    expect(result.tasks[0]).toMatchObject({ id: "1", subject: "First task", status: "pending" });
    expect(result.tasks[1]).toMatchObject({ id: "2", subject: "Second task", activeForm: "Creating second task" });
  });

  test("TaskCreate: continues counter after TodoWrite", () => {
    const afterTodoWrite: TaskState = { tasks: [{ id: "1", subject: "Existing", description: "", status: "pending" }], taskCounter: 1 };

    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tc-3",
        name: "TaskCreate",
        input: { subject: "New task" },
      },
    ];

    const result = extractTasks(afterTodoWrite, blocks);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[1].id).toBe("2");
  });

  // ── TaskUpdate ──

  test("TaskUpdate: updates status", () => {
    const initial: TaskState = {
      tasks: [{ id: "1", subject: "My task", description: "", status: "pending" }],
      taskCounter: 1,
    };

    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tu-1",
        name: "TaskUpdate",
        input: { taskId: "1", status: "in_progress", activeForm: "Working on task" },
      },
    ];

    const result = extractTasks(initial, blocks);
    expect(result.tasks[0]).toMatchObject({ status: "in_progress", activeForm: "Working on task" });
  });

  test("TaskUpdate: updates to completed", () => {
    const initial: TaskState = {
      tasks: [{ id: "1", subject: "My task", description: "", status: "in_progress" }],
      taskCounter: 1,
    };

    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tu-2",
        name: "TaskUpdate",
        input: { taskId: "1", status: "completed" },
      },
    ];

    const result = extractTasks(initial, blocks);
    expect(result.tasks[0].status).toBe("completed");
  });

  test("TaskUpdate: sets blockedBy from addBlockedBy", () => {
    const initial: TaskState = {
      tasks: [{ id: "2", subject: "Blocked task", description: "", status: "pending" }],
      taskCounter: 2,
    };

    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tu-3",
        name: "TaskUpdate",
        input: { taskId: "2", addBlockedBy: ["1"] },
      },
    ];

    const result = extractTasks(initial, blocks);
    expect(result.tasks[0].blockedBy).toEqual(["1"]);
  });

  test("TaskUpdate: skips if taskId missing", () => {
    const initial: TaskState = {
      tasks: [{ id: "1", subject: "My task", description: "", status: "pending" }],
      taskCounter: 1,
    };

    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "tu-4",
        name: "TaskUpdate",
        input: { status: "completed" }, // no taskId
      },
    ];

    const result = extractTasks(initial, blocks);
    expect(result.tasks[0].status).toBe("pending"); // unchanged
  });

  // ── Deduplication ──

  test("deduplicates by block.id within same turn", () => {
    const blocks: ToolUseBlock[] = [
      {
        type: "tool_use",
        id: "dup-1",
        name: "TaskCreate",
        input: { subject: "Duplicated" },
      },
    ];

    const first = extractTasks(empty, blocks);
    // Same block ID again
    const second = extractTasks(first, blocks);
    expect(second.tasks).toHaveLength(1); // not 2
  });

  // ── Mixed scenario ──

  test("full lifecycle: create → update → complete", () => {
    // Step 1: Create tasks
    const createBlocks: ToolUseBlock[] = [
      { type: "tool_use", id: "lc-1", name: "TaskCreate", input: { subject: "Read code", description: "Read all files", activeForm: "Reading code" } },
      { type: "tool_use", id: "lc-2", name: "TaskCreate", input: { subject: "Write tests", description: "Unit tests" } },
      { type: "tool_use", id: "lc-3", name: "TaskCreate", input: { subject: "Refactor", description: "Clean up" } },
    ];

    let state = extractTasks(empty, createBlocks);
    expect(state.tasks).toHaveLength(3);
    expect(state.tasks.map((t) => t.status)).toEqual(["pending", "pending", "pending"]);

    // Step 2: Start first task
    const startBlocks: ToolUseBlock[] = [
      { type: "tool_use", id: "lc-4", name: "TaskUpdate", input: { taskId: "1", status: "in_progress", activeForm: "Reading code" } },
    ];
    state = extractTasks(state, startBlocks);
    expect(state.tasks[0].status).toBe("in_progress");

    // Step 3: Complete first, start second
    const progressBlocks: ToolUseBlock[] = [
      { type: "tool_use", id: "lc-5", name: "TaskUpdate", input: { taskId: "1", status: "completed" } },
      { type: "tool_use", id: "lc-6", name: "TaskUpdate", input: { taskId: "2", status: "in_progress", activeForm: "Writing tests" } },
    ];
    state = extractTasks(state, progressBlocks);
    expect(state.tasks[0].status).toBe("completed");
    expect(state.tasks[1].status).toBe("in_progress");
    expect(state.tasks[1].activeForm).toBe("Writing tests");
    expect(state.tasks[2].status).toBe("pending");
  });

  // ── Non-task tools are ignored ──

  test("ignores non-task tool_use blocks", () => {
    const blocks: ToolUseBlock[] = [
      { type: "tool_use", id: "other-1", name: "Read", input: { file_path: "/foo.ts" } },
      { type: "tool_use", id: "other-2", name: "Bash", input: { command: "ls" } },
      { type: "tool_use", id: "other-3", name: "Task", input: { prompt: "do stuff" } },
    ];

    const result = extractTasks(empty, blocks);
    expect(result.tasks).toHaveLength(0);
  });
});
