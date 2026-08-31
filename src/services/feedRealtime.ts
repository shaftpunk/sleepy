import { supabase } from "../lib/supabase";

let subscriptionCounter = 0;

export function subscribeToFeedChanges(
  babyId: string,
  onChange: () => void,
) {
  // Each call gets its own channel topic so multiple subscribers
  // can listen to the same baby independently.
  const channel = supabase
    .channel(
      `feed-${babyId}-${++subscriptionCounter}`,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "feed",
        filter: `baby_id=eq.${babyId}`,
      },
      () => {
        onChange();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}