import { PURCHASES_ERROR_CODE, LOG_LEVEL, type PurchasesPlugin, type PurchasesCallbackId } from "@revenuecat/purchases-capacitor";
import { customerEvidence, EMPTY_PURCHASE_EVIDENCE, offeringPackage, PurchaseFailure,
  type PurchaseContext, type PurchaseEvidence, type PurchaseIssue, type PurchasePlan, type PurchaseResult, type ServerReconciliation } from "./revenueCatModel";

type Runtime = { sdk: PurchasesPlugin; supported: () => boolean; apiKey: () => string | undefined;
  generation: () => number; authenticatedUser: () => Promise<string | null>;
  validatePurchaseContext?: (context: PurchaseContext) => Promise<boolean>;
  preparePurchase?: (context:PurchaseContext,plan:PurchasePlan)=>Promise<string>;
  cancelPurchase?: (intentId:string)=>Promise<void>;
  reconcilePurchase?: (intentId?:string,restore?:boolean,transactionId?:string)=>Promise<ServerReconciliation>;
  diagnostic?: (issue: PurchaseIssue, code: string | null) => void };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createRevenueCatClient(runtime: Runtime) {
  const sdk = runtime.sdk;
  let epoch = 0, userId: string | null = null, generation = -1;
  let context: PurchaseContext | null = null, listener: PurchasesCallbackId | null = null;
  let state = EMPTY_PURCHASE_EVIDENCE, pending: Promise<unknown> = Promise.resolve(), moneyBusy = false;
  let listenerRefresh = false;
  const subscribers = new Set<() => void>();
  const emit = (next: PurchaseEvidence) => { state = Object.freeze(next); subscribers.forEach(fn => fn()); };
  const snapshot = () => generation === runtime.generation() && userId ? state : EMPTY_PURCHASE_EVIDENCE;
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = pending.catch(() => {}).then(work); pending = result; return result;
  };
  const current = (version: number) => epoch === version && generation === runtime.generation() && Boolean(userId);
  function assertCurrent(version: number) { if (!current(version)) throw new PurchaseFailure("authentication"); }
  async function verifyIdentity(version: number) {
    assertCurrent(version);
    const identity = await sdk.getAppUserID(); const anonymous = await sdk.isAnonymous();
    assertCurrent(version);
    if (identity.appUserID !== userId || anonymous.isAnonymous) throw new PurchaseFailure("identity");
  }
  async function detach() {
    if (listener !== null) { const id = listener; listener = null; await sdk.removeCustomerInfoUpdateListener({ listenerToRemove: id }); }
  }
  function issue(error: unknown): PurchaseIssue {
    if (error instanceof PurchaseFailure) return error.issue;
    const code = String((error as { code?: unknown })?.code ?? "");
    if ([PURCHASES_ERROR_CODE.NETWORK_ERROR, PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR].includes(code as PURCHASES_ERROR_CODE)) return "network";
    if ([PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR, PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR,
      PURCHASES_ERROR_CODE.PURCHASE_BELONGS_TO_OTHER_USER].includes(code as PURCHASES_ERROR_CODE)) return "ownership";
    return "store";
  }
  function failed(error: unknown, version: number) {
    const failure = issue(error);
    const code = String((error as { code?: unknown })?.code ?? "");
    runtime.diagnostic?.(failure, /^\d+$/.test(code) ? code : null);
    if (current(version)) emit({ ...EMPTY_PURCHASE_EVIDENCE, status: "error", issue: failure });
    // Deliberately omit SDK messages, customer data and receipt/error payloads.
    return failure;
  }
  async function fetchInfo(version: number): Promise<PurchaseEvidence> {
    await verifyIdentity(version);
    const { customerInfo } = await sdk.getCustomerInfo();
    await verifyIdentity(version);
    const next = customerEvidence(customerInfo); emit(next); return next;
  }
  function resetRevenueCatSession(): Promise<void> {
    epoch++; userId = null; context = null; generation = -1; emit(EMPTY_PURCHASE_EVIDENCE);
    return serial(detach);
    // Do not call SDK logOut(): it creates an anonymous ID. The native identified
    // cache stays inaccessible until the next UUID is explicitly verified via logIn.
  }
  async function initializeRevenueCat(id: string): Promise<PurchaseEvidence> {
    if (!uuid.test(id)) { await resetRevenueCatSession(); throw new PurchaseFailure("authentication"); }
    const version = ++epoch; userId = id; generation = runtime.generation();
    context = context?.userId === id ? context : null;
    emit({ ...EMPTY_PURCHASE_EVIDENCE, status: "loading" });
    return serial(async () => {
      try {
        assertCurrent(version); await detach(); assertCurrent(version);
        if (!runtime.supported()) { emit(EMPTY_PURCHASE_EVIDENCE); return state; }
        // Never accept test_, sk_, or a server credential as an iOS API key.
        if (!/^appl_[A-Za-z0-9]+$/.test(runtime.apiKey() ?? "")) {
          emit({ ...EMPTY_PURCHASE_EVIDENCE, issue: "notConfigured" }); return state;
        }
        if (await runtime.authenticatedUser() !== id) throw new PurchaseFailure("authentication");
        assertCurrent(version);
        if (!(await sdk.isConfigured()).isConfigured) {
          assertCurrent(version); await sdk.setLogLevel({ level: LOG_LEVEL.ERROR });
          assertCurrent(version); await sdk.configure({ apiKey: runtime.apiKey()!, appUserID: id });
        } else if ((await sdk.getAppUserID()).appUserID !== id || (await sdk.isAnonymous()).isAnonymous) {
          assertCurrent(version); await sdk.logIn({ appUserID: id });
        }
        await verifyIdentity(version);
        listener = await sdk.addCustomerInfoUpdateListener(() => {
          if (!current(version) || listenerRefresh) return;
          // Callback payload has no trustworthy current-account scope. Read fresh
          // data under a verified UUID instead of publishing a potentially old payload.
          listenerRefresh = true;
          void serial(async () => { try { if (current(version)) await fetchInfo(version); }
            catch (error) { failed(error, version); } finally { listenerRefresh = false; } });
        });
        assertCurrent(version); return await fetchInfo(version);
      } catch (error) { failed(error, version); return snapshot(); }
    });
  }
  function refreshRevenueCatState(): Promise<PurchaseEvidence> {
    // Retry failed configuration/identification on foreground, not only reads.
    if (userId && generation === runtime.generation() && (state.status === "error" || state.status === "unavailable")) {
      return initializeRevenueCat(userId);
    }
    const version = epoch;
    return serial(async () => { try { await ready(version); return await fetchInfo(version); }
      catch (error) { failed(error, version); return snapshot(); } });
  }
  async function ready(version: number) {
    assertCurrent(version);
    if (!runtime.supported()) throw new PurchaseFailure("unavailable");
    if (!/^appl_[A-Za-z0-9]+$/.test(runtime.apiKey() ?? "")) throw new PurchaseFailure("notConfigured");
    if (await runtime.authenticatedUser() !== userId) throw new PurchaseFailure("authentication");
    await verifyIdentity(version);
  }
  function setPurchaseContext(next: PurchaseContext | null) {
    if (context && next && context.userId === next.userId && context.babyId === next.babyId && context.householdId === next.householdId) return;
    context = next;
  }
  function assertContext(requested: PurchaseContext | undefined) {
    if (!requested || !context || requested.userId !== userId || requested.userId !== context.userId ||
      !uuid.test(requested.householdId) || requested.householdId !== context.householdId ||
      !requested.babyId || requested.babyId !== context.babyId) throw new PurchaseFailure("context");
  }
  async function getRevenueCatOffering() {
    const version = epoch;
    return serial(async () => { try { await ready(version); const offering = await sdk.getOfferings(); assertCurrent(version);
      // Validate both launch packages before exposing this offering to future UI.
      offeringPackage(offering, "monthly"); offeringPackage(offering, "annual"); return offering.current!;
    } catch (error) { throw new PurchaseFailure(failed(error, version)); } });
  }
  function moneyOperation(kind: "purchase" | "restore", requested?: PurchaseContext, plan?: PurchasePlan): Promise<PurchaseResult> {
    const version = epoch;
    let reconciliation:ServerReconciliation|undefined;
    async function sync(intentId?:string,transactionId?:string){
      if(!runtime.reconcilePurchase)return;
      try{assertCurrent(version);const value=await runtime.reconcilePurchase(intentId,kind==="restore",transactionId);assertCurrent(version);reconciliation=value;}
      catch{reconciliation={state:"pending",householdId:null};}
    }
    const result = (status: PurchaseResult["status"], failure: PurchaseIssue | null = null): PurchaseResult => ({ status,
      evidence: current(version) ? snapshot() : EMPTY_PURCHASE_EVIDENCE, issue: failure,
      ...(current(version)&&reconciliation?{reconciliation}:{}) });
    try { assertCurrent(version); if (kind === "purchase") assertContext(requested); }
    catch (error) { return Promise.resolve(result("error", issue(error))); }
    if (!runtime.supported()) return Promise.resolve(result("unavailable", "unavailable"));
    if (moneyBusy) return Promise.resolve(result("error", "busy"));
    moneyBusy = true;
    // Capture the context revision by value: later selection changes invalidate it.
    const captured = context;
    return serial(async () => {
      let completed = false;
      let intentId:string|undefined;
      let transactionId:string|undefined;
      try {
        await ready(version);
        if (kind === "purchase") {
          assertContext(requested);
          if (captured !== context) throw new PurchaseFailure("context");
          await fetchInfo(version);
          if (state.status === "active") {await sync();return result("alreadySubscribed");}
          const offerings = await sdk.getOfferings();
          await ready(version); assertContext(requested);
          if (runtime.validatePurchaseContext && !await runtime.validatePurchaseContext(requested!)) throw new PurchaseFailure("context");
          assertCurrent(version);
          assertContext(requested);
          if (captured !== context) throw new PurchaseFailure("context");
          const pack = offeringPackage(offerings, plan!);
          if(runtime.preparePurchase)intentId=await runtime.preparePurchase(requested!,plan!);
          assertCurrent(version);assertContext(requested);
          if(captured!==context)throw new PurchaseFailure("context");
          const payment=await sdk.purchasePackage({ aPackage: pack });
          transactionId=payment.transaction?.transactionIdentifier;
        } else { assertCurrent(version); await sdk.restorePurchases(); }
        completed = true;
        // Server verification must still run if the final SDK refresh fails.
        let refreshFailed=false;
        try{await fetchInfo(version);}catch(error){failed(error,version);refreshFailed=true;}
        await sync(intentId,transactionId);
        if(refreshFailed)return result("completedUnknown");
        return result(kind === "purchase" ? "purchased" : "restored");
      } catch (error) {
        const code = String((error as { code?: unknown })?.code ?? "");
        if (current(version) && code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
          if(intentId&&runtime.cancelPurchase)try{await runtime.cancelPurchase(intentId);}catch{/* Expiry still fails closed if offline. */}
          return result("cancelled");
        }
        if (current(version) && code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return result("pending");
        if (current(version) && code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) {
          try { await fetchInfo(version); await sync();return result("alreadySubscribed"); }
          catch (refreshError) { return result("completedUnknown", failed(refreshError, version)); }
        }
        const failure = failed(error, version);
        // A store transaction may finish even if refresh fails or the user logs
        // out. Never encourage an immediate retry by calling that a failed charge.
        return result(completed ? "completedUnknown" : "error", failure);
      } finally { moneyBusy = false; }
    });
  }
  return { initializeRevenueCat, resetRevenueCatSession, refreshRevenueCatState, getRevenueCatCustomerInfo: refreshRevenueCatState,
    getRevenueCatOffering, setPurchaseContext, snapshot, subscribe: (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
    purchaseRevenueCatPackage: (plan: PurchasePlan, purchaseContext: PurchaseContext) => moneyOperation("purchase", purchaseContext, plan),
    restoreRevenueCatPurchases: () => moneyOperation("restore") };
}
