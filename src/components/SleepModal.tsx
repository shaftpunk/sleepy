import { useState } from "react";

import {
  createManualSleep,
  updateSleep,
  type SleepRecord,
} from "../services/sleepService";

import { useAppStore } from "../stores/appStore";
import { useTranslation } from "../i18n";

type Props = {
  sleep?: SleepRecord | null;
  onClose: () => void;
  onSaved: () => void;
};

function localDateTime(date: string | Date) {
  const d = new Date(date);
  const offset = d.getTimezoneOffset() * 60000;

  return new Date(d.getTime() - offset)
    .toISOString()
    .slice(0, 16);
}

export default function SleepModal({
  sleep,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation();

  const currentBabyId = useAppStore(
    (state) => state.currentBabyId,
  );

  const babies = useAppStore(
    (state) => state.babies,
  );

  const currentBaby = babies.find(
    (baby) => baby.id === currentBabyId,
  );

  const now = new Date();

  const defaultStart = new Date(
    now.getTime() - 60 * 60000,
  );

  const [start, setStart] = useState(
    localDateTime(
      sleep?.starttime ?? defaultStart,
    ),
  );

  const [end, setEnd] = useState(
    localDateTime(
      sleep?.endtime ?? now,
    ),
  );

  const [rate, setRate] = useState<
    number | null
  >(
    sleep?.rate
      ? Number(sleep.rate)
      : null,
  );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  async function save() {
    if (!currentBabyId) {
      setError(t("errors.noBabySelected"));
      return;
    }

    try {
      setSaving(true);
      setError("");

      const starttime =
        new Date(start).toISOString();

      const endtime =
        new Date(end).toISOString();

      if (
        new Date(endtime) <=
        new Date(starttime)
      ) {
        setError(
          t("errors.endTimeAfterStart"),
        );

        return;
      }

      const rateValue =
        rate != null
          ? String(rate)
          : null;

      if (sleep) {
        await updateSleep(
          sleep.id,
          starttime,
          endtime,
          rateValue,
        );
      } else {
        await createManualSleep({
          baby_id: currentBabyId,
          starttime,
          endtime,
          rate: rateValue,
        });
      }

      await onSaved();
      onClose();
    } catch (err) {
      console.error(err);

      setError(
        t("errors.couldNotSaveSleep"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        className="feed-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">
              {currentBaby?.name ??
                t("common.appName")}
            </p>

            <h2>
              {sleep
                ? t("sleep.editTitle")
                : t("sleep.addTitle")}
            </h2>
          </div>

          <button
            className="modal-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <label className="form-field">
          <span>{t("sleep.fellAsleep")}</span>

          <input
            className="datetime-input"
            type="datetime-local"
            value={start}
            onChange={(event) =>
              setStart(
                event.target.value,
              )
            }
          />
        </label>

        <label className="form-field">
          <span>{t("sleep.wokeUp")}</span>

          <input
            className="datetime-input"
            type="datetime-local"
            value={end}
            onChange={(event) =>
              setEnd(
                event.target.value,
              )
            }
          />
        </label>

        <div className="form-field">
          <span>{t("sleep.quality")}</span>

          <div className="star-picker">
            {[1, 2, 3, 4, 5].map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    rate != null &&
                    value <= rate
                      ? "star-button active"
                      : "star-button"
                  }
                  onClick={() =>
                    setRate(
                      rate === value
                        ? null
                        : value,
                    )
                  }
                  aria-label={t("sleep.rateAria", { value })}
                >
                  ★
                </button>
              ),
            )}
          </div>
        </div>

        {error && (
          <p className="form-error">
            {error}
          </p>
        )}

        <button
          className="primary-button"
          onClick={save}
          disabled={
            saving ||
            !currentBabyId
          }
        >
          {saving
            ? t("common.saving")
            : sleep
              ? t("common.saveChanges")
              : t("sleep.addTitle")}
        </button>
      </div>
    </div>
  );
}
