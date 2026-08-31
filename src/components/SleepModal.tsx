import { useState } from "react";

import {
  createManualSleep,
  updateSleep,
  type SleepRecord,
} from "../services/sleepService";

import { useAppStore } from "../stores/appStore";

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
      setError("No baby selected.");
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
          "End time must be after start time.",
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
        "Could not save sleep.",
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
                "Sleepy"}
            </p>

            <h2>
              {sleep
                ? "Edit sleep"
                : "Add sleep"}
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
          <span>Fell asleep</span>

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
          <span>Woke up</span>

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
          <span>Quality</span>

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
                  aria-label={`Rate ${value} star${
                    value === 1
                      ? ""
                      : "s"
                  }`}
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
            ? "Saving..."
            : sleep
              ? "Save changes"
              : "Add sleep"}
        </button>
      </div>
    </div>
  );
}