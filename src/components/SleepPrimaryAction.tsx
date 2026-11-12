import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { createSleepHold, withinSleepHoldTarget } from "../lib/holdSleepAction";
import { maximumBackdate } from "../lib/sleepActionTime";
import { selectionFeedback } from "../services/interactionFeedback";
import SleepTimeSheet from "./SleepTimeSheet";

type Props = { ending: boolean; after: number | null; babyName: string; disabled: boolean; saving: boolean;
  onCommit: (minutes: number) => Promise<boolean> };
export default function SleepPrimaryAction({ ending, after, babyName, disabled, saving, onCommit }: Props) {
  const { t } = useTranslation();
  const hint = useId();
  const [offset, setOffset] = useState(0), [sheet, setSheet] = useState(false);
  const [pressed, setPressed] = useState(false);
  const latest = useRef({ after, ending, disabled, onCommit });
  useLayoutEffect(() => { latest.current = { after, ending, disabled, onCommit }; }, [after, ending, disabled, onCommit]);
  const busy = useRef(false), suppressClick = useRef(false);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [gesture] = useState(() => createSleepHold({
    maximum: () => maximumBackdate(Date.now(), after, ending),
    select: setOffset, haptic: selectionFeedback,
    onCancel: () => setPressed(false),
  }));
  const cancel = useCallback(() => {
    gesture.cancel(); pointer.current = null; suppressClick.current = true; setPressed(false);
  }, [gesture]);
  useEffect(() => {
    const abandoned = () => { if (pointer.current) cancel(); };
    const hidden = () => { if (document.hidden) abandoned(); };
    window.addEventListener("blur", abandoned); window.addEventListener("scroll", abandoned, true);
    document.addEventListener("pause", abandoned); document.addEventListener("visibilitychange", hidden);
    return () => { gesture.dispose(); pointer.current = null; suppressClick.current = true;
      window.removeEventListener("blur", abandoned); window.removeEventListener("scroll", abandoned, true);
      document.removeEventListener("pause", abandoned); document.removeEventListener("visibilitychange", hidden); };
  }, [gesture, cancel]);
  useLayoutEffect(() => { if (pointer.current) cancel(); }, [after, ending, disabled, cancel]);
  async function commit(minutes: number) {
    if (latest.current.disabled || busy.current) return false;
    busy.current = true;
    try { return await latest.current.onCommit(minutes); } finally { busy.current = false; }
  }
  return <div className="home-sleep-actions">
    <button type="button" className={`primary-button sleep-action${ending ? " is-sleeping" : ""}${pressed ? " is-pressed" : ""}`}
      disabled={disabled} aria-describedby={hint}
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || disabled) return;
        suppressClick.current = false;
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        try { event.currentTarget.setPointerCapture(event.pointerId); }
        catch { cancel(); return; }
        setPressed(true);
        // The controller survives Awake/Sleeping transitions. Use this press's
        // current bounds rather than the props from its first mount.
        gesture.begin(() => maximumBackdate(Date.now(), latest.current.after, latest.current.ending));
      }}
      onPointerMove={event => {
        if (pointer.current?.id !== event.pointerId) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!withinSleepHoldTarget(pointer.current, { x: event.clientX, y: event.clientY }, bounds)) cancel();
      }}
      onPointerCancel={cancel} onLostPointerCapture={() => { if (pointer.current) cancel(); }}
      onPointerUp={event => {
        if (pointer.current?.id !== event.pointerId) return;
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) { cancel(); return; }
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!withinSleepHoldTarget(pointer.current, { x: event.clientX, y: event.clientY }, bounds)) { cancel(); return; }
        pointer.current = null;
        setPressed(false);
        const result = gesture.release();
        suppressClick.current = result.kind !== "tap";
        // Commit the rendered selection, even if a timer increment is still
        // waiting for React to render. No visible selection means no mutation.
        if (result.kind === "hold" && offset > 0) void commit(offset);
      }}
      onKeyDown={event => {
        if (event.repeat && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); return; }
        if ((event.key === "Enter" || event.key === " ") && !pointer.current) suppressClick.current = false;
      }}
      onClick={() => {
        if (pointer.current) { cancel(); return; }
        if (suppressClick.current) { suppressClick.current = false; return; }
        suppressClick.current = false; void commit(0);
      }}>
      {saving ? t("common.saving") : offset > 0 ? t("home.actionMinutesAgo", { minutes: offset }) : t(ending ? "home.stopSleep" : "home.startSleep")}
    </button>
    <p className="home-hold-hint" id={hint}>{t("home.holdToAdjust")}</p>
    <span className="sr-only" role="status">{offset > 0 ? t("home.actionMinutesAgo", { minutes: offset }) : ""}</span>
    <button type="button" className="text-button home-change-time" disabled={disabled} onClick={() => setSheet(true)}>{t("home.changeTime")}</button>
    {sheet && <SleepTimeSheet babyName={babyName} ending={ending} after={after} disabled={disabled}
      onClose={() => setSheet(false)} onCommit={commit} />}
  </div>;
}
