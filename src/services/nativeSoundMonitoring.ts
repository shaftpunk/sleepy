import { Capacitor } from "@capacitor/core";
import { nativeSoundMeter, type NativeSoundStatus } from "./nativeSoundInput";
import { THRESHOLDS, type Sensitivity } from "../sound/detector";
import { SoundDisplayEnvelope } from "../sound/displayLevel";
import { supabase } from "../lib/supabase";
import { createSoundEvent } from "./soundEventService";
import { registerBeforeSignOut, sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";

type State = NativeSoundStatus & { level: number; rms: number; syncFailed: boolean };
let state: State = { active: false, running: false, status: "off", queueCount: 0, level: 0, rms: 0, syncFailed: false };
let userId: string | null = null;
let ready: Promise<void> | undefined;
let syncing: Promise<void> | undefined;
let syncOwner: string | null = null;
let startPending: Promise<void> | undefined;
let generation = 0;
let display = new SoundDisplayEnvelope();
let lastVisual = 0, lastLog = 0;
const observers = new Set<() => void>();
export const nativeSoundSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
export const nativeSoundSnapshot = () => state;
export const subscribeNativeSound = (listener: () => void) => { observers.add(listener); return () => { observers.delete(listener); }; };
function publish(next: Partial<State>) { state = { ...state, ...next }; observers.forEach(listener => listener()); }
function acceptStatus(value: NativeSoundStatus) {
  if (value.active && value.userId !== userId) return;
  const storageStopped = ["queue-full", "metadata-storage-failed"].includes(value.stopReason ?? "");
  const captureFailed = ["audio-stalled", "start-failed", "invalid-input-format", "unrecoverable-input"].includes(value.stopReason ?? "");
  publish({ ...value, status: value.stopReason === "permission-revoked" ? "blocked" : storageStopped || captureFailed ? "error" : value.status,
    syncFailed: storageStopped || state.syncFailed, level: value.running ? state.level : 0 });
}
async function initialize() {
  ready ??= (async () => {
    await nativeSoundMeter.addListener("level", value => {
      if (!state.active || value.runId !== state.runId || state.userId !== userId || document.hidden) return;
      if (![value.rms, value.displayRms].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return;
      const now = Date.now();
      if (now - lastVisual < 50) return; // Never render React at audio-buffer rate.
      const elapsed = lastVisual ? Math.min(200, now - lastVisual) : 60; lastVisual = now;
      const level = display.update(value.displayRms, elapsed);
      publish({ rms: value.rms, level, status: value.detected ? "detected" : "listening", running: true });
      if (now - lastLog >= 1000) {
        lastLog = now;
        console.info("[Sleepy sound] display calibration", { rms: value.rms, dbFS: value.dbFS, displayLevel: level });
      }
    });
    await nativeSoundMeter.addListener("state", value => { acceptStatus(value); if (userId) void synchronizeNativeSoundEvents().catch(() => {}); });
    await nativeSoundMeter.addListener("stopped", event => {
      if (event.runId === state.runId) publish({ active: false, running: false, status: "off", level: 0 });
      void nativeSoundMeter.getState().then(acceptStatus).catch(() => {});
      if (userId) void synchronizeNativeSoundEvents().catch(() => {});
    });
    await nativeSoundMeter.addListener("eventsAvailable", () => { if (!document.hidden) void synchronizeNativeSoundEvents().catch(() => {}); });
  })();
  return ready;
}
export async function stopNativeSound(reason = "explicit-stop") {
  generation++;
  const actual = await nativeSoundMeter.getState();
  if (actual.active && actual.runId) await nativeSoundMeter.stop({ runId: actual.runId, reason });
  publish({ active: false, running: false, status: "off", level: 0 });
}
export async function reconcileNativeSound(nextUser: string | null, babyId: string | null, enabled: boolean, sensitivity?: Sensitivity) {
  if (!nativeSoundSupported()) return;
  if (userId !== nextUser) {
    generation++;
    publish({ active: false, running: false, status: "off", level: 0, rms: 0 });
  }
  userId = nextUser;
  await initialize();
  const actual = await nativeSoundMeter.getState();
  if (actual.active && (!enabled || actual.userId !== nextUser || (babyId && actual.babyId !== babyId) || (sensitivity && actual.threshold !== THRESHOLDS[sensitivity]))) await stopNativeSound("account-baby-or-preference-changed");
  else acceptStatus(actual);
  if (nextUser) await synchronizeNativeSoundEvents();
}
export async function startNativeSound(options: { userId: string; babyId: string; sleepId: string; sensitivity: Sensitivity }) {
  if (startPending) return startPending;
  userId = options.userId;
  const captured = generation, authGeneration = sessionGeneration();
  startPending = (async () => {
    await initialize().catch(error => { publish({ status: "unavailable" }); throw error; });
    const auth = await supabase.auth.getUser();
    if (auth.error || auth.data.user?.id !== options.userId) { publish({ status: "error" }); throw new Error("Sign in before monitoring"); }
    if (captured !== generation || !isSessionGenerationCurrent(authGeneration)) return;
    const actual = await nativeSoundMeter.getState();
    if (captured !== generation || !isSessionGenerationCurrent(authGeneration) || userId !== options.userId) return;
    if (actual.active) {
      if (actual.userId !== options.userId || actual.babyId !== options.babyId || actual.sleepId !== options.sleepId) {
        await stopNativeSound("previous-session"); throw new Error("Previous monitoring stopped; tap Start again");
      }
      acceptStatus(actual); return;
    }
    display = new SoundDisplayEnvelope(); lastVisual = 0;
    publish({ status: "starting" });
    try {
      const { data: lease, error: leaseError } = await supabase.functions.invoke("sound-monitor-status", { body: { action: "issue", sleepId: options.sleepId } });
      if (leaseError || !lease || typeof lease.token !== "string" || typeof lease.url !== "string" || !Number.isFinite(lease.expiresAt)) {
        throw Object.assign(new Error("Monitoring validity service unavailable", { cause: leaseError }), { code: "LEASE_UNAVAILABLE" });
      }
      if (captured !== generation || !isSessionGenerationCurrent(authGeneration) || userId !== options.userId) return;
      await nativeSoundMeter.start({ runId: crypto.randomUUID(), userId: options.userId, babyId: options.babyId,
        sleepId: options.sleepId, threshold: THRESHOLDS[options.sensitivity], lease });
      if (captured !== generation || !isSessionGenerationCurrent(authGeneration) || userId !== options.userId) { await stopNativeSound("cancelled-start"); return; }
      acceptStatus(await nativeSoundMeter.getState());
    } catch (error) {
      if (captured !== generation || !isSessionGenerationCurrent(authGeneration)) return;
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      publish({ status: code === "PERMISSION_DENIED" ? "blocked" : code === "UNAVAILABLE" ? "unavailable" : code === "LEASE_UNAVAILABLE" ? "validation-error" : "error", active: false, running: false,
        syncFailed: code === "QUEUE_FULL" || state.syncFailed });
      throw new Error("Could not start sound monitoring", { cause: error });
    }
  })().finally(() => { startPending = undefined; });
  return startPending;
}
export async function validateNativeSoundSleep() {
  if (!nativeSoundSupported()) return;
  const actual = await nativeSoundMeter.getState();
  acceptStatus(actual);
  if (!actual.active || !actual.sleepId || actual.userId !== userId) return;
  const captured = generation;
  const { data, error } = await supabase.from("sleep").select("id,baby_id,endtime,deleted_at").eq("id", actual.sleepId).single();
  if (captured !== generation) return;
  if ((!error && (!data || data.endtime || data.deleted_at || data.baby_id !== actual.babyId)) || error?.code === "PGRST116") await stopNativeSound("sleep-ended-or-unavailable");
  await synchronizeNativeSoundEvents();
}
export async function synchronizeNativeSoundEvents(): Promise<void> {
  if (!userId || document.hidden) return;
  if (syncing) {
    if (syncOwner === userId) return syncing;
    await syncing.catch(() => {});
    return synchronizeNativeSoundEvents();
  }
  const owner = userId, authGeneration = sessionGeneration();
  syncOwner = owner;
  syncing = (async () => {
    try {
      for (;;) {
        if (userId !== owner || !isSessionGenerationCurrent(authGeneration)) return;
        const { data, error } = await supabase.auth.getUser();
        if (error) throw new Error("Session verification unavailable");
        if (data.user?.id !== owner || userId !== owner) return;
        const { events } = await nativeSoundMeter.getEvents({ userId: owner });
        if (!events.length) break;
        for (const event of events) {
          if (event.created_by_user_id !== owner || userId !== owner || !isSessionGenerationCurrent(authGeneration)) return;
          await createSoundEvent({ id: event.id, baby_id: event.baby_id, sleep_id: event.sleep_id, created_by_user_id: owner,
            event_type: "sound", started_at: new Date(event.startMs).toISOString(), ended_at: new Date(event.endMs).toISOString(),
            avg_level: event.avg_level, max_level: event.max_level });
          await nativeSoundMeter.acknowledge({ userId: owner, ids: [event.id] });
        }
      }
      if (userId === owner) publish({ syncFailed: false, queueCount: (await nativeSoundMeter.getState()).queueCount });
    } catch { if (userId === owner) publish({ syncFailed: true }); throw new Error("Sound metadata synchronization failed"); }
  })().finally(() => { syncing = undefined; syncOwner = null; });
  return syncing;
}
registerBeforeSignOut(async () => {
  if (!nativeSoundSupported()) return;
  await stopNativeSound("logout");
  // Authentication generation has just changed, but the owner is still signed in.
  await synchronizeNativeSoundEvents().catch(() => {});
  userId = null;
});
