import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  useAppStore,
} from "../stores/appStore";

import {
  deleteSleep,
  getAllSleeps,
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

import SleepClock
  from "../components/history/SleepClock";

import { useAnalyticsData } from "../hooks/useAnalyticsData";
import { feedTypeLabel, formatClock, formatDuration, sideLabel } from "../lib/format";
import { LOCALES, useTranslation } from "../i18n";


export default function History() {
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
  const [copyingSleep, setCopyingSleep] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
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
      [currentBabyId]
    );


  useEffect(() => {
    if (!currentBabyId) {
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


        {currentBabyId && (
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
              {t("common.sleep")}
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

              <button
                className="secondary-button"
                disabled={!currentBabyId}
                onClick={() =>
                  setNewSleep(true)
                }
              >
                {t("common.addShort")}
              </button>
            </div>
          </div>

          {copyMessage && (
            <p className="history-copy-message" role="status">{copyMessage}</p>
          )}


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
                      {formatClock(new Date(sleep.starttime).getTime(), lang)}

                      {" – "}

                      {sleep.endtime
                        ? formatClock(new Date(sleep.endtime).getTime(), lang)
                        : t("common.sleeping")}
                    </strong>


                    <span>
                      {formatDate(
                        sleep.starttime
                      )}

                      {sleep.durationminutes !==
                        null &&
                        ` · ${formatDuration(
                          sleep.durationminutes,
                          lang
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
                        title={t("sleep.splitButton")}
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
                            t("common.confirmDeleteSleep")
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
              {t("common.feeding")}
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
                      {formatClock(new Date(feed.starttime).getTime(), lang)}
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
                          t("common.confirmDeleteFeed")
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
