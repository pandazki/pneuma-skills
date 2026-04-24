/**
 * {{displayName}} Preview — minimal markdown viewer.
 *
 * Renders the first workspace file as markdown.
 * Extend this component to build your mode's custom preview.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ViewerPreviewProps, ViewerFileContent } from "../../../core/types/viewer-contract.js";
import type { Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";

export default function Preview({ sources }: ViewerPreviewProps) {
  // Files arrive via the default `files` source. Subscribe through the
  // runtime's `useSource` hook so the view re-renders on workspace changes.
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value } = useSource(filesSource);
  const files = value ?? [];
  const file = files[0];

  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        <p>No files in workspace. Create a file to get started.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto prose prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {file.content}
      </ReactMarkdown>
    </div>
  );
}
