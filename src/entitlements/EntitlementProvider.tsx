import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useHouseholdContext } from "../households/HouseholdContextProvider";
import { registerBeforeSignOut, sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";
import { resolveHouseholdEntitlements } from "../services/entitlementService";
import { entitlementAccess, sameHouseholdContext, type EntitlementResolution } from "./model";
import { ENTITLEMENT_ENFORCEMENT_ENABLED } from "./features";
import type { HouseholdContext } from "../households/context";
import { usePurchaseEvidence } from "../purchases/PurchaseEvidenceContext";
import type { PurchaseEvidence } from "../purchases/revenueCatModel";
import {subscribeEntitlementReconciliation} from "../services/subscriptionReconciliationService";

type Snapshot = { context: HouseholdContext; generation: number; resolution: EntitlementResolution | null };
type Value = ReturnType<typeof entitlementAccess> & { householdId: string | null; loading: boolean;
  verificationState: "verified" | "unknown"; validUntil: string | null; enforcementEnabled: boolean; purchaseEvidence: PurchaseEvidence };
const Context = createContext<Value | undefined>(undefined);
export function EntitlementProvider({ children }: { children: ReactNode }) {
  const purchaseEvidence = usePurchaseEvidence();
  const { userId, babyId, householdId, loading: contextLoading } = useHouseholdContext();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision,setRevision]=useState(0);
  useEffect(()=>subscribeEntitlementReconciliation(event=>{
    if(event.userId===userId && (event.householdId===null||event.householdId===householdId))setRevision(value=>value+1);
  }),[userId,householdId]);
  useEffect(() => registerBeforeSignOut(async () => { setSnapshot(null); }), []);
  useEffect(() => {
    if (!userId || !babyId || !householdId || contextLoading) return;
    const context = { userId, babyId, householdId };
    let current = true, request = 0, timer: number | undefined;
    async function load() {
      const version = ++request, generation = sessionGeneration();
      try {
        const resolution = await resolveHouseholdEntitlements(context.householdId);
        if (!current || version !== request || !isSessionGenerationCurrent(generation)) return;
        setSnapshot({ context, generation, resolution });
        window.clearTimeout(timer);
        const delay = Math.min(300000, Math.max(1000, Date.parse(resolution.recheckAt) - Date.now()));
        timer = window.setTimeout(visible, delay);
      } catch {
        if (!current || version !== request || !isSessionGenerationCurrent(generation)) return;
        // Missing migration/RPC, authorization failure and offline are unknown,
        // never a fabricated Plus grant. Compatibility keeps current UX usable.
        setSnapshot({ context, generation, resolution: null });
        window.clearTimeout(timer); timer = window.setTimeout(visible, 60000);
      }
    }
    function visible() { if (!document.hidden) void load(); }
    void load(); document.addEventListener("visibilitychange", visible); document.addEventListener("resume", visible);
    return () => { current = false; window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible); document.removeEventListener("resume", visible); };
  }, [userId, babyId, householdId, contextLoading, revision]);
  const context = userId && babyId && householdId ? { userId, babyId, householdId } : null;
  const scoped = !contextLoading && snapshot && isSessionGenerationCurrent(snapshot.generation) && sameHouseholdContext(context, snapshot.context) ? snapshot : null;
  return <Context.Provider value={{ ...entitlementAccess(scoped?.resolution ?? null), householdId,
    loading: contextLoading || Boolean(context && !scoped), verificationState: scoped?.resolution ? "verified" : "unknown",
    validUntil: scoped?.resolution?.validUntil ?? null,
    enforcementEnabled: ENTITLEMENT_ENFORCEMENT_ENABLED, purchaseEvidence }}>{children}</Context.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useEntitlements(): Value {
  const value = useContext(Context);
  if (!value) throw new Error("EntitlementProvider is required");
  return value;
}
