import { useCallback, useEffect, useState } from "react";

/**
 * Listing of production-bible artifacts on disk:
 *   bible.md / cast cards / setting cards / storyboards.
 *
 * Mirrors `useAssetFsListing` — fetch on mount, refetch on demand.
 * No polling, no WS subscription; the agent emits writes inside its
 * own turn so the UI just refetches when the turn ends or when the
 * user clicks the section's refresh button.
 */

interface BibleEntry {
  path: string;
  mtime: number;
}

interface CardEntry {
  name: string;
  mdPath: string;
  imagePath: string | null;
  mtime: number;
}

interface PanelEntry {
  index: number;
  row: number;
  col: number;
  bbox: { x: number; y: number; w: number; h: number };
  path: string;
  assetId?: string;
}

interface StoryboardEntry {
  id: string;
  compositePath: string;
  panels: PanelEntry[];
  grid: { rows: number; cols: number } | null;
  hasStdoutJson: boolean;
  mtime: number;
}

interface SetupListing {
  bible: BibleEntry | null;
  cast: CardEntry[];
  world: CardEntry[];
  storyboards: StoryboardEntry[];
}

interface State {
  data: SetupListing | null;
  loading: boolean;
  error: string | null;
}

export function useSetupListing(): State & { refetch: () => void } {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });

  const refetch = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fetch("/api/setup/listing")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<SetupListing>;
      })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err) =>
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);
  return { ...state, refetch };
}

export type { SetupListing, BibleEntry, CardEntry, PanelEntry, StoryboardEntry };
