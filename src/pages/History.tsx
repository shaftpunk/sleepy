import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ageInDays } from "../analytics/localDate";
import SleepyIcon from "../components/SleepyIcon";
import DiaperModal from "../components/DiaperModal";
import FeedModal from "../components/FeedModal";
import SleepModal from "../components/SleepModal";
import SleepSplitModal from "../components/SleepSplitModal";
import { useModalAccessibility } from "../hooks/useModalAccessibility";
import { LOCALES, useTranslation } from "../i18n";
import { feedTypeLabel, formatClock, formatDuration, formatSleepRange, sideLabel } from "../lib/format";
import { localDayKey, logDayBounds, logTimeline, shiftLocalDay } from "../lib/logDay";
import { getDiaperChangesBetween, type DiaperChange } from "../services/diaperService";
import { getFeedsBetween, type FeedRecord } from "../services/feedService";
import { subscribeToFeedChanges } from "../services/feedRealtime";
import { getActiveSleep, getLastCompletedSleep, getSleepsOverlappingPeriod, resumeSleep, type SleepRecord } from "../services/sleepService";
import { subscribeToSleepChanges } from "../services/sleepRealtime";
import { useAppStore } from "../stores/appStore";
import "./Log.css";

type Editor =
  | { kind: "sleep"; record?: SleepRecord }
  | { kind: "split"; record: SleepRecord }
  | { kind: "feed"; record?: FeedRecord }
  | { kind: "diaper"; record?: DiaperChange };

type EventKind = "sleep" | "feed" | "diaper";

