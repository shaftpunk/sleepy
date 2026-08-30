import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getSleepsOverlappingPeriod,
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


type Interval = {
  start: number;
  end: number;
};


function formatMinutes(
  minutes: number
) {
  const rounded =
    Math.max(
      0,
      Math.round(minutes)
    );

  const hours =
    Math.floor(
      rounded / 60
    );

  const rest =
    rounded % 60;

  if (!hours) {
    return `${rest}m`;
  }

  if (!rest) {
    return `${hours}h`;
  }

  return `${hours}h ${rest}m`;
}


function formatClock(
  date: number
) {
  return new Intl.DateTimeFormat(
    "nb-NO",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  ).format(
    new Date(date)
  );
}


function dayKey(
  value: string | number
) {
  const date =
    new Date(value);

  return [
    date.getFullYear(),
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    ),
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    ),
  ].join("-");
}


function dayName(
  value: string | number
) {
  return new Intl.DateTimeFormat(
    "nb-NO",
    {
      weekday: "short",
    }
  ).format(
    new Date(value)
  );
}


function makeIntervals(
  sleeps: SleepRecord[],
  from: number,
  to: number
): Interval[] {

  const raw =
    sleeps
      .map(
        (sleep) => {

          const start =
            Math.max(
              from,
              new Date(
                sleep.starttime
              ).getTime()
            );

          const end =
            Math.min(
              to,
              sleep.endtime
                ? new Date(
                    sleep.endtime
                  ).getTime()
                : to
            );

          return {
            start,
            end,
          };
        }
      )
      .filter(
        (interval) =>
          interval.end >
          interval.start
      )
      .sort(
        (a, b) =>
          a.start -
          b.start
      );


  const merged:
    Interval[] = [];


  raw.forEach(
    (interval) => {

      const last =
        merged[
          merged.length - 1
        ];

      if (
        !last ||
        interval.start >
          last.end
      ) {
        merged.push({
          ...interval,
        });

        return;
      }

      last.end =
        Math.max(
          last.end,
          interval.end
        );
    }
  );


  return merged;
}


function windowStats(
  sleeps: SleepRecord[],
  hours: number,
  now: number
) {
  const from =
    now -
    hours *
      60 *
      60 *
      1000;

  const intervals =
    makeIntervals(
      sleeps,
      from,
      now
    );


  const sleepMs =
    intervals.reduce(
      (
        total,
        interval
      ) =>
        total +
        (
          interval.end -
          interval.start
        ),
      0
    );


  const totalMinutes =
    hours * 60;

  const sleepMinutes =
    Math.round(
      sleepMs /
      60000
    );


  const wakeMinutes =
    Math.max(
      0,
      totalMinutes -
      sleepMinutes
    );


  const longest =
    intervals.reduce(
      (
        longest,
        interval
      ) =>
        Math.max(
          longest,
          Math.round(
            (
              interval.end -
              interval.start
            ) /
              60000
          )
        ),
      0
    );


  const average =
    intervals.length
      ? Math.round(
          sleepMinutes /
          intervals.length
        )
      : 0;


  return {
    from,
    intervals,

    sleepMinutes,
    wakeMinutes,

    percentage:
      totalMinutes
        ? Math.round(
            (
              sleepMinutes /
              totalMinutes
            ) *
              100
          )
        : 0,

    sessions:
      intervals.length,

    longest,
    average,
  };
}


