import {
    useEffect,
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
  
  function formatTime(
    dateString: string
  ) {
    return new Intl.DateTimeFormat(
      "nb-NO",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    ).format(
      new Date(dateString)
    );
  }
  
  function formatMinutes(
    minutes: number | null
  ) {
    if (minutes === null) {
      return "";
    }
  
    const h =
      Math.floor(minutes / 60);
  
    const m =
      minutes % 60;
  
    if (!h) {
      return `${m} min`;
    }
  
    if (!m) {
      return `${h} t`;
    }
  
    return `${h} t ${m} min`;
  }
  
  function relativeTime(
    dateString: string
  ) {
    const minutes =
      Math.max(
        0,
        Math.floor(
          (
            Date.now() -
            new Date(
              dateString
            ).getTime()
          ) / 60000
        )
      );
  
    if (minutes < 1) {
      return "Just now";
    }
  
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
  
    const h =
      Math.floor(minutes / 60);
  
    const m =
      minutes % 60;
  
    if (!m) {
      return `${h}h ago`;
    }
  
    return `${h}h ${m}m ago`;
  }
  
  function feedDescription(
    feed: FeedRecord
  ) {
    if (
      feed.feedtype ===
      "bottle"
    ) {
      return feed.amountml !== null
        ? `Bottle · ${feed.amountml} ml`
        : "Bottle";
    }
  
    if (
      feed.feedtype ===
      "breast"
    ) {
      if (feed.side === "left") {
        return "Breast · Left";
      }
  
      if (feed.side === "right") {
        return "Breast · Right";
      }
  
      if (feed.side === "both") {
        return "Breast · Both";
      }
  
      return "Breast";
    }
  
    return "Food";
  }
  
  export default function Home() {
    const currentBbyId =
      useAppStore(
        (state) =>
          state.currentBbyId
      );
  
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
      clockTick,
      setClockTick,
    ] =
      useState(0);
  
    async function loadSleepData() {
      const [
        active,
        last,
        recent,
      ] =
        await Promise.all([
          getActiveSleep(
            currentBbyId
          ),
  
          getLastCompletedSleep(
            currentBbyId
          ),
  
          getRecentSleeps(
            currentBbyId,
            5
          ),
        ]);
  
      setActiveSleep(active);
      setLastSleep(last);
      setRecentSleeps(recent);
    }
  
    async function loadFeedData() {
      const [
        last,
        recent,
      ] =
        await Promise.all([
          getLastFeed(
            currentBbyId
          ),
  
          getRecentFeeds(
            currentBbyId,
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
        subscribeToSleepChanges(
          currentBbyId,
          loadSleepData
        );
  
      const unsubscribeFeed =
        subscribeToFeedChanges(
          currentBbyId,
          loadFeedData
        );
  
      return () => {
        mounted = false;
        unsubscribeSleep();
        unsubscribeFeed();
      };
    }, [currentBbyId]);
  
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
            setClockTick(
              (value) =>
                value + 1
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
          await startSleep(
            currentBbyId
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
  
    void clockTick;
  
    return (
      <>
        <main className="home-page">
          <header className="home-header">
            <div>
              <p className="eyebrow">
                Sleepy
              </p>
  
              <h1>
                {currentBbyId}
              </h1>
            </div>
  
            <div className="status-pill">
              {loading
                ? "Loading..."
                : activeSleep
                  ? "Sleeping"
                  : "Awake"}
            </div>
          </header>
  
          <section className="sleep-card">
            <p className="sleep-label">
              {activeSleep
                ? "Sleeping for"
                : "Awake for"}
            </p>
  
            <div className="sleep-timer">
              {timer}
            </div>
  
            <p className="sleep-subtitle">
              {activeSleep
                ? `Started ${formatTime(
                    activeSleep.starttime
                  )}`
                : lastSleep?.endtime
                  ? `Woke up ${formatTime(
                      lastSleep.endtime
                    )}`
                  : "Ready for the next nap"}
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
                ? "Saving..."
                : activeSleep
                  ? "Stop sleep"
                  : "Start sleep"}
            </button>
          </section>
  
          <section className="feed-card">
            <div>
              <p className="card-label">
                Last fed
              </p>
  
              <h2>
                {lastFeed
                  ? relativeTime(
                      lastFeed.starttime
                    )
                  : "Not registered"}
              </h2>
  
              <p className="muted">
                {lastFeed
                  ? feedDescription(
                      lastFeed
                    )
                  : "No feeding yet"}
              </p>
            </div>
  
            <button
              className="secondary-button"
              onClick={() =>
                setFeedModalOpen(
                  true
                )
              }
            >
              Register
            </button>
          </section>
  
          <section className="recent-section">
            <div className="section-heading">
              <div>
                <p className="card-label">
                  Recent
                </p>
  
                <h2>Sleep</h2>
              </div>
            </div>
  
            {recentSleeps.length ===
            0 ? (
              <div className="empty-card">
                <div className="moon-icon">
                  ☾
                </div>
  
                <p>
                  No sleep
                  registrations yet.
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
                          {formatTime(
                            sleep.starttime
                          )}
                          {" – "}
                          {sleep.endtime
                            ? formatTime(
                                sleep.endtime
                              )
                            : "Sleeping"}
                        </strong>
  
                        <p className="muted">
                          {formatMinutes(
                            sleep.durationminutes
                          )}
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
                  Recent
                </p>
  
                <h2>Feeding</h2>
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
                    ? "Show less"
                    : "View all"}
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
            bbyid={
              currentBbyId
            }
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