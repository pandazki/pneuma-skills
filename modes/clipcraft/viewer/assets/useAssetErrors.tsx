import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

interface AssetErrorsContextValue {
  errors: Map<string, string>;
  setError: (assetId: string, message: string) => void;
  clearError: (assetId: string) => void;
}

const AssetErrorsContext = createContext<AssetErrorsContextValue | null>(null);

export function AssetErrorsProvider({ children }: { children: React.ReactNode }) {
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());

  const setError = useCallback((assetId: string, message: string) => {
    setErrors((prev) => {
      const next = new Map(prev);
      next.set(assetId, message);
      return next;
    });
  }, []);

  const clearError = useCallback((assetId: string) => {
    setErrors((prev) => {
      if (!prev.has(assetId)) return prev;
      const next = new Map(prev);
      next.delete(assetId);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ errors, setError, clearError }), [errors, setError, clearError]);

  return <AssetErrorsContext.Provider value={value}>{children}</AssetErrorsContext.Provider>;
}

export function useAssetErrors() {
  const ctx = useContext(AssetErrorsContext);
  if (!ctx) throw new Error("useAssetErrors must be used inside <AssetErrorsProvider>");
  return ctx;
}

export function useAssetError(assetId: string): string | null {
  const { errors } = useAssetErrors();
  return errors.get(assetId) ?? null;
}
