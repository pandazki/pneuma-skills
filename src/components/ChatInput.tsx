import { useState, useRef, useCallback, useEffect, useMemo, type KeyboardEvent, type ClipboardEvent, type DragEvent } from "react";
import { useStore } from "../store.js";
import { sendUserMessage, sendInterrupt } from "../ws.js";
import ModelSwitcher from "./ModelSwitcher.js";
import SlashMenu, { type SlashMenuItem } from "./SlashMenu.js";

const EMPTY_STRINGS: string[] = [];

interface ImageAttachment {
  id: string;
  media_type: string;
  data: string; // base64
  preview: string; // data URL for thumbnail
}

/** Format selection info for display in the chip */
function formatSelectionLabel(sel: { type: string; content: string; level?: number; file: string }): string {
  const typeLabels: Record<string, string> = {
    heading: `h${sel.level || 1}`,
    paragraph: "paragraph",
    list: "list",
    code: "code block",
    blockquote: "blockquote",
    image: "image",
    table: "table",
    "text-range": "text",
  };
  const type = typeLabels[sel.type] || sel.type;
  const preview = sel.content.length > 60 ? sel.content.slice(0, 57) + "..." : sel.content;
  return `${type}: "${preview}"`;
}

let attachmentCounter = 0;

function fileToAttachment(file: File): Promise<ImageAttachment | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      resolve({
        id: `img-${Date.now()}-${++attachmentCounter}`,
        media_type: file.type,
        data: base64,
        preview: dataUrl,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export default function ChatInput() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sessionStatus = useStore((s) => s.sessionStatus);
  const cliConnected = useStore((s) => s.cliConnected);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const slashCommands = useStore((s) => s.session?.slash_commands ?? EMPTY_STRINGS);
  const skills = useStore((s) => s.session?.skills ?? EMPTY_STRINGS);

  const isRunning = sessionStatus === "running";

  // Build slash menu items
  const allSlashItems: SlashMenuItem[] = [
    ...skills.map((s) => ({ name: s, kind: "skill" as const })),
    ...slashCommands.map((c) => ({ name: c, kind: "command" as const })),
  ];
  const filteredSlashItems = slashFilter
    ? allSlashItems.filter((item) => item.name.toLowerCase().includes(slashFilter.toLowerCase()))
    : allSlashItems;

  // Reset slash index when filter changes
  useEffect(() => {
    setSlashIndex(0);
  }, [slashFilter]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;
    const imgPayload = images.length > 0
      ? images.map((img) => ({ media_type: img.media_type, data: img.data }))
      : undefined;
    sendUserMessage(trimmed, selection, imgPayload);
    setText("");
    setImages([]);
    setSelection(null);
    setSlashOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, images, selection, setSelection]);

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

  // Image handling
  const addImages = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const attachments = await Promise.all(fileArray.map(fileToAttachment));
    const valid = attachments.filter((a): a is ImageAttachment => a !== null);
    if (valid.length > 0) {
      setImages((prev) => [...prev, ...valid]);
    }
  }, []);

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
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
      addImages(imageFiles);
    }
  }, [addImages]);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files?.length) addImages(files);
  }, [addImages]);

  const handleFilePickerClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      addImages(e.target.files);
      e.target.value = ""; // reset so same file can be re-selected
    }
  };

  return (
    <div className="p-3 border-t border-neutral-800">
      {/* Selection chip */}
      {selection && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cc-primary/15 text-cc-primary text-xs max-w-full overflow-hidden">
            <PinIcon />
            <span className="truncate">{formatSelectionLabel(selection)}</span>
            <span className="shrink-0 text-cc-muted mx-0.5">in {selection.file}</span>
            <button
              onClick={() => setSelection(null)}
              className="shrink-0 ml-0.5 hover:text-cc-fg transition-colors cursor-pointer"
              title="Clear selection"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      {/* Image thumbnails */}
      {images.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-1 overflow-x-auto">
          {images.map((img) => (
            <div key={img.id} className="relative shrink-0 group">
              <img
                src={img.preview}
                alt=""
                className="w-14 h-14 rounded-md object-cover border border-neutral-700"
              />
              <button
                onClick={() => removeImage(img.id)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-neutral-700 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
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
              : isRunning
                ? "Claude is working..."
                : selection
                  ? "Tell Claude what to change..."
                  : "Send a message... (paste images, type / for commands)"
          }
          disabled={!cliConnected}
          rows={1}
          className="w-full bg-neutral-800 text-neutral-100 rounded-lg px-3 py-2 text-sm resize-none placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-50"
        />
      </div>

      {/* Action bar: model switcher + file picker | send/stop */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          <ModelSwitcher />
          <button
            onClick={handleFilePickerClick}
            className="flex items-center gap-1 px-2 py-1 text-xs text-neutral-500 hover:text-neutral-300 bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
            title="Attach image"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
            </svg>
            <span>Image</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        <div>
          {isRunning ? (
            <button
              onClick={sendInterrupt}
              className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs rounded-lg transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={(!text.trim() && images.length === 0) || !cliConnected}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
