import { supabase } from "../lib/supabase";
import type { BabyId } from "../stores/appStore";

let subscriptionCounter = 0;

export function subscribeToSleepChanges(
  bbyid: BabyId,
  onChange: () => void
) {
  // Each call gets its own channel topic — the Supabase client keys channels
  // by topic name, so two independent subscribers on the same page (e.g. a
  // page's own fetch plus the shared analytics hook) would otherwise collide
  // on the same already-subscribed channel and throw.
  const channel = supabase
    .channel(`sleep-${bbyid}-${++subscriptionCounter}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "sleep",
        filter: `bbyid=eq.${bbyid}`,
      },
      () => {
        onChange();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}