export default function Analysis() {

  const bbyid =
    useAppStore(
      (state) =>
        state.currentBbyId
    );


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
    loading,
    setLoading,
  ] =
    useState(true);


  const [
    now,
    setNow,
  ] =
    useState(
      Date.now()
    );


  async function loadData() {

    const currentNow =
      Date.now();

    const from =
      new Date(
        currentNow -
        7 *
          24 *
          60 *
          60 *
          1000
      );

    const [
      sleepData,
      feedData,
    ] =
      await Promise.all([

        getSleepsOverlappingPeriod(
          bbyid,
          from.toISOString(),
          new Date(
            currentNow
          ).toISOString()
        ),

        getFeedsFromDate(
          bbyid,
          from.toISOString()
        ),

      ]);


    setSleeps(
      sleepData
    );

    setFeeds(
      feedData
    );

    setNow(
      Date.now()
    );
  }


  useEffect(() => {

    let mounted =
      true;


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


    const timer =
      window.setInterval(
        () =>
          setNow(
            Date.now()
          ),
        30000
      );


    const offSleep =
      subscribeToSleepChanges(
        bbyid,
        loadData
      );


    const offFeed =
      subscribeToFeedChanges(
        bbyid,
        loadData
      );


    return () => {

      mounted =
        false;

      window.clearInterval(
        timer
      );

      offSleep();
      offFeed();

    };

  }, [bbyid]);


  const stats12 =
    useMemo(
      () =>
        windowStats(
          sleeps,
          12,
          now
        ),
      [
        sleeps,
        now,
      ]
    );


  const stats24 =
    useMemo(
      () =>
        windowStats(
          sleeps,
          24,
          now
        ),
      [
        sleeps,
        now,
      ]
    );


  const stats7d =
    useMemo(
      () =>
        windowStats(
          sleeps,
          24 * 7,
          now
        ),
      [
        sleeps,
        now,
      ]
    );


  const feeds24 =
    useMemo(
      () => {

        const from =
          now -
          24 *
            60 *
            60 *
            1000;

        return feeds.filter(
          (feed) =>
            new Date(
              feed.starttime
            ).getTime() >=
            from
        );

      },
      [
        feeds,
        now,
      ]
    );


  const bottleMl24 =
    feeds24.reduce(
      (
        total,
        feed
      ) =>
        total +
        (
          feed.feedtype ===
            "bottle"
            ? feed.amountml ??
              0
            : 0
        ),
      0
    );


  const bottleMl7 =
    feeds.reduce(
      (
        total,
        feed
      ) =>
        total +
        (
          feed.feedtype ===
            "bottle"
            ? feed.amountml ??
              0
            : 0
        ),
      0
    );


  const daily =
    useMemo(
      () => {

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
            new Date(now);

          date.setDate(
            date.getDate() -
            i
          );

          date.setHours(
            12,
            0,
            0,
            0
          );


          result.push({
            key:
              dayKey(
                date.getTime()
              ),

            label:
              dayName(
                date.getTime()
              ),

            sleep: 0,

            feeds: 0,
          });

        }


        sleeps.forEach(
          (sleep) => {

            const start =
              new Date(
                sleep.starttime
              );

            const end =
              sleep.endtime
                ? new Date(
                    sleep.endtime
                  )
                : new Date(now);


            const day =
              result.find(
                (item) =>
                  item.key ===
                  dayKey(
                    start.getTime()
                  )
              );


            if (
              day &&
              end >
                start
            ) {

              day.sleep +=
                Math.round(
                  (
                    end.getTime() -
                    start.getTime()
                  ) /
                    60000
                );

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
              day.feeds +=
                1;
            }

          }
        );


        return result;

      },
      [
        sleeps,
        feeds,
        now,
      ]
    );


  const maxDailySleep =
    Math.max(
      1,
      ...daily.map(
        (day) =>
          day.sleep
      )
    );


  return (
    <main className="analysis-page">

      <header className="page-header">
        <p className="eyebrow">
          {bbyid}
        </p>

        <h1>
          Analysis
        </h1>

        <p className="page-description">
          Sleep, awake time and feeding patterns.
        </p>
      </header>


      {loading ? (

        <div className="empty-card">
          Loading...
        </div>

      ) : (

        <>

          <section className="analysis-card twelve-hour-card">

            <div className="analysis-card-heading">

              <div>
                <p className="card-label">
                  Right now
                </p>

                <h2>
                  Last 12 hours
                </h2>
              </div>


              <div className="sleep-percentage">
                {stats12.percentage}%
              </div>

            </div>


            <div className="twelve-stats">

              <div>
                <span>
                  Sleep
                </span>

                <strong>
                  {formatMinutes(
                    stats12.sleepMinutes
                  )}
                </strong>
              </div>


              <div>
                <span>
                  Awake
                </span>

                <strong>
                  {formatMinutes(
                    stats12.wakeMinutes
                  )}
                </strong>
              </div>

            </div>


            <div className="sleep-timeline">

              <div className="timeline-track">

                {stats12.intervals.map(
                  (
                    interval,
                    index
                  ) => {

                    const total =
                      now -
                      stats12.from;

                    const left =
                      (
                        (
                          interval.start -
                          stats12.from
                        ) /
                        total
                      ) *
                      100;

                    const width =
                      (
                        (
                          interval.end -
                          interval.start
                        ) /
                        total
                      ) *
                      100;


                    return (
                      <div
                        key={index}
                        className="timeline-sleep-block"
                        style={{
                          left:
                            `${left}%`,

                          width:
                            `${width}%`,
                        }}
                        title={
                          `${formatClock(
                            interval.start
                          )} – ${formatClock(
                            interval.end
                          )}`
                        }
                      />
                    );
                  }
                )}

              </div>


              <div className="timeline-times">
                <span>
                  {formatClock(
                    stats12.from
                  )}
                </span>

                <span>
                  {formatClock(
                    stats12.from +
                    6 *
                      60 *
                      60 *
                      1000
                  )}
                </span>

                <span>
                  Now
                </span>
              </div>


              <div className="timeline-legend">

                <span>
                  <i className="legend-awake" />
                  Awake
                </span>

                <span>
                  <i className="legend-sleep" />
                  Sleep
                </span>

              </div>

            </div>


            <div className="mini-stats">

              <div>
                <span>
                  Sessions
                </span>

                <strong>
                  {stats12.sessions}
                </strong>
              </div>


              <div>
                <span>
                  Longest
                </span>

                <strong>
                  {formatMinutes(
                    stats12.longest
                  )}
                </strong>
              </div>


              <div>
                <span>
                  Average
                </span>

                <strong>
                  {formatMinutes(
                    stats12.average
                  )}
                </strong>
              </div>

            </div>

          </section>


          <section className="stats-grid">

            <div className="stat-card">

              <span>
                Sleep · 24h
              </span>

              <strong>
                {formatMinutes(
                  stats24.sleepMinutes
                )}
              </strong>

              <small>
                {stats24.percentage}% of the day
              </small>

            </div>


            <div className="stat-card">

              <span>
                Awake · 24h
              </span>

              <strong>
                {formatMinutes(
                  stats24.wakeMinutes
                )}
              </strong>

              <small>
                Calculated between sleeps
              </small>

            </div>


            <div className="stat-card">

              <span>
                Longest sleep
              </span>

              <strong>
                {formatMinutes(
                  stats24.longest
                )}
              </strong>

              <small>
                Last 24 hours
              </small>

            </div>


            <div className="stat-card">

              <span>
                Sleep sessions
              </span>

              <strong>
                {stats24.sessions}
              </strong>

              <small>
                Last 24 hours
              </small>

            </div>

          </section>


          <section className="analysis-card">

            <div className="analysis-card-heading">

              <div>
                <p className="card-label">
                  Feeding
                </p>

                <h2>
                  Last 24 hours
                </h2>
              </div>

            </div>


            <div className="mini-stats">

              <div>
                <span>
                  Feedings
                </span>

                <strong>
                  {feeds24.length}
                </strong>
              </div>


              <div>
                <span>
                  Bottle
                </span>

                <strong>
                  {bottleMl24} ml
                </strong>
              </div>


              <div>
                <span>
                  Avg. interval
                </span>

                <strong>
                  {feeds24.length >
                  1
                    ? formatMinutes(
                        Math.round(
                          24 *
                            60 /
                            feeds24.length
                        )
                      )
                    : "–"}
                </strong>
              </div>

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
                    key={day.key}
                  >

                    <div className="bar-track">

                      <div
                        className="bar-value"
                        style={{
                          height:
                            `${Math.max(
                              4,
                              (
                                day.sleep /
                                maxDailySleep
                              ) *
                                100
                            )}%`,
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

            <div className="analysis-card-heading">

              <div>
                <p className="card-label">
                  7 days
                </p>

                <h2>
                  Overview
                </h2>
              </div>

            </div>


            <div className="seven-day-grid">

              <div>
                <span>
                  Total sleep
                </span>

                <strong>
                  {formatMinutes(
                    stats7d.sleepMinutes
                  )}
                </strong>
              </div>


              <div>
                <span>
                  Average session
                </span>

                <strong>
                  {formatMinutes(
                    stats7d.average
                  )}
                </strong>
              </div>


              <div>
                <span>
                  Longest session
                </span>

                <strong>
                  {formatMinutes(
                    stats7d.longest
                  )}
                </strong>
              </div>


              <div>
                <span>
                  Feedings
                </span>

                <strong>
                  {feeds.length}
                </strong>
              </div>


              <div>
                <span>
                  Bottle
                </span>

                <strong>
                  {bottleMl7} ml
                </strong>
              </div>


              <div>
                <span>
                  Sleep sessions
                </span>

                <strong>
                  {stats7d.sessions}
                </strong>
              </div>

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
                      key={day.key}
                    >

                      <strong>
                        {day.label}
                      </strong>

                      <span>
                        {formatMinutes(
                          day.sleep
                        )}
                        {" · "}
                        {day.feeds} feeds
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