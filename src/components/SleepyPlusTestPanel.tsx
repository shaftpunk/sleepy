import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthProvider";
import { sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";
import { useHouseholdContext } from "../households/HouseholdContextProvider";
import { useEntitlements } from "../entitlements/EntitlementProvider";
import { useTranslation } from "../i18n";
import { usePurchaseEvidence } from "../purchases/PurchaseEvidenceContext";
import { createPurchaseTestController, type PurchaseTestState } from "../purchases/purchaseTestController";
import { purchaseMessageKey } from "../purchases/purchaseMessages";
import { REVENUECAT, type PurchaseContext } from "../purchases/revenueCatModel";
import { revenueCatAvailable, getRevenueCatDiagnostics, refreshRevenueCatState, reconcileRevenueCatState,
  purchaseRevenueCatPackage, restoreRevenueCatPurchases } from "../services/revenueCatService";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short = (value: string | null) => value && uuid.test(value) ? value.slice(0, 8) + "…" : "—";
// No DEV-only flag: the native-only diagnostic section must also work in TestFlight.
export default function SleepyPlusTestPanel() {
  return revenueCatAvailable() ? <AuthenticatedPanel /> : null;
}
function AuthenticatedPanel() {
  const { user, loading } = useAuth();
  const household = useHouseholdContext();
  if (loading || !user || !uuid.test(user.id) || household.userId !== user.id) return null;
  const context = !household.loading && household.babyId && household.householdId
    ? { userId: user.id, babyId: household.babyId, householdId: household.householdId } : null;
  return <SessionPanel key={[user.id, sessionGeneration(), household.babyId, household.householdId, household.loading].join(":")}
    userId={user.id} context={context} />;
}
function SessionPanel({ userId, context }: { userId: string; context: PurchaseContext | null }) {
  const evidence = usePurchaseEvidence();
  const entitlements = useEntitlements();
  const { t } = useTranslation();
  const babyId = context?.babyId ?? null, householdId = context?.householdId ?? null;
  const controller = useMemo(() => {
    const generation = sessionGeneration();
    const scope = babyId && householdId ? { userId, babyId, householdId } : null;
    return createPurchaseTestController(userId, scope, () => isSessionGenerationCurrent(generation), {
      diagnostics: getRevenueCatDiagnostics, refresh: refreshRevenueCatState, reconcile: reconcileRevenueCatState,
      purchase: purchaseRevenueCatPackage, restore: restoreRevenueCatPurchases,
    });
  }, [userId, babyId, householdId]);
  useLayoutEffect(() => { controller.activate(); return controller.dispose; }, [controller]);
  useEffect(() => { void controller.inspect(); }, [controller, evidence.status, evidence.refreshedAt]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const resolved = entitlements.verificationState === "verified" && entitlements.householdId === householdId
    ? { householdId: entitlements.householdId, tier: entitlements.tier, isPlus: entitlements.isPlus,
      verificationState: entitlements.verificationState, validUntil: entitlements.validUntil } : null;
  return <SleepyPlusTestView userId={userId} householdId={householdId} state={state} resolved={resolved}
    onAction={action => { void controller.run(action); }} translate={t} />;
}

type Resolved = { householdId: string | null; tier: string | null; isPlus: boolean; verificationState: string; validUntil: string | null };
type Props = { userId: string; householdId: string | null; state: PurchaseTestState; resolved: Resolved | null;
  onAction: (action: "monthly" | "annual" | "restore" | "refresh") => void; translate: ReturnType<typeof useTranslation>["t"] };
export function SleepyPlusTestView({ userId, householdId, state, resolved, onAction, translate: t }: Props) {
  const { diagnostics: sdk, reconciliation: server } = state;
  // A failed reconciliation is unknown, not an invented Free result. Assignment-required
  // must never borrow the currently selected household as a purchase association.
  const authoritative = state.serverError ? null : server ? server.entitlement ?? null : resolved;
  const sandbox = !state.serverError && (server?.state === "sandboxVerified" || server?.subscriptionState === "sandbox");
  const ready = sdk?.configured && ["none", "active"].includes(sdk.evidence.status);
  const product = sdk?.evidence.productIdentifier;
  const safeProduct = product && Object.values(REVENUECAT.appleProducts).some(id => id === product) ? product : "—";
  const message = state.paymentPending && state.result?.status !== "pending" ? t("plusTesting.activationPending")
    : state.issue ? t(`purchases.${state.issue}`)
    : state.result ? t(purchaseMessageKey({ ...state.result, reconciliation: server ?? undefined })) : null;
  const row = (label: string, value: string) => <div><dt>{label}</dt><dd>{value}</dd></div>;
  return <section className="settings-card settings-card--stack plus-test-panel" aria-labelledby="plus-test-title">
    <h2 className="setting-title" id="plus-test-title">{t("plusTesting.title")}</h2>
    <p className="setting-description">{t("plusTesting.temporary")}</p>
    <h3>RevenueCat</h3>
    <p className="setting-description">{t("plusTesting.nonAuthoritative")}</p>
    <dl>
      {row("SDK", sdk ? t(sdk.available ? "plusTesting.available" : "plusTesting.unavailable") : t(state.diagnosticError ? "plusTesting.error" : "plusTesting.loading"))}
      {row(t("plusTesting.configuration"), sdk ? t(sdk.configured ? "plusTesting.configured" : "plusTesting.notConfigured") : "—")}
      {row(t("plusTesting.sleepyIdentity"), short(userId))}
      {row(t("plusTesting.customerIdentity"), sdk?.appUserIdPrefix ?? "—")}
      {row(t("plusTesting.evidence"), t(`plusTesting.${sdk?.evidence.status ?? (state.diagnosticError ? "error" : "loading")}`))}
      {row(t("plusTesting.product"), safeProduct)}
      {row(t("plusTesting.environment"), sdk?.evidence.environment ?? "—")}
    </dl>
    <h3>{t("plusTesting.server")}</h3>
    <dl>
      {row("state", state.serverError ? "unknown" : server?.state ?? authoritative?.verificationState ?? "unknown")}
      {row("subscriptionState", state.serverError ? "unknown" : server?.subscriptionState ?? "unknown")}
      {row("householdId", short(server ? server.householdId : householdId))}
      {row("tier", authoritative?.tier ?? "unknown")}
      {row("is_plus", authoritative ? t(authoritative.isPlus ? "plusTesting.yes" : "plusTesting.no") : "unknown")}
      {row("verification_state", authoritative?.verificationState ?? "unknown")}
      {row("valid_until", authoritative?.validUntil ?? "—")}
    </dl>
    {!householdId && <p className="setting-description">{t("purchases.context")}</p>}
    <div className="plus-test-actions" aria-busy={state.busy}>
      <button type="button" className="secondary-btn" disabled={state.busy || !ready || !householdId || state.paymentPending} onClick={() => onAction("monthly")}>{t("plusTesting.monthly")}</button>
      <button type="button" className="secondary-btn" disabled={state.busy || !ready || !householdId || state.paymentPending} onClick={() => onAction("annual")}>{t("plusTesting.annual")}</button>
      <button type="button" className="secondary-btn" disabled={state.busy || !ready} onClick={() => onAction("restore")}>{t("plusTesting.restore")}</button>
      <button type="button" className="secondary-btn" disabled={state.busy} onClick={() => onAction("refresh")}>{t("plusTesting.refresh")}</button>
    </div>
    <div role="status" aria-live="polite" aria-atomic="true">
      {state.busy && <p>{t("plusTesting.loading")}</p>}
      {message && <p>{message}</p>}
      {sandbox && <p className="plus-test-notice">{t("plusTesting.sandboxNotice")}</p>}
    </div>
  </section>;
}
