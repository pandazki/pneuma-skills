import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

interface VariantPointerContextValue {
  pointers: Map<string, string>;
  get: (clipId: string) => string | undefined;
  set: (clipId: string, assetId: string) => void;
}

const VariantPointerContext = createContext<VariantPointerContextValue | null>(null);

export function VariantPointerProvider({ children }: { children: React.ReactNode }) {
  const [pointers, setPointers] = useState<Map<string, string>>(() => new Map());

  const get = useCallback((clipId: string) => pointers.get(clipId), [pointers]);

  const set = useCallback((clipId: string, assetId: string) => {
    setPointers((prev) => {
      const next = new Map(prev);
      next.set(clipId, assetId);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ pointers, get, set }), [pointers, get, set]);

  return <VariantPointerContext.Provider value={value}>{children}</VariantPointerContext.Provider>;
}

export function useVariantPointer(): VariantPointerContextValue {
  const ctx = useContext(VariantPointerContext);
  if (!ctx) throw new Error("useVariantPointer must be used inside VariantPointerProvider");
  return ctx;
}
