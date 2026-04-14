import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ViewerNotification } from "../../../../core/types/viewer-contract.js";
import { GenerationDialog } from "./GenerationDialog.js";
import type {
  AssetKind,
  GenerationRequest,
  RequestMode,
} from "./dispatchGeneration.js";

interface DialogState {
  open: boolean;
  mode: RequestMode;
  initialKind: AssetKind;
  source?: GenerationRequest["source"];
}

const CLOSED: DialogState = {
  open: false,
  mode: "create",
  initialKind: "image",
};

interface GenerationDialogApi {
  openForCreate: (initialKind?: AssetKind) => void;
  openForVariant: (
    source: NonNullable<GenerationRequest["source"]>,
    initialKind: AssetKind,
  ) => void;
  close: () => void;
}

const Ctx = createContext<GenerationDialogApi | null>(null);

/**
 * Hoists the GenerationDialog once at the top of the ClipCraft viewer
 * provider stack and exposes open/close controls via context. Any
 * descendant can call `useGenerationDialog().openForCreate()` or
 * `openForVariant(source, kind)` to show the form — the source is
 * wired to `onNotifyAgent` via the provider's props, so the dispatch
 * path is a single call.
 */
export function GenerationDialogProvider({
  onNotifyAgent,
  children,
}: {
  onNotifyAgent?: (n: ViewerNotification) => void;
  children: ReactNode;
}) {
  const [state, setState] = useState<DialogState>(CLOSED);

  const openForCreate = useCallback((initialKind: AssetKind = "image") => {
    setState({ open: true, mode: "create", initialKind });
  }, []);

  const openForVariant = useCallback(
    (
      source: NonNullable<GenerationRequest["source"]>,
      initialKind: AssetKind,
    ) => {
      setState({ open: true, mode: "variant", initialKind, source });
    },
    [],
  );

  const close = useCallback(() => {
    setState(CLOSED);
  }, []);

  const api = useMemo(
    () => ({ openForCreate, openForVariant, close }),
    [openForCreate, openForVariant, close],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <GenerationDialog
        open={state.open}
        mode={state.mode}
        initialKind={state.initialKind}
        source={state.source}
        onClose={close}
        onNotifyAgent={onNotifyAgent}
      />
    </Ctx.Provider>
  );
}

export function useGenerationDialog(): GenerationDialogApi {
  const api = useContext(Ctx);
  if (!api) {
    throw new Error(
      "useGenerationDialog must be called inside a GenerationDialogProvider",
    );
  }
  return api;
}
