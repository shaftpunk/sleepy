import { PurchaseFailure, type PurchaseContext, type PurchaseResult, type RevenueCatDiagnostics,
  type ServerReconciliation } from "./revenueCatModel";

type Action = "monthly" | "annual" | "restore" | "refresh";
type Services = {
  diagnostics: (userId: string) => Promise<RevenueCatDiagnostics>;
  refresh: () => Promise<unknown>;
  reconcile: () => Promise<ServerReconciliation>;
  purchase: (plan: "monthly" | "annual", context: PurchaseContext) => Promise<PurchaseResult>;
  restore: () => Promise<PurchaseResult>;
};
export type PurchaseTestState = {
  busy: boolean; diagnostics: RevenueCatDiagnostics | null; diagnosticError: boolean; result: PurchaseResult | null;
  reconciliation: ServerReconciliation | null; serverError: boolean;
  issue: PurchaseFailure["issue"] | null; paymentPending: boolean;
};
// UI orchestration only. The existing purchase service owns prepare -> Apple -> reconcile.
export function createPurchaseTestController(userId: string, context: PurchaseContext | null,
  current: () => boolean, services: Services) {
  let alive = true;
  let state: PurchaseTestState = { busy: false, diagnostics: null, diagnosticError: false, result: null, reconciliation: null,
    serverError: false, issue: null, paymentPending: false };
  const listeners = new Set<() => void>();
  const valid = () => alive && current();
  function publish(next: Partial<PurchaseTestState>) {
    if (!valid()) return;
    state = { ...state, ...next }; listeners.forEach(fn => fn());
  }
  async function inspect() {
    try { const diagnostics = await services.diagnostics(userId); publish({ diagnostics, diagnosticError: false }); }
    catch { publish({ diagnostics: null, diagnosticError: true }); }
  }
  async function run(action: Action) {
    // Synchronous guard: two taps in one render cannot queue two Apple sheets.
    if (!valid() || state.busy || (state.paymentPending && (action === "monthly" || action === "annual"))) return;
    publish({ busy: true, issue: null });
    try {
      if (action === "refresh") {
        await services.refresh();
        if (!valid()) return;
        try {
          const reconciliation = await services.reconcile();
          publish({ reconciliation, serverError: false,
            paymentPending: state.paymentPending && !["verified", "sandboxVerified"].includes(reconciliation.state) });
        } catch { publish({ serverError: true, issue: "network" }); }
      } else {
        if (action !== "restore" && (!context || context.userId !== userId)) throw new PurchaseFailure("context");
        const result = action === "restore" ? await services.restore() : await services.purchase(action, context!);
        const received = ["purchased", "completedUnknown", "pending"].includes(result.status);
        publish({ result, reconciliation: result.reconciliation ?? null, serverError: false, issue: result.issue,
          paymentPending: (state.paymentPending || received) && !["verified", "sandboxVerified"].includes(result.reconciliation?.state ?? "") });
      }
    } catch (error) {
      publish({ issue: error instanceof PurchaseFailure ? error.issue : "unknown" });
    } finally {
      if (valid()) await inspect();
      publish({ busy: false });
    }
  }
  return { snapshot: () => state, inspect, run, activate: () => { alive = true; },
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    dispose: () => { alive = false; listeners.clear(); } };
}
