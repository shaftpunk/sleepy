import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAppStore } from "../stores/appStore";
import { getActiveSleep, getLastCompletedSleep, startSleep, stopSleep, type SleepRecord } from "../services/sleepService";
import { getLastFeed, type FeedRecord } from "../services/feedService";
import { getRecentDiaperChanges, type DiaperChange } from "../services/diaperService";
import { subscribeToSleepChanges } from "../services/sleepRealtime";
import { subscribeToFeedChanges } from "../services/feedRealtime";
import SleepyIcon from "../components/SleepyIcon";
import awakeFox from "../assets/awake-fox.png";
import sleepingFox from "../assets/sleeping-fox.png";
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
  const isDefault = useAppStore(state => state.visualTheme === "default");

  return <main className="home-page home-minimal">
    <header className={isDefault && babies.length > 0 ? "home-header home-header-profile" : "home-header"}>
      <h1>{t("common.appName")}</h1>
      {babies.length > 0 && <label className="home-baby-select">
        <span className="sr-only">{t("home.changeBaby", { name: babies.find(baby => baby.id === currentBabyId)?.name ?? "" })}</span>
        {isDefault && <span className="home-baby-avatar"><SleepyIcon name="baby" /></span>}
        <select value={currentBabyId ?? ""} onChange={event => setCurrentBabyId(event.target.value)}>
          {!currentBabyId && <option value="" disabled>&mdash;</option>}
          {babies.map(baby => <option key={baby.id} value={baby.id}>{baby.name}</option>)}
        </select>
        {isDefault && <SleepyIcon name="chevron" className="home-baby-chevron" />}
      </label>}
    </header>
    <HomeActivity key={currentBabyId} />
  </main>;
}

