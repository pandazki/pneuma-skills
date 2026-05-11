import { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <div
      ref={trapRef}
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[96vw] max-h-[92vh] outline-none"
      >
        <img src={src} alt={alt} className="max-w-full max-h-[92vh] object-contain rounded" />
      </div>
    </div>
  );
}
