import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { getActiveSleep, type SleepRecord } from "./sleepService";
import { getActiveSleepEstimate, subscribeSleepEstimateHistory } from "./sleepEstimateService";
import type { ActiveSleepClassification } from "../analytics/personalSleepClassification";
import { registerBeforeSignOut, sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";
import { liveActivityEnabled, saveLiveActivityEnabled } from "./liveActivityPreference";
import { supabase } from "../lib/supabase";
import { nativePushInstallationProof } from "./nativePushService";
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
type Bridge = {
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

function sendActivityToken(row: ActivityToken, userId: string, generation: number): Promise<void> {
  const current = () => owner === userId && isSessionGenerationCurrent(generation);
  const eligible = () => current() && liveActivityEnabled() && babies.some(baby => baby.id === row.babyId);
  const key = row.activityId;
  const operation = (tokenWrites.get(key) ?? Promise.resolve()).then(async () => {
    if (!row.revoked && (!eligible() || activityTokens.get(key) !== row || acknowledged.get(key) === row.revision)) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user.id !== userId || (!row.revoked && !eligible())) return;
    const authorization = "Bearer " + session.access_token;
    const args = { ...nativePushInstallationProof(), p_activity_id: key, p_revision: row.revision };
    if (row.revoked) {
      await supabase.rpc("revoke_live_activity_token", args).setHeader("Authorization", authorization).abortSignal(AbortSignal.timeout(4000));
      return;
    }
    const { data, error } = await supabase.rpc("register_live_activity_token", {
      ...args, p_sleep_id: row.sleepId, p_baby_id: row.babyId, p_environment: row.environment,
      p_push_token: row.token, p_expires_at: row.expiresAt,
    }).setHeader("Authorization", authorization).abortSignal(AbortSignal.timeout(4000));
    if (error || !current() || activityTokens.get(key) !== row) return;
    if (data === "already_ended") {
      acknowledged.set(key, row.revision);
      await bridge.endActivity({ ownerId: userId, activityId: key });
    } else if (data === "registered" || data === "unchanged") {
      acknowledged.set(key, row.revision);
    }
  }).catch(() => { /* Retry unacknowledged tokens on the next snapshot. */ });
  tokenWrites.set(key, operation);
  void operation.then(() => { if (tokenWrites.get(key) === operation) tokenWrites.delete(key); });
  return operation;
}

function receiveActivityToken(row: ActivityToken) {
  const userId = owner;
  if (!userId || row.ownerId !== userId.toLowerCase()) return;
  const previous = activityTokens.get(row.activityId);
  if (previous && (row.revision < previous.revision || previous.revoked)) return;
  if (row.revoked) {
    activityTokens.set(row.activityId, row);
    acknowledged.delete(row.activityId);
  } else {
    if (!liveActivityEnabled() || !babies.some(baby => baby.id === row.babyId)) return;
    if (previous?.revision === row.revision) row = previous;
    else activityTokens.set(row.activityId, row);
    if (tokenWrites.has(row.activityId) && previous === row) return;
  }
  void sendActivityToken(row, userId, sessionGeneration());
}

async function syncActivityTokens(userId: string, generation: number) {
  try {
    tokenListener ??= Promise.resolve(bridge.addListener("activityTokenChanged", receiveActivityToken)).catch(error => {
      tokenListener = undefined;
      throw error;
    });
    await tokenListener;
    if (owner !== userId || !isSessionGenerationCurrent(generation)) return;
    const { tokens } = await bridge.getActivityTokens();
    for (const [id, row] of activityTokens) {
      if (row.revoked && Date.parse(row.expiresAt) <= Date.now()) activityTokens.delete(id);
    }
    if (owner === userId && isSessionGenerationCurrent(generation)) tokens.forEach(receiveActivityToken);
  } catch { /* Older native bridges and failed snapshots recover on a later refresh. */ }
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
