import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAppStore } from "../stores/appStore";
import { getActiveSleep, getLastCompletedSleep, startSleep, stopSleep, type SleepRecord } from "../services/sleepService";
import { getLastFeed, type FeedRecord } from "../services/feedService";
import { getRecentDiaperChanges, type DiaperChange } from "../services/diaperService";
import { subscribeToSleepChanges } from "../services/sleepRealtime";
import { subscribeToFeedChanges } from "../services/feedRealtime";
import FeedModal from "../components/FeedModal";
import SleepModal from "../components/SleepModal";
import DiaperModal from "../components/DiaperModal";
import ActiveSleepEstimate from "../components/ActiveSleepEstimate";
import { getActiveSleepEstimate, sleepEstimateHistoryRevision, subscribeSleepEstimateHistory, type SleepEstimatePresentation } from "../services/sleepEstimateService";
import SoundMonitorPanel from "../components/SoundMonitorPanel";
import SleepPrimaryAction from "../components/SleepPrimaryAction";
import { useAnalyticsData } from "../hooks/useAnalyticsData";
import { computeNextFeedSide } from "../analytics/home";
import { ageInDays } from "../analytics/localDate";
import { calculateNextSleep } from "../analytics/nextSleep";
import { feedTypeLabel, formatClock, formatSleepRange, sideLabel } from "../lib/format";
import { formatHomeDuration } from "../lib/homePresentation";
import { useTranslation } from "../i18n";
import "./SleepButton.css";
import "./Home.css";

export default function Home() {
  const currentBabyId = useAppStore(state => state.currentBabyId);
  const babies = useAppStore(state => state.babies);
  const setCurrentBabyId = useAppStore(state => state.setCurrentBabyId);
  const { t } = useTranslation();

  return <main className="home-page home-minimal">
    <header className="home-header">
      <h1>{t("common.appName")}</h1>
      {babies.length > 0 && <label className="home-baby-select">
        <span className="sr-only">{t("home.changeBaby", { name: babies.find(baby => baby.id === currentBabyId)?.name ?? "" })}</span>
        <select value={currentBabyId ?? ""} onChange={event => setCurrentBabyId(event.target.value)}>
          {!currentBabyId && <option value="" disabled>&mdash;</option>}
          {babies.map(baby => <option key={baby.id} value={baby.id}>{baby.name}</option>)}
        </select>
      </label>}
    </header>
    <HomeActivity key={currentBabyId} />
  </main>;
}

