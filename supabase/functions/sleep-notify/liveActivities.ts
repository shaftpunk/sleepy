import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { sendLiveActivityEnd } from "../_shared/apns.ts";

type Registration = {
  installation_id: string;
  activity_id: string;
  revision: number;
  environment: string;
  push_token: string;
};

export async function endLiveActivities(
  supabase: SupabaseClient, sleepId: string, babyId: string, endedAt: string,
  send = sendLiveActivityEnd, delay = () => new Promise(resolve => setTimeout(resolve, 750)),
) {
  async function registrations(): Promise<Registration[]> {
    const { data, error } = await supabase.rpc("live_activity_end_targets", {
      p_sleep_id: sleepId, p_baby_id: babyId, p_endtime: endedAt,
    });
    if (error) throw new Error("Live Activity target lookup failed");
    return data ?? [];
  }
  async function deliver(row: Registration): Promise<boolean> {
    let response;
    try { response = await send(row.push_token, row.environment); }
    catch { return true; }
    if (response.status === 200 || response.status === 410 ||
        (response.status === 400 && response.reason === "BadDeviceToken")) {
      const { error } = await supabase.from("live_activity_tokens").update({ push_token: null })
        .eq("installation_id", row.installation_id).eq("activity_id", row.activity_id).eq("revision", row.revision);
      if (error) console.warn("Live Activity token cleanup failed");
    } else {
      console.warn("Live Activity APNs delivery rejected", { status: response.status });
    }
    return response.status === 429 || response.status >= 500;
  }

  const rows = await registrations();
  const retry = await Promise.all(rows.map(deliver));
  if (!retry.some(Boolean)) return;
  await delay();
  const current = await registrations();
  await Promise.all(current.filter(row => rows.some((attempt, i) =>
    retry[i] && attempt.installation_id === row.installation_id &&
    attempt.activity_id === row.activity_id && attempt.revision === row.revision,
  )).map(deliver));
}
