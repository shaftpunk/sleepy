import { supabase } from "../lib/supabase";
import { notifySleepPresentationChanged } from "./sleepPresentationEvents";
import type { SleepRecord } from "./sleepService";

// React and native invoke the same server command. No legacy write fallback:
// install the reviewed migration before enabling this app version.
export async function endSleep(sleepId: string, endedAt: string): Promise<SleepRecord> {
  if (!Number.isFinite(Date.parse(endedAt))) throw new Error("Invalid sleep end time");
  const { data, error } = await supabase.rpc("end_sleep", { p_sleep_id: sleepId, p_ended_at: endedAt }).single();
  if (error) throw error;
  const row = data as SleepRecord | null;
  if (!row || row.id !== sleepId || !row.endtime || row.deleted_at) throw new Error("Sleep end was not confirmed");
  notifySleepPresentationChanged({ endedSleepId: row.id });
  return row;
}
