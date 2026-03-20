// src/replay-engine.ts
import { useStore } from "./store/index";
import { getApiBase } from "./utils/api";
import type { ChatMessage } from "./types";

let playbackTimer: ReturnType<typeof setTimeout> | null = null;

/** Navigate viewer to the file being edited in a tool_use message */
function navigateToEditedFile(msg: any) {
  const content = msg.message?.content || msg.content || [];
  const toolUseBlocks = content.filter((b: any) => b.type === "tool_use");
  for (const tool of toolUseBlocks) {
    const rawPath = tool.input?.file_path || tool.input?.path;
    if (rawPath && typeof rawPath === "string") {
      const s = useStore.getState();
      // Match content set — handle both relative and absolute paths
      const matchingCs = s.contentSets.find((cs: any) =>
        rawPath.startsWith(cs.prefix + "/") || rawPath.includes("/" + cs.prefix + "/")
      );
      if (matchingCs && s.activeContentSet !== matchingCs.prefix) {
        s.setActiveContentSet(matchingCs.prefix);
      }
      // Extract relative file path within content set
      let itemPath = rawPath;
      if (matchingCs) {
        const csIdx = rawPath.indexOf(matchingCs.prefix + "/");
        if (csIdx >= 0) {
          itemPath = rawPath.slice(csIdx + matchingCs.prefix.length + 1);
        }
      }
      const matchingItem = s.workspaceItems.find((item: any) =>
        item.path === itemPath || rawPath.endsWith("/" + item.path)
      );
      if (matchingItem) {
        s.setActiveFile(matchingItem.path);
      }
      break;
    }
  }
}

export function startPlayback() {
  const store = useStore.getState();
  if (!store.replayMode || store.isPlaying) return;
  store.setIsPlaying(true);
  scheduleNext();
}

