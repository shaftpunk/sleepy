import { supabase } from "../lib/supabase";
import { parseEntitlementResolution } from "../entitlements/model";

export async function resolveHouseholdEntitlements(householdId: string) {
  const { data, error } = await supabase.rpc("resolve_household_entitlements", { p_household_id: householdId });
  if (error) throw new Error("Household entitlements unavailable", { cause: error });
  return parseEntitlementResolution(data, householdId);
}
