import { supabase } from "../lib/supabase";
import type { BabyId } from "../stores/appStore";

export function subscribeToFeedChanges(
  bbyid: BabyId,
  onChange: () => void
) {
  const channel = supabase
    .channel(`feed-${bbyid}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "feed",
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