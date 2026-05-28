/**
 * ViewerErrorBoundary — contains crashes inside a mode's PreviewComponent
 * so a broken external mode does not bring down the rest of the session
 * (chat panel, top bar, gallery).
 *
 * Most failures observed here are external modes authored against the
 * pre-2.29 `ViewerPreviewProps` (which had a `files: ViewerFileContent[]`
 * field, since replaced by `sources` + `fileChannel`). The fallback
 * surfaces the actual error message and points at the migration so the
 * user can either update the mode or pick a different one.
 */

import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  modeName?: string;
}

interface State {
  error: Error | null;
}

export class ViewerErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[viewer-error-boundary] Mode "${this.props.modeName ?? "?"}" crashed:\n`,
      error,
      info.componentStack,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || String(this.state.error);
    const suspectOldContract = /reading 'find'|files\.find|undefined.*find/i.test(message);

    return (
      <div className="h-full w-full flex items-center justify-center p-8 text-cc-fg">
        <div className="max-w-[42rem] text-sm space-y-4">
          <div className="text-[11px] tracking-[0.18em] uppercase font-medium text-cc-error/80">
            Viewer crashed
          </div>
          <h2 className="font-logo text-2xl text-cc-fg leading-tight">
            {this.props.modeName
              ? `"${this.props.modeName}" viewer threw an error.`
              : "The viewer threw an error."}
          </h2>
          <pre className="font-mono text-[12px] text-cc-muted bg-cc-surface/40 border border-cc-border/40 rounded-md p-3 whitespace-pre-wrap break-words">
            {message}
          </pre>
          {suspectOldContract && (
            <p className="text-cc-muted leading-relaxed">
              This looks like a mode authored against the pre-2.29
              ViewerPreviewProps contract — <code className="text-cc-fg">props.files</code>{" "}
              was replaced by <code className="text-cc-fg">sources</code> +{" "}
              <code className="text-cc-fg">fileChannel</code>. Update the mode's
              manifest to declare a <code className="text-cc-fg">sources</code> field
              and read content via <code className="text-cc-fg">useSource</code>.
            </p>
          )}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={this.reset}
              className="text-xs px-3 py-1.5 rounded-md border border-cc-border/60 hover:border-cc-primary/60 text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Try again
            </button>
            <span className="text-xs text-cc-muted/70">
              The rest of the session is still usable — pick another mode from the launcher.
            </span>
          </div>
        </div>
      </div>
    );
  }
}
