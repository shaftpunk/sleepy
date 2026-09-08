import { create } from "zustand";
import { supabase } from "../lib/supabase";
import { createSoundEvent, type SoundEventInput } from "./soundEventService";

// Metadata only, in-memory and user-scoped. Survives route changes, not reloads.
// Bound the queue and stop capture on the first failure; never grow indefinitely.
export const useSoundQueue = create<{ failed: boolean; pending: number }>(() => ({ failed: false, pending: 0 }));
const queue: SoundEventInput[] = [];
let flushing = false;
let accountId: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  const nextId = session?.user.id ?? null;
  if ((accountId !== null && accountId !== nextId) || !nextId) {
    queue.length = 0;
    useSoundQueue.setState({ pending: 0, failed: false });
  }
  accountId = nextId;
});
export function enqueueSoundEvent(event: SoundEventInput) {
  if (accountId !== event.created_by_user_id) return; // Logout cleanup never queues another user's event.
  if (queue.length >= 20) { useSoundQueue.setState({ failed: true }); return; }
  queue.push(event);
  useSoundQueue.setState({ pending: queue.length });
  void retrySoundEvents();
}
export async function retrySoundEvents(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const event = queue[0];
      const { data, error } = await supabase.auth.getUser();
      if (error || data.user?.id !== event.created_by_user_id) throw new Error("Session changed");
      await createSoundEvent(event);
      const index = queue.findIndex((item) => item.id === event.id);
      if (index >= 0) queue.splice(index, 1);
      useSoundQueue.setState({ pending: queue.length });
    }
    useSoundQueue.setState({ failed: false });
  } catch {
    useSoundQueue.setState({ failed: true });
  } finally { flushing = false; }
}
