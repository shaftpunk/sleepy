import type { Session } from "@supabase/supabase-js";
import { registerBeforeSignOut, sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";
import { supabase, supabaseUrl, supabaseAnonKey } from "../lib/supabase";
import { liveActivitiesSupported, liveActivityBridge as bridge } from "./liveActivityService";

let revision = 0;
let pending: Promise<void> = Promise.resolve();
let mirroredUser: string | null = null;
let listener: Promise<unknown> | undefined;
let refreshing: Promise<void> | undefined;
export function refreshNativeSleepSession(ownerId: string, forceRefresh = false): Promise<void> {
  if (refreshing) return refreshing;
  const generation = sessionGeneration();
  refreshing = (async () => {
    // Only the existing JS auth client owns rotation. A widget/native intent
    // never receives a refresh token or accesses the WebView's credential store.
    let { data, error } = await supabase.auth.getSession();
    if (error || !data.session || data.session.user.id !== ownerId || !isSessionGenerationCurrent(generation)) return;
    if (forceRefresh) {
      ({ data, error } = await supabase.auth.refreshSession());
      if (error || !data.session || data.session.user.id !== ownerId || !isSessionGenerationCurrent(generation)) return;
    }
    await synchronizeNativeSleepSession(data.session);
  })().catch(() => {}).finally(() => { refreshing = undefined; });
  return refreshing;
}
export function synchronizeNativeSleepSession(session: Session | null): Promise<void> {
  const version = ++revision;
  if (!liveActivitiesSupported()) return Promise.resolve();
  listener ??= bridge.addListener("wakeSessionRefreshRequested", event => {
    void refreshNativeSleepSession(event.ownerId, event.forceRefresh);
  }).catch(() => { listener = undefined; });
  pending = pending.catch(() => {}).then(async () => {
    if (session && version !== revision) return;
    if (!session) { await bridge.clearAuthSession(); mirroredUser = null; return; }
    // A resume can mirror the pre-refresh JS snapshot. Never erase Keychain or
    // replace a newer token with that expired snapshot while refresh is pending.
    if (!session.expires_at || session.expires_at <= Date.now() / 1000) {
      if (mirroredUser !== session.user.id) { await bridge.clearAuthSession(); mirroredUser = null; }
      return;
    }
    await bridge.setAuthSession({ userId: session.user.id, accessToken: session.access_token,
      expiresAt: session.expires_at ?? 0, url: supabaseUrl, anonKey: supabaseAnonKey });
    mirroredUser = session.user.id;
  });
  return pending;
}
// Clear before signOut; failure blocks signOut so an old native credential is
// never silently left behind. No refresh token is copied to native code.
registerBeforeSignOut(() => synchronizeNativeSleepSession(null));
