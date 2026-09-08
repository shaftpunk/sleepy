import { supabase } from "../lib/supabase";
import type { SoundObservation } from "../sound/detector";

export type SoundEventInput = SoundObservation & {
  id: string;
  sleep_id: string;
  baby_id: string;
  created_by_user_id: string;
  event_type: "sound";
};
export type SoundEvent = SoundEventInput & { created_at: string };

export async function createSoundEvent(event: SoundEventInput): Promise<void> {
  // Another device may have stopped sleep before its realtime update arrived.
  // Re-read through RLS and trim the metadata interval, never the sleep itself.
  const { data: sleep, error: sleepError } = await supabase.from("sleep")
    .select("baby_id,starttime,endtime,deleted_at").eq("id", event.sleep_id).single();
  if (sleepError) throw sleepError;
  if (sleep.baby_id !== event.baby_id) throw new Error("Sleep/baby mismatch");
  if (sleep.deleted_at) return; // Do not attach new observations to deleted sleep.
  const start = Math.max(Date.parse(event.started_at), Date.parse(sleep.starttime));
  const end = Math.min(Date.parse(event.ended_at), sleep.endtime ? Date.parse(sleep.endtime) : Infinity);
  if (end <= start) return; // Nothing observed within this sleep interval.
  const payload = { ...event, started_at: new Date(start).toISOString(), ended_at: new Date(end).toISOString() };
  // Idempotent retry: event UUID is allocated once, before the first request.
  const { error } = await supabase.from("sleep_sound_events").upsert(payload, {
    onConflict: "id", ignoreDuplicates: true,
  });
  if (error) throw error;
}

export async function getSoundEventsForSleep(sleepId: string): Promise<SoundEvent[]> {
  const result: SoundEvent[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("sleep_sound_events").select("*")
      .eq("sleep_id", sleepId).order("started_at").order("id").range(offset, offset + 499);
    if (error) throw error;
    result.push(...(data ?? []) as SoundEvent[]);
    if (!data || data.length < 500) return result;
  }
}
