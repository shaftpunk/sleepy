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

import { useTranslation } from "../i18n";

interface NotificationSettingsProps {
  bbyid: BabyId;
}

export default function NotificationSettings({
  bbyid,
}: NotificationSettingsProps) {
  const { t } = useTranslation();

  function formatMinutes(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) {
      return t("notifications.durationMin", { minutes });
    }

    if (minutes === 0) {
      return t(
        hours === 1
          ? "notifications.durationHourSingular"
          : "notifications.durationHourPlural",
        { hours },
      );
    }

    return t("notifications.durationHoursMinutes", { hours, minutes });
  }

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
              : t("notifications.errorCouldNotLoad"),
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
  }, [bbyid, t]);

  async function handleEnablePush() {
    try {
      setSaving(true);
      setMessage(null);

      await enablePushNotifications(bbyid);

      setPushEnabled(true);

      setMessage(
        t("notifications.messageEnabled"),
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error instanceof Error
          ? error.message
          : t("notifications.errorCouldNotEnable"),
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
        t("notifications.messageDisabled"),
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error instanceof Error
          ? error.message
          : t("notifications.errorCouldNotDisable"),
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
        t("notifications.messageTestSent"),
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error instanceof Error
          ? error.message
          : t("notifications.errorCouldNotSendTest"),
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
          ? t("notifications.messageFeedingReminderEnabled")
          : t("notifications.messageFeedingReminderDisabled"),
      );
    } catch (error) {
      console.error(error);

      setFeedingReminderEnabled(
        previousValue,
      );

      setMessage(
        error instanceof Error
          ? error.message
          : t("notifications.errorCouldNotUpdateFeedingReminder"),
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
        t("notifications.messageReminderSetTo", { duration: formatMinutes(minutes) }),
      );
    } catch (error) {
      console.error(error);

      setFeedingReminderMinutes(
        previousValue,
      );

      setMessage(
        error instanceof Error
          ? error.message
          : t("notifications.errorCouldNotUpdateReminderInterval"),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="notification-settings">
        <h2>{t("notifications.heading")}</h2>

        <p>{t("notifications.loadingSettings")}</p>
      </section>
    );
  }

  return (
    <section className="notification-settings">
      <div className="notification-settings__header">
        <div>
          <h2>{t("notifications.heading")}</h2>

          <p>
            {t("notifications.notificationsFor")}{" "}
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
            ? t("notifications.enabled")
            : t("notifications.disabled")}
        </div>
      </div>

      <div className="notification-settings__card">
        <div className="notification-setting-row">
          <div>
            <strong>{t("notifications.pushNotifications")}</strong>

            <p>
              {t("notifications.pushDescription")}
            </p>
          </div>

          {pushEnabled ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleDisablePush}
            >
              {t("notifications.disableButton")}
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleEnablePush}
            >
              {t("notifications.enableButton")}
            </button>
          )}
        </div>
      </div>

      <div className="notification-settings__section-title">
        {t("common.feeding")}
      </div>

      <div className="notification-settings__card">
        <div className="notification-setting-row">
          <div>
            <strong>{t("notifications.feedingReminderTitle")}</strong>

            <p>
              {t("notifications.feedingReminderDescription")}
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
              {t("notifications.remindMeAfter")}
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
              {t("notifications.oneReminderNote")}
            </p>
          </div>
        )}
      </div>

      {!pushEnabled &&
        feedingReminderEnabled && (
          <div className="notification-settings__warning">
            {t("notifications.warningPushDisabled")}
          </div>
        )}

      {pushEnabled && (
        <button
          type="button"
          className="notification-settings__test"
          disabled={saving}
          onClick={handleTestNotification}
        >
          {t("notifications.sendTestButton")}
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
