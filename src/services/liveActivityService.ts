import { Capacitor, registerPlugin } from "@capacitor/core";
import { getActiveSleep, type SleepRecord } from "./sleepService";
import { getActiveSleepEstimate, subscribeSleepEstimateHistory } from "./sleepEstimateService";
import type { ActiveSleepClassification } from "../analytics/personalSleepClassification";
import { registerBeforeSignOut, sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";

export type LiveActivityBaby = { id: string; name: string };
export type LiveSleep = { sleepId: string; babyId: string; babyName: string; startedAt: string;
  classification: ActiveSleepClassification; estimatedWakeTime: string | null };
type Bridge = {
  reconcile(options: { ownerId: string; sleeps: LiveSleep[] }): Promise<void>;
  startSleep(options: LiveSleep & { ownerId: string }): Promise<void>;
  updateSleep(options: { sleepId: string; soundMonitoringActive: boolean }): Promise<void>;
  endSleep(options: { sleepId: string }): Promise<void>;
  endAll(): Promise<void>;
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
function optional(operation: () => Promise<void>): Promise<void> {
  return Promise.resolve().then(operation).catch(() => { console.info("[Sleepy Live Activity] Optional presentation unavailable; sleep data is unchanged."); });
}
function enqueue(operation: () => Promise<void>): Promise<void> {
  work = work.catch(() => {}).then(() => optional(operation));
  return work;
}
export function configureSleepLiveActivities(userId: string | null, accessibleBabies: LiveActivityBaby[]): Promise<void> {
  const changedAccount = owner !== null && owner !== userId;
  owner = userId; babies = accessibleBabies.map(({ id, name }) => ({ id, name })); revision++;
  presented = [];
  if (!liveActivitiesSupported()) return Promise.resolve();
  if (changedAccount || !userId) void enqueue(() => bridge.endAll());
  return refreshSleepLiveActivities();
}
export function refreshSleepLiveActivities(): Promise<void> {
  if (!liveActivitiesSupported() || !owner || !babies.length || document.hidden) return Promise.resolve();
  const version = ++revision, userId = owner, catalog = babies, authGeneration = sessionGeneration();
  presented = [];
  return enqueue(async () => {
    if (version !== revision || owner !== userId || !isSessionGenerationCurrent(authGeneration)) return;
    // A failed/incomplete read must never masquerade as "no active sleeps".
    const rows = await Promise.all(catalog.map(async baby => ({ baby, sleep: await getActiveSleep(baby.id) })));
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
  });
}
export function clearSleepLiveActivities(): Promise<void> {
  revision++; owner = null; babies = [];
  presented = [];
  return liveActivitiesSupported() ? enqueue(() => bridge.endAll()) : Promise.resolve();
}
// ActivityKit errors must never block logout, unlike authenticated push detach.
registerBeforeSignOut(clearSleepLiveActivities);

// A normal history read may finish after the activity was created. Update only
// existing matching activities, without a database read or a new activity request.
export function refreshSleepLiveActivityEstimates(): Promise<void> {
  if (!liveActivitiesSupported() || !owner || document.hidden) return Promise.resolve();
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
