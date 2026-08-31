import { supabase } from "../lib/supabase";
import type { BabyId } from "../stores/appStore";

let subscriptionCounter = 0;

export function subscribeToFeedChanges(
  bbyid: BabyId,
  onChange: () => void
) {
  // See sleepRealtime.ts: unique topic per call avoids colliding with
  // another concurrent subscriber on the same page.
  const channel = supabase
    .channel(`feed-${bbyid}-${++subscriptionCounter}`)
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