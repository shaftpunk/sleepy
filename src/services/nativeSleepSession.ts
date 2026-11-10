import type { Session } from "@supabase/supabase-js";
import { registerBeforeSignOut } from "../auth/sessionLifecycle";
import { supabaseUrl, supabaseAnonKey } from "../lib/supabase";
import { liveActivitiesSupported, liveActivityBridge as bridge } from "./liveActivityService";

let revision = 0;
let pending: Promise<void> = Promise.resolve();
export function synchronizeNativeSleepSession(session: Session | null): Promise<void> {
  const version = ++revision;
  if (!liveActivitiesSupported()) return Promise.resolve();
  pending = pending.catch(() => {}).then(async () => {
    if (session && version !== revision) return;
    if (!session) { await bridge.clearAuthSession(); return; }
    await bridge.setAuthSession({ userId: session.user.id, accessToken: session.access_token,
      expiresAt: session.expires_at ?? 0, url: supabaseUrl, anonKey: supabaseAnonKey });
  });
  return pending;
}
// Clear before signOut; failure blocks signOut so an old native credential is
// never silently left behind. No refresh token is copied to native code.
registerBeforeSignOut(() => synchronizeNativeSleepSession(null));
