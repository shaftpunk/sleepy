import {
  useState,
} from "react";

import {
  splitSleep,
  type SleepRecord,
} from "../services/sleepService";

import { LOCALES, useTranslation } from "../i18n";


type Props = {
  sleep: SleepRecord;

  onClose: () => void;

  onSaved: () => void;
};


function localDateTime(
  date: string
) {
  const d =
    new Date(date);

  const offset =
    d.getTimezoneOffset() *
    60000;

  return new Date(
    d.getTime() -
    offset
  )
    .toISOString()
    .slice(0, 16);
}


export default function SleepSplitModal({
  sleep,
  onClose,
  onSaved,
}: Props) {
  const { t, lang } = useTranslation();

  const startMs =
    sleep.endtime
      ? new Date(
        sleep.starttime
      ).getTime()
      : 0;

  const endMs =
    sleep.endtime
      ? new Date(
        sleep.endtime
      ).getTime()
      : 0;

  const middle =
    new Date(
      startMs +
      (
        endMs -
        startMs
      ) / 2
    );

  const [
    splitTime,
    setSplitTime,
  ] = useState(
    localDateTime(
      middle.toISOString()
    )
  );

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  if (!sleep.endtime) {
    return null;
  }


  async function save() {
    try {
      setSaving(true);
      setError("");

      const splitDate =
        new Date(splitTime);

      if (
        splitDate.getTime() <=
        startMs ||
        splitDate.getTime() >=
        endMs
      ) {
        setError(
          t("errors.splitTimeOutsideSession")
        );

        return;
      }

      await splitSleep(
        sleep.id,
        splitDate.toISOString()
      );

      await onSaved();

      onClose();

    } catch (err) {
      console.error(
        "Split failed:",
        err
      );

      setError(
        t("errors.couldNotSplitSleep")
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
              {t("sleep.eyebrow")}
            </p>

            <h2>
              {t("sleep.splitSessionTitle")}
            </h2>
          </div>

          <button
            className="modal-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>


        <div className="split-summary">
          <span>
            {new Date(
              sleep.starttime
            ).toLocaleTimeString(
              LOCALES[lang],
              {
                hour: "2-digit",
                minute: "2-digit",
              }
            )}
          </span>

          <span>→</span>

          <span>
            {new Date(
              sleep.endtime
            ).toLocaleTimeString(
              LOCALES[lang],
              {
                hour: "2-digit",
                minute: "2-digit",
              }
            )}
          </span>
        </div>


        <label className="form-field">
          <span>
            {t("sleep.splitAt")}
          </span>

          <input
            className="datetime-input"
            type="datetime-local"
            value={splitTime}
            onChange={(event) =>
              setSplitTime(
                event.target.value
              )
            }
          />
        </label>


        {error && (
          <p className="form-error">
            {error}
          </p>
        )}


        <button
          className="primary-button"
          disabled={saving}
          onClick={save}
        >
          {saving
            ? t("sleep.splitting")
            : t("sleep.splitButton")}
        </button>
      </div>
    </div>
  );
}
