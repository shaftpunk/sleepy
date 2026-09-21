import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { useTranslation } from "../i18n";

import {
  getSleepEventNotificationSettings,
  updateSleepEventNotificationSettings,
  type SleepEventNotificationSettings as SleepEventSettings,
} from "../services/notificationSettingsService";

interface Props {
  babyId: string;
  babyName: string;
}

export default function SleepEventNotificationSettings({
  babyId,
  babyName,
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SleepEventSettings>({
    notify_sleep_started: false,
    notify_sleep_ended: false,
  });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setMessage(null);

      try {
        const loaded = await getSleepEventNotificationSettings(
          userId,
          babyId,
        );

        if (!cancelled) {
          setSettings(loaded);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : t("errors.generic"),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, babyId]);

  async function handleChange(
    field: keyof SleepEventSettings,
    value: boolean,
  ) {
    if (!userId) return;

    const previous = settings;
    setSettings({ ...settings, [field]: value });
    setMessage(null);

    try {
      await updateSleepEventNotificationSettings(userId, babyId, {
        [field]: value,
      });
    } catch (error) {
      setSettings(previous);
      setMessage(
        error instanceof Error ? error.message : t("errors.generic"),
      );
    }
  }

  if (!userId) {
    return null;
  }

  return (
    <section className="settings-card">
      <div className="setting-copy">
        <p className="setting-title">{t("notifications.sleepEventsTitle")}</p>
      </div>

      {loading ? (
        <p className="muted">{t("notifications.sleepEventsLoading")}</p>
      ) : (
        <>
          <div className="notification-setting-row">
            <span>{t("notifications.notifyFallsAsleep", { name: babyName })}</span>

            <label className="notification-toggle">
              <input
                type="checkbox"
                checked={settings.notify_sleep_started}
                onChange={(event) =>
                  void handleChange("notify_sleep_started", event.target.checked)
                }
              />

              <span className="notification-toggle__slider" />
            </label>
          </div>

          <div className="notification-setting-row">
            <span>{t("notifications.notifyWakesUp", { name: babyName })}</span>

            <label className="notification-toggle">
              <input
                type="checkbox"
                checked={settings.notify_sleep_ended}
                onChange={(event) =>
                  void handleChange("notify_sleep_ended", event.target.checked)
                }
              />

              <span className="notification-toggle__slider" />
            </label>
          </div>
        </>
      )}

      {message && <p className="notification-settings__message">{message}</p>}
    </section>
  );
}
