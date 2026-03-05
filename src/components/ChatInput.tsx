import { useState, useRef, useCallback, useEffect, useMemo, type KeyboardEvent, type ClipboardEvent, type DragEvent } from "react";
import { useStore } from "../store.js";
import { sendUserMessage, sendInterrupt } from "../ws.js";
import ModelSwitcher from "./ModelSwitcher.js";
import SlashMenu, { type SlashMenuItem } from "./SlashMenu.js";

const EMPTY_STRINGS: string[] = [];

interface FileAttachment {
  id: string;
  kind: "image" | "file";
  name: string;
  media_type: string;
  data: string;          // base64
  size: number;
  preview: string | null; // data URL (image) or null (file)
}

/** Format selection info for display in the chip */
function formatSelectionLabel(sel: { type: string; content: string; level?: number; file: string; tag?: string; classes?: string; selector?: string }): string {
  if (sel.selector) {
    const preview = sel.content.length > 40 ? sel.content.slice(0, 37) + "..." : sel.content;
    return preview ? `${sel.selector}  "${preview}"` : sel.selector;
  }
  const typeLabels: Record<string, string> = {
    heading: `h${sel.level || 1}`,
    paragraph: "paragraph",
    list: "list",
    code: "code block",
    blockquote: "blockquote",
    image: "image",
    table: "table",
    "text-range": "text",
    section: "section",
    link: "link",
    container: "container",
    interactive: "interactive",
  };
  const type = typeLabels[sel.type] || sel.type;
  const preview = sel.content.length > 60 ? sel.content.slice(0, 57) + "..." : sel.content;
  return `${type}: "${preview}"`;
}

let attachmentCounter = 0;