function HomeActivity() {
  const { t, lang } = useTranslation();
  const currentBabyId = useAppStore(state => state.currentBabyId);
  const currentBaby = useAppStore(state => state.babies.find(baby => baby.id === currentBabyId));
  const [activeSleep, setActiveSleep] = useState<SleepRecord | null>(null);
  const [lastSleep, setLastSleep] = useState<SleepRecord | null>(null);
  const [lastFeed, setLastFeed] = useState<FeedRecord | null>(null);
  const [lastDiaper, setLastDiaper] = useState<DiaperChange | null>(null);
  const [editingSleep, setEditingSleep] = useState<SleepRecord | null>(null);
  const [feedEditor, setFeedEditor] = useState<{ feed: FeedRecord | null } | null>(null);
  const [diaperEditor, setDiaperEditor] = useState<{ change: DiaperChange | null } | null>(null);
  const [diaperSaved, setDiaperSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sleepActionError, setSleepActionError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const { sessions, active, feeds } = useAnalyticsData(currentBabyId);
  const predictionMinute = Math.ceil(now / 60000) * 60000;
  const ageDays = ageInDays(currentBaby?.birth_date, predictionMinute);
  const nextSleep = useMemo(() => calculateNextSleep({ sessions, active, now: predictionMinute, ageDays }),
    [sessions, active, predictionMinute, ageDays]);
  const nextFeedSide = computeNextFeedSide(feeds);

  const sleepRequest = useRef(0);
  const feedRequest = useRef(0);
  const diaperRequest = useRef(0);

  async function loadSleepData() {
    if (!currentBabyId) return;
    const request = ++sleepRequest.current;
    const [current, previous] = await Promise.all([getActiveSleep(currentBabyId), getLastCompletedSleep(currentBabyId)]);
    if (request !== sleepRequest.current) return;
    setActiveSleep(current?.baby_id === currentBabyId ? current : null);
    setLastSleep(previous?.baby_id === currentBabyId ? previous : null);
  }

  async function loadFeedData() {
    if (!currentBabyId) return;
    const request = ++feedRequest.current;
    const feed = await getLastFeed(currentBabyId);
    if (request === feedRequest.current) setLastFeed(feed?.baby_id === currentBabyId ? feed : null);
  }

  async function loadDiaperData() {
    if (!currentBabyId) return;
    const request = ++diaperRequest.current;
    const [change] = await getRecentDiaperChanges(currentBabyId, 1);
    if (request === diaperRequest.current) setLastDiaper(change?.baby_id === currentBabyId ? change : null);
  }

  useEffect(() => {
    if (!currentBabyId) { setLoading(false); return; }
    const report = (error: unknown) => console.error("Failed loading Home:", error);
    const refreshSleep = () => loadSleepData().catch(report);
    const refreshFeed = () => loadFeedData().catch(report);
    const refresh = () => {
      void refreshSleep().then(() => setLoading(false));
      void refreshFeed();
      void loadDiaperData().catch(report);
    };
    const refreshIfVisible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    const unsubscribeSleep = subscribeToSleepChanges(currentBabyId, refreshSleep);
    const unsubscribeFeed = subscribeToFeedChanges(currentBabyId, refreshFeed);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      unsubscribeSleep();
      unsubscribeFeed();
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
    // These readers close over the baby ID. The parent remounts this view on a baby switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBabyId]);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("resume", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("resume", update);
    };
  }, []);

  function openDiaper(change: DiaperChange | null = null) {
    setDiaperSaved(false);
    setDiaperEditor({ change });
  }

  function feedDescription(feed: FeedRecord) {
    const typeLabel = feedTypeLabel(feed.feedtype, lang);

    if (feed.feedtype === "bottle") {
      return feed.amountml !== null ? `${typeLabel} \u00b7 ${feed.amountml} ml` : typeLabel;
    }

    if (feed.feedtype === "breast") {
      const side = sideLabel(feed.side, lang);
      return side ? `${typeLabel} \u00b7 ${side}` : typeLabel;
    }

    return typeLabel;
  }

  const completedSleepEnd = lastSleep?.endtime;
  const clock = (timestamp: number) => formatClock(timestamp, lang);

  const sleepActionBusy = useRef(false);
  async function handleSleep(minutesAgo = 0): Promise<boolean> {
    if (sleepActionBusy.current || saving || loading) return false;
    sleepActionBusy.current = true;
    const restoreActionFocus = Boolean(document.activeElement?.closest(".home-sleep-actions"));
    try {
      setSleepActionError(null);
      setSaving(true);

      if (activeSleep) {
        await stopSleep(
          activeSleep.id,
          activeSleep.starttime,
          minutesAgo
        );
      } else {
        if (!currentBabyId) {
          return false;
        }

        await startSleep(
          currentBabyId,
          minutesAgo
        );
      }

      await loadSleepData();
      if (restoreActionFocus) requestAnimationFrame(() => {
        if (!document.hidden) document.querySelector<HTMLButtonElement>(".home-sleep-actions > .sleep-action")?.focus({ preventScroll: true });
      });
      return true;
    } catch (error) {
      const safeMessages = [t("sleepStart.overlap"), t("sleepStart.invalid"), t("errors.endTimeAfterStart")];
      setSleepActionError(error instanceof Error && safeMessages.includes(error.message) ? error.message : t("errors.couldNotSaveSleep"));
      console.error(
        "Sleep action failed:",
        error
      );
      return false;
    } finally {
      sleepActionBusy.current = false;
      setSaving(false);
    }
  }

  return <>
    <section className="home-current" aria-labelledby="home-current-title">
      <h2 id="home-current-title">{t(activeSleep ? "common.sleeping" : "home.nextSleepTitle")}</h2>
      {loading ? <p>{t("common.loading")}</p> : activeSleep ? <>
        <p className="home-current-value">{formatHomeDuration(Math.floor(Math.max(0, now - Date.parse(activeSleep.starttime)) / 60000), lang)}</p>
        <button type="button" className="home-started" onClick={() => setEditingSleep(activeSleep)}>
          {t("home.startedAt", { time: clock(Date.parse(activeSleep.starttime)) })} <span aria-hidden="true">&#9998;</span>
        </button>
      </> : nextSleep.status === "ready" && nextSleep.earliestStart != null && nextSleep.latestStart != null ? <>
        <p className="home-current-value">{clock(nextSleep.earliestStart)}&ndash;{clock(nextSleep.latestStart)}</p>
        {nextSleep.peak && <p>{t("home.mostLikely", { time: clock(nextSleep.peak.peakTime) })}</p>}
      </> : <p>{t("home.nextSleepLearning")}</p>}
    </section>
    <div className="home-quick-actions">
      <SleepPrimaryAction key={`${currentBabyId}:${activeSleep?.id ?? "awake"}:${activeSleep?.starttime ?? lastSleep?.endtime ?? ""}`} ending={Boolean(activeSleep)}
        after={activeSleep ? Date.parse(activeSleep.starttime) : completedSleepEnd ? Date.parse(completedSleepEnd) : null}
        babyName={currentBaby?.name ?? t("common.appName")} disabled={loading || saving || !currentBabyId || Boolean(activeSleep && activeSleep.baby_id !== currentBabyId)}
        saving={saving} awakeActions={<>
          <button type="button" className="secondary-button" disabled={loading || !currentBabyId} onClick={() => openDiaper()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v6c0 4-4 7-9 8-5-1-9-4-9-8zm0 4c4 0 7 3 7 9m11-9c-4 0-7 3-7 9M3 8h5m8 0h5" /></svg>
            {t("diaper.label")}
          </button>
          <button type="button" className="secondary-button" disabled={loading || !currentBabyId} onClick={() => setFeedEditor({ feed: null })}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7V5a2 2 0 0 1 4 0v2m-6 0h8v4H8zM9 11h6l2 3v6H7v-6zm1 4h2m-2 3h2" /></svg>
            {t("diaper.feed")}
          </button>
        </>} onCommit={handleSleep} />
      {sleepActionError && <p role="alert">{sleepActionError}</p>}
      {diaperSaved && <p role="status">{t("diaper.saved")}</p>}
    </div>

    <section className="home-recent" aria-labelledby="home-recent-title">
      <h2 id="home-recent-title">{t("common.recent")}</h2>
      <RecentRow label={t("common.sleep")} editLabel={t("sleep.editTitle")} onEdit={lastSleep && completedSleepEnd ? () => setEditingSleep(lastSleep) : undefined}>
        {lastSleep && completedSleepEnd && <>
          <strong>{formatSleepRange(Date.parse(lastSleep.starttime), Date.parse(completedSleepEnd), now, lang)}</strong>
          <span>{formatHomeDuration(lastSleep.durationminutes ?? (Date.parse(completedSleepEnd) - Date.parse(lastSleep.starttime)) / 60000, lang)}</span>
        </>}
      </RecentRow>
      <RecentRow label={t("diaper.feed")} editLabel={t("feeding.editTitle")} onEdit={lastFeed ? () => setFeedEditor({ feed: lastFeed }) : undefined}>
        {lastFeed && <><strong>{clock(Date.parse(lastFeed.starttime))}</strong><span>{feedDescription(lastFeed)}</span></>}
      </RecentRow>
      <RecentRow label={t("diaper.label")} editLabel={t("diaper.edit")} onEdit={lastDiaper ? () => openDiaper(lastDiaper) : undefined}>
        {lastDiaper && <><strong>{clock(Date.parse(lastDiaper.changed_at))}</strong><span>{t(lastDiaper.type === "both" ? "diaper.historyBoth" : `diaper.${lastDiaper.type}`)}</span></>}
      </RecentRow>
    </section>

    <SoundMonitorPanel sleep={activeSleep} showControls={false} />

    {editingSleep && <SleepModal allowDelete sleep={editingSleep} onClose={() => setEditingSleep(null)} onSaved={loadSleepData}
      activeDetails={activeSleep?.id === editingSleep.id && <CurrentSleepEstimate sleep={activeSleep} now={now} />} />}
    {diaperEditor && currentBabyId && <DiaperModal allowDelete babyId={currentBabyId} change={diaperEditor.change ?? undefined}
      onClose={() => setDiaperEditor(null)} onSaved={() => {
        setDiaperEditor(null);
        setDiaperSaved(true);
        void loadDiaperData().catch(error => console.error("Failed loading latest diaper:", error));
      }} />}
    {feedEditor && <FeedModal allowDelete feed={feedEditor.feed} nextSide={nextFeedSide} onClose={() => setFeedEditor(null)} onSaved={loadFeedData} />}
  </>;
}

function RecentRow({ label, editLabel, onEdit, children }: {
  label: string;
  editLabel: string;
  onEdit?: () => void;
  children: ReactNode;
}) {
  if (!onEdit) return <div className="home-recent-row"><span>{label}</span><span>&mdash;</span></div>;
  return <button type="button" className="home-recent-row" onClick={onEdit}>
    <span><span className="sr-only">{editLabel}: </span>{label}</span>
    <span className="home-recent-value">{children}</span>
    <span aria-hidden="true">&#9998;</span>
  </button>;
}

function CurrentSleepEstimate({ sleep, now }: { sleep: SleepRecord; now: number }) {
  const revision = useSyncExternalStore(subscribeSleepEstimateHistory, sleepEstimateHistoryRevision, sleepEstimateHistoryRevision);
  const [estimate, setEstimate] = useState<{ sleep: SleepRecord; presentation: SleepEstimatePresentation } | null>(null);
  useEffect(() => {
    let current = true;
    void getActiveSleepEstimate(sleep).then(presentation => {
      if (current) setEstimate({ sleep, presentation });
    }).catch(error => console.error("Failed loading current sleep estimate:", error));
    return () => { current = false; };
  }, [sleep, revision]);
  if (estimate?.sleep !== sleep) return null;
  return <ActiveSleepEstimate presentation={estimate.presentation} sleepStartedAt={sleep.starttime} now={now} />;
}
