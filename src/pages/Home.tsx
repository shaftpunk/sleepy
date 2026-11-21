import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Link } from "react-router-dom";

import { useAppStore } from "../stores/appStore";

import {
  getActiveSleep,
  getLastCompletedSleep,
  getRecentSleeps,
  startSleep,
  stopSleep,
  type SleepRecord,
} from "../services/sleepService";

import {
  countFeedsBetween,
  getLastFeed,
  getRecentFeeds,
  type FeedRecord,
} from "../services/feedService";

import {
  subscribeToSleepChanges,
} from "../services/sleepRealtime";

import {
  subscribeToFeedChanges,
} from "../services/feedRealtime";

import FeedModal from "../components/FeedModal";
import SleepModal from "../components/SleepModal";
import FamilyMessageModal from "../components/FamilyMessageModal";
import SoundMonitorPanel from "../components/SoundMonitorPanel";
import FeedHistory from "../components/FeedHistory";
import BabySprite from "../themes/retro/BabySprite";

import { useAnalyticsData } from "../hooks/useAnalyticsData";
import { computeNextFeedSide, computeTodayTotals } from "../analytics/home";
import SleepWaveCard from "../components/sleep-wave/SleepWaveCard";
import { useSleepForecasts } from "../hooks/useSleepForecasts";
import { getActiveSleepEstimate, sleepEstimateHistoryRevision, subscribeSleepEstimateHistory, type SleepEstimatePresentation } from "../services/sleepEstimateService";
import ActiveSleepEstimate from "../components/ActiveSleepEstimate";
import { feedTypeLabel, formatClock, formatDuration, formatSleepRange, sideLabel } from "../lib/format";
import { useTranslation } from "../i18n";
import "./SleepButton.css";
import { countDiaperChangesBetween, getRecentDiaperChanges, type DiaperChange } from "../services/diaperService";
import { startOfLocalDay } from "../analytics/time";
import DiaperModal from "../components/DiaperModal";
import SleepPrimaryAction from "../components/SleepPrimaryAction";
import "./Home.css";
import { formatHomeDuration } from "../lib/homePresentation";