function HomeActivity() {
  const { t, lang } = useTranslation();
  const isDefault = useAppStore(state => state.visualTheme === "default");
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
    <section className="home-current" data-sleeping={Boolean(activeSleep)} aria-labelledby="home-current-title">
      {isDefault && <>
        <svg className="home-orb-ring" aria-hidden="true" viewBox="0 0 200 200">
          <defs>
            <path id="home-ring-arc" d="M 28 163 A 96 96 0 1 1 172 163" />
            <linearGradient id="home-ring-base" x2="1" y2="1">
              <stop stopColor="#ad94d3" /><stop offset=".55" stopColor="#c9a8ce" /><stop offset="1" stopColor="#e6b6c6" />
            </linearGradient>
            <linearGradient id="home-ring-warm" x2="1" y2="1">
              <stop stopColor="var(--orb-warm)" /><stop offset=".6" stopColor="var(--orb-pink)" /><stop offset="1" stopColor="var(--orb-warm)" />
            </linearGradient>
          </defs>
          <g fill="none" strokeWidth="4" strokeLinecap="round">
            <use href="#home-ring-arc" stroke="url(#home-ring-base)" />
            <use className="home-ring-cool" href="#home-ring-arc" stroke="var(--orb-cool)" />
            <use className="home-ring-pulse" href="#home-ring-arc" stroke="url(#home-ring-warm)" />
          </g>
          <circle className="home-orb-now" cx="183" cy="148" r="3.4" />
        </svg>
        <RecentOrbMarkers now={now} sleep={completedSleepEnd} feed={lastFeed?.starttime} diaper={lastDiaper?.changed_at} />
        <div className="home-orb-fox-slot">
          <div className="home-orb-fox-motion">
            <img className="home-current-animal" src={activeSleep ? sleepingFox : awakeFox} alt="" draggable={false} />
          </div>
        </div>
      </>}
      {isDefault && !loading && !activeSleep && completedSleepEnd && <>
        <span className="home-awake-label">{t("home.awakeFor")}</span>
        <strong className="home-awake-duration">{formatHomeDuration(Math.floor(Math.max(0, now - Date.parse(completedSleepEnd)) / 60000), lang)}</strong>
      </>}
      <h2 id="home-current-title">{t(activeSleep ? (isDefault ? "home.sleepingFor" : "common.sleeping") : "home.nextSleepTitle")}</h2>
      {loading ? <p>{t("common.loading")}</p> : activeSleep ? <>
        <p className="home-current-value">{formatHomeDuration(Math.floor(Math.max(0, now - Date.parse(activeSleep.starttime)) / 60000), lang)}</p>
        <button type="button" className="home-started" onClick={() => setEditingSleep(activeSleep)}>
          {t("home.startedAt", { time: clock(Date.parse(activeSleep.starttime)) })} <SleepyIcon name="edit" />
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
            <SleepyIcon name="diaper" />
            {t("diaper.label")}
          </button>
          <button type="button" className="secondary-button" disabled={loading || !currentBabyId} onClick={() => setFeedEditor({ feed: null })}>
            <SleepyIcon name="feed" />
            {t("diaper.feed")}
          </button>
        </>} onCommit={handleSleep} />
      {sleepActionError && <p role="alert">{sleepActionError}</p>}
      {diaperSaved && <p role="status">{t("diaper.saved")}</p>}
    </div>

    <section className="home-recent" aria-labelledby="home-recent-title">
      <h2 id="home-recent-title">{t("common.recent")}</h2>
      <RecentRow kind="sleep" label={t("common.sleep")} editLabel={t("sleep.editTitle")} onEdit={lastSleep && completedSleepEnd ? () => setEditingSleep(lastSleep) : undefined}>
        {lastSleep && completedSleepEnd && <>
          <strong>{formatSleepRange(Date.parse(lastSleep.starttime), Date.parse(completedSleepEnd), now, lang)}</strong>
          <span>{formatHomeDuration(lastSleep.durationminutes ?? (Date.parse(completedSleepEnd) - Date.parse(lastSleep.starttime)) / 60000, lang)}</span>
        </>}
      </RecentRow>
      <RecentRow kind="feed" label={t("diaper.feed")} editLabel={t("feeding.editTitle")} onEdit={lastFeed ? () => setFeedEditor({ feed: lastFeed }) : undefined}>
        {lastFeed && <><strong>{clock(Date.parse(lastFeed.starttime))}</strong><span>{feedDescription(lastFeed)}</span></>}
      </RecentRow>
      <RecentRow kind="diaper" label={t("diaper.label")} editLabel={t("diaper.edit")} onEdit={lastDiaper ? () => openDiaper(lastDiaper) : undefined}>
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

function RecentOrbMarkers({ now, sleep, feed, diaper }: {
  now: number;
  sleep?: string | null;
  feed?: string | null;
  diaper?: string | null;
}) {
  const latest = { sleep, feed, diaper };
  const recent = (["sleep", "feed", "diaper"] as const)
    .map(kind => ({ kind, time: Date.parse(latest[kind] ?? "") }))
    .filter(event => event.time <= now && now - event.time <= 24 * 60 * 60 * 1000)
    .sort((a, b) => a.time - b.time);

  if (recent.length < 2) return null;
  return <div className="home-orb-markers" aria-hidden="true">
    {recent.map(event => <SleepyIcon key={event.kind} name={event.kind} />)}
  </div>;
}

function RecentRow({ kind, label, editLabel, onEdit, children }: {
  kind: "sleep" | "feed" | "diaper";
  label: string;
  editLabel: string;
  onEdit?: () => void;
  children: ReactNode;
}) {
  const icon = <SleepyIcon className="home-recent-icon" name={kind} />;
  if (!onEdit) return <div className="home-recent-row">{icon}<span>{label}</span><span>&mdash;</span></div>;
  return <button type="button" className="home-recent-row" onClick={onEdit}>
    {icon}
    <span><span className="sr-only">{editLabel}: </span>{label}</span>
    <span className="home-recent-value">{children}</span>
    <SleepyIcon name="edit" />
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
