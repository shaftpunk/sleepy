import { useEffect, useRef } from "react";

// Presentation-only dialog keyboard handling. Existing close handlers and their
// busy-state restrictions remain authoritative; no form or persistence behavior.
export function useModalAccessibility<T extends HTMLElement = HTMLDivElement>(onClose: () => void, canClose = true) {
  const ref = useRef<T>(null);
  const latest = useRef({ onClose, canClose });
  useEffect(() => { latest.current = { onClose, canClose }; }, [onClose, canClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
    )].filter(element => element.getClientRects().length && !element.closest('details:not([open]) :not(summary)'));
    dialog.tabIndex = -1;
    const frame = requestAnimationFrame(() => (focusable()[0] ?? dialog).focus({ preventScroll: true }));
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && latest.current.canClose) {
        event.preventDefault(); latest.current.onClose();
      }
      if (event.key !== "Tab") return;
      const items = focusable(), first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame); document.removeEventListener("keydown", handleKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
