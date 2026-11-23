import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { getActiveSleep, type SleepRecord } from "./sleepService";
import { getActiveSleepEstimate, subscribeSleepEstimateHistory } from "./sleepEstimateService";
import type { ActiveSleepClassification } from "../analytics/personalSleepClassification";
import { registerBeforeSignOut, sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";
import { liveActivityEnabled, saveLiveActivityEnabled } from "./liveActivityPreference";
import { supabase } from "../lib/supabase";
import { nativePushInstallationPresence, nativePushInstallationProof } from "./nativePushService";
import type { SleepPresentationChange } from "./sleepPresentationEvents";

export type LiveActivityBaby = { id: string; name: string };
export type LiveSleep = { sleepId: string; babyId: string; babyName: string; startedAt: string;
  classification: ActiveSleepClassification; estimatedWakeTime: string | null };
type ActivityToken = {
  ownerId: string;
  activityId: string;
  sleepId: string;
  babyId: string;
  revision: number;
  expiresAt: string;
  environment: "production" | "sandbox";
} & ({ token: string; revoked?: false } | { revoked: true });
type NativeDiagnostic = {
  activityId?: string; sleepId?: string; babyId?: string; requested?: boolean;
  tokenPresent?: boolean; tokenBytes?: number; updateReceived?: boolean; observerActive?: boolean;
  snapshotContainsToken?: boolean; revision?: number; environment?: string;
};
type RegistrationDiagnostic = {
  activityId: string; sleepId: string; babyId: string; revision: number; environment: string;
  eventReceived?: boolean; lastAttempt?: string; lastSuccess?: string; result?: string;
  errorCode?: string; errorMessage?: string; dedupeSkipped?: boolean; staleFenced?: boolean; retryPending?: boolean;
};
type Bridge = {
  getActivityTokenDiagnostics(options: { ownerId: string }): Promise<NativeDiagnostic>;
  logActivityTokenDiagnostic(options: { phase: string; activityId?: string; sleepId?: string; revision?: number; tokenPresent?: boolean }): Promise<void>;
  getActivityTokens(): Promise<{ tokens: ActivityToken[] }>;
  endActivity(options: { ownerId: string; activityId: string }): Promise<void>;
  addListener(event: "activityTokenChanged", listener: (token: ActivityToken) => void): Promise<PluginListenerHandle>;
  setEnabled(options: { enabled: boolean }): Promise<void>;
  getAppInfo(): Promise<{ version: string; build: string }>;
  reconcile(options: { ownerId: string; sleeps: LiveSleep[] }): Promise<void>;
  startSleep(options: LiveSleep & { ownerId: string }): Promise<void>;
  updateSleep(options: { sleepId: string; soundMonitoringActive: boolean }): Promise<void>;
  endSleep(options: { sleepId: string }): Promise<void>;
  endAll(): Promise<void>;
  setContext(options: { ownerId: string; babyIds: string[] }): Promise<void>;
  reconcileBaby(options: { ownerId: string; babyId: string; activeSleepId: string | null }): Promise<void>;
  addListener(event: "foreground", listener: () => void): Promise<PluginListenerHandle>;
  addListener(event: "wakeSessionRefreshRequested", listener: (event: { ownerId: string; forceRefresh: boolean }) => void): Promise<PluginListenerHandle>;
  updatePresentation(options: LiveSleep & { ownerId: string }): Promise<void>;
  setAuthSession(options: { userId: string; accessToken: string; expiresAt: number; url: string; anonKey: string }): Promise<void>;
  clearAuthSession(): Promise<void>;
};
const bridge = registerPlugin<Bridge>("SleepyLiveActivity");
export { bridge as liveActivityBridge };
export const liveActivitiesSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("SleepyLiveActivity");
let owner: string | null = null, babies: LiveActivityBaby[] = [], revision = 0;
let work: Promise<void> = Promise.resolve();
let presented: { record: SleepRecord; payload: LiveSleep }[] = [];
let tokenListener: Promise<PluginListenerHandle> | undefined;
const activityTokens = new Map<string, ActivityToken>();
const acknowledged = new Map<string, number>();
const tokenWrites = new Map<string, Promise<void>>();

// Temporary, bounded diagnostic state. Store only metadata for the current account.
const diagnostics = new Map<string, RegistrationDiagnostic>();
let listenerInstalled = false;
let snapshotStatus = "Not read";
function recordRegistration(row: ActivityToken, patch: Partial<RegistrationDiagnostic>) {
  if (owner?.toLowerCase() !== row.ownerId) return;
  const previous = diagnostics.get(row.activityId);
  if (previous && previous.revision > row.revision) return;
  diagnostics.delete(row.activityId);
  diagnostics.set(row.activityId, { ...previous, activityId: row.activityId, sleepId: row.sleepId,
    babyId: row.babyId, revision: row.revision, environment: row.environment, ...patch });
  if (diagnostics.size > 8) diagnostics.delete(diagnostics.keys().next().value!);
}

export async function readLiveActivityDiagnostics() {
  const userId = owner, generation = sessionGeneration();
  const native = userId ? await Promise.resolve().then(() => bridge.getActivityTokenDiagnostics({ ownerId: userId })).catch(() => null) : null;
  if (owner !== userId || !isSessionGenerationCurrent(generation)) throw new Error("Account changed");
  const registration = native?.activityId ? diagnostics.get(native.activityId) : [...diagnostics.values()].at(-1);
  return { native, registration, ...nativePushInstallationPresence(), generation, listenerInstalled, snapshotStatus };
}

// Forward only explicit fields to the iOS device log, including on TestFlight.
function logActivityToken(phase: string, row?: ActivityToken) {
  const fields = row ? { activityId: row.activityId, sleepId: row.sleepId,
    revision: row.revision, tokenPresent: !row.revoked && Boolean(row.token) } : {};
  void Promise.resolve().then(() => bridge.logActivityTokenDiagnostic({ phase, ...fields })).catch(() => {});
}

function sendActivityToken(row: ActivityToken, userId: string, generation: number): Promise<void> {
  const current = () => owner === userId && isSessionGenerationCurrent(generation);
  const diagnose = (patch: Partial<RegistrationDiagnostic>) => {
    if (isSessionGenerationCurrent(generation)) recordRegistration(row, patch);
  };
  const eligible = () => current() && liveActivityEnabled() && babies.some(baby => baby.id === row.babyId);
  const key = row.activityId;
  const operation = (tokenWrites.get(key) ?? Promise.resolve()).then(async () => {
    if (!row.revoked && (!eligible() || activityTokens.get(key) !== row || acknowledged.get(key) === row.revision)) {
      diagnose(acknowledged.get(key) === row.revision ? { dedupeSkipped: true } : { staleFenced: true });
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user.id !== userId || (!row.revoked && !eligible())) {
      if (!row.revoked) {
        diagnose({ staleFenced: true, result: "Session or activity context rejected" });
        logActivityToken("context_rejected", row);
      }
      return;
    }
    const authorization = "Bearer " + session.access_token;
    const args = { ...nativePushInstallationProof(), p_activity_id: key, p_revision: row.revision };
    if (row.revoked) {
      await supabase.rpc("revoke_live_activity_token", args).setHeader("Authorization", authorization).abortSignal(AbortSignal.timeout(4000));
      return;
    }
    diagnose({ lastAttempt: new Date().toISOString(), result: "Pending",
      errorCode: undefined, errorMessage: undefined, retryPending: false });
    logActivityToken("rpc_attempt", row);
    const { data, error } = await supabase.rpc("register_live_activity_token", {
      ...args, p_sleep_id: row.sleepId, p_baby_id: row.babyId, p_environment: row.environment,
      p_push_token: row.token, p_expires_at: row.expiresAt,
    }).setHeader("Authorization", authorization).abortSignal(AbortSignal.timeout(4000));
    if (error) {
      // Only expose known server messages. Arbitrary upstream text can contain request data.
      const knownMessages = ["Authentication required", "Invalid installation credential", "Sleep unavailable", "Invalid Live Activity registration"];
      diagnose({ result: "Failed", retryPending: true,
        errorCode: /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(error.code) ? error.code : undefined,
        errorMessage: knownMessages.includes(error.message) ? error.message : "Registration request failed" });
      logActivityToken(["42501", "PGRST301", "PGRST302"].includes(error.code) ? "rpc_authorization_failed" : "rpc_failed", row);
      return;
    }
    if (data === "registered" || data === "unchanged" || data === "already_ended") logActivityToken("rpc_" + data, row);
    else logActivityToken("rpc_failed", row);
    if (!current() || activityTokens.get(key) !== row) {
      diagnose({ staleFenced: true });
      return;
    }
    const registered = data === "registered" || data === "unchanged";
    diagnose({ result: registered || data === "already_ended" ? data : "Unexpected RPC result",
      ...(registered ? { lastSuccess: new Date().toISOString() } : {}),
      retryPending: !registered && data !== "already_ended" });
    if (data === "already_ended") {
      acknowledged.set(key, row.revision);
      await bridge.endActivity({ ownerId: userId, activityId: key });
    } else if (data === "registered" || data === "unchanged") {
      acknowledged.set(key, row.revision);
    }
  }).catch(() => {
    if (!row.revoked) {
      diagnose({ result: "Failed", errorMessage: "Registration or bridge call failed", retryPending: true });
      logActivityToken("rpc_failed", row);
    }
  });
  tokenWrites.set(key, operation);
  void operation.then(() => { if (tokenWrites.get(key) === operation) tokenWrites.delete(key); });
  return operation;
}

function receiveActivityToken(row: ActivityToken, fromSnapshot = false) {
  logActivityToken(fromSnapshot ? "snapshot_token" : "native_event", row);
  const userId = owner;
  if (!userId || row.ownerId !== userId.toLowerCase()) { logActivityToken("context_rejected", row); return; }
  recordRegistration(row, fromSnapshot ? {} : { eventReceived: true });
  const previous = activityTokens.get(row.activityId);
  if (previous && (row.revision < previous.revision || previous.revoked)) { recordRegistration(row, { staleFenced: true }); return; }
  if (row.revoked) {
    activityTokens.set(row.activityId, row);
    acknowledged.delete(row.activityId);
  } else {
    if (!liveActivityEnabled() || !babies.some(baby => baby.id === row.babyId)) { logActivityToken("context_rejected", row); return; }
    if (previous?.revision === row.revision) row = previous;
    else activityTokens.set(row.activityId, row);
    if (tokenWrites.has(row.activityId) && previous === row) { recordRegistration(row, { dedupeSkipped: true }); return; }
  }
  if (fromSnapshot && previous === row && acknowledged.get(row.activityId) !== row.revision) logActivityToken("retry_on_snapshot", row);
  void sendActivityToken(row, userId, sessionGeneration());
}

async function syncActivityTokens(userId: string, generation: number) {
  try {
    tokenListener ??= Promise.resolve(bridge.addListener("activityTokenChanged", row => receiveActivityToken(row))).catch(error => {
      tokenListener = undefined;
      throw error;
    });
    await tokenListener;
    listenerInstalled = true;
    logActivityToken("listener_ready");
    if (owner !== userId || !isSessionGenerationCurrent(generation)) return;
    const { tokens } = await bridge.getActivityTokens();
    if (owner !== userId || !isSessionGenerationCurrent(generation)) return;
    snapshotStatus = "Read (" + tokens.length + ")";
    logActivityToken("snapshot_read");
    for (const [id, row] of activityTokens) {
      if (row.revoked && Date.parse(row.expiresAt) <= Date.now()) activityTokens.delete(id);
    }
    if (owner === userId && isSessionGenerationCurrent(generation)) tokens.forEach(row => receiveActivityToken(row, true));
  } catch {
    if (owner === userId && isSessionGenerationCurrent(generation)) snapshotStatus = "Failed";
    logActivityToken("snapshot_failed");
  }
}

function revokeActivityTokens(userId: string, keep: (row: ActivityToken) => boolean = () => false) {
  const operations = [];
  for (const row of activityTokens.values()) {
    if (row.revoked || keep(row)) continue;
    activityTokens.set(row.activityId, { ...row, revoked: true });
    acknowledged.delete(row.activityId);
    operations.push(sendActivityToken({ ...row, revoked: true }, userId, sessionGeneration()));
  }
  return Promise.all(operations);
}

function optional(operation: () => Promise<void>): Promise<void> {
  return Promise.resolve().then(operation).catch(() => { console.info("[Sleepy Live Activity] Optional presentation unavailable; sleep data is unchanged."); });
}
function enqueue(operation: () => Promise<void>): Promise<void> {
  work = work.catch(() => {}).then(() => optional(operation));
  return work;
}
export function configureSleepLiveActivities(userId: string | null, accessibleBabies: LiveActivityBaby[]): Promise<void> {
  const previousOwner = owner;
  const changedAccount = previousOwner !== null && previousOwner !== userId;
  if (previousOwner) void revokeActivityTokens(previousOwner, row =>
    previousOwner === userId && accessibleBabies.some(baby => baby.id === row.babyId));
  if (changedAccount) activityTokens.clear();
  if (previousOwner !== userId) { diagnostics.clear(); snapshotStatus = "Not read"; }
  owner = userId; babies = accessibleBabies.map(({ id, name }) => ({ id, name })); revision++;
  presented = [];
  if (!liveActivitiesSupported()) return Promise.resolve();
  void enqueue(() => bridge.setEnabled({ enabled: liveActivityEnabled() }));
  // Cleanup cannot queue behind an offline database request.
  if (changedAccount || !userId) void optional(() => bridge.endAll());
  if (userId) void optional(() => bridge.setContext({ ownerId: userId, babyIds: babies.map(baby => baby.id) }));
  return refreshSleepLiveActivities();
}
export async function applySleepPresentationChange(change: SleepPresentationChange): Promise<void> {
  if (!liveActivitiesSupported()) return;
  if (change.endedSleepId) {
    revision++;
    presented = presented.filter(snapshot => snapshot.record.id !== change.endedSleepId);
    await optional(() => bridge.endSleep({ sleepId: change.endedSleepId! }));
    return;
  }
  const snapshot = change.snapshot, userId = owner;
  if (snapshot) {
    if (!userId || !isSessionGenerationCurrent(snapshot.generation) || !babies.some(baby => baby.id === snapshot.babyId)) return;
    revision++;
    presented = presented.filter(item => item.payload.babyId !== snapshot.babyId || item.payload.sleepId === snapshot.activeSleepId);
    // This only removes obsolete activities; never creates from a partial read.
    await optional(() => bridge.reconcileBaby({ ownerId: userId, babyId: snapshot.babyId, activeSleepId: snapshot.activeSleepId }));
    if (snapshot.activeSleepId) await refreshSleepLiveActivities();
    return;
  }
  await refreshSleepLiveActivities();
}
export function refreshSleepLiveActivities(): Promise<void> {
  if (!liveActivitiesSupported()) return Promise.resolve();
  if (!liveActivityEnabled()) return enqueue(() => bridge.setEnabled({ enabled: false }));
  if (!owner || !babies.length || document.hidden) return Promise.resolve();
  const version = ++revision, userId = owner, catalog = babies, authGeneration = sessionGeneration();
  presented = [];
  return enqueue(async () => {
    if (!liveActivityEnabled() || version !== revision || owner !== userId || !isSessionGenerationCurrent(authGeneration)) return;
    await bridge.setEnabled({ enabled: true });
    void syncActivityTokens(userId, authGeneration);
    // A failed/incomplete read must never masquerade as "no active sleeps".
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    let rows;
    try { rows = await Promise.all(catalog.map(async baby => ({ baby, sleep: await getActiveSleep(baby.id, { notifyPresentation: false, signal: controller.signal }) }))); }
    finally { clearTimeout(timeout); }
    if (version !== revision || owner !== userId || document.hidden || !isSessionGenerationCurrent(authGeneration)) return;
    if (rows.some(({ baby, sleep }) => sleep && sleep.baby_id !== baby.id)) throw new Error("Incomplete sleep presentation snapshot");
    const snapshots = (await Promise.all(rows.map(async ({ baby, sleep }) => {
      if (!sleep || sleep.endtime || sleep.deleted_at) return null;
      const estimate = await getActiveSleepEstimate(sleep);
      return { record: sleep, payload: { sleepId: sleep.id, babyId: baby.id, babyName: baby.name,
        startedAt: sleep.starttime, ...estimate } };
    }))).filter(snapshot => snapshot !== null);
    if (version !== revision || owner !== userId || document.hidden || !isSessionGenerationCurrent(authGeneration)) return;
    await bridge.reconcile({ ownerId: userId, sleeps: snapshots.map(snapshot => snapshot.payload) });
    presented = snapshots;
    void syncActivityTokens(userId, authGeneration);
  });
}
export async function setSleepLiveActivitiesEnabled(enabled: boolean): Promise<void> {
  saveLiveActivityEnabled(enabled);
  revision++;
  presented = [];
  if (!liveActivitiesSupported()) return;
  // Do not wait for an offline/in-flight database read to dismiss presentation.
  // The native plugin serializes bridge calls; revision fences the old read.
  if (!enabled && owner) void revokeActivityTokens(owner);
  await bridge.setEnabled({ enabled });
  if (liveActivityEnabled()) await refreshSleepLiveActivities();
}
export async function clearSleepLiveActivities(): Promise<void> {
  const revocation = owner ? revokeActivityTokens(owner) : Promise.resolve();
  activityTokens.clear();
  diagnostics.clear();
  snapshotStatus = "Not read";
  revision++; owner = null; babies = [];
  presented = [];
  if (liveActivitiesSupported()) await optional(() => bridge.endAll());
  await revocation;
}
// ActivityKit errors must never block logout, unlike authenticated push detach.
registerBeforeSignOut(clearSleepLiveActivities);

// A normal history read may finish after the activity was created. Update only
// existing matching activities, without a database read or a new activity request.
export function refreshSleepLiveActivityEstimates(): Promise<void> {
  if (!liveActivityEnabled() || !liveActivitiesSupported() || !owner || document.hidden) return Promise.resolve();
  const version = revision, userId = owner, generation = sessionGeneration();
  return enqueue(async () => {
    if (version !== revision || owner !== userId || document.hidden || !isSessionGenerationCurrent(generation)) return;
    for (const snapshot of presented) {
      const estimate = await getActiveSleepEstimate(snapshot.record);
      if (version !== revision || owner !== userId || document.hidden || !isSessionGenerationCurrent(generation)) return;
      if (snapshot.payload.classification === estimate.classification && snapshot.payload.estimatedWakeTime === estimate.estimatedWakeTime) continue;
      const payload = { ...snapshot.payload, ...estimate };
      await bridge.updatePresentation({ ownerId: userId, ...payload });
      snapshot.payload = payload;
    }
  });
}
subscribeSleepEstimateHistory(() => { void refreshSleepLiveActivityEstimates(); });