export function stopPlayback() {
  if (playbackTimer) {
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
  useStore.getState().setIsPlaying(false);
}

async function scheduleNext() {
  const store = useStore.getState();
  if (!store.isPlaying || !store.replayMode) return;

  const { replayMessages, currentSeq, playbackSpeed } = store;
  if (currentSeq >= replayMessages.length) {
    // End of replay — ensure last checkpoint is loaded
    const checkpoints = store.replayCheckpoints as any[];
    if (checkpoints.length > 0) {
      const lastCp = checkpoints[checkpoints.length - 1];
      await checkoutCheckpoint(lastCp.hash);
      store.setActiveCheckpoint(lastCp.hash);
    }
    stopPlayback();
    return;
  }

  const msg = replayMessages[currentSeq];
  displayMessage(msg);

  // Switch checkpoint when an assistant message contains Edit/Write tool_use
  // This makes files change as the agent describes its edits, not after
  const checkpoints = store.replayCheckpoints as any[];
  let checkpointSwitched = false;
  if (checkpoints.length > 0 && msg.type === "assistant") {
    const hasFileEdit = (msg as any).message?.content?.some((b: any) =>
      b.type === "tool_use" && (b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit")
    );
    if (hasFileEdit) {
      // Count how many file-editing assistant messages we've seen
      let editCount = 0;
      for (let i = 0; i <= currentSeq; i++) {
        const m = replayMessages[i] as any;
        if (m.type === "assistant" && m.message?.content?.some((b: any) =>
          b.type === "tool_use" && (b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit")
        )) {
          editCount++;
        }
      }
      const cpIdx = Math.min(editCount - 1, checkpoints.length - 1);
      if (cpIdx >= 0) {
        const targetCp = checkpoints[cpIdx];
        if (targetCp && store.activeCheckpointHash !== targetCp.hash) {
          await checkoutCheckpoint(targetCp.hash);
          store.setActiveCheckpoint(targetCp.hash);
          checkpointSwitched = true;
        }
      }
    }
  }

  // Auto-navigate to edited file AFTER checkpoint loads (content sets need to be current)
  if (checkpointSwitched && msg.type === "assistant") {
    navigateToEditedFile(msg);
  }

  store.setCurrentSeq(currentSeq + 1);

  // Fixed-rhythm delay — skip real time gaps (user thinking time is irrelevant)
  const baseDelay = msg.type === "user_message" ? 400
    : msg.type === "assistant" ? 600
    : 150; // system events, results — quick
  const delay = baseDelay / playbackSpeed;

  playbackTimer = setTimeout(scheduleNext, delay);
}

/** Strip internal XML blocks injected by the system (viewer-context, user-actions, etc.) */
function stripInternalTags(content: string): string {
  return content
    .replace(/<viewer-context[\s\S]*?<\/viewer-context>\s*/g, "")
    .replace(/<user-actions[\s\S]*?<\/user-actions>\s*/g, "")
    .replace(/<system-reminder[\s\S]*?<\/system-reminder>\s*/g, "")
    .replace(/<context[\s\S]*?<\/context>\s*/g, "")
    .trim();
}

function displayMessage(raw: any) {
  const store = useStore.getState();

  if (raw.type === "user_message") {
    const cleanContent = stripInternalTags(raw.content || "");
    if (!cleanContent) return; // Skip empty messages (context-only)
    const chatMsg: ChatMessage = {
      id: raw.id || `replay-user-${Date.now()}-${Math.random()}`,
      role: "user",
      content: cleanContent,
      timestamp: raw.timestamp || Date.now(),
    };
    store.appendMessage(chatMsg);
  } else if (raw.type === "assistant") {
    const msg = raw.message;
    if (!msg) return;
    const textBlocks = (msg.content || []).filter((b: any) => b.type === "text");
    const text = textBlocks.map((b: any) => b.text || "").join("\n");
    if (!text && !(msg.content || []).some((b: any) => b.type === "tool_use")) return; // Skip empty
    const chatMsg: ChatMessage = {
      id: msg.id || `replay-assistant-${Date.now()}-${Math.random()}`,
      role: "assistant",
      content: text,
      contentBlocks: msg.content,
      timestamp: raw.timestamp || Date.now(),
      parentToolUseId: raw.parent_tool_use_id || null,
      model: msg.model,
      stopReason: msg.stop_reason,
    };
    store.appendMessage(chatMsg);

    // Note: auto-navigation to edited files is done in scheduleNext() AFTER checkpoint loads,
    // so content sets are up-to-date when we try to match paths.
  } else if (raw.type === "content_update" && raw.files) {
    // File updates — push to viewer
    store.updateFiles(raw.files);
  }
  // Skip: result, stream_event, system_event, command_output, etc.
}

async function checkoutCheckpoint(hash: string) {
  try {
    const resp = await fetch(`${getApiBase()}/api/replay/checkout/${hash}`, {
      method: "POST",
    });
    const data = await resp.json();
    if (data.files) {
      const store = useStore.getState();
      // Use setFiles (replace all) not updateFiles (merge) — checkpoint is a complete state
      store.setFiles(data.files);

      // Auto-select first content set and first file so viewer shows content
      setTimeout(() => {
        const s = useStore.getState();
        if (s.contentSets.length > 0 && !s.activeContentSet) {
          s.setActiveContentSet(s.contentSets[0].prefix);
        }
        if (s.workspaceItems.length > 0 && !s.activeFile) {
          s.setActiveFile(s.workspaceItems[0].path);
        }
      }, 50);
    }
  } catch (err) {
    console.warn("[replay] checkpoint checkout failed:", err);
  }
}

/** Seek to a specific position — displays all messages up to that point instantly */
export function seekTo(targetSeq: number) {
  const store = useStore.getState();
  const wasPlaying = store.isPlaying;
  if (wasPlaying) stopPlayback();

  // Clear existing messages
  store.setMessages([]);

  // Display all messages up to targetSeq instantly
  for (let i = 0; i < targetSeq && i < store.replayMessages.length; i++) {
    displayMessage(store.replayMessages[i]);
  }

  store.setCurrentSeq(targetSeq);

  // Find the right checkpoint by counting file-editing messages up to targetSeq
  const checkpoints = store.replayCheckpoints as any[];
  if (checkpoints.length > 0) {
    let editCount = 0;
    for (let i = 0; i < targetSeq && i < store.replayMessages.length; i++) {
      const m = store.replayMessages[i] as any;
      if (m.type === "assistant" && m.message?.content?.some((b: any) =>
        b.type === "tool_use" && (b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit")
      )) {
        editCount++;
      }
    }
    const cpIdx = Math.max(0, Math.min(editCount - 1, checkpoints.length - 1));
    const bestCp = editCount === 0 ? checkpoints[0] : checkpoints[cpIdx];
    checkoutCheckpoint(bestCp.hash);
    store.setActiveCheckpoint(bestCp.hash);
  }
}

/** Load a replay package from the server (tar.gz path or extracted directory) */
export async function loadReplay(packagePath: string) {
  const base = getApiBase();

  // Load the package
  const loadResp = await fetch(`${base}/api/replay/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: packagePath }),
  });
  const loadData = await loadResp.json();
  if (loadData.error) throw new Error(loadData.error);

  // Get all messages
  const msgsResp = await fetch(`${base}/api/replay/messages`);
  const msgsData = await msgsResp.json();

  const { manifest } = loadData;

  // Sort checkpoints by timestamp to ensure chronological order
  const sortedCheckpoints = [...manifest.checkpoints].sort(
    (a: any, b: any) => a.timestamp - b.timestamp
  );

  // Enter replay mode
  useStore.getState().enterReplayMode({
    messages: msgsData.messages,
    checkpoints: sortedCheckpoints,
    metadata: {
      title: manifest.metadata.title,
      mode: manifest.metadata.mode,
      totalTurns: manifest.metadata.totalTurns,
      duration: manifest.metadata.duration,
    },
    summary: manifest.summary,
  });

  // Load the first checkpoint (earliest state) and start playing
  if (sortedCheckpoints.length > 0) {
    await checkoutCheckpoint(sortedCheckpoints[0].hash);
    useStore.getState().setActiveCheckpoint(sortedCheckpoints[0].hash);
  }

  // Auto-play — start from the beginning
  startPlayback();
}
