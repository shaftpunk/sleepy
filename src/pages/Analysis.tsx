import { useEffect, useState } from "react";

import { useAppStore } from "../stores/appStore";
import { useAnalyticsData } from "../hooks/useAnalyticsData";

import OverviewTab from "./analysis/OverviewTab";
import DayTab from "./analysis/DayTab";
import MonthTab from "./analysis/MonthTab";
import InsightTab from "./analysis/InsightTab";
import FeedTab from "./analysis/FeedTab";

import "./Analysis.css";

type TabKey =
  | "overview"
  | "day"
  | "month"
  | "insight"
  | "feed";

const TABS: {
  key: TabKey;
  label: string;
}[] = [
  {
    key: "overview",
    label: "Oversikt",
  },
  {
    key: "day",
    label: "Dag",
  },
  {
    key: "month",
    label: "Måned",
  },
  {
    key: "insight",
    label: "Innsikt",
  },
  {
    key: "feed",
    label: "Mating",
  },
];

export default function Analysis() {
  const currentBabyId = useAppStore(
    (state) => state.currentBabyId,
  );

  const babies = useAppStore(
    (state) => state.babies,
  );

  const currentBaby = babies.find(
    (baby) =>
      baby.id === currentBabyId,
  );

  const [tab, setTab] =
    useState<TabKey>("overview");

  const {
    sessions,
    feeds,
    loading,
  } = useAnalyticsData(
    currentBabyId,
  );

  const [now, setNow] = useState(
    () => Date.now(),
  );

  useEffect(() => {
    const interval =
      window.setInterval(
        () =>
          setNow(
            Date.now(),
          ),
        60000,
      );

    return () =>
      window.clearInterval(
        interval,
      );
  }, []);

  return (
    <main className="analysis-page">
      <header className="page-header">
        <p className="eyebrow">
          {currentBaby?.name ??
            "Sleepy"}
        </p>

        <h1>Analyse</h1>

        <p className="page-description">
          Søvn, oppvåkning og mating over tid.
        </p>
      </header>

      <div className="analysis-tab-bar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={
              tab === t.key
                ? "analysis-tab active"
                : "analysis-tab"
            }
            onClick={() =>
              setTab(t.key)
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-card">
          Laster...
        </div>
      ) : (
        <>
          {tab === "overview" && (
            <OverviewTab
              sessions={sessions}
              now={now}
            />
          )}

          {tab === "day" && (
            <DayTab
              sessions={sessions}
              now={now}
            />
          )}

          {tab === "month" && (
            <MonthTab
              sessions={sessions}
              now={now}
            />
          )}

          {tab === "insight" && (
            <InsightTab
              sessions={sessions}
              now={now}
            />
          )}

          {tab === "feed" && (
            <FeedTab
              feeds={feeds}
              now={now}
            />
          )}
        </>
      )}
    </main>
  );
}