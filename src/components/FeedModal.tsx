import { useState } from "react";

import {
  createFeed,
  updateFeed,
  type FeedRecord,
  type FeedSide,
  type FeedType,
} from "../services/feedService";

import { useAppStore } from "../stores/appStore";

type Props = {
  feed?: FeedRecord | null;
  onClose: () => void;
  onSaved: () => void;
};

function localDateTime(date?: string) {
  const d = date ? new Date(date) : new Date();
  const offset = d.getTimezoneOffset() * 60000;

  return new Date(d.getTime() - offset)
    .toISOString()
    .slice(0, 16);
}

export default function FeedModal({
  feed,
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

  const [feedType, setFeedType] =
    useState<FeedType>(
      feed?.feedtype ?? "bottle",
    );

  const [amount, setAmount] = useState(
    feed?.amountml?.toString() ?? "",
  );

  const [side, setSide] =
    useState<FeedSide>(
      feed?.side ?? null,
    );

  const [note, setNote] =
    useState(feed?.note ?? "");

  const [time, setTime] = useState(
    localDateTime(feed?.starttime),
  );

  const [saving, setSaving] =
    useState(false);

  async function handleSave() {
    if (!currentBabyId) {
      console.error(
        "Cannot save feeding: no baby selected.",
      );
      return;
    }

    try {
      setSaving(true);

      const values = {
        baby_id: currentBabyId,

        feedtype: feedType,

        amountml:
          feedType === "bottle" && amount
            ? Number(amount)
            : null,

        side:
          feedType === "breast"
            ? side
            : null,

        note:
          note.trim() || null,

        starttime:
          new Date(time).toISOString(),
      };

      if (feed) {
        await updateFeed(
          feed.id,
          values,
        );
      } else {
        await createFeed(values);
      }

      await onSaved();
      onClose();
    } catch (error) {
      console.error(
        "Failed to save feeding:",
        error,
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
              {feed
                ? "Edit feeding"
                : "Register feeding"}
            </h2>
          </div>

          <button
            className="modal-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="feed-type-grid">
          {[
            [
              "bottle",
              "🍼",
              "Bottle",
            ],
            [
              "breast",
              "♡",
              "Breast",
            ],
            [
              "food",
              "🥣",
              "Food",
            ],
          ].map(
            ([value, icon, label]) => (
              <button
                key={value}
                className={
                  feedType === value
                    ? "feed-type-button active"
                    : "feed-type-button"
                }
                onClick={() =>
                  setFeedType(
                    value as FeedType,
                  )
                }
              >
                {icon}
                <span>{label}</span>
              </button>
            ),
          )}
        </div>

        <label className="form-field">
          <span>Date and time</span>

          <input
            className="datetime-input"
            type="datetime-local"
            value={time}
            onChange={(event) =>
              setTime(
                event.target.value,
              )
            }
          />
        </label>

        {feedType === "bottle" && (
          <label className="form-field">
            <span>Amount</span>

            <div className="amount-input">
              <input
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="120"
                value={amount}
                onChange={(event) =>
                  setAmount(
                    event.target.value,
                  )
                }
              />

              <span>ml</span>
            </div>
          </label>
        )}

        {feedType === "breast" && (
          <div className="form-field">
            <span>Side</span>

            <div className="side-buttons">
              {[
                ["left", "Left"],
                ["right", "Right"],
                ["both", "Both"],
              ].map(
                ([value, label]) => (
                  <button
                    key={value}
                    className={
                      side === value
                        ? "side-button active"
                        : "side-button"
                    }
                    onClick={() =>
                      setSide(
                        value as FeedSide,
                      )
                    }
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>
        )}

        <label className="form-field">
          <span>Note</span>

          <textarea
            placeholder="Optional note..."
            value={note}
            onChange={(event) =>
              setNote(
                event.target.value,
              )
            }
          />
        </label>

        <button
          className="primary-button"
          onClick={handleSave}
          disabled={
            saving ||
            !time ||
            !currentBabyId
          }
        >
          {saving
            ? "Saving..."
            : feed
              ? "Save changes"
              : "Save feeding"}
        </button>
      </div>
    </div>
  );
}