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

// TEMPORARY TestFlight diagnostics. Remove after the persistence failure is
// identified. Never pass raw plugin errors, sessions, RPC args or storage here.
function diagnostic(stage: string, facts: Record<string, string | number | boolean | null> = {}) {
  console.info(`[Sleepy native push] ${stage}`, facts);
}
function safeErrorFields(error: unknown, secrets: (string | null)[] = []) {
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const sanitize = (value: unknown) => {
    if (typeof value !== "string") return null;
    let text = value;
    for (const secret of secrets) {
      if (secret) text = text.split(secret).join("[redacted]").split(secret.toUpperCase()).join("[redacted]");
    }
    return text.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted JWT]")
      .replace(/\b[a-fA-F0-9]{32,}\b/g, "[redacted hex]");
  };
  return { code: sanitize(fields.code), message: sanitize(fields.message), details: sanitize(fields.details), hint: sanitize(fields.hint) };
}
class NativePushPersistenceError extends Error {}
function persistenceError(stage: string, error?: unknown, secrets: (string | null)[] = []): Error {
  const fields = safeErrorFields(error, secrets);
  console.error(`[Sleepy native push] ${stage}`, fields);
  const code = fields.code && /^[A-Z0-9_-]{1,32}$/i.test(fields.code) ? `:${fields.code}` : "";
  const action = stage.startsWith("detach:") ? "removed" : "saved";
  return new NativePushPersistenceError(`Native notification registration could not be ${action}. Please retry. [${stage}${code}]`);
}
function tokenFacts(token: string | null) {
  return { tokenLength: token?.length ?? 0, tokenHexOnly: token !== null && /^[a-fA-F0-9]+$/.test(token),
    tokenLengthValid: token !== null && token.length >= 32 && token.length <= 512 };
}

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
async function persist(token: string | null, owner: string | null): Promise<void> {
  const captured = owner ? { userId: owner, epoch, generation: sessionGeneration() } : undefined;
  const authenticatedUserId = userId;
  const action = owner ? "attach" : "detach";
  let value: Installation;
  try {
    const saved = installation();
    if (!saved || typeof saved !== "object") throw new Error("Invalid installation storage");
    value = saved;
  }
  catch { throw persistenceError(`${action}:installation-storage`); }
  const installationIdValid = typeof value.id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id);
  const installationKeyValid = typeof value.key === "string" && /^[a-f0-9]{64}$/.test(value.key);
  const revisionValid = Number.isSafeInteger(value.revision) && value.revision >= 0 && value.revision < Number.MAX_SAFE_INTEGER;
  const facts = tokenFacts(token);
  diagnostic(`${action}: validate`, { installationId: installationIdValid ? value.id : "invalid", installationIdValid,
    installationKeyValid, revisionValid, ...facts });
  if (!installationIdValid || !installationKeyValid || !revisionValid || (owner && (!facts.tokenHexOnly || !facts.tokenLengthValid))) {
    return Promise.reject(persistenceError(`${action}:validation`));
  }
  value.revision++;
  value.owner = owner;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
  catch { throw persistenceError(`${action}:installation-storage`); }
  const operation = writes.catch(() => {}).then(async () => {
    if (captured && !current(captured)) throw new Error("Notification session changed.");
    // getSession waits for Supabase's persisted-session initialization. Never
    // infer authentication solely from the service's cached userId.
    const { data: auth, error: authError } = await supabase.auth.getSession().catch(error => {
      throw persistenceError(`${action}:session`, error, [value.key, token]);
    });
    const sessionUser = auth.session?.user.id;
    const sessionMatches = Boolean(sessionUser && sessionUser === authenticatedUserId && userId === authenticatedUserId);
    diagnostic(`${action}: session`, { authenticatedUserExists: Boolean(sessionUser), sessionMatches,
      installationId: value.id, revision: value.revision });
    if (authError || !sessionMatches) throw persistenceError(`${action}:session`, authError, [value.key, token]);
    if (captured && !current(captured)) throw new Error("Notification session changed.");
    diagnostic(`${action}: RPC start`, { installationId: value.id, revision: value.revision, enabled: owner !== null, ...facts });
    let result;
    try {
      result = await supabase.rpc("set_native_push_registration", {
        p_installation_id: value.id, p_installation_key: value.key, p_revision: value.revision,
        p_device_token: token, p_enabled: owner !== null,
      });
    } catch (error) { throw persistenceError(`${action}:rpc`, error, [value.key, token]); }
    const { data, error } = result;
    if (error) throw persistenceError(`${action}:rpc`, error, [value.key, token]);
    if (data !== true) {
      diagnostic(`${action}: RPC rejected revision`, { installationId: value.id, revision: value.revision, returnedFalse: data === false });
      throw persistenceError(`${action}:rpc-result`, { code: data === false ? "STALE_REVISION" : "UNEXPECTED_RESULT" });
    }
    diagnostic(`${action}: RPC saved`, { installationId: value.id, revision: value.revision });
  }).catch(error => {
    if (error instanceof NativePushPersistenceError) throw error;
    throw persistenceError(`${action}:unexpected`, error, [value.key, token]);
  });
  writes = operation;
  return operation;
}
function fail(error?: Error) {
  publish("failed");
  pending?.reject(error ?? new Error("Native notification registration failed. Please retry."));
  pending = undefined;
}
async function initialize() {
  ready ??= (async () => {
    await PushNotifications.addListener("registration", ({ value }) => {
      diagnostic("registration event", tokenFacts(value));
      const captured = context;
      if (!captured || !current(captured)) { diagnostic("registration event ignored: no current session"); return; }
      void persist(value, captured.userId).then(() => {
        if (!current(captured)) return;
        publish("enabled"); pending?.resolve(); pending = undefined;
      }, error => { if (current(captured)) fail(error); });
    });
    await PushNotifications.addListener("registrationError", error => {
      console.error("[Sleepy native push] registrationError event", safeErrorFields({ message: error.error }));
      if (context && current(context)) fail();
    });
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
    let permission = await PushNotifications.checkPermissions().catch(error => {
      console.error("[Sleepy native push] permission check failed", safeErrorFields(error));
      throw new Error("Native notification permission check failed. Please retry. [permission:check]");
    });
    diagnostic("permission checked", { receive: permission.receive, cachedUserExists: Boolean(userId) });
    if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
      permission = await PushNotifications.requestPermissions().catch(error => {
        console.error("[Sleepy native push] permission request failed", safeErrorFields(error));
        throw new Error("Native notification permission request failed. Please retry. [permission:request]");
      });
      diagnostic("permission requested", { receive: permission.receive });
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
      const timer = window.setTimeout(() => { diagnostic("registration timed out"); context = undefined; fail(); }, 20000);
      pending = {
        resolve: () => { window.clearTimeout(timer); resolve(); },
        reject: error => { window.clearTimeout(timer); reject(error); },
      };
      diagnostic("PushNotifications.register called");
      void PushNotifications.register().then(() => {
        // Resolution only confirms the request was submitted, not an APNs token.
        diagnostic("PushNotifications.register resolved");
      }, error => {
        console.error("[Sleepy native push] PushNotifications.register rejected", safeErrorFields(error));
        fail();
      });
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
