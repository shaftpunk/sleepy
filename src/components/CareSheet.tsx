import { useRef, type ReactNode } from "react";
import { useModalAccessibility } from "../hooks/useModalAccessibility";
import { useTranslation } from "../i18n";
import "./CareSheet.css";

export default function CareSheet({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  const dialog = useModalAccessibility(onClose);
  const start = useRef<{ x: number; y: number } | null>(null);
  function resetDrag() {
    start.current = null;
    dialog.current?.style.removeProperty("transform");
  }
  return <div className="modal-backdrop care-backdrop" onClick={onClose}>
    <div ref={dialog} className="feed-modal care-sheet" role="dialog" aria-modal="true" aria-label={title}
      onClick={event => event.stopPropagation()}>
      <div className="care-grip" aria-hidden="true"
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          start.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!start.current || !dialog.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
          const distance = Math.max(0, event.clientY - start.current.y);
          dialog.current.style.transform = `translateY(${Math.min(distance, 100)}px)`;
        }}
        onLostPointerCapture={resetDrag}
        onPointerCancel={resetDrag}
        onPointerUp={event => {
          const origin = start.current;
          resetDrag();
          if (origin && event.clientY - origin.y > 48 && Math.abs(event.clientX - origin.x) < 40) onClose();
        }} />
      <header><h2>{title}</h2><button type="button" className="text-button" onClick={onClose}>{t("common.close")}</button></header>
      {children}
    </div>
  </div>;
}
