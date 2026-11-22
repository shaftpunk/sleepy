import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { isSessionGenerationCurrent, sessionGeneration } from "../auth/sessionLifecycle";
import { useEntitlements } from "../entitlements/EntitlementProvider";
import { useHouseholdContext } from "../households/HouseholdContextProvider";
import { useTranslation } from "../i18n";
import { usePurchaseEvidence } from "../purchases/PurchaseEvidenceContext";
import { purchaseMessageKey } from "../purchases/purchaseMessages";
import { createPurchaseTestController } from "../purchases/purchaseTestController";
import { REVENUECAT, type PurchaseContext } from "../purchases/revenueCatModel";
import { getRevenueCatOffering, purchaseRevenueCatPackage, reconcileRevenueCatState,
  refreshRevenueCatState, restoreRevenueCatPurchases, revenueCatAvailable } from "../services/revenueCatService";
import SleepyPlusTestPanel from "./SleepyPlusTestPanel";

const internalBuild = import.meta.env.VITE_ENABLE_PURCHASE_TEST_PANEL === "true";

export default function SleepyPlusSettings() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const household = useHouseholdContext();
  const entitlements = useEntitlements();
  const [showInternal, setShowInternal] = useState(false);
  const verified = entitlements.verificationState === "verified";
  const status = entitlements.loading ? "common.loading" : verified
    ? entitlements.isPlus ? "settings.plusActive" : "settings.plusFree"
    : "settings.plusUnknown";
  const native = revenueCatAvailable();
  const context = !household.loading && user && household.userId === user.id && household.babyId && household.householdId
    ? { userId: user.id, babyId: household.babyId, householdId: household.householdId } : null;
  const canUpgrade = verified && !entitlements.isPlus && entitlements.householdId === context?.householdId;
  return <>
    <section className="settings-card settings-card--stack">
      <p className="setting-title" role="status">{t(status)}</p>
      {native && user && !loading && household.userId === user.id ? <PurchaseActions
        key={[user.id, sessionGeneration(), context?.babyId, context?.householdId].join(":")}
        userId={user.id} context={context} canUpgrade={canUpgrade} isPlus={verified && entitlements.isPlus} />
        : !native && <p className="muted">{t("purchases.unavailable")}</p>}
      {!context && !household.loading && <Link to="/settings/family" className="settings-text-link">{t("settings.familyTitle")}</Link>}
    </section>
    {internalBuild && native && <details onToggle={event => setShowInternal(event.currentTarget.open)}>
      <summary>{t("settings.internalPurchases")}</summary>
      {showInternal && <SleepyPlusTestPanel />}
    </details>}
  </>;
}

type Prices = { monthly: string; annual: string };
function PurchaseActions({ userId, context, canUpgrade, isPlus }: {
  userId: string; context: PurchaseContext | null; canUpgrade: boolean; isPlus: boolean;
}) {
  const { t } = useTranslation();
  const evidence = usePurchaseEvidence();
  const babyId = context?.babyId;
  const householdId = context?.householdId;
  const controller = useMemo(() => {
    const generation = sessionGeneration();
    const scope = babyId && householdId ? { userId, babyId, householdId } : null;
    return createPurchaseTestController(userId, scope, () => isSessionGenerationCurrent(generation), {
      purchase: purchaseRevenueCatPackage, restore: restoreRevenueCatPurchases,
      refresh: refreshRevenueCatState, reconcile: reconcileRevenueCatState,
    });
  }, [babyId, householdId, userId]);
  useLayoutEffect(() => { controller.activate(); return controller.dispose; }, [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [offering, setOffering] = useState<Prices | "unavailable" | null>(null);
  const [attempt, retry] = useState(0);
  const upgrade = canUpgrade && evidence.status === "none" && !state.paymentPending;

  useEffect(() => {
    if (!upgrade) return;
    let current = true;
    const generation = sessionGeneration();
    void getRevenueCatOffering().then(result => {
      if (!current || !isSessionGenerationCurrent(generation)) return;
      const monthly = result.availablePackages.find(pack => pack.identifier === REVENUECAT.packages.monthly)?.product.priceString;
      const annual = result.availablePackages.find(pack => pack.identifier === REVENUECAT.packages.annual)?.product.priceString;
      setOffering(monthly && annual ? { monthly, annual } : "unavailable");
    }).catch(() => {
      if (current && isSessionGenerationCurrent(generation)) setOffering("unavailable");
    });
    return () => { current = false; };
  }, [upgrade, attempt, evidence.refreshedAt]);

  const resultKey = state.result ? purchaseMessageKey(state.result) : null;
  const message = state.issue ? t(`purchases.${state.issue}`)
    : resultKey ? t(resultKey === "purchases.sandboxVerified" ? "purchases.statusUpdated" : resultKey) : null;
  return <>
    {upgrade && offering && offering !== "unavailable" && <div className="settings-detail-actions">
      <button type="button" className="primary-button" disabled={state.busy}
        onClick={() => void controller.run("monthly")}>{t("settings.plusMonthly", { price: offering.monthly })}</button>
      <button type="button" className="secondary-button" disabled={state.busy}
        onClick={() => void controller.run("annual")}>{t("settings.plusAnnual", { price: offering.annual })}</button>
    </div>}
    {upgrade && !offering && <p className="muted" role="status">{t("common.loading")}</p>}
    {upgrade && offering === "unavailable" && <p role="status">{t("purchases.offering")}{" "}
      <button type="button" className="text-button" onClick={() => { setOffering(null); retry(value => value + 1); }}>
        {t("common.retry")}
      </button>
    </p>}
    {canUpgrade && (evidence.status === "error" || evidence.status === "unavailable") &&
      <p className="muted">{t("purchases.unavailable")}</p>}
    <button type="button" className="secondary-button" disabled={state.busy || evidence.status === "loading"}
      onClick={() => void controller.run("restore")}>{t("settings.plusRestore")}</button>
    {(isPlus || evidence.status === "active") && <a className="settings-text-link"
      href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">{t("settings.plusManage")}</a>}
    {(state.busy || message) && <p role="status">{state.busy ? t("common.loading") : message}</p>}
  </>;
}
