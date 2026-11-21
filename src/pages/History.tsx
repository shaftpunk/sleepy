import DiaperModal from "../components/DiaperModal";
import { deleteDiaperChange, getRecentDiaperChanges, type DiaperChange } from "../services/diaperService";
import { useSearchParams } from "react-router-dom";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

import {
  useAppStore,
} from "../stores/appStore";

import {
  deleteSleep,
  getAllSleeps,
  getRecentSleeps,
  resumeSleep,
  type SleepRecord,
} from "../services/sleepService";

import {
  deleteFeed,
  getRecentFeeds,
  type FeedRecord,
} from "../services/feedService";

import {
  subscribeToSleepChanges,
} from "../services/sleepRealtime";

import {
  subscribeToFeedChanges,
} from "../services/feedRealtime";

import SleepModal
  from "../components/SleepModal";

import SleepSplitModal
  from "../components/SleepSplitModal";

import FeedModal
  from "../components/FeedModal";

import SleepClock
  from "../components/history/SleepClock";

import DailySleepPlanner from "../components/history/DailySleepPlanner";
import SleepHistoryItem from "../components/history/SleepHistoryItem";
import { useAnalyticsData } from "../hooks/useAnalyticsData";
import { useSleepForecasts } from "../hooks/useSleepForecasts";
import { ROLLING_DAY_MS, sleepDayLabel, sleepsInLast24Hours } from "../lib/recentSleeps";
import { feedTypeLabel, formatClock, formatDuration, sideLabel } from "../lib/format";
import { LOCALES, useTranslation } from "../i18n";


