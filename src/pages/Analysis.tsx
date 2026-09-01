import { useEffect, useState } from "react";

import { useAppStore } from "../stores/appStore";
import { useAnalyticsData } from "../hooks/useAnalyticsData";
import { useTranslation } from "../i18n";

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

export default function Analysis() {
  const { t } = useTranslation();

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
    active,
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

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: t("analysis.tabOverview") },
    { key: "day", label: t("analysis.tabDay") },
    { key: "month", label: t("analysis.tabMonth") },
    { key: "insight", label: t("analysis.tabInsight") },
    { key: "feed", label: t("common.feeding") },
  ];

  return (
    <main className="analysis-page">
      <header className="page-header">
        <p className="eyebrow">
          {currentBaby?.name ??
            t("common.appName")}
        </p>

        <h1>{t("analysis.pageTitle")}</h1>

        <p className="page-description">
          {t("analysis.pageDescription")}
        </p>
      </header>

      <div className="analysis-tab-bar">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            className={
              tab === tabItem.key
                ? "analysis-tab active"
                : "analysis-tab"
            }
            onClick={() =>
              setTab(tabItem.key)
            }
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-card">
          {t("common.loading")}
        </div>
      ) : (
        <>
          {tab === "overview" && (
            <OverviewTab
              sessions={sessions}
              active={active}
              birthDate={currentBaby?.birth_date ?? null}
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