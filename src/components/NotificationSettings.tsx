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
      .then((result) => {
        console.log("Existing push subscription:", result);
        setEnabled(result);
      })
      .catch((error) => {
        console.error(
          "Could not check push subscription:",
          error,
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [supported]);

  async function handleEnable() {
    alert("Enable clicked");

    try {
      setLoading(true);
      setMessage("");

      console.log("Push supported:", pushSupported());

      if ("Notification" in window) {
        console.log(
          "Current notification permission:",
          Notification.permission,
        );
      }

      console.log("Current bbyid:", currentBbyId);

      await enablePushNotifications(currentBbyId);

      console.log("Push notification subscription created.");

      setEnabled(true);
      setMessage("Notifications enabled.");

      alert("Notifications enabled.");
    } catch (error) {
      console.error(
        "Could not enable notifications:",
        error,
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not enable notifications.";

      setMessage(errorMessage);

      alert(errorMessage);
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

      alert("Notifications disabled.");
    } catch (error) {
      console.error(
        "Could not disable notifications:",
        error,
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not disable notifications.";

      setMessage(errorMessage);

      alert(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function handleTest() {
    try {
      setLoading(true);
      setMessage("");

      console.log(
        "Sending test notification for:",
        currentBbyId,
      );

      await sendTestNotification(currentBbyId);

      setMessage("Test notification sent.");

      alert("Test notification sent.");
    } catch (error) {
      console.error(
        "Could not send test notification:",
        error,
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not send test notification.";

      setMessage(errorMessage);

      alert(errorMessage);
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

      <p>
        Status: {enabled ? "Enabled" : "Disabled"}
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