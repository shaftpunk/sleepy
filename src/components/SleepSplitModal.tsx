import {
  useState,
} from "react";

import {
  splitSleep,
  type SleepRecord,
} from "../services/sleepService";


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
  if (!sleep.endtime) {
    return null;
  }

  const startMs =
    new Date(
      sleep.starttime
    ).getTime();

  const endMs =
    new Date(
      sleep.endtime
    ).getTime();

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
          "Split time must be inside the sleep session."
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
        "Could not split sleep session."
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
              Sleep
            </p>

            <h2>
              Split session
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
              "nb-NO",
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
              "nb-NO",
              {
                hour: "2-digit",
                minute: "2-digit",
              }
            )}
          </span>
        </div>


        <label className="form-field">
          <span>
            Split at
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
            ? "Splitting..."
            : "Split sleep"}
        </button>
      </div>
    </div>
  );
}