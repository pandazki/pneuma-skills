/**
 * {{displayName}} Preview — minimal markdown viewer.
 *
 * Renders the first workspace file as markdown.
 * Extend this component to build your mode's custom preview.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";

export default function Preview({ files }: ViewerPreviewProps) {
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
