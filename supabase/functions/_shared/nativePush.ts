import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { sendApns } from "./apns.ts";

export async function sendNativeNotifications(
  supabase: SupabaseClient, userIds: string[], payload: { title: string; body: string; url: string },
): Promise<{ attempted: number; sent: number; failed: number }> {
  const summary = { attempted: 0, sent: 0, failed: 0 };
  // Opt-in rollout: keep existing Web Push delivery independent of APNs setup.
  if (!Deno.env.get("APNS_PRIVATE_KEY") || userIds.length === 0) return summary;
  const { data, error } = await supabase.from("native_push_tokens")
    .select("installation_id, device_token, revision")
    .in("user_id", [...new Set(userIds)]).eq("enabled", true)
    .eq("topic", "no.strandeconsulting.sleepy").eq("environment", "production");
  if (error) { console.error("Native push lookup failed"); return summary; }
  for (const row of data ?? []) {
    summary.attempted++;
    try {
      const status = await sendApns(row.device_token, payload);
      if (status === 200) summary.sent++;
      else {
        summary.failed++;
        console.warn("APNs delivery rejected", { status });
        if (status === 410) {
          await supabase.from("native_push_tokens").update({ enabled: false })
            .eq("installation_id", row.installation_id).eq("revision", row.revision);
        }
      }
    } catch { summary.failed++; console.error("APNs transport failed"); }
  }
  return summary;
}
