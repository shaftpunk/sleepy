import registry from "./features.json";

export type Tier = "free" | "plus";
export type Feature = keyof typeof registry;
export const FEATURES = registry;
// Deliberate release-time compatibility switch. Not a persisted Plus grant,
// environment override, or replacement for membership/role authorization.
export const ENTITLEMENT_ENFORCEMENT_ENABLED = false;
export function isFeature(value: string): value is Feature {
  return Object.hasOwn(FEATURES, value);
}
export function wouldAllowFeature(feature: Feature, tier: Tier | null): boolean {
  return isFeature(feature) && (FEATURES[feature].requiredTier === "free" || tier === "plus");
}
export function canUseFeature(feature: Feature, tier: Tier | null, enforce: boolean = ENTITLEMENT_ENFORCEMENT_ENABLED): boolean {
  return isFeature(feature) && (!enforce || wouldAllowFeature(feature, tier));
}
