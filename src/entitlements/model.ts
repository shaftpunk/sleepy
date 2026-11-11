import { FEATURES, isFeature, wouldAllowFeature, canUseFeature, type Feature, type Tier } from "./features";
import type { HouseholdContext } from "../households/context";

export type EntitlementResolution = { householdId: string; tier: Tier; isPlus: boolean; features: Feature[];
  verificationState: "verified"; verifiedAt: string; validUntil: string | null; recheckAt: string; policyVersion: 1 };
export function parseEntitlementResolution(value: unknown, householdId: string): EntitlementResolution {
  if (!value || typeof value !== "object") throw new Error("Invalid entitlement resolution");
  const row = value as Record<string, unknown>;
  const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (row.household_id !== householdId || !["free", "plus"].includes(String(row.tier)) ||
    row.is_plus !== (row.tier === "plus") || row.verification_state !== "verified" || row.policy_version !== 1 ||
    !date(row.verified_at) || !date(row.recheck_at) || (row.valid_until !== null && !date(row.valid_until)) ||
    !Array.isArray(row.features) || row.features.some(feature => typeof feature !== "string" || !isFeature(feature))) {
    throw new Error("Invalid entitlement scope or policy");
  }
  const expected = Object.keys(FEATURES).filter(key => wouldAllowFeature(key as Feature, row.tier as Tier)).sort();
  if (JSON.stringify([...row.features].sort()) !== JSON.stringify(expected)) throw new Error("Entitlement feature policy mismatch");
  return { householdId, tier: row.tier as Tier, isPlus: row.is_plus as boolean, features: row.features as Feature[],
    verificationState: "verified", verifiedAt: row.verified_at, validUntil: row.valid_until as string | null,
    recheckAt: row.recheck_at, policyVersion: 1 };
}
export function sameHouseholdContext(a: HouseholdContext | null, b: HouseholdContext | null): boolean {
  return Boolean(a && b && a.userId === b.userId && a.babyId === b.babyId && a.householdId === b.householdId);
}
export function entitlementAccess(resolution: EntitlementResolution | null) {
  const tier = resolution?.tier ?? null;
  return { tier, isPlus: resolution?.isPlus ?? false,
    canUse: (feature: Feature) => canUseFeature(feature, tier),
    wouldAllow: (feature: Feature) => wouldAllowFeature(feature, tier) };
}
