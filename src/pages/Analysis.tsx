import {
    useEffect,
    useMemo,
    useState,
  } from "react";
  
  import {
    getSleepsFromDate,
    type SleepRecord,
  } from "../services/sleepService";
  
  import {
    getFeedsFromDate,
    type FeedRecord,
  } from "../services/feedService";
  
  import {
    subscribeToSleepChanges,
  } from "../services/sleepRealtime";
  
  import {
    subscribeToFeedChanges,
  } from "../services/feedRealtime";
  
  import {
    useAppStore,
  } from "../stores/appStore";
  
  function hoursAndMinutes(
    minutes: number
  ) {
    const hours =
      Math.floor(minutes / 60);
  
    const rest =
      minutes % 60;
  
    if (!hours) {
      return `${rest} min`;
    }
  
    return `${hours}h ${rest}m`;
  }
  
  function dayKey(
    dateString: string
  ) {
    const date =
      new Date(dateString);
  
    return [
      date.getFullYear(),
      String(
        date.getMonth() + 1
      ).padStart(2, "0"),
      String(
        date.getDate()
      ).padStart(2, "0"),
    ].join("-");
  }
  
  function dayName(
    dateString: string
  ) {
    return new Intl.DateTimeFormat(
      "nb-NO",
      {
        weekday: "short",
      }
    ).format(
      new Date(dateString)
    );
  }
  
  export default function Analysis() {
    const currentBbyId =
      useAppStore(
        (state) =>
          state.currentBbyId
      );
  
    const [
      sleeps,
      setSleeps,
    ] =
      useState<
        SleepRecord[]
      >([]);
  
    const [
      feeds,
      setFeeds,
    ] =
      useState<
        FeedRecord[]
      >([]);
  
    const [
      loading,
      setLoading,
    ] =
      useState(true);
  
    async function loadData() {
      const from =
        new Date();
  
      from.setHours(
        0,
        0,
        0,
        0
      );
  
      from.setDate(
        from.getDate() - 6
      );
  
      const [
        sleepData,
        feedData,
      ] =
        await Promise.all([
          getSleepsFromDate(
            currentBbyId,
            from.toISOString()
          ),
  
          getFeedsFromDate(
            currentBbyId,
            from.toISOString()
          ),
        ]);
  
      setSleeps(
        sleepData
      );
  
      setFeeds(
        feedData
      );
    }
  
    useEffect(() => {
      let mounted = true;
  
      async function initialLoad() {
        setLoading(true);
  
        try {
          await loadData();
        } catch (error) {
          console.error(
            "Analysis load failed:",
            error
          );
        } finally {
          if (mounted) {
            setLoading(false);
          }
        }
      }
  
      initialLoad();
  
      const unsubscribeSleep =
        subscribeToSleepChanges(
          currentBbyId,
          loadData
        );
  
      const unsubscribeFeed =
        subscribeToFeedChanges(
          currentBbyId,
          loadData
        );
  
      return () => {
        mounted = false;
        unsubscribeSleep();
        unsubscribeFeed();
      };
    }, [currentBbyId]);
  
    const totalSleep =
      useMemo(
        () =>
          sleeps.reduce(
            (
              total,
              sleep
            ) =>
              total +
              (
                sleep.durationminutes ??
                0
              ),
            0
          ),
        [sleeps]
      );
  
    const averageSleep =
      sleeps.length
        ? Math.round(
            totalSleep /
              sleeps.length
          )
        : 0;
  
    const bottleFeeds =
      feeds.filter(
        (feed) =>
          feed.feedtype ===
          "bottle"
      );
  
    const totalMl =
      bottleFeeds.reduce(
        (
          total,
          feed
        ) =>
          total +
          (
            feed.amountml ??
            0
          ),
        0
      );
  
    const daily =
      useMemo(() => {
        const result: {
          key: string;
          label: string;
          sleep: number;
          feeds: number;
        }[] = [];
  
        for (
          let i = 6;
          i >= 0;
          i--
        ) {
          const date =
            new Date();
  
          date.setDate(
            date.getDate() - i
          );
  
          date.setHours(
            12,
            0,
            0,
            0
          );
  
          result.push({
            key: dayKey(
              date.toISOString()
            ),
            label: dayName(
              date.toISOString()
            ),
            sleep: 0,
            feeds: 0,
          });
        }
  
        sleeps.forEach(
          (sleep) => {
            const day =
              result.find(
                (item) =>
                  item.key ===
                  dayKey(
                    sleep.starttime
                  )
              );
  
            if (day) {
              day.sleep +=
                sleep.durationminutes ??
                0;
            }
          }
        );
  
        feeds.forEach(
          (feed) => {
            const day =
              result.find(
                (item) =>
                  item.key ===
                  dayKey(
                    feed.starttime
                  )
              );
  
            if (day) {
              day.feeds += 1;
            }
          }
        );
  
        return result;
      }, [
        sleeps,
        feeds,
      ]);
  
    const maxSleep =
      Math.max(
        1,
        ...daily.map(
          (day) => day.sleep
        )
      );
  
    return (
      <main className="analysis-page">
        <header className="page-header">
          <p className="eyebrow">
            {currentBbyId}
          </p>
  
          <h1>Analysis</h1>
  
          <p className="page-description">
            Last 7 days
          </p>
        </header>
  
        {loading ? (
          <div className="empty-card">
            Loading...
          </div>
        ) : (
          <>
            <section className="stats-grid">
              <div className="stat-card">
                <span>
                  Total sleep
                </span>
  
                <strong>
                  {hoursAndMinutes(
                    totalSleep
                  )}
                </strong>
  
                <small>
                  Last 7 days
                </small>
              </div>
  
              <div className="stat-card">
                <span>
                  Average sleep
                </span>
  
                <strong>
                  {hoursAndMinutes(
                    averageSleep
                  )}
                </strong>
  
                <small>
                  Per session
                </small>
              </div>
  
              <div className="stat-card">
                <span>
                  Feedings
                </span>
  
                <strong>
                  {feeds.length}
                </strong>
  
                <small>
                  Last 7 days
                </small>
              </div>
  
              <div className="stat-card">
                <span>
                  Bottle
                </span>
  
                <strong>
                  {totalMl} ml
                </strong>
  
                <small>
                  Total volume
                </small>
              </div>
            </section>
  
            <section className="analysis-card">
              <div className="analysis-card-heading">
                <div>
                  <p className="card-label">
                    Trend
                  </p>
  
                  <h2>
                    Daily sleep
                  </h2>
                </div>
              </div>
  
              <div className="bar-chart">
                {daily.map(
                  (day) => (
                    <div
                      className="bar-column"
                      key={
                        day.key
                      }
                    >
                      <div className="bar-track">
                        <div
                          className="bar-value"
                          style={{
                            height:
                              `${
                                Math.max(
                                  4,
                                  (
                                    day.sleep /
                                    maxSleep
                                  ) *
                                    100
                                )
                              }%`,
                          }}
                        />
                      </div>
  
                      <span>
                        {day.label}
                      </span>
                    </div>
                  )
                )}
              </div>
            </section>
  
            <section className="analysis-card">
              <p className="card-label">
                Daily overview
              </p>
  
              <div className="daily-list">
                {daily
                  .slice()
                  .reverse()
                  .map(
                    (day) => (
                      <div
                        className="daily-row"
                        key={
                          day.key
                        }
                      >
                        <strong>
                          {day.label}
                        </strong>
  
                        <span>
                          {hoursAndMinutes(
                            day.sleep
                          )}
                          {" · "}
                          {
                            day.feeds
                          }{" "}
                          feeds
                        </span>
                      </div>
                    )
                  )}
              </div>
            </section>
          </>
        )}
      </main>
    );
  }