import {
  useEffect,
  useState,
} from "react";

import {
  useAppStore,
} from "../stores/appStore";

import {
  deleteSleep,
  getRecentSleeps,
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


function formatDate(
  date: string
) {
  return new Intl.DateTimeFormat(
    "nb-NO",
    {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }
  ).format(
    new Date(date)
  );
}


function formatTime(
  date: string
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


function formatDuration(
  minutes: number | null
) {
  if (minutes === null) {
    return "";
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  const rest =
    minutes % 60;

  if (!hours) {
    return `${rest} min`;
  }

  return `${hours}h ${rest}m`;
}


function feedLabel(
  feed: FeedRecord
) {
  if (
    feed.feedtype ===
    "bottle"
  ) {
    return `Bottle${
      feed.amountml !== null
        ? ` · ${feed.amountml} ml`
        : ""
    }`;
  }

  if (
    feed.feedtype ===
    "breast"
  ) {
    return `Breast${
      feed.side
        ? ` · ${feed.side}`
        : ""
    }`;
  }

  return "Food";
}


export default function History() {
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


  async function load() {
    const [
      sleepData,
      feedData,
    ] =
      await Promise.all([
        getRecentSleeps(
          bbyid,
          100
        ),

        getRecentFeeds(
          bbyid,
          100
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
    load();

    const offSleep =
      subscribeToSleepChanges(
        bbyid,
        load
      );

    const offFeed =
      subscribeToFeedChanges(
        bbyid,
        load
      );

    return () => {
      offSleep();
      offFeed();
    };

  }, [bbyid]);


  return (
    <>
      <main className="history-page">

        <header className="page-header">
          <p className="eyebrow">
            {bbyid}
          </p>

          <h1>
            History
          </h1>

          <p className="page-description">
            Correct, split, add or remove registrations.
          </p>
        </header>


        <section className="history-section">

          <div className="section-heading">
            <h2>
              Sleep
            </h2>

            <button
              className="secondary-button"
              onClick={() =>
                setNewSleep(true)
              }
            >
              + Add
            </button>
          </div>


          <div className="history-list">

            {sleeps.map(
              (sleep) => (

                <div
                  className="history-item"
                  key={sleep.id}
                >

                  <div className="history-icon">
                    ☾
                  </div>


                  <div
                    className="history-content clickable"
                    onClick={() =>
                      setEditingSleep(
                        sleep
                      )
                    }
                  >

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


                    <span>
                      {formatDate(
                        sleep.starttime
                      )}

                      {sleep.durationminutes !==
                        null &&
                        ` · ${formatDuration(
                          sleep.durationminutes
                        )}`}
                    </span>


                    {sleep.note && (
                      <p>
                        {sleep.note}
                      </p>
                    )}

                  </div>


                  <div className="history-actions">

                    {sleep.endtime && (
                      <button
                        className="history-action-button"
                        title="Split sleep"
                        onClick={() =>
                          setSplittingSleep(
                            sleep
                          )
                        }
                      >
                        ✂
                      </button>
                    )}


                    <button
                      className="history-delete"
                      onClick={async () => {

                        if (
                          !window.confirm(
                            "Delete this sleep?"
                          )
                        ) {
                          return;
                        }

                        await deleteSleep(
                          sleep.id
                        );

                        await load();
                      }}
                    >
                      ×
                    </button>

                  </div>

                </div>
              )
            )}

          </div>

        </section>


        <section className="history-section">

          <div className="section-heading">
            <h2>
              Feeding
            </h2>

            <button
              className="secondary-button"
              onClick={() =>
                setNewFeed(true)
              }
            >
              + Add
            </button>
          </div>


          <div className="history-list">

            {feeds.map(
              (feed) => (

                <div
                  className="history-item"
                  key={feed.id}
                >

                  <div className="history-icon">
                    {feed.feedtype ===
                    "bottle"
                      ? "🍼"
                      : feed.feedtype ===
                          "food"
                        ? "🥣"
                        : "♡"}
                  </div>


                  <div
                    className="history-content clickable"
                    onClick={() =>
                      setEditingFeed(
                        feed
                      )
                    }
                  >

                    <strong>
                      {feedLabel(
                        feed
                      )}
                    </strong>

                    <span>
                      {formatDate(
                        feed.starttime
                      )}
                      {" · "}
                      {formatTime(
                        feed.starttime
                      )}
                    </span>

                    {feed.note && (
                      <p>
                        {feed.note}
                      </p>
                    )}

                  </div>


                  <button
                    className="history-delete"
                    onClick={async () => {

                      if (
                        !window.confirm(
                          "Delete this feeding?"
                        )
                      ) {
                        return;
                      }

                      await deleteFeed(
                        feed.id
                      );

                      await load();
                    }}
                  >
                    ×
                  </button>

                </div>
              )
            )}

          </div>

        </section>

      </main>


      {(newSleep ||
        editingSleep) && (

        <SleepModal
          bbyid={bbyid}
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
          bbyid={bbyid}
          feed={editingFeed}
          onClose={() => {
            setNewFeed(
              false
            );

            setEditingFeed(
              null
            );
          }}
          onSaved={load}
        />

      )}

    </>
  );
}