export default function Home() {
  const { t, lang } = useTranslation();

  const currentBabyId =
    useAppStore(
      (state) =>
        state.currentBabyId
    );

  const babies =
    useAppStore(
      (state) =>
        state.babies
    );

  const visualTheme = useAppStore((state) => state.visualTheme);
  const isRetro = visualTheme === "retro";
  const isPremium = visualTheme === "default";

  const currentBaby =
    babies.find(
      (baby) =>
        baby.id === currentBabyId
    );

  function relativeTime(dateString: string) {
    const minutes = Math.max(
      0,
      Math.floor((now - new Date(dateString).getTime()) / 60000)
    );

    if (minutes < 1) return t("common.justNow");
    if (minutes < 60) return t("common.minutesAgo", { minutes });

    const h = Math.floor(minutes / 60);
    const m = minutes % 60;

    if (!m) return t("common.hoursAgo", { hours: h });

    return t("common.hoursMinutesAgo", { hours: h, minutes: m });
  }

  function feedDescription(feed: FeedRecord) {
    const typeLabel = feedTypeLabel(feed.feedtype, lang);

    if (feed.feedtype === "bottle") {
      return feed.amountml !== null ? `${typeLabel} · ${feed.amountml} ml` : typeLabel;
    }

    if (feed.feedtype === "breast") {
      const side = sideLabel(feed.side, lang);
      return side ? `${typeLabel} · ${side}` : typeLabel;
    }

    return typeLabel;
  }

  const [
    activeSleep,
    setActiveSleep,
  ] =
    useState<
      SleepRecord | null
    >(null);

  const [
    lastSleep,
    setLastSleep,
  ] =
    useState<
      SleepRecord | null
    >(null);

  const [
    recentSleeps,
    setRecentSleeps,
  ] =
    useState<
      SleepRecord[]
    >([]);

  const [
    lastFeed,
    setLastFeed,
  ] =
    useState<
      FeedRecord | null
    >(null);

  const [
    recentFeeds,
    setRecentFeeds,
  ] =
    useState<
      FeedRecord[]
    >([]);

  const [
    feedModalOpen,
    setFeedModalOpen,
  ] =
    useState(false);

  const [editingSleep,setEditingSleep] = useState<SleepRecord | null>(null);
  const [diaperBabyId, setDiaperBabyId] = useState<string | null>(null);
  const [latestDiaper, setLatestDiaper] = useState<DiaperChange | null>(null);
  const [editingDiaper, setEditingDiaper] = useState<DiaperChange | null>(null);
  const [diaperSaved, setDiaperSaved] = useState(false);
  const [sleepModalOpen, setSleepModalOpen] = useState(false);
  const [familyMessageOpen, setFamilyMessageOpen] = useState(false);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    showAllFeeds,
    setShowAllFeeds,
  ] =
    useState(false);

  const [
    now,
    setNow,
  ] =
    useState(
      () => Date.now()
    );

  const {
    sessions: analyticsSessions,
    active: analyticsActive,
    feeds: analyticsFeeds,
  } = useAnalyticsData(currentBabyId);

  const todayStats = useMemo(
    () => computeTodayTotals(analyticsSessions, now),
    [analyticsSessions, now]
  );

  const dayStart = startOfLocalDay(now);
  const [feedTotal, setFeedTotal] = useState<{ key: string; count: number | null } | null>(null);
  const [diaperTotal, setDiaperTotal] = useState<{ key: string; count: number | null } | null>(null);
  const activityKey = JSON.stringify([currentBabyId, dayStart]);

  useEffect(() => {
    if (!currentBabyId) return;
    let cancelled = false;
    const start = new Date(dayStart);
    const end = new Date(dayStart);
    end.setDate(end.getDate() + 1);
    void countFeedsBetween(currentBabyId, start.toISOString(), end.toISOString())
      .then(count => { if (!cancelled) setFeedTotal({ key: activityKey, count }); })
      .catch(() => { if (!cancelled) setFeedTotal({ key: activityKey, count: null }); });
    return () => { cancelled = true; };
  }, [currentBabyId, dayStart, activityKey, recentFeeds]);

  useEffect(() => {
    if (!currentBabyId) return;
    let cancelled = false;
    const start = new Date(dayStart);
    const end = new Date(dayStart);
    end.setDate(end.getDate() + 1);
    void countDiaperChangesBetween(currentBabyId, start.toISOString(), end.toISOString())
      .then(count => { if (!cancelled) setDiaperTotal({ key: activityKey, count }); })
      .catch(() => { if (!cancelled) setDiaperTotal({ key: activityKey, count: null }); });
    return () => { cancelled = true; };
  }, [currentBabyId, dayStart, activityKey, diaperSaved]);

  useEffect(() => {
    if (!currentBabyId) return;
    let cancelled = false;
    void getRecentDiaperChanges(currentBabyId, 1)
      .then(([change]) => { if (!cancelled) setLatestDiaper(change ?? null); })
      .catch(() => { if (!cancelled) setLatestDiaper(null); });
    return () => { cancelled = true; };
  }, [currentBabyId, diaperSaved]);

  const lastDiaper = latestDiaper?.baby_id === currentBabyId ? latestDiaper : null;

  function openDiaper(change: DiaperChange | null = null) {
    setEditingDiaper(change);
    setDiaperSaved(false);
    setDiaperBabyId(currentBabyId);
  }

  const feedCount = feedTotal?.key === activityKey ? feedTotal.count : null;
  const diaperCount = diaperTotal?.key === activityKey ? diaperTotal.count : null;

  const waveActive = useMemo(() => activeSleep?.baby_id === currentBabyId
    ? { id: activeSleep.id, startMs: Date.parse(activeSleep.starttime) } : analyticsActive,
  [activeSleep, currentBabyId, analyticsActive]);
  // Shared with History's daily planner, so both show the same forecast.
  const { nextSleep, dayForecast, upcomingForecast } = useSleepForecasts({
    sessions: analyticsSessions, active: analyticsActive, waveActive, now, birthDate: currentBaby?.birth_date,
  });


  const nextFeedSide = useMemo(
    () => computeNextFeedSide(analyticsFeeds),
    [analyticsFeeds]
  );

  async function loadSleepData() {
    if (!currentBabyId) {
      setActiveSleep(null);
      setLastSleep(null);
      setRecentSleeps([]);
      return;
    }

    const [
      active,
      last,
      recent,
    ] =
      await Promise.all([
        getActiveSleep(
          currentBabyId
        ),

        getLastCompletedSleep(
          currentBabyId
        ),

        getRecentSleeps(
          currentBabyId,
          5
        ),
      ]);

    setActiveSleep(active);
    setLastSleep(last);
    setRecentSleeps(recent);
  }

  async function loadFeedData() {
    if (!currentBabyId) {
      setLastFeed(null);
      setRecentFeeds([]);
      return;
    }

    const [
      last,
      recent,
    ] =
      await Promise.all([
        getLastFeed(
          currentBabyId
        ),

        getRecentFeeds(
          currentBabyId,
          10
        ),
      ]);

    setLastFeed(last);
    setRecentFeeds(recent);
  }

  async function loadAllData() {
    await Promise.all([
      loadSleepData(),
      loadFeedData(),
    ]);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);

      try {
        await loadAllData();
      } catch (error) {
        console.error(
          "Failed loading Sleepy:",
          error
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();

    const unsubscribeSleep =
      currentBabyId
        ? subscribeToSleepChanges(
          currentBabyId,
          loadSleepData
        )
        : () => { };

    const unsubscribeFeed =
      currentBabyId
        ? subscribeToFeedChanges(
          currentBabyId,
          loadFeedData
        )
        : () => { };

    return () => {
      mounted = false;
      unsubscribeSleep();
      unsubscribeFeed();
    };
  }, [currentBabyId]);

  // Mobile/PWA browsers commonly suspend JS execution and silently drop the
  // realtime WebSocket connection while the app is backgrounded (screen
  // locked, app-switched away from, etc.). Supabase Realtime does not replay
  // postgres_changes events that happened while disconnected, so without
  // this, reopening the app could keep showing a stale "active sleep" (e.g.
  // one that was actually stopped, or started, on another device in the
  // meantime) until some unrelated event happened to trigger a refetch.
  // Refetch straight from the database whenever the page becomes visible
  // again, regardless of what the realtime channel did.
  //
  // loadAllData/loadSleepData/loadFeedData are plain functions (not
  // memoized) closing over currentBabyId, so they're intentionally omitted
  // here - re-running only when currentBabyId itself changes still picks up
  // a correct, current closure (same pattern as the mount effect above).
  useEffect(() => {
    function refetchIfVisible() {
      if (document.visibilityState === "visible") {
        void loadAllData();
      }
    }

    document.addEventListener("visibilitychange", refetchIfVisible);
    window.addEventListener("focus", refetchIfVisible);

    return () => {
      document.removeEventListener("visibilitychange", refetchIfVisible);
      window.removeEventListener("focus", refetchIfVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBabyId]);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const interval = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("resume", update);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", update); document.removeEventListener("resume", update); };
  }, []);

  const completedSleep = lastSleep?.baby_id === currentBabyId ? lastSleep : null;
  const completedSleepEnd = completedSleep?.endtime;

  // The live timer (sleeping for / awake for), shown in Sleep Wave on the
  // premium skin and above it on Alive/Retro. Same clock and rule for both.
  const liveDuration = activeSleep || lastSleep?.endtime
    ? formatHomeDuration(Math.floor(Math.max(0, now - Date.parse(activeSleep?.starttime ?? lastSleep!.endtime!)) / 60000), lang)
    : null;
  const [sleepActionError, setSleepActionError] = useState<string | null>(null);
  const historyRevision = useSyncExternalStore(subscribeSleepEstimateHistory, sleepEstimateHistoryRevision, sleepEstimateHistoryRevision);
  const [wakeEstimate, setWakeEstimate] = useState<{ sleep: SleepRecord; presentation: SleepEstimatePresentation } | null>(null);
  useEffect(() => {
    if (!activeSleep || activeSleep.baby_id !== currentBabyId) return;
    let current = true;
    void getActiveSleepEstimate(activeSleep).then(presentation => {
      if (current) setWakeEstimate({ sleep: activeSleep, presentation });
    });
    return () => { current = false; };
  }, [activeSleep, currentBabyId, historyRevision]);

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

  return (
    <>
      <main className="home-page">
        {isPremium ? <header className="home-header home-header--premium">
          <p className="home-brand">
            <svg className="home-brand-moon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
              <path d="M21.5 4.2A12.5 12.5 0 1 0 27.8 22 10 10 0 0 1 21.5 4.2Z" />
            </svg>
            {t("common.appName")}
          </p>
          <Link className="home-baby-pill" to="/settings" aria-label={t("home.changeBaby", { name: currentBaby?.name ?? t("common.appName") })}>
            <span className="home-baby-initial" aria-hidden="true">{(currentBaby?.name ?? t("common.appName")).trim().charAt(0).toUpperCase()}</span>
            <h1>{currentBaby?.name ?? t("common.appName")}</h1>
            <svg className="home-baby-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" /></svg>
          </Link>
        </header> : <header className="home-header">
          <div>
            <p className="eyebrow">
              {t("common.appName")}
            </p>

            <h1>
              {currentBaby?.name ?? t("common.appName")}
            </h1>
          </div>

          <div className="status-pill">
            {loading
              ? t("common.loading")
              : activeSleep
                ? t("common.sleeping")
                : t("common.awake")}
          </div>
        </header>}

        <div className="home-quick-actions">
          <SleepPrimaryAction key={`${currentBabyId}:${activeSleep?.id ?? "awake"}:${activeSleep?.starttime ?? lastSleep?.endtime ?? ""}`} ending={Boolean(activeSleep)}
            after={activeSleep ? Date.parse(activeSleep.starttime) : lastSleep?.endtime ? Date.parse(lastSleep.endtime) : null}
            babyName={currentBaby?.name ?? t("common.appName")} disabled={loading || saving || !currentBabyId || Boolean(activeSleep && activeSleep.baby_id !== currentBabyId)}
            saving={saving} awakeActions={<>
              <button type="button" className="secondary-button" disabled={loading || !currentBabyId} onClick={() => openDiaper()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v6c0 4-4 7-9 8-5-1-9-4-9-8zm0 4c4 0 7 3 7 9m11-9c-4 0-7 3-7 9M3 8h5m8 0h5" /></svg>
                {t("diaper.label")}
              </button>
              <button type="button" className="secondary-button" disabled={loading || !currentBabyId} onClick={() => setFeedModalOpen(true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7V5a2 2 0 0 1 4 0v2m-6 0h8v4H8zM9 11h6l2 3v6H7v-6zm1 4h2m-2 3h2" /></svg>
                {t("diaper.feed")}
              </button>
            </>} onCommit={handleSleep} />
          {sleepActionError && <p role="alert">{sleepActionError}</p>}
          {diaperSaved && <p role="status">{t("diaper.saved")}</p>}
        </div>

        <section hidden={isPremium && !activeSleep} className="sleep-card home-live-state" aria-label={t(activeSleep ? "common.sleeping" : "common.awake")}>
          {isRetro && (
            <div className="baby-sprite-panel">
              <BabySprite asleep={Boolean(activeSleep)} />
            </div>
          )}

          {/* Premium: the live timer lives in Sleep Wave (one sleep surface). */}
          {!isPremium && <>
          <p className="sleep-label">
            {activeSleep
              ? t("home.sleepingFor")
              : t("home.awakeFor")}
          </p>

          <div className="sleep-timer">
            {loading ? t("common.loading") : liveDuration ?? t("common.notRegistered")}
          </div>

          <p className="sleep-subtitle">
            {activeSleep
              ? <button className="home-edit" onClick={() => setEditingSleep(activeSleep)}>{t("home.startedAt", { time: formatClock(new Date(activeSleep.starttime).getTime(), lang) })} <span aria-hidden="true">&#9998;</span></button>
              : lastSleep?.endtime
                ? t("home.wokeUpAt", { time: formatClock(new Date(lastSleep.endtime).getTime(), lang) })
                : t("home.readyForNextNap")}
          </p>
          </>}

          {activeSleep && <div className="home-sleep-insight">
            {activeSleep && activeSleep.baby_id === currentBabyId && wakeEstimate?.sleep === activeSleep &&
              <ActiveSleepEstimate presentation={wakeEstimate.presentation} sleepStartedAt={activeSleep.starttime} now={now} />}
          </div>}
        </section>

        <SleepWaveCard key={currentBabyId} sessions={analyticsSessions} active={waveActive}
          prediction={nextSleep} forecast={dayForecast} upcoming={upcomingForecast}
          now={now} babyName={currentBaby?.name}
          onEditStart={() => setEditingSleep(activeSleep)} live={isPremium && !loading ? { sleeping: Boolean(activeSleep), duration: liveDuration,
            caption: activeSleep ? t("home.startedAt", { time: formatClock(new Date(activeSleep.starttime).getTime(), lang) }) : null } : null} />

        <SoundMonitorPanel sleep={activeSleep} />

        <section className="home-today" aria-labelledby="home-today-title">
        <h2 className="card-label" id="home-today-title">{t("common.today")}</h2>
          <div className="today-stats">
            <Link className="today-sleep" to="/history?today=sleep">
              <strong>{formatHomeDuration(todayStats.totalMinutes, lang)}</strong>
              <span>{t("common.sleep")} {"·"} {todayStats.sessionCount} {t(todayStats.sessionCount === 1 ? "todayActivity.session" : "todayActivity.sessions")}</span>
            </Link>
            <Link to="/history?today=feed"><span>{feedCount ?? "—"} {t(feedCount === 1 ? "todayActivity.feed" : "todayActivity.feeds")}</span></Link>
            <Link to="/history?today=diaper"><span>{diaperCount ?? "—"} {t(diaperCount === 1 ? "todayActivity.diaper" : "todayActivity.diapers")}</span></Link>
          </div>

        </section>

        <section className="feed-card" aria-labelledby="home-last-slept">
          <div>
            <p className="card-label" id="home-last-slept">{t("home.lastSlept")}</p>

            {completedSleep && completedSleepEnd ? (
              <>
                <h2><button type="button" className="home-edit" aria-label={t("sleep.editTitle")} onClick={() => setEditingSleep(completedSleep)}>{relativeTime(completedSleepEnd)} <span aria-hidden="true">&#9998;</span></button></h2>
                <p className="muted">{t("home.sleptDuration", {
                  duration: formatDuration(
                    completedSleep.durationminutes ?? (Date.parse(completedSleepEnd) - Date.parse(completedSleep.starttime)) / 60000,
                    lang,
                  ),
                })}</p>
                <p className="muted">{formatSleepRange(Date.parse(completedSleep.starttime), Date.parse(completedSleepEnd), now, lang)}</p>
              </>
            ) : (
              <h2>{loading ? t("common.loading") : t("home.noCompletedSleep")}</h2>
            )}
          </div>

          <button type="button" className="secondary-button" onClick={() => setSleepModalOpen(true)}>
            {t("common.register")}
          </button>
        </section>

        <section className="feed-card">
          <div>
            <p className="card-label">
              {t("home.lastFed")}
            </p>

            <h2>
              {lastFeed
                ? relativeTime(
                  lastFeed.starttime
                )
                : t("common.notRegistered")}
            </h2>

            <p className="muted">
              {lastFeed
                ? feedDescription(
                  lastFeed
                )
                : t("home.noFeedingYet")}
            </p>

            {nextFeedSide && (
              <p className="muted">
                {t("home.nextFeedSide", {
                  side: (sideLabel(nextFeedSide, lang) ?? "").toLowerCase(),
                })}
              </p>
            )}
          </div>

          <button
            className="secondary-button"
            onClick={() =>
              setFeedModalOpen(
                true
              )
            }
          >
            {t("common.register")}
          </button>
        </section>

        <section className="feed-card" aria-labelledby="home-last-diaper">
          <div>
            <p className="card-label" id="home-last-diaper">{t("home.lastDiaper")}</p>
            {lastDiaper ? <>
              <h2><button type="button" className="home-edit" aria-label={t("diaper.edit")} onClick={() => openDiaper(lastDiaper)}>
                {relativeTime(lastDiaper.changed_at)} <span aria-hidden="true">&#9998;</span>
              </button></h2>
              <p className="muted">
                {t(lastDiaper.type === "both" ? "diaper.historyBoth" : `diaper.${lastDiaper.type}`)}
                {" · "}{formatClock(Date.parse(lastDiaper.changed_at), lang)}
              </p>
            </> : <>
              <h2>{t("common.notRegistered")}</h2>
              <p className="muted">{t("home.noDiaperYet")}</p>
            </>}
          </div>
          <button type="button" className="secondary-button" disabled={!currentBabyId} onClick={() => openDiaper()}>
            {t("common.register")}
          </button>
        </section>

        <section className="family-message-card">
          <div>
            <p className="card-label">{t("familyMessage.eyebrow")}</p>
            <h2>{t("familyMessage.title")}</h2>
            <p className="muted">{t("familyMessage.description")}</p>
          </div>

          <button
            type="button"
            className="secondary-button"
            disabled={!currentBabyId || !currentBaby}
            onClick={() => setFamilyMessageOpen(true)}
          >
            {t("familyMessage.send")}
          </button>
        </section>

        <section className="recent-section">
          <div className="section-heading">
            <div>
              <p className="card-label">
                {t("common.recent")}
              </p>

              <h2>{t("common.sleep")}</h2>
            </div>
          </div>

          {recentSleeps.length ===
            0 ? (
            <div className="empty-card">
              <div className="moon-icon">
                ☾
              </div>

              <p>
                {t("home.noSleepYet")}
              </p>
            </div>
          ) : (
            <div className="sleep-list">
              {recentSleeps.map(sleep => (
                <button type="button" className="sleep-list-item home-recent-sleep"
                  key={sleep.id} onClick={() => setEditingSleep(sleep)}>
                  <span>
                    <span className="sr-only">{t("sleep.editTitle")} </span>
                    <strong>
                      {formatClock(Date.parse(sleep.starttime), lang)}
                      {" \u2013 "}
                      {sleep.endtime ? formatClock(Date.parse(sleep.endtime), lang) : t("common.sleeping")}
                    </strong>
                    {sleep.durationminutes != null && <span className="muted">{formatDuration(sleep.durationminutes, lang)}</span>}
                  </span>
                  <span className="sleep-list-icon" aria-hidden="true">&#9998;</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="recent-section">
          <div className="section-heading">
            <div>
              <p className="card-label">
                {t("common.recent")}
              </p>

              <h2>{t("common.feeding")}</h2>
            </div>

            {recentFeeds.length >
              3 && (
                <button
                  className="text-button"
                  onClick={() =>
                    setShowAllFeeds(
                      (value) =>
                        !value
                    )
                  }
                >
                  {showAllFeeds
                    ? t("common.showLess")
                    : t("common.viewAll")}
                </button>
              )}
          </div>

          <FeedHistory
            feeds={
              showAllFeeds
                ? recentFeeds
                : recentFeeds.slice(
                  0,
                  3
                )
            }
            onChanged={
              loadFeedData
            }
          />
        </section>
      </main>

      {(sleepModalOpen || (editingSleep && editingSleep.baby_id === currentBabyId)) && (
        <SleepModal sleep={editingSleep} onClose={() => { setSleepModalOpen(false); setEditingSleep(null); }} onSaved={loadSleepData} />
      )}

      {diaperBabyId && diaperBabyId === currentBabyId && <DiaperModal babyId={diaperBabyId} change={editingDiaper ?? undefined}
        onClose={() => setDiaperBabyId(null)} onSaved={() => { setDiaperBabyId(null); setDiaperSaved(true); }} />}

      {feedModalOpen && (
        <FeedModal
          onClose={() =>
            setFeedModalOpen(
              false
            )
          }
          onSaved={
            loadFeedData
          }
        />
      )}

      {familyMessageOpen && currentBabyId && currentBaby && (
        <FamilyMessageModal
          babyId={currentBabyId}
          babyName={currentBaby.name}
          onClose={() => setFamilyMessageOpen(false)}
        />
      )}
    </>
  );
}
