import { useTranslation } from "../../i18n";
import { formatClock, formatDuration } from "../../lib/format";
import type { SleepRecord } from "../../services/sleepService";

/* One sleep row with the existing History actions (edit, resume, split,
   delete). Shared by "Last 24 hours" and the older history list. */
export default function SleepHistoryItem({ sleep, dateLabel, canResume, resuming, onEdit, onResume, onSplit, onDelete }: {
  sleep: SleepRecord;
  dateLabel: string;
  canResume: boolean;
  resuming: boolean;
  onEdit: (sleep: SleepRecord) => void;
  onResume: (sleep: SleepRecord) => void;
  onSplit: (sleep: SleepRecord) => void;
  onDelete: (sleep: SleepRecord) => void;
}) {
  const { t, lang } = useTranslation();
  return (
    <div className="history-item">
      <div className="history-icon">☾</div>

      <button type="button" className="history-content clickable" onClick={() => onEdit(sleep)}>
        <strong>
          {formatClock(new Date(sleep.starttime).getTime(), lang)}
          {" – "}
          {sleep.endtime ? formatClock(new Date(sleep.endtime).getTime(), lang) : t("common.sleeping")}
        </strong>
        <span>
          {dateLabel}
          {sleep.durationminutes !== null && ` · ${formatDuration(sleep.durationminutes, lang)}`}
        </span>
        {sleep.note && <span className="history-note">{sleep.note}</span>}
      </button>

      <div className="history-actions">
        {canResume && sleep.endtime && (
          <button className="history-action-button" title={t("history.resumeSleepTitle")} aria-label={t("history.resumeSleepTitle")}
            disabled={resuming} onClick={() => onResume(sleep)}>
            {resuming ? "..." : "↺"}
          </button>
        )}
        {sleep.endtime && (
          <button className="history-action-button" title={t("sleep.splitButton")} aria-label={t("sleep.splitButton")} onClick={() => onSplit(sleep)}>
            ✂
          </button>
        )}
        <button className="history-delete" aria-label={t("common.deleteSleepAria")} onClick={() => onDelete(sleep)}>×</button>
      </div>
    </div>
  );
}
