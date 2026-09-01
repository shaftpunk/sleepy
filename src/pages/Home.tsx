import {
  useEffect,
  useMemo,
  useState,
} from "react";

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
import FeedHistory from "../components/FeedHistory";
import SleepStrip from "../components/SleepStrip";

import { useAnalyticsData } from "../hooks/useAnalyticsData";
import { computeNextFeedSide, computeNextSleepHint, computeTodayTotals } from "../analytics/home";
import { computeWakeWindows } from "../analytics/wakeWindows";
import { median } from "../analytics/time";
import { feedTypeLabel, formatClock, formatDuration, sideLabel, stars } from "../lib/format";
import { useTranslation } from "../i18n";

function durationFrom(
  dateString: string
) {
  const seconds = Math.max(
    0,
    Math.floor(
      (
        Date.now() -
        new Date(
          dateString
        ).getTime()
      ) / 1000
    )
  );

  const hours =
    Math.floor(seconds / 3600);

  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );

  const secs =
    seconds % 60;

  return [
    hours
      .toString()
      .padStart(2, "0"),

    minutes
      .toString()
      .padStart(2, "0"),

    secs
      .toString()
      .padStart(2, "0"),
  ].join(":");
}

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

  const [
    timer,
    setTimer,
  ] =
    useState(
      "00:00:00"
    );

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

  const wakeWindowStats = useMemo(() => {
    const windows = computeWakeWindows(analyticsSessions).windows;
    return {
      count: windows.length,
      medianMinutes: windows.length
        ? median(windows.map((w) => w.minutes))
        : null,
    };
  }, [analyticsSessions]);

  const nextSleepHint = useMemo(
    () =>
      computeNextSleepHint({
        lastSessionEndMs: lastSleep?.endtime
          ? new Date(lastSleep.endtime).getTime()
          : null,
        isCurrentlyAsleep: Boolean(activeSleep),
        wakeWindowCount: wakeWindowStats.count,
        medianWakeWindowMinutes: wakeWindowStats.medianMinutes,
        now,
      }),
    [lastSleep, activeSleep, wakeWindowStats, now]
  );

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

  useEffect(() => {
    function update() {
      if (activeSleep) {
        setTimer(
          durationFrom(
            activeSleep.starttime
          )
        );

        return;
      }

      if (lastSleep?.endtime) {
        setTimer(
          durationFrom(
            lastSleep.endtime
          )
        );

        return;
      }

      setTimer(
        "00:00:00"
      );
    }

    update();

    const interval =
      window.setInterval(
        update,
        1000
      );

    return () =>
      window.clearInterval(
        interval
      );
  }, [
    activeSleep,
    lastSleep,
  ]);

  useEffect(() => {
    const interval =
      window.setInterval(
        () => {
          setNow(
            Date.now()
          );
        },
        30000
      );

    return () =>
      window.clearInterval(
        interval
      );
  }, []);

  async function handleSleep() {
    try {
      setSaving(true);

      if (activeSleep) {
        await stopSleep(
          activeSleep.id,
          activeSleep.starttime
        );
      } else {
        if (!currentBabyId) {
          return;
        }

        await startSleep(
          currentBabyId
        );
      }

      await loadSleepData();
    } catch (error) {
      console.error(
        "Sleep action failed:",
        error
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <main className="home-page">
        <header className="home-header">
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
        </header>

        <section className="sleep-card">
          <p className="sleep-label">
            {activeSleep
              ? t("home.sleepingFor")
              : t("home.awakeFor")}
          </p>

          <div className="sleep-timer">
            {timer}
          </div>

          <p className="sleep-subtitle">
            {activeSleep
              ? t("home.startedAt", { time: formatClock(new Date(activeSleep.starttime).getTime(), lang) })
              : lastSleep?.endtime
                ? t("home.wokeUpAt", { time: formatClock(new Date(lastSleep.endtime).getTime(), lang) })
                : t("home.readyForNextNap")}
          </p>

          <button
            className="primary-button"
            onClick={
              handleSleep
            }
            disabled={
              loading ||
              saving
            }
          >
            {saving
              ? t("common.saving")
              : activeSleep
                ? t("home.stopSleep")
                : t("home.startSleep")}
          </button>
        </section>

        {!activeSleep && nextSleepHint && (
          <p className="next-sleep-hint">
            {nextSleepHint.kind === "predicted" &&
              t("home.nextSleepPredicted", { time: formatClock(nextSleepHint.predictedTs, lang) })}

            {nextSleepHint.kind === "about-usual" &&
              t("home.nextSleepAboutUsual")}

            {nextSleepHint.kind === "longer-than-usual" &&
              t("home.nextSleepLonger", { duration: formatDuration(nextSleepHint.overMinutes, lang) })}
          </p>
        )}

        <section className="today-stats">
          <div>
            <span>{t("home.sleepToday")}</span>
            <strong>{formatDuration(todayStats.totalMinutes, lang)}</strong>
          </div>

          <div>
            <span>{t("home.sessions")}</span>
            <strong>{todayStats.sessionCount}</strong>
          </div>

          <div>
            <span>{t("home.avgQuality")}</span>
            <strong>{stars(todayStats.avgRating)}</strong>
          </div>
        </section>

        <SleepStrip
          sessions={analyticsSessions}
          active={analyticsActive}
        />

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
              {recentSleeps.map(
                (sleep) => (
                  <div
                    className="sleep-list-item"
                    key={
                      sleep.id
                    }
                  >
                    <div>
                      <strong>
                        {formatClock(new Date(sleep.starttime).getTime(), lang)}
                        {" – "}
                        {sleep.endtime
                          ? formatClock(new Date(sleep.endtime).getTime(), lang)
                          : t("common.sleeping")}
                      </strong>

                      <p className="muted">
                        {sleep.durationminutes != null
                          ? formatDuration(sleep.durationminutes, lang)
                          : ""}
                      </p>
                    </div>

                    <div className="sleep-list-icon">
                      ☾
                    </div>
                  </div>
                )
              )}
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
    </>
  );
}
