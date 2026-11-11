import { Capacitor } from "@capacitor/core";
import { Purchases } from "@revenuecat/purchases-capacitor";
import { supabase } from "../lib/supabase";
import { registerBeforeSignOut, sessionGeneration } from "../auth/sessionLifecycle";
import { createRevenueCatClient } from "../purchases/revenueCatClient";
import { getHouseholdCandidates } from "./householdContextService";

const client = createRevenueCatClient({ sdk: Purchases,
  supported: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios",
  apiKey: () => import.meta.env.VITE_REVENUECAT_IOS_API_KEY,
  generation: sessionGeneration,
  validatePurchaseContext: async context => (await getHouseholdCandidates(context.userId, context.babyId))
    .some(household => household.id === context.householdId),
  diagnostic: (issue, code) => { if (import.meta.env.DEV) console.warn("RevenueCat operation failed", { issue, code }); },
  authenticatedUser: async () => {
    const { data, error } = await supabase.auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
});
registerBeforeSignOut(async () => {
  // Local evidence is invalidated synchronously. SDK cleanup stays serialized,
  // but an outstanding Apple sheet/network request must not hold Supabase logout.
  void client.resetRevenueCatSession().catch(() => {});
});
export const { initializeRevenueCat, resetRevenueCatSession, refreshRevenueCatState,
  getRevenueCatCustomerInfo, getRevenueCatOffering, purchaseRevenueCatPackage, restoreRevenueCatPurchases,
  setPurchaseContext, snapshot: revenueCatSnapshot, subscribe: subscribeRevenueCat } = client;