function fileToAttachment(file: File): Promise<FileAttachment | null> {
  return new Promise((resolve) => {
    const isImage = file.type.startsWith("image/");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      resolve({
        id: `att-${Date.now()}-${++attachmentCounter}`,
        kind: isImage ? "image" : "file",
        name: file.name,
        media_type: file.type || "application/octet-stream",
        data: base64,
        size: file.size,
        preview: isImage ? dataUrl : null,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export default function ChatInput() {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cliConnected = useStore((s) => s.cliConnected);
  const turnInProgress = useStore((s) => s.turnInProgress);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const annotations = useStore((s) => s.annotations);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const updateAnnotationComment = useStore((s) => s.updateAnnotationComment);
  const clearAnnotations = useStore((s) => s.clearAnnotations);
  const previewMode = useStore((s) => s.previewMode);
  const slashCommands = useStore((s) => s.session?.slash_commands ?? EMPTY_STRINGS);
  const skills = useStore((s) => s.session?.skills ?? EMPTY_STRINGS);

  const isBusy = turnInProgress;

  // Build slash menu items — slash_commands is the superset, skills is a subset.
  // Use slash_commands as the source, mark skills accordingly to avoid duplicates.
  const allSlashItems: SlashMenuItem[] = useMemo(() => {
    const skillSet = new Set(skills);
    return slashCommands.map((name) => ({
      name,
      kind: skillSet.has(name) ? "skill" as const : "command" as const,
    }));
  }, [slashCommands, skills]);
  const filteredSlashItems = useMemo(() => {
    if (!slashFilter) return allSlashItems;
    const lower = slashFilter.toLowerCase();
    const matches = allSlashItems.filter((item) => item.name.toLowerCase().includes(lower));
    // Sort: exact matches first, then prefix matches, then substring matches
    matches.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aExact = aName === lower;
      const bExact = bName === lower;
      if (aExact !== bExact) return aExact ? -1 : 1;
      const aPrefix = aName.startsWith(lower);
      const bPrefix = bName.startsWith(lower);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      return 0;
    });
    return matches;
  }, [allSlashItems, slashFilter]);

  // Reset slash index when filter changes
  useEffect(() => {
    setSlashIndex(0);
  }, [slashFilter]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    const hasAnnotations = annotations.length > 0;
    if (!trimmed && attachments.length === 0 && !hasAnnotations) return;
    const imageAtts = attachments.filter((a) => a.kind === "image");
    const fileAtts = attachments.filter((a) => a.kind === "file");
    const imgPayload = imageAtts.length > 0
      ? imageAtts.map((img) => ({ media_type: img.media_type, data: img.data }))
      : undefined;
    const filePayload = fileAtts.length > 0
      ? fileAtts.map((f) => ({ name: f.name, media_type: f.media_type, data: f.data, size: f.size }))
      : undefined;
    sendUserMessage(trimmed, selection, imgPayload, hasAnnotations ? annotations : undefined, filePayload);
    setText("");
    setAttachments([]);
    setSelection(null);
    clearAnnotations();
    setSlashOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    // Immediately show busy state — disable input + show Stop button
    useStore.getState().setTurnInProgress(true);
  }, [text, attachments, selection, setSelection, annotations, clearAnnotations]);

  const handleKeyDown = (e: KeyboardEvent) => {
    // Slash menu navigation
    if (slashOpen && filteredSlashItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % filteredSlashItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + filteredSlashItems.length) % filteredSlashItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectSlashItem(filteredSlashItems[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const selectSlashItem = (item: SlashMenuItem) => {
    // Replace from the `/` to cursor with `/<command> `
    const slashStart = text.lastIndexOf("/");
    const before = slashStart > 0 ? text.slice(0, slashStart) : "";
    setText(`${before}/${item.name} `);
    setSlashOpen(false);
    textareaRef.current?.focus();
  };

  const handleTextChange = (value: string) => {
    setText(value);

    // Check if we should open/close slash menu
    // Only trigger at start of input or after whitespace
    const lastSlash = value.lastIndexOf("/");
    if (lastSlash >= 0 && (lastSlash === 0 || value[lastSlash - 1] === " " || value[lastSlash - 1] === "\n")) {
      const afterSlash = value.slice(lastSlash + 1);
      // Close if there's a space after the command (already completed)
      if (afterSlash.includes(" ") || afterSlash.includes("\n")) {
        setSlashOpen(false);
      } else {
        setSlashOpen(true);
        setSlashFilter(afterSlash);
      }
    } else {
      setSlashOpen(false);
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  // File handling
  const addAttachments = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const results = await Promise.all(fileArray.map(fileToAttachment));
    const valid = results.filter((a): a is FileAttachment => a !== null);
    if (valid.length > 0) {
      setAttachments((prev) => [...prev, ...valid]);
    }
  }, []);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addAttachments(imageFiles);
    }
  }, [addAttachments]);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files?.length) addAttachments(files);
  }, [addAttachments]);

  const handleFilePickerClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      addAttachments(e.target.files);
      e.target.value = ""; // reset so same file can be re-selected
    }
  };

  const hasAnnotations = annotations.length > 0;

  return (
    <div className="p-3 bg-cc-surface/70 backdrop-blur-2xl border border-cc-primary/20 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] ring-1 ring-white/5">
      {/* Annotations list (annotate mode) */}
      {hasAnnotations && (
        <div className="mb-2 rounded-lg border border-cc-border bg-cc-card/50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-cc-border/50">
            <span className="text-xs font-medium text-cc-fg">
              Annotations ({annotations.length})
            </span>
            <button
              onClick={clearAnnotations}
              className="text-[11px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
            >
              Clear all
            </button>
          </div>
          <div className="max-h-[200px] overflow-y-auto divide-y divide-cc-border/30">
            {annotations.map((ann, i) => (
              <div key={ann.id} className="px-3 py-2 group">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-cc-primary/15 text-cc-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-cc-fg truncate font-medium">
                        {ann.element.label || ann.element.selector || `${ann.element.type}: "${ann.element.content.slice(0, 30)}"`}
                      </span>
                      <span className="shrink-0 text-cc-muted text-[10px]">{ann.slideFile}</span>
                    </div>
                    <input
                      type="text"
                      value={ann.comment}
                      onChange={(e) => updateAnnotationComment(ann.id, e.target.value)}
                      placeholder="Add comment..."
                      className="mt-1 w-full bg-cc-bg/60 text-cc-fg text-xs rounded px-2 py-1 border border-cc-border/40 placeholder-cc-muted/50 focus:outline-none focus:border-cc-primary/50"
                    />
                  </div>
                  <button
                    onClick={() => removeAnnotation(ann.id)}
                    className="shrink-0 text-cc-muted hover:text-cc-fg transition-colors cursor-pointer opacity-0 group-hover:opacity-100 mt-0.5"
                    title="Remove annotation"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selection chip (select mode — only when no annotations) */}
      {!hasAnnotations && selection && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="rounded-md bg-cc-primary/15 text-cc-primary text-xs max-w-full overflow-hidden">
            {selection.thumbnail && (
              <img src={selection.thumbnail} alt="" className="mx-2 mt-2 max-h-16 max-w-[calc(100%-1rem)] rounded border border-cc-border/30 bg-white" />
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5">
              <PinIcon />
              <span className="truncate">{formatSelectionLabel(selection)}</span>
              <span className="shrink-0 text-cc-muted text-[11px]">{selection.file}</span>
              <button
                onClick={() => setSelection(null)}
                className="shrink-0 ml-0.5 hover:text-cc-fg transition-colors cursor-pointer"
                title="Clear selection"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attachment thumbnails */}
      {attachments.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-1 overflow-x-auto">
          {attachments.map((att) => (
            <div key={att.id} className="relative shrink-0 group">
              {att.kind === "image" ? (
                <img
                  src={att.preview!}
                  alt=""
                  className="w-14 h-14 rounded-md object-cover border border-cc-border"
                />
              ) : (
                <div className="w-14 h-14 rounded-md border border-cc-border bg-cc-card flex flex-col items-center justify-center gap-0.5 px-1">
                  <FileIcon />
                  <span className="text-[8px] text-cc-muted truncate w-full text-center">{att.name}</span>
                </div>
              )}
              <button
                onClick={() => removeAttachment(att.id)}
                className="absolute top-0.5 right-0.5 w-4 h-4 bg-cc-card/80 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Textarea with slash menu */}
      <div
        className="relative"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {slashOpen && filteredSlashItems.length > 0 && (
          <SlashMenu
            items={filteredSlashItems}
            selectedIndex={slashIndex}
            onSelect={selectSlashItem}
          />
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          placeholder={
            !cliConnected
              ? "Waiting for CLI connection..."
              : isBusy
                ? "Claude is working..."
                : hasAnnotations
                  ? "Add notes (optional)..."
                  : selection
                    ? "Tell Claude what to change..."
                    : previewMode === "annotate"
                      ? "Click elements to annotate, then send..."
                      : "Send a message... (drop files, paste images, type / for commands)"
          }
          disabled={!cliConnected || isBusy}
          rows={1}
          className="w-full bg-cc-surface/80 backdrop-blur-xl text-cc-fg rounded-2xl px-4 py-3 text-sm resize-none placeholder-cc-muted/50 border border-cc-border/50 shadow-inner focus:outline-none focus:border-cc-primary/60 focus:ring-1 focus:ring-cc-primary/30 disabled:opacity-50 transition-all"
        />
      </div>

      {/* Action bar: model switcher + file picker | send/stop */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          <ModelSwitcher />
          <button
            onClick={handleFilePickerClick}
            className="flex items-center gap-1 px-2 py-1 text-xs text-cc-muted hover:text-cc-fg bg-cc-card hover:bg-cc-hover rounded transition-colors"
            title="Attach file"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
            </svg>
            <span>File</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        <div>
          {isBusy ? (
            <button
              onClick={sendInterrupt}
              className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white font-medium text-xs rounded-full transition-all shadow-[0_0_12px_rgba(220,38,38,0.4)]"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={(!text.trim() && attachments.length === 0 && !hasAnnotations) || !cliConnected}
              className="px-5 py-2 bg-cc-primary hover:bg-cc-primary-hover text-cc-bg font-medium text-xs rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(249,115,22,0.4)] disabled:shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
      <path d="M9.828 1.282a.75.75 0 011.06 0l3.83 3.83a.75.75 0 010 1.06l-3.17 3.17a.75.75 0 01-.254.166l-1.97.738.738-1.97a.75.75 0 01.166-.254l3.17-3.17-2.77-2.77-3.17 3.17a.75.75 0 01-.254.166l-1.97.738.738-1.97a.75.75 0 01.166-.254l3.17-3.17a.75.75 0 010-1.06zM1.5 14.5l4-4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-4 h-4 text-cc-muted">
      <path d="M4 1.5h5l3 3v10H4z" strokeLinejoin="round" />
      <path d="M9 1.5v3h3" strokeLinejoin="round" />
    </svg>
  );
}