export default function History() {
  const babyId = useAppStore(state => state.currentBabyId);
  const baby = useAppStore(state => state.babies.find(child => child.id === babyId));
  const age = ageInDays(baby?.birth_date, Date.now());
  const [params, setParams] = useSearchParams();
  const [today, setToday] = useState(() => localDayKey(new Date()));
  useEffect(() => {
    const update = () => setToday(localDayKey(new Date()));
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const { start, key: day } = logDayBounds(params.get("date"), today);
  const { t, lang } = useTranslation();
  const viewKey = JSON.stringify([babyId, day]);
  const [adding, setAdding] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  function selectDate(date: string) {
    setAdding(null);
    const next = new URLSearchParams(params);
    next.delete("today");
    next.set("date", date);
    setParams(next);
  }

  const label = day === today ? t("common.today") : localDayKey(shiftLocalDay(start, 1)) === today
    ? t("common.yesterday")
    : new Intl.DateTimeFormat(lang === "en" ? "en-US" : LOCALES[lang], {
      month: "short", day: "numeric", ...(day.slice(0, 4) !== today.slice(0, 4) && { year: "numeric" }),
    }).format(start);
  return <main className="history-page log-page">
    <header className="log-header">
      <div className="log-identity">
        {baby && <SleepyIcon name="baby" />}
        <div><h1>{t("nav.log")}</h1>
          {baby && <strong>{baby.name}</strong>}
          {age != null && <small>{new Intl.NumberFormat(LOCALES[lang], { style: "unit", unit: "day", unitDisplay: "long" }).format(age)}</small>}
        </div>
      </div>
      <button className="secondary-button" type="button" disabled={!babyId} ref={addButton} onClick={() => setAdding(viewKey)}>
        <span aria-hidden="true">+</span> {t("log.add")}
      </button>
    </header>
    <div className="log-date">
      <button type="button" className="secondary-button" aria-label={t("log.previous")}
        onClick={() => selectDate(localDayKey(shiftLocalDay(start, -1)))}>&lsaquo;</button>
      <label className="log-date-picker">
        <span aria-hidden="true">{label}</span>
        <input type="date" value={day} aria-label={t("log.chooseDate")}
          onChange={event => { if (event.target.value) selectDate(event.target.value); }} />
      </label>
      <button type="button" className="secondary-button" aria-label={t("log.next")}
        onClick={() => selectDate(localDayKey(shiftLocalDay(start, 1)))}>&rsaquo;</button>
    </div>

    <LogDay key={viewKey} babyId={babyId} day={day} today={today} adding={adding === viewKey}
      closeAdd={() => setAdding(null)} restoreFocus={() => addButton.current?.focus()} />
  </main>;
}

function LogDay({ babyId, day, today, adding, closeAdd, restoreFocus }: {
  babyId: string | null;
  day: string;
  today: string;
  adding: boolean;
  closeAdd: () => void;
  restoreFocus: () => void;
}) {
  const { t, lang } = useTranslation();
  const { start, end } = logDayBounds(day, today);
  const from = start.toISOString();
  const to = end.toISOString();
  const [sleeps, setSleeps] = useState<SleepRecord[]>([]);
  const [feeds, setFeeds] = useState<FeedRecord[]>([]);
  const [diapers, setDiapers] = useState<DiaperChange[]>([]);
  const [loading, setLoading] = useState(Boolean(babyId));
  const [error, setError] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [resumable, setResumable] = useState<string | null>(null);

  const requests = useRef({ sleep: 0, feed: 0, diaper: 0 });
  const refreshSleep = useCallback(async () => {
    if (!babyId) return;
    const request = ++requests.current.sleep;
    const rows = await getSleepsOverlappingPeriod(babyId, from, to);
    if (requests.current.sleep === request) setSleeps(rows);
  }, [babyId, from, to]);
  const refreshFeed = useCallback(async () => {
    if (!babyId) return;
    const request = ++requests.current.feed;
    const rows = await getFeedsBetween(babyId, from, to);
    if (requests.current.feed === request) setFeeds(rows);
  }, [babyId, from, to]);
  const refreshDiaper = useCallback(async () => {
    if (!babyId) return;
    const request = ++requests.current.diaper;
    const rows = await getDiaperChangesBetween(babyId, from, to);
    if (requests.current.diaper === request) setDiapers(rows);
  }, [babyId, from, to]);
  const reportError = useCallback((cause: unknown) => {
    console.error("Failed loading Log:", cause);
    setError(true);
  }, []);
  const refresh = useCallback(async () => {
    setError(false);
    await Promise.all([refreshSleep(), refreshFeed(), refreshDiaper()]).catch(reportError);
    setLoading(false);
  }, [refreshSleep, refreshFeed, refreshDiaper, reportError]);

  useEffect(() => {
    if (!babyId) return;
    void refresh();
    const unsubscribeSleep = subscribeToSleepChanges(babyId, () => void refreshSleep().catch(reportError));
    const unsubscribeFeed = subscribeToFeedChanges(babyId, () => void refreshFeed().catch(reportError));
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    // Diapers are not in the repository's Realtime publication. Refresh just
    // that bounded read while Log is visible to pick up other caregivers' changes.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshDiaper().catch(reportError);
    }, 15000);
    return () => {
      const pending = requests.current;
      pending.sleep++;
      pending.feed++;
      pending.diaper++;
      unsubscribeSleep();
      unsubscribeFeed();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      clearInterval(timer);
    };
  }, [babyId, refresh, refreshSleep, refreshFeed, refreshDiaper, reportError]);

  const timeline = logTimeline(day > today ? sleeps.filter(sleep => sleep.endtime) : sleeps, feeds, diapers, start.getTime(), end.getTime());
  const labels = { sleep: t("common.sleep"), feed: t("diaper.feed"), diaper: t("diaper.label") };
  const now = new Date();
  const initialTime = new Date(start);
  initialTime.setHours(now.getHours(), now.getMinutes(), 0, 0);

  function open(event: (typeof timeline)[number]) {
    setResumable(null);
    setEditor(event);
    if (babyId && event.kind === "sleep" && event.record.endtime) {
      void Promise.all([getLastCompletedSleep(babyId), getActiveSleep(babyId)]).then(([latest, active]) => {
        setResumable(!active && latest?.id === event.record.id ? event.record.id : null);
      }).catch(cause => console.error("Failed checking whether sleep can resume:", cause));
    }
  }

  function details(event: (typeof timeline)[number]) {
    if (event.kind === "sleep") {
      const sleep = event.record;
      const began = Date.parse(sleep.starttime);
      if (!sleep.endtime) return [formatClock(began, lang), t("common.sleeping")].join(" \u00b7 ");
      const ended = Date.parse(sleep.endtime);
      return [formatSleepRange(began, ended, start.getTime(), lang),
        formatDuration(sleep.durationminutes ?? (ended - began) / 60000, lang)].join(" \u00b7 ");
    }
    if (event.kind === "feed") {
      const feed = event.record;
      return [feedTypeLabel(feed.feedtype, lang), feed.feedtype === "breast" ? sideLabel(feed.side, lang) : null,
        feed.feedtype === "bottle" && feed.amountml != null ? feed.amountml + " ml" : null,
        feed.durationminutes != null ? formatDuration(feed.durationminutes, lang) : null].filter(Boolean).join(" \u00b7 ");
    }
    const type = event.record.type;
    return t(type === "both" ? "diaper.historyBoth" : `diaper.${type}`);
  }

  function close() {
    setEditor(null);
    requestAnimationFrame(() => { if (document.activeElement === document.body) restoreFocus(); });
  }

  return <>
    {error && <p role="alert">{t("log.loadError")} <button className="text-button" onClick={() => void refresh()}>{t("common.retry")}</button></p>}
    {loading ? <p role="status">{t("common.loading")}</p> : timeline.length === 0 && !error ? <p className="log-empty">{t("log.empty")}</p> : (
      <ul className="log-timeline">
        {timeline.map(event => <li key={event.kind + ":" + event.record.id}>
          <button type="button" className="log-row" data-kind={event.kind} data-event-id={event.record.id} onClick={() => open(event)}>
            <time dateTime={new Date(event.time).toISOString()}>{formatClock(event.time, lang)}</time>
            <SleepyIcon name={event.kind} />
            <span><strong>{labels[event.kind]}</strong><span>{details(event)}</span></span>
            <span aria-hidden="true">&rsaquo;</span>
          </button>
        </li>)}
      </ul>
    )}

    {adding && <AddEntry labels={labels} onClose={closeAdd} onChoose={kind => {
      setEditor({ kind });
      closeAdd();
    }} />}
    {editor?.kind === "sleep" && <SleepModal sleep={editor.record} initialTime={initialTime} allowDelete onClose={close} onSaved={refresh}
      onSplit={editor.record?.endtime ? () => setEditor({ kind: "split", record: editor.record! }) : undefined}
      onResume={editor.record?.id === resumable && editor.record ? async () => {
        await resumeSleep(editor.record!);
        await refresh();
      } : undefined} />}
    {editor?.kind === "split" && <SleepSplitModal sleep={editor.record} onClose={close} onSaved={refresh} />}
    {editor?.kind === "feed" && <FeedModal feed={editor.record} initialTime={initialTime} allowDelete onClose={close} onSaved={refresh} />}
    {editor?.kind === "diaper" && babyId && <DiaperModal babyId={babyId} change={editor.record} initialTime={initialTime} allowDelete
      onClose={close} onSaved={() => { close(); void refresh(); }} />}
  </>;
}

function AddEntry({ labels, onChoose, onClose }: {
  labels: Record<EventKind, string>;
  onChoose: (kind: EventKind) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useModalAccessibility(onClose);
  return <div className="modal-backdrop" onClick={onClose}>
    <div ref={ref} className="feed-modal log-add-dialog" role="dialog" aria-modal="true" aria-label={t("log.add")}
      onClick={event => event.stopPropagation()}>
      {(["sleep", "feed", "diaper"] as const).map(kind => <button key={kind} className="secondary-button" type="button"
        onClick={() => onChoose(kind)}>{labels[kind]}</button>)}
      <button className="text-button" type="button" onClick={onClose}>{t("common.close")}</button>
    </div>
  </div>;
}
