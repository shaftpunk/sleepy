import { useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useHouseholdContext } from "../households/HouseholdContextProvider";
import { initializeRevenueCat, resetRevenueCatSession, refreshRevenueCatState, revenueCatSnapshot,
  subscribeRevenueCat, setPurchaseContext } from "../services/revenueCatService";
import { PurchaseEvidenceContext } from "./PurchaseEvidenceContext";
import { usePurchaseEvidence } from "./PurchaseEvidenceContext";

// Mounted outside AuthGate so logout/auth expiry also clears local purchase state.
export function RevenueCatSession({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const evidence = useSyncExternalStore(subscribeRevenueCat, revenueCatSnapshot, revenueCatSnapshot);
  useEffect(() => {
    if (loading || !userId) { void resetRevenueCatSession().catch(() => {}); return; }
    void initializeRevenueCat(userId).catch(() => {});
    const refresh = () => { if (!document.hidden) void refreshRevenueCatState(); };
    document.addEventListener("visibilitychange", refresh); document.addEventListener("resume", refresh);
    return () => { void resetRevenueCatSession().catch(() => {});
      document.removeEventListener("visibilitychange", refresh); document.removeEventListener("resume", refresh); };
  }, [userId, loading]);
  return <PurchaseEvidenceContext.Provider value={evidence}>{children}</PurchaseEvidenceContext.Provider>;
}
// Separate from identity initialization: baby/household changes must not log in
// again, but must invalidate an in-flight purchase's intended household context.
export function RevenueCatHouseholdContext() {
  const { userId, babyId, householdId, loading } = useHouseholdContext();
  const { status } = usePurchaseEvidence();
  useLayoutEffect(() => {
    setPurchaseContext(!loading && userId && babyId && householdId ? { userId, babyId, householdId } : null);
    return () => setPurchaseContext(null);
  }, [userId, babyId, householdId, loading, status]);
  return null;
}
