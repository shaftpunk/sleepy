import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type { BabyId } from "../stores/appStore";

import {
  disablePushNotifications,
  enablePushNotifications,
  hasPushSubscription,
  sendTestNotification,
} from "../services/pushService";

import {
  getNotificationSettings,
  updateFeedingReminder,
  updateFeedingReminderMinutes,
} from "../services/notificationSettingsService";

interface NotificationSettingsProps {
  bbyid: BabyId;
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  return `${hours}h ${minutes}m`;
}

export default function NotificationSettings({
  bbyid,
}: NotificationSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [pushEnabled, setPushEnabled] =
    useState(false);

  const [
    feedingReminderEnabled,
    setFeedingReminderEnabled,
  ] = useState(false);

  const [
    feedingReminderMinutes,
    setFeedingReminderMinutes,
  ] = useState(180);

  const [message, setMessage] = useState<
    string | null
  >(null);

  const reminderOptions = useMemo(() => {
    const values: number[] = [];

    for (let minutes = 30; minutes <= 720; minutes += 30) {
      values.push(minutes);
    }

    return values;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setMessage(null);

        const [
          pushSubscriptionEnabled,
          settings,
        ] = await Promise.all([
          hasPushSubscription(),
          getNotificationSettings(bbyid),
        ]);

        if (cancelled) return;

        setPushEnabled(
          pushSubscriptionEnabled,
        );

        setFeedingReminderEnabled(
          settings.feeding_reminder_enabled,
        );

        setFeedingReminderMinutes(
          settings.feeding_reminder_minutes,
        );
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load notification settings.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [bbyid]);

  async function handleEnablePush() {
    try {
      setSaving(true);
      setMessage(null);

      await enablePushNotifications(bbyid);

      setPushEnabled(true);

      setMessage(
        "Push notifications enabled.",
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not enable notifications.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDisablePush() {
    try {
      setSaving(true);
      setMessage(null);

      await disablePushNotifications();

      setPushEnabled(false);

      setMessage(
        "Push notifications disabled.",
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not disable notifications.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleTestNotification() {
    try {
      setSaving(true);
      setMessage(null);

      await sendTestNotification(bbyid);

      setMessage(
        "Test notification sent.",
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not send test notification.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleFeedingReminderChange(
    enabled: boolean,
  ) {
    const previousValue =
      feedingReminderEnabled;

    setFeedingReminderEnabled(enabled);

    try {
      setSaving(true);
      setMessage(null);

      await updateFeedingReminder(
        bbyid,
        enabled,
      );

      setMessage(
        enabled
          ? "Feeding reminder enabled."
          : "Feeding reminder disabled.",
      );
    } catch (error) {
      console.error(error);

      setFeedingReminderEnabled(
        previousValue,
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update feeding reminder.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleReminderMinutesChange(
    minutes: number,
  ) {
    const previousValue =
      feedingReminderMinutes;

    setFeedingReminderMinutes(minutes);

    try {
      setSaving(true);
      setMessage(null);

      await updateFeedingReminderMinutes(
        bbyid,
        minutes,
      );

      setMessage(
        `Reminder set to ${formatMinutes(minutes)}.`,
      );
    } catch (error) {
      console.error(error);

      setFeedingReminderMinutes(
        previousValue,
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update reminder interval.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="notification-settings">
        <h2>Notifications</h2>

        <p>Loading notification settings...</p>
      </section>
    );
  }

  return (
    <section className="notification-settings">
      <div className="notification-settings__header">
        <div>
          <h2>Notifications</h2>

          <p>
            Notifications for{" "}
            <strong>{bbyid}</strong>
          </p>
        </div>

        <div
          className={
            pushEnabled
              ? "notification-status notification-status--enabled"
              : "notification-status"
          }
        >
          <span className="notification-status__dot" />

          {pushEnabled
            ? "Enabled"
            : "Disabled"}
        </div>
      </div>

      <div className="notification-settings__card">
        <div className="notification-setting-row">
          <div>
            <strong>Push notifications</strong>

            <p>
              Receive Sleepy notifications on
              this device.
            </p>
          </div>

          {pushEnabled ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleDisablePush}
            >
              Disable
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleEnablePush}
            >
              Enable
            </button>
          )}
        </div>
      </div>

      <div className="notification-settings__section-title">
        Feeding
      </div>

      <div className="notification-settings__card">
        <div className="notification-setting-row">
          <div>
            <strong>Feeding reminder</strong>

            <p>
              Get a reminder when enough time
              has passed since the last feeding.
            </p>
          </div>

          <label className="notification-toggle">
            <input
              type="checkbox"
              checked={
                feedingReminderEnabled
              }
              disabled={saving}
              onChange={(event) =>
                void handleFeedingReminderChange(
                  event.target.checked,
                )
              }
            />

            <span className="notification-toggle__slider" />
          </label>
        </div>

        {feedingReminderEnabled && (
          <div className="notification-reminder-time">
            <label htmlFor="feeding-reminder-time">
              Remind me after
            </label>

            <select
              id="feeding-reminder-time"
              value={
                feedingReminderMinutes
              }
              disabled={saving}
              onChange={(event) =>
                void handleReminderMinutesChange(
                  Number(
                    event.target.value,
                  ),
                )
              }
            >
              {reminderOptions.map(
                (minutes) => (
                  <option
                    key={minutes}
                    value={minutes}
                  >
                    {formatMinutes(
                      minutes,
                    )}
                  </option>
                ),
              )}
            </select>

            <p>
              You will receive one reminder
              after each feeding.
            </p>
          </div>
        )}
      </div>

      {!pushEnabled &&
        feedingReminderEnabled && (
          <div className="notification-settings__warning">
            Feeding reminders are enabled, but
            push notifications are disabled on
            this device.
          </div>
        )}

      {pushEnabled && (
        <button
          type="button"
          className="notification-settings__test"
          disabled={saving}
          onClick={handleTestNotification}
        >
          Send test notification
        </button>
      )}

      {message && (
        <p className="notification-settings__message">
          {message}
        </p>
      )}
    </section>
  );
}