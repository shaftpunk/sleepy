import { supabase } from "../lib/supabase";
import type { BabyId } from "../stores/appStore";

export function subscribeToSleepChanges(
  bbyid: BabyId,
  onChange: () => void
) {
  const channel = supabase
    .channel(`sleep-${bbyid}`)
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