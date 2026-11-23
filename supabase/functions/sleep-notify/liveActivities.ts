import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { LiveActivityApnsError, sendLiveActivityEnd } from "../_shared/apns.ts";

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
  async function registrations(attempt: number): Promise<Registration[]> {
    const { data, error } = await supabase.rpc("live_activity_end_targets", {
      p_sleep_id: sleepId, p_baby_id: babyId, p_endtime: endedAt,
    });
    if (error) {
      console.error("Live Activity target lookup failed", { sleepId, babyId, attempt });
      throw new Error("Live Activity target lookup failed");
    }
    console.info("Live Activity registrations selected", { sleepId, babyId, attempt, count: data?.length ?? 0 });
    return data ?? [];
  }
  async function deliver(row: Registration, attempt: number): Promise<boolean> {
    const context = { sleepId, babyId, activityId: row.activity_id, environment: row.environment, revision: row.revision, attempt };
    console.info("Live Activity APNs attempt", context);
    let response;
    try { response = await send(row.push_token, row.environment, row.activity_id); }
    catch (error) {
      console.warn("Live Activity APNs exception", { ...context,
        stage: error instanceof LiveActivityApnsError ? error.stage : "unknown" });
      return true;
    }
    console.info("Live Activity APNs result", { ...context, status: response.status, reason: response.reason ?? null });
    if (response.status === 200 || response.status === 410 ||
        (response.status === 400 && response.reason === "BadDeviceToken")) {
      const { error, count } = await supabase.from("live_activity_tokens").update({ push_token: null }, { count: "exact" })
        .eq("installation_id", row.installation_id).eq("activity_id", row.activity_id).eq("revision", row.revision);
      console.info("Live Activity registration cleanup", { ...context, result: error ? "failed" : "completed", count });
    }
    return response.status === 429 || response.status >= 500;
  }

  const rows = await registrations(1);
  const retry = await Promise.all(rows.map(row => deliver(row, 1)));
  if (!retry.some(Boolean)) return;
  await delay();
  const current = await registrations(2);
  const retries = current.filter(row => rows.some((attempt, i) =>
    retry[i] && attempt.installation_id === row.installation_id &&
    attempt.activity_id === row.activity_id && attempt.revision === row.revision,
  ));
  console.info("Live Activity retry targets", { sleepId, babyId, count: retries.length });
  await Promise.all(retries.map(row => deliver(row, 2)));
}