export default function History() {
  const [params] = useSearchParams();
  const today = params.get("today");
  useEffect(() => {
    if (today) document.getElementById("history-sessions")?.scrollIntoView();
  }, [today]);
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

  const currentBaby =
    babies.find(
      (baby) =>
        baby.id === currentBabyId
    ) ?? null;

  const {
    sessions,
    active,
  } = useAnalyticsData(currentBabyId);

  const [now, setNow] = useState(() => Date.now());
  const [moreOpen, setMoreOpen] = useState(false);
  const last24Id = useId(), moreId = useId();
  // The same forecast Sleep Wave shows on Home (shared hook, same inputs).
  const { nextSleep, dayForecast, upcomingForecast } = useSleepForecasts({
    sessions, active, now, birthDate: currentBaby?.birth_date,
  });
  const [copyingSleep, setCopyingSleep] = useState(false);
  const [resumingSleepId, setResumingSleepId] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  // Keep the planner current: a regular tick (covers the minute and the
  // local day change) plus an immediate update when the app resumes.
  useEffect(() => {
    const update = () => setNow(Date.now());
    const interval = window.setInterval(update, 15000);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("resume", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("resume", update);
    };
  }, []);

  function formatDate(date: string) {
    return new Intl.DateTimeFormat(LOCALES[lang], {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }).format(new Date(date));
  }

  function feedLabel(feed: FeedRecord) {
    const typeLabel = feedTypeLabel(feed.feedtype, lang);

    if (feed.feedtype === "bottle") {
      return `${typeLabel}${feed.amountml !== null ? ` · ${feed.amountml} ml` : ""}`;
    }

    if (feed.feedtype === "breast") {
      const side = sideLabel(feed.side, lang);
      return `${typeLabel}${side ? ` · ${side}` : ""}`;
    }

    return typeLabel;
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Clipboard unavailable");
    }
  }

  async function handleCopySleepJson() {
    if (!currentBabyId || !currentBaby) return;

    try {
      setCopyingSleep(true);
      setCopyMessage(null);
      const allSleeps = await getAllSleeps(currentBabyId);
      const payload = {
        format: "sleepy-sleep-export",
        version: 1,
        exported_at: new Date().toISOString(),
        baby: {
          id: currentBaby.id,
          name: currentBaby.name,
          birth_date: currentBaby.birth_date,
        },
        sessions: allSleeps.map((sleep) => ({
          id: sleep.id,
          baby_id: sleep.baby_id,
          starttime: sleep.starttime,
          endtime: sleep.endtime,
          durationminutes: sleep.durationminutes,
          sleep_type: sleep.sleep_type,
          rate: sleep.rate,
          note: sleep.note ?? null,
          created_at: sleep.created_at ?? null,
          updated_at: sleep.updated_at ?? null,
        })),
      };

      await copyText(JSON.stringify(payload, null, 2));
      setCopyMessage(t("history.copyJsonSuccess", { count: allSleeps.length }));
    } catch (error) {
      console.error("Could not copy sleep history:", error);
      setCopyMessage(t("history.copyJsonError"));
    } finally {
      setCopyingSleep(false);
    }
  }

  async function handleResumeSleep(sleep: SleepRecord) {
    if (resumingSleepId) return;

    if (
      !window.confirm(
        t("history.confirmResumeSleep")
      )
    ) {
      return;
    }

    try {
      setResumingSleepId(sleep.id);
      setResumeMessage(null);

      await resumeSleep(sleep);
      await load();

      setResumeMessage(t("history.resumeSleepSuccess"));
    } catch (error) {
      console.error("Could not resume sleep:", error);
      setResumeMessage(
        error instanceof Error
          ? error.message
          : t("errors.couldNotResumeSleep")
      );
    } finally {
      setResumingSleepId(null);
    }
  }


  const [
    sleeps,
    setSleeps,
  ] = useState<
    SleepRecord[]
  >([]);

  const [
    feeds,
    setFeeds,
  ] = useState<
    FeedRecord[]
  >([]);


  const [
    editingSleep,
    setEditingSleep,
  ] =
    useState<
      SleepRecord | null
    >(null);


  const [
    splittingSleep,
    setSplittingSleep,
  ] =
    useState<
      SleepRecord | null
    >(null);


  const [
    editingFeed,
    setEditingFeed,
  ] =
    useState<
      FeedRecord | null
    >(null);


  const [
    newSleep,
    setNewSleep,
  ] =
    useState(false);


  const [
    newFeed,
    setNewFeed,
  ] =
    useState(false);


  const load =
    useCallback(
      async () => {
        if (!currentBabyId) {
          setSleeps([]);
          setFeeds([]);
          return;
        }

        try {
          const [
            sleepData,
            feedData,
          ] =
            await Promise.all([
              getRecentSleeps(
                currentBabyId,
                100
              ),

              getRecentFeeds(
                currentBabyId,
                100
              ),
            ]);

          setSleeps(
            sleepData
          );

          setFeeds(
            feedData
          );
        } catch (error) {
          console.error(
            "Could not load history:",
            error
          );
        }
      },
      [currentBabyId, setSleeps, setFeeds]
    );


  useEffect(() => {
    if (!currentBabyId) {
      // Reset history when the selected baby is cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSleeps([]);
      setFeeds([]);
      return;
    }

    void load();

    const offSleep =
      subscribeToSleepChanges(
        currentBabyId,
        () => {
          void load();
        }
      );

    const offFeed =
      subscribeToFeedChanges(
        currentBabyId,
        () => {
          void load();
        }
      );

    return () => {
      offSleep();
      offFeed();
    };

  }, [
    currentBabyId,
    load,
  ]);


  const [diapers, setDiapers] = useState<DiaperChange[]>([]);
  const [editingDiaper, setEditingDiaper] = useState<DiaperChange | null>(null);
  const [diaperRevision, refreshDiapers] = useState(0);
  const [diaperDeleteError, setDiaperDeleteError] = useState(false);
  useEffect(() => {
    if (!currentBabyId) return;
    let cancelled = false;
    void getRecentDiaperChanges(currentBabyId, 100).then(rows => {
      if (!cancelled) setDiapers(rows);
    }).catch(error => console.error("Could not load diaper changes", error));
    return () => { cancelled = true; };
  }, [currentBabyId, diaperRevision]);

  const recentSleeps = useMemo(() => sleepsInLast24Hours(sleeps, now), [sleeps, now]);
  const olderSleeps = useMemo(() => {
    const recent = new Set(recentSleeps.map((sleep) => sleep.id));
    return sleeps.filter((sleep) => !recent.has(sleep.id));
  }, [sleeps, recentSleeps]);
  const sleepById = useMemo(() => new Map(sleeps.map((sleep) => [sleep.id, sleep])), [sleeps]);
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const visibleSleeps = today ? sleeps.filter(sleep => !sleep.deleted_at && sleep.endtime &&
    Date.parse(sleep.starttime) <= now && (today === "sessions" ? Date.parse(sleep.starttime) >= midnight :
      Date.parse(sleep.endtime) > midnight)) : recentSleeps;
  const editableIds = useMemo(() => new Set(sleepById.keys()), [sleepById]);
  const newestSleepId = sleeps[0]?.id ?? null;

  async function handleDeleteSleep(sleep: SleepRecord) {
    if (!window.confirm(t("common.confirmDeleteSleep"))) return;
    await deleteSleep(sleep.id);
    await load();
  }

  function renderSleep(sleep: SleepRecord, dateLabel: string) {
    return (
      <SleepHistoryItem
        key={sleep.id}
        sleep={sleep}
        dateLabel={dateLabel}
        canResume={!active && sleep.id === newestSleepId}
        resuming={resumingSleepId === sleep.id}
        onEdit={setEditingSleep}
        onResume={(target) => void handleResumeSleep(target)}
        onSplit={setSplittingSleep}
        onDelete={(target) => void handleDeleteSleep(target)}
      />
    );
  }

  function renderFeed(feed: FeedRecord) {
    return (
      <div className="history-item" key={feed.id}>
        <div className="history-icon" aria-hidden="true">
          {feed.feedtype === "bottle" ? "🍼" : feed.feedtype === "food" ? "🥣" : "♡"}
        </div>
        <button type="button" className="history-content clickable" onClick={() => setEditingFeed(feed)}>
          <strong>{feedLabel(feed)}</strong>
          <span>{formatDate(feed.starttime)} {"·"} {formatClock(Date.parse(feed.starttime), lang)}</span>
          {feed.note && <span className="history-note">{feed.note}</span>}
        </button>
        <button type="button" className="history-delete" aria-label={t("common.deleteFeedingAria")} onClick={async () => {
          if (!window.confirm(t("common.confirmDeleteFeed"))) return;
          await deleteFeed(feed.id);
          await load();
        }}>&times;</button>
      </div>
    );
  }

  function renderDiaper(change: DiaperChange) {
    return <div className="history-item" key={change.id} data-diaper-change={change.id}>
      <div className="history-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 6h18v6c0 4-4 7-9 8-5-1-9-4-9-8zm0 4c4 0 7 3 7 9m11-9c-4 0-7 3-7 9M3 8h5m8 0h5" />
        </svg>
      </div>
      <button type="button" className="history-content clickable" onClick={() => setEditingDiaper(change)}>
        <strong>{t(change.type === "both" ? "diaper.historyBoth" : `diaper.${change.type}`)}</strong>
        <span>{formatDate(change.changed_at)} {"·"} {formatClock(Date.parse(change.changed_at), lang)}</span>
      </button>
      <button type="button" className="history-delete" aria-label={t("diaper.delete")} onClick={async () => {
        if (!window.confirm(t("diaper.delete"))) return;
        setDiaperDeleteError(false);
        try {
          await deleteDiaperChange(change.id, change.baby_id);
          refreshDiapers(value => value + 1);
        } catch {
          setDiaperDeleteError(true);
        }
      }}>&times;</button>
    </div>;
  }

  const start = today ? midnight : now - ROLLING_DAY_MS;
  const byTime = (a: { time: number }, b: { time: number }) => b.time - a.time;
  const careActivities = [
    ...feeds.filter(feed => feed.baby_id === currentBabyId).map(feed => ({
      time: Date.parse(feed.starttime), node: renderFeed(feed),
    })),
    ...diapers.filter(change => change.baby_id === currentBabyId).map(change => ({
      time: Date.parse(change.changed_at), node: renderDiaper(change),
    })),
  ];
  const recentActivities = [
    ...(active && !today ? [{ time: active.startMs, node: (
              <div key="active-sleep" className="history-item is-active" data-history-active="true">
                <div className="history-icon">☾</div>
                <div className="history-content">
                  <strong>{formatClock(active.startMs, lang)} – <em className="history-live">{t("history.planSleepingNow")}</em></strong>
                  <span>{sleepDayLabel(active.startMs, null, now, lang)} · {formatDuration((now - active.startMs) / 60000, lang)}</span>
                </div>
              </div>
    ) }] : []),
    ...visibleSleeps.map(sleep => ({
      time: Date.parse(sleep.starttime),
      node: renderSleep(sleep, sleepDayLabel(Date.parse(sleep.starttime), sleep.endtime ? Date.parse(sleep.endtime) : null, now, lang)),
    })),
    ...careActivities.filter(event => event.time >= start && event.time <= now),
  ].sort(byTime);
  const olderActivities = careActivities.filter(event => event.time < start || event.time > now).sort(byTime);

  return (
    <>
      <main className="history-page">

        <header className="page-header">
          <p className="eyebrow">
            {currentBaby?.name ??
              t("common.appName")}
          </p>

          <h1>
            {t("history.pageTitle")}
          </h1>

          <p className="page-description">
            {t("history.pageDescription")}
          </p>
        </header>

        {/* A. Today's sleep plan: the same forecast as Sleep Wave on Home. */}
        {currentBabyId && (
          <DailySleepPlanner
            sessions={sessions}
            active={active}
            prediction={nextSleep}
            forecast={dayForecast}
            upcoming={upcomingForecast}
            now={now}
            editableIds={editableIds}
            onSelectSession={(id) => setEditingSleep(sleepById.get(id) ?? null)}
            resetKey={currentBabyId}
          />
        )}

        {/* B. Rolling last 24 hours (not the calendar day). */}
        <section id="history-sessions" className="history-section history-last-24" aria-labelledby={last24Id}>
          <div className="section-heading">
            <h2 id={last24Id}>{today ? t("common.today") : t("history.last24Title")}</h2>
            <button className="secondary-button" disabled={!currentBabyId} onClick={() => setNewSleep(true)}>
              {t("common.addShort")}
            </button>
          </div>

          {resumeMessage && (
            <p className="history-copy-message" role="status">{resumeMessage}</p>
          )}

          <div className="history-list">
            {recentActivities.map(event => event.node)}
            {(!active || today) && recentActivities.length === 0 && (
              <p className="muted">{t(today ? "diaper.emptyToday" : "diaper.emptyRecent")}</p>
            )}
          </div>
        </section>

        {/* C. Older history: the existing browsing experience, collapsed by default. */}
        <button
          type="button"
          className="secondary-button history-more-toggle"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((open) => !open)}
        >
          {moreOpen ? t("history.lessHistory") : t("history.moreHistory")}
        </button>

        <div id={moreId} hidden={!moreOpen} className="history-more">
          {currentBabyId && moreOpen && (
            <section className="analysis-card">
              <div className="analysis-card-heading">
                <div>
                  <p className="card-label">{t("common.sleep")}</p>
                  <h2>{t("history.sleepClockTitle")}</h2>
                </div>
              </div>

              <p className="muted">{t("history.sleepClockDescription")}</p>

              <SleepClock sessions={sessions} active={active} now={now} />
            </section>
          )}

          <section className="history-section">

            <div className="section-heading">
              <h2>
                {t("history.olderSleep")}
              </h2>

              <div className="history-heading-actions">
                <button
                  type="button"
                  className="secondary-button history-copy-button"
                  disabled={!currentBabyId || copyingSleep}
                  onClick={() => void handleCopySleepJson()}
                  title={t("history.copyJsonDescription")}
                >
                  <span aria-hidden="true">⧉</span>
                  {copyingSleep ? t("history.copyingJson") : t("history.copyJson")}
                </button>
              </div>
            </div>

            {copyMessage && (
              <p className="history-copy-message" role="status">{copyMessage}</p>
            )}

            <div className="history-list">
              {olderSleeps.map((sleep) => renderSleep(sleep, formatDate(sleep.starttime)))}
            </div>

          </section>

          <section className="history-section">

            <div className="section-heading">
              <h2>
                {t("diaper.older")}
              </h2>

              <button
                className="secondary-button"
                disabled={!currentBabyId}
                onClick={() =>
                  setNewFeed(true)
                }
              >
                {t("common.addShort")}
              </button>
            </div>


            <div className="history-list">

              {olderActivities.map(event => event.node)}

            </div>

          </section>

        </div>

      </main>


      {diaperDeleteError && <p role="alert">{t("diaper.error")}</p>}
      {editingDiaper && editingDiaper.baby_id === currentBabyId && <DiaperModal babyId={editingDiaper.baby_id} change={editingDiaper}
        onClose={() => setEditingDiaper(null)} onSaved={() => { setEditingDiaper(null); refreshDiapers(value => value + 1); }} />}

      {(newSleep ||
        editingSleep) && (

        <SleepModal
          sleep={editingSleep}
          onClose={() => {
            setNewSleep(
              false
            );

            setEditingSleep(
              null
            );
          }}
          onSaved={load}
        />

      )}


      {splittingSleep && (

        <SleepSplitModal
          sleep={splittingSleep}
          onClose={() =>
            setSplittingSleep(
              null
            )
          }
          onSaved={load}
        />

      )}


      {(newFeed ||
        editingFeed) && (

        <FeedModal
          feed={editingFeed}
          onClose={() => {
            setNewFeed(false);
            setEditingFeed(null);
          }}
          onSaved={load}
        />

      )}

    </>
  );
}
