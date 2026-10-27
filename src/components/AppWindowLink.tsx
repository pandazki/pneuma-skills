import { useState, type ComponentProps, type MouseEvent } from "react";
import type { AppWindowRequest } from "../../core/types/desktop-window.js";
import { openAppWindow } from "../utils/window-navigation.js";

type Props = Omit<ComponentProps<"a">, "onClick" | "onAuxClick"> & {
  kind: AppWindowRequest["kind"];
  href: string;
};

export function AppWindowLink({ kind, children, ...props }: Props) {
  const [error, setError] = useState("");
  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!window.pneumaDesktop || event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    setError("");
    try {
      await openAppWindow({ kind, url: event.currentTarget.href });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return <>
    <a {...props} onClick={open} onAuxClick={open}>{children}</a>
    {error && <p role="alert" className="text-xs text-cc-error">{error}</p>}
  </>;
}
