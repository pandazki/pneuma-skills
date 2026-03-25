import { defineTile } from "gridboard";

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

const INITIAL_TODOS: TodoItem[] = [
  { id: "1", text: "Explore GridBoard tiles", done: true },
  { id: "2", text: "Customize the dashboard layout", done: false },
  { id: "3", text: "Add a chart tile for your data", done: false },
  { id: "4", text: "Share your dashboard", done: false },
];

export default defineTile({
  label: "Todo List",
  description: "Simple interactive checklist with local state",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 8 },
  // responsive breakpoints cover all sizes within min/max
  isOptimizedFor: () => true,

  render({ width, height }) {
    const [todos, setTodos] = React.useState<TodoItem[]>(INITIAL_TODOS);
    const [inputValue, setInputValue] = React.useState("");

    const isCompact = height < 200;
    const showInput = height >= 180;

    const doneCount = todos.filter((t) => t.done).length;

    function toggle(id: string) {
      setTodos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
      );
    }

    function addTodo() {
      const text = inputValue.trim();
      if (!text) return;
      setTodos((prev) => [
        ...prev,
        { id: String(Date.now()), text, done: false },
      ]);
      setInputValue("");
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === "Enter") addTodo();
    }

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-family)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isCompact ? "6px 10px" : "8px 12px",
            borderBottom: "1px solid var(--tile-border)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: isCompact ? "0.7rem" : "0.78rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "0.02em",
            }}
          >
            Tasks
          </span>
          <span
            style={{
              fontSize: "0.65rem",
              color: doneCount === todos.length && todos.length > 0 ? "var(--success)" : "var(--text-muted)",
              fontWeight: 500,
            }}
          >
            {doneCount}/{todos.length}
          </span>
        </div>

        {/* Todo list */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isCompact ? "4px 6px" : "6px 8px",
          }}
        >
          {todos.map((todo) => (
            <div
              key={todo.id}
              onClick={() => toggle(todo.id)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                padding: isCompact ? "3px 4px" : "5px 4px",
                borderRadius: "5px",
                cursor: "pointer",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--accent-dim)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              {/* Checkbox */}
              <div
                style={{
                  width: isCompact ? "12px" : "14px",
                  height: isCompact ? "12px" : "14px",
                  borderRadius: "3px",
                  border: todo.done ? "none" : "1.5px solid var(--tile-border-hover)",
                  background: todo.done ? "var(--accent)" : "transparent",
                  flexShrink: 0,
                  marginTop: "1px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.15s",
                }}
              >
                {todo.done && (
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="#09090b"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="1.5,5 4,7.5 8.5,2.5" />
                  </svg>
                )}
              </div>
              {/* Text */}
              <span
                style={{
                  fontSize: isCompact ? "0.68rem" : "0.78rem",
                  color: todo.done ? "var(--text-muted)" : "var(--text-primary)",
                  textDecoration: todo.done ? "line-through" : "none",
                  lineHeight: 1.4,
                  wordBreak: "break-word",
                  transition: "color 0.15s",
                }}
              >
                {todo.text}
              </span>
            </div>
          ))}
        </div>

        {/* Add input */}
        {showInput && (
          <div
            style={{
              display: "flex",
              gap: "6px",
              padding: "6px 8px",
              borderTop: "1px solid var(--tile-border)",
              flexShrink: 0,
            }}
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add task…"
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--tile-border)",
                borderRadius: "5px",
                padding: "3px 8px",
                fontSize: "0.72rem",
                color: "var(--text-primary)",
                outline: "none",
                fontFamily: "var(--font-family)",
              }}
            />
            <button
              onClick={addTodo}
              style={{
                background: "var(--accent)",
                border: "none",
                borderRadius: "5px",
                width: "24px",
                height: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
                color: "#09090b",
                fontSize: "1rem",
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              +
            </button>
          </div>
        )}
      </div>
    );
  },
});
