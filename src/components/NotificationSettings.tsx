import { useEffect, useState } from "react";
import { useAppStore } from "../stores/appStore";

import {
  disablePushNotifications,
  enablePushNotifications,
  hasPushSubscription,
  pushSupported,
  sendTestNotification,
} from "../services/pushService";

export default function NotificationSettings() {
  const currentBbyId = useAppStore(
    (state) => state.currentBbyId,
  );

  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const supported = pushSupported();

  useEffect(() => {
    if (!supported) {
      setLoading(false);
      return;
    }

    hasPushSubscription()
      .then(setEnabled)
      .catch((error) => {
        console.error("Could not check push subscription:", error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [supported]);

  async function handleEnable() {
    try {
      setLoading(true);
      setMessage("");

      await enablePushNotifications(currentBbyId);

      setEnabled(true);
      setMessage("Notifications enabled.");
    } catch (error) {
      console.error("Could not enable notifications:", error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not enable notifications.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    try {
      setLoading(true);
      setMessage("");

      await disablePushNotifications();

      setEnabled(false);
      setMessage("Notifications disabled.");
    } catch (error) {
      console.error("Could not disable notifications:", error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not disable notifications.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleTest() {
    try {
      setLoading(true);
      setMessage("");

      await sendTestNotification(currentBbyId);

      setMessage("Test notification sent.");
    } catch (error) {
      console.error("Could not send test notification:", error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not send test notification.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!supported) {
    return (
      <section className="settings-card">
        <h2>Notifications</h2>

        <p>
          Push notifications are not available in this browser.
        </p>

        <p>
          On iPhone, install Sleepy to the Home Screen first.
        </p>
      </section>
    );
  }

  return (
    <section className="settings-card">
      <h2>Notifications</h2>

      <p>
        Receive Sleepy notifications even when the app is closed.
      </p>

      {!enabled ? (
        <button
          type="button"
          onClick={handleEnable}
          disabled={loading}
        >
          {loading
            ? "Enabling..."
            : "Enable notifications"}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={handleTest}
            disabled={loading}
          >
            {loading
              ? "Sending..."
              : "Send test notification"}
          </button>

          <button
            type="button"
            onClick={handleDisable}
            disabled={loading}
          >
            Disable notifications
          </button>
        </>
      )}

      {message && (
        <p className="settings-message">
          {message}
        </p>
      )}
    </section>
  );
}