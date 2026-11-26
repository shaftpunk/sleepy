import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { feedTypeLabel, formatClock, sideLabel } from "../lib/format";
import { getActiveSleep, getLastCompletedSleep } from "../services/sleepService";
import { getLastFeed } from "../services/feedService";
import { getRecentDiaperChanges } from "../services/diaperService";
import CareSheet from "./CareSheet";

export default function HandoffSheet({ babyId, name, onClose }: {
  babyId: string; name: string; onClose: () => void;
}) {
  const { t, lang, locale } = useTranslation();
  const [summary, setSummary] = useState("");
  const [error, setError] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"copied" | "manual">();
  useEffect(() => {
    let cancelled = false;
    setSummary("");
    setError(false);
    setCopyStatus(undefined);
    async function read() {
      const [active, last, feed, [diaper]] = await Promise.all([
        getActiveSleep(babyId), getLastCompletedSleep(babyId), getLastFeed(babyId), getRecentDiaperChanges(babyId, 1),
      ]);
      if (cancelled) return;
      const now = new Date();
      const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
      const stamp = (value: string) => new Date(value).toDateString() === now.toDateString()
        ? formatClock(Date.parse(value), lang) : dateTime.format(new Date(value));
      const missing = t("care.missing");
      let sleep = t("common.sleep") + " · " + missing;
      if (active?.baby_id === babyId) sleep = t("care.sleeping", { time: stamp(active.starttime) });
      else if (last?.baby_id === babyId && last.endtime) sleep = t("care.awake", { time: stamp(last.endtime) });
      let meal = missing;
      if (feed?.baby_id === babyId) {
        const detail = feed.feedtype === "breast" ? sideLabel(feed.side, lang)
          : feed.feedtype === "bottle" && feed.amountml != null ? feed.amountml + " ml" : null;
        meal = [stamp(feed.starttime), feedTypeLabel(feed.feedtype, lang), detail].filter(Boolean).join(" · ");
      }
      const change = diaper?.baby_id === babyId
        ? [stamp(diaper.changed_at), t(diaper.type === "both" ? "diaper.historyBoth" : `diaper.${diaper.type}`)].join(" · ") : missing;
      setSummary([t("care.asOf", { name, time: dateTime.format(now) }), "", sleep,
        t("diaper.feed") + " · " + meal, t("diaper.label") + " · " + change].join("\n"));
    }
    void read().catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [babyId, name, t, lang, locale]);
  return <CareSheet title={t("care.handoff")} onClose={onClose}>
    {summary ? <><p className="care-summary">{summary}</p>
      <button className="primary-button" onClick={async () => {
        try { await navigator.clipboard.writeText(summary); setCopyStatus("copied"); }
        catch { setCopyStatus("manual"); }
      }}>{t("care.copy")}</button>
      {copyStatus && <p role="status">{t(`care.${copyStatus}`)}</p>}
    </> : <p role="status">{t(error ? "log.loadError" : "common.loading")}</p>}
  </CareSheet>;
}
