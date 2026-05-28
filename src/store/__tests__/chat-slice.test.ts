import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import { createChatSlice, type ChatSlice } from "../chat-slice.js";

function makeStore() {
  return create<ChatSlice>()((...a) => ({
    ...(createChatSlice as unknown as (...args: typeof a) => ChatSlice)(...a),
  }));
}

describe("chat-slice addPendingNotification replaces semantics", () => {
  test("queues a notification with no replaces field", () => {
    const useStore = makeStore();
    useStore.getState().addPendingNotification({
      type: "compilation-error",
      message: "build broke",
      severity: "warning",
    });
    const pending = useStore.getState().pendingMessages;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe("notification");
  });

  test("info+replaces clears matching queued entries without enqueuing itself", () => {
    const useStore = makeStore();
    useStore.getState().addPendingNotification({
      type: "compilation-error",
      message: "build broke",
      severity: "warning",
    });
    expect(useStore.getState().pendingMessages).toHaveLength(1);

    useStore.getState().addPendingNotification({
      type: "compilation-recovered",
      message: "",
      severity: "info",
      replaces: ["compilation-error"],
    });

    // The clear-only signal should remove the prior compile-error and
    // NOT add itself to the queue — otherwise we just shift the stale
    // entry sideways into a new noisy "recovered" message.
    expect(useStore.getState().pendingMessages).toHaveLength(0);
  });

  test("warning+replaces removes matching entries and enqueues the new one", () => {
    const useStore = makeStore();
    useStore.getState().addPendingNotification({
      type: "compilation-error",
      message: "first error",
      severity: "warning",
    });
    useStore.getState().addPendingNotification({
      type: "compilation-error",
      message: "second error",
      severity: "warning",
      replaces: ["compilation-error"],
    });
    const pending = useStore.getState().pendingMessages;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe("notification");
    if (pending[0].kind === "notification") {
      expect(pending[0].notification.message).toBe("second error");
    }
  });

  test("replaces only touches notifications, leaves queued user messages alone", () => {
    const useStore = makeStore();
    useStore.getState().addPendingMessage({ text: "hello agent" });
    useStore.getState().addPendingNotification({
      type: "compilation-error",
      message: "build broke",
      severity: "warning",
    });
    useStore.getState().addPendingNotification({
      type: "compilation-recovered",
      message: "",
      severity: "info",
      replaces: ["compilation-error"],
    });
    const pending = useStore.getState().pendingMessages;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe("user");
  });
});
