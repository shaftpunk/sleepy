import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "../lib/supabase";
import { isSessionGenerationCurrent, registerBeforeSignOut, sessionGeneration } from "../auth/sessionLifecycle";

export type NativePushState = "not-requested" | "registering" | "enabled" | "denied" | "failed";
let state: NativePushState = "not-requested";
let userId: string | null = null;
let epoch = 0;
let context: { userId: string; epoch: number; generation: number } | undefined;
let ready: Promise<void> | undefined;
let writes: Promise<void> = Promise.resolve();
let pending: { resolve: () => void; reject: (error: Error) => void } | undefined;
let registration: Promise<void> | undefined;
let pendingPath: string | undefined;
let loggingOut = false;
const observers = new Set<() => void>();
const STORAGE_KEY = "sleepy-native-push-installation";
type Installation = { id: string; key: string; revision: number; owner: string | null };

export const isNativeIOS = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
export const nativePushState = () => state;
export function subscribeNativePush(listener: () => void): () => void {
  observers.add(listener);
  return () => { observers.delete(listener); };
}
function publish(next: NativePushState) { state = next; observers.forEach((listener) => listener()); }
function installation(create = true): Installation | null {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved) as Installation;
  if (!create) return null;
  const value: Installation = {
    id: crypto.randomUUID(),
    key: Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join(""),
    revision: 0, owner: null,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  return value;
}
function current(value: NonNullable<typeof context>) {
  return userId === value.userId && epoch === value.epoch && isSessionGenerationCurrent(value.generation);
}
function persist(token: string | null, owner: string | null): Promise<void> {
  const captured = owner ? { userId: owner, epoch, generation: sessionGeneration() } : undefined;
  const value = installation()!;
  value.revision++;
  value.owner = owner;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  const operation = writes.catch(() => {}).then(async () => {
    if (captured && !current(captured)) throw new Error("Notification session changed.");
    const { data, error } = await supabase.rpc("set_native_push_registration", {
      p_installation_id: value.id, p_installation_key: value.key, p_revision: value.revision,
      p_device_token: token, p_enabled: owner !== null,
    });
    if (error || data !== true) throw new Error("Native notification registration could not be saved. Please retry.");
  });
  writes = operation;
  return operation;
}
function fail() {
  publish("failed");
  pending?.reject(new Error("Native notification registration failed. Please retry."));
  pending = undefined;
}
async function initialize() {
  ready ??= (async () => {
    await PushNotifications.addListener("registration", ({ value }) => {
      const captured = context;
      if (!captured || !current(captured)) return;
      void persist(value, captured.userId).then(() => {
        if (!current(captured)) return;
        publish("enabled"); pending?.resolve(); pending = undefined;
      }, () => { if (current(captured)) fail(); });
    });
    await PushNotifications.addListener("registrationError", () => { if (context && current(context)) fail(); });
    await PushNotifications.addListener("pushNotificationReceived", () => {
      // iOS presents the configured foreground banner; never log its private payload.
      if (context && current(context)) observers.forEach(listener => listener());
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const path: unknown = notification.data?.url;
      if (typeof path === "string" && ["/", "/history", "/settings", "/analysis"].includes(path)) {
        pendingPath = path;
        observers.forEach(listener => listener());
      }
    });
  })();
  return ready;
}
export function consumeNativePushPath(): string | undefined {
  const value = pendingPath; pendingPath = undefined; return value;
}

export async function enableNativePush(): Promise<void> {
  if (loggingOut) throw new Error("Sign-out is in progress.");
  if (registration) return registration;
  registration = (async () => {
    if (!isNativeIOS() || !Capacitor.isPluginAvailable("PushNotifications")) {
      throw new Error("Native notifications are unavailable. Please install the latest Sleepy build.");
    }
    if (!userId) throw new Error("Sign in before enabling notifications.");
    const captured = { userId, epoch, generation: sessionGeneration() };
    await initialize();
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
      permission = await PushNotifications.requestPermissions();
    }
    if (!current(captured)) throw new Error("Notification session changed. Please retry.");
    if (permission.receive !== "granted") {
      publish("denied");
      throw new Error("Notifications are denied. Allow Sleepy notifications in iPhone Settings.");
    }
    const value = installation()!;
    value.owner = captured.userId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    context = captured;
    publish("registering");
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { context = undefined; fail(); }, 20000);
      pending = {
        resolve: () => { window.clearTimeout(timer); resolve(); },
        reject: error => { window.clearTimeout(timer); reject(error); },
      };
      void PushNotifications.register().catch(fail);
    });
  })().finally(() => { registration = undefined; });
  return registration;
}

export async function disableNativePush(): Promise<void> {
  epoch++; context = undefined; pendingPath = undefined;
  const started = epoch;
  pending?.reject(new Error("Notification registration cancelled.")); pending = undefined;
  // Keep the owner marker until the server confirms detach so offline logout can retry.
  const saved = installation(false);
  if (saved?.owner) {
    const previousOwner = saved.owner;
    try { await persist(null, null); }
    catch (error) {
      const latest = installation()!; latest.owner = previousOwner;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(latest));
      publish("failed"); throw error;
    }
  }
  if (epoch !== started) return;
  publish("not-requested");
  if (Capacitor.isPluginAvailable("PushNotifications")) await PushNotifications.unregister();
}

export async function setNativePushUser(nextUserId: string | null, refresh = false): Promise<void> {
  if (!isNativeIOS() || (userId === nextUserId && (!refresh || registration))) return;
  epoch++; context = undefined;
  pending?.reject(new Error("Notification session changed.")); pending = undefined;
  userId = nextUserId;
  loggingOut = false;
  const started = epoch;
  publish("not-requested");
  await initialize();
  if (epoch !== started || userId !== nextUserId) return;
  const saved = installation(false);
  if (!nextUserId) { await PushNotifications.unregister(); return; }
  if (saved?.owner && saved.owner !== nextUserId) {
    // Authenticated new account can detach using the installation credential,
    // but must explicitly opt in; it never inherits another user's registration.
    await disableNativePush();
  } else if (saved?.owner === nextUserId) {
    const permission = await PushNotifications.checkPermissions();
    if (epoch !== started || userId !== nextUserId) return;
    if (permission.receive === "granted") await enableNativePush();
    else { await disableNativePush(); publish("denied"); }
  } else {
    const permission = await PushNotifications.checkPermissions();
    if (epoch === started && permission.receive === "denied") publish("denied");
  }
}
registerBeforeSignOut(async () => {
  if (isNativeIOS()) { loggingOut = true; await disableNativePush(); }
});
