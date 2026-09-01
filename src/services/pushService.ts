import { supabase } from "../lib/supabase";
import { useAppStore, type BabyId } from "../stores/appStore";
import { translate, type TranslationKey } from "../i18n";

function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(useAppStore.getState().language, key, params);
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Converts the URL-safe Base64 VAPID public key
 * into an ArrayBuffer accepted by PushManager.
 */
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);

  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);

  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray.buffer;
}

/**
 * Check whether the current browser/device supports Web Push.
 */
export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Returns the browser's current notification permission.
 */
export function getNotificationPermission(): NotificationPermission {
  if (!("Notification" in window)) {
    return "denied";
  }

  return Notification.permission;
}

/**
 * Enable push notifications and store the subscription in Supabase.
 */
export async function enablePushNotifications(
  bbyid: BabyId,
): Promise<PushSubscription> {
  if (!pushSupported()) {
    throw new Error(
      t("notifications.errorPushNotSupported"),
    );
  }

  if (!VAPID_PUBLIC_KEY) {
    throw new Error(
      t("notifications.errorVapidKeyMissing"),
    );
  }

  /*
   * Important for iPhone:
   * Notification.requestPermission() must ultimately be triggered
   * by a user action, such as pressing the Enable notifications button.
   */
  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error(
      t("notifications.errorPermissionDenied"),
    );
  }

  /*
   * Wait until the PWA service worker is active.
   */
  const registration = await navigator.serviceWorker.ready;

  /*
   * Check if this device already has a subscription.
   */
  let subscription =
    await registration.pushManager.getSubscription();

  /*
   * If not, create one using our VAPID public key.
   */
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey:
        urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY),
    });
  }

  const subscriptionJson = subscription.toJSON();

  if (
    !subscriptionJson.endpoint ||
    !subscriptionJson.keys?.p256dh ||
    !subscriptionJson.keys?.auth
  ) {
    throw new Error(
      t("notifications.errorInvalidPushSubscription"),
    );
  }

  /*
   * Save/update the subscription in Supabase.
   *
   * endpoint is unique in push_subscriptions, so the same
   * device won't create duplicate rows.
   */
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        bbyid,
        endpoint: subscriptionJson.endpoint,
        p256dh: subscriptionJson.keys.p256dh,
        auth: subscriptionJson.keys.auth,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "endpoint",
      },
    );

  if (error) {
    throw new Error(
      t("notifications.errorCouldNotSaveSubscription", { error: error.message }),
    );
  }

  return subscription;
}

/**
 * Disable notifications for this device.
 *
 * Removes the subscription from Supabase first,
 * then unsubscribes the browser.
 */
export async function disablePushNotifications(): Promise<void> {
  if (!pushSupported()) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;

  const subscription =
    await registration.pushManager.getSubscription();

  if (!subscription) {
    return;
  }

  const endpoint = subscription.endpoint;

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) {
    throw new Error(
      t("notifications.errorCouldNotRemoveSubscription", { error: error.message }),
    );
  }

  const success = await subscription.unsubscribe();

  if (!success) {
    console.warn(
      "The browser did not confirm that the push subscription was removed.",
    );
  }
}

/**
 * Check whether this browser already has an active
 * push subscription.
 */
export async function hasPushSubscription(): Promise<boolean> {
  if (!pushSupported()) {
    return false;
  }

  if (Notification.permission !== "granted") {
    return false;
  }

  const registration = await navigator.serviceWorker.ready;

  const subscription =
    await registration.pushManager.getSubscription();

  return subscription !== null;
}

/**
 * Ask the Supabase Edge Function to send a test push
 * to subscriptions belonging to the selected baby/profile.
 */
export async function sendTestNotification(
  bbyid: BabyId,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke(
    "send-push",
    {
      body: {
        bbyid,
        title: t("notifications.testTitle"),
        body: t("notifications.testBody"),
        url: "/",
      },
    },
  );

  if (error) {
    throw new Error(
      t("notifications.errorCouldNotSendTestDetailed", { error: error.message }),
    );
  }

  if (data?.error) {
    throw new Error(
      t("notifications.errorCouldNotSendTestDetailed", { error: data.error }),
    );
  }

  console.log("Push test result:", data);
}