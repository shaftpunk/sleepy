import { supabase } from "../lib/supabase";
import { getMyHouseholds } from "./householdService";
import type { HouseholdCandidate, HouseholdRole } from "../households/context";

const roles: readonly string[] = ["owner", "parent", "caregiver", "viewer"];
export async function getHouseholdCandidates(userId: string, babyId: string): Promise<HouseholdCandidate[]> {
  // All reads retain caller RLS. Never trust a stored household or use a global
  // first household: intersect this user's memberships with this baby's links.
  const [households, memberships, links] = await Promise.all([
    getMyHouseholds(),
    supabase.from("household_members").select("household_id,role").eq("user_id", userId),
    supabase.from("baby_households").select("household_id").eq("baby_id", babyId),
  ]);
  if (memberships.error || links.error) throw new Error("Household context unavailable");
  const linked = new Set((links.data ?? []).map(row => row.household_id));
  return households.flatMap(household => {
    const member = memberships.data?.find(row => row.household_id === household.id && roles.includes(row.role));
    return linked.has(household.id) && member ? [{ id: household.id, name: household.name, role: member.role as HouseholdRole }] : [];
  });
}
let channelId = 0;
export function subscribeHouseholdContext(userId: string, babyId: string, refresh: () => void): () => void {
  try {
    const channel = supabase.channel(`household-context-${++channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "household_members", filter: `user_id=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "baby_households", filter: `baby_id=eq.${babyId}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  } catch {
    // Realtime is best effort; the provider also revalidates on foreground and
    // periodically. A socket setup failure must not interrupt existing screens.
    return () => {};
  }
}
