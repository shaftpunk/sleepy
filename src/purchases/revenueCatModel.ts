import type { CustomerInfo, PurchasesOfferings, PurchasesPackage } from "@revenuecat/purchases-capacitor";

export const REVENUECAT = {
  entitlement: "plus", offering: "default",
  packages: { monthly: "$rc_monthly", annual: "$rc_annual" },
  appleProducts: { monthly: "sleepy_plus_monthly", annual: "sleepy_plus_yearly" },
} as const;
export type PurchasePlan = keyof typeof REVENUECAT.packages;
export type PurchaseContext = { userId: string; babyId: string; householdId: string };
export type PurchaseIssue = "unavailable" | "notConfigured" | "authentication" | "context" | "identity" |
  "offering" | "network" | "store" | "ownership" | "busy" | "unknown";
// Purchase evidence only: no receipts, transactions, customer IDs or household grants.
export type PurchaseEvidence = {
  status: "unavailable" | "loading" | "none" | "active" | "error";
  entitlement: "plus" | null; expiration: string | null; productIdentifier: string | null;
  willRenew: boolean | null; refreshedAt: string | null; issue: PurchaseIssue | null;
  environment: "sandbox" | "production" | null;
};
export const EMPTY_PURCHASE_EVIDENCE: PurchaseEvidence = Object.freeze({ status: "unavailable", entitlement: null,
  expiration: null, productIdentifier: null, willRenew: null, refreshedAt: null, issue: null, environment: null });
export type RevenueCatDiagnostics = { available: boolean; configured: boolean; appUserIdPrefix: string | null; evidence: PurchaseEvidence };
export class PurchaseFailure extends Error {
  readonly issue: PurchaseIssue;
  constructor(issue: PurchaseIssue) { super(`Purchase operation unavailable: ${issue}`); this.issue = issue; }
}
export type ServerReconciliation = { state: "pending" | "verified" | "verifiedMultiple" | "sandboxVerified" | "assignmentRequired" | "free";
  householdId: string | null; subscriptionState?:"production"|"sandbox"|"none"|"unknown";
  entitlement?: { householdId: string; tier: "free" | "plus"; isPlus: boolean; verificationState: "verified"; validUntil: string | null } | null };
export type PurchaseResult = { status: "purchased" | "restored" | "alreadySubscribed" | "cancelled" | "pending" |
  "completedUnknown" | "error" | "unavailable"; evidence: PurchaseEvidence; issue: PurchaseIssue | null;
  reconciliation?: ServerReconciliation };

export function customerEvidence(info: CustomerInfo, now = Date.now()): PurchaseEvidence {
  const all = info?.entitlements?.all, active = info?.entitlements?.active;
  if (!all || !active || typeof all !== "object" || typeof active !== "object" || Array.isArray(all) || Array.isArray(active)) {
    throw new PurchaseFailure("unknown");
  }
  const plus = active[REVENUECAT.entitlement];
  const known = all[REVENUECAT.entitlement];
  if ((known && typeof known.isActive !== "boolean") || (known?.isActive === true && !plus) ||
      (plus && (!known || known.isActive !== true))) throw new PurchaseFailure("unknown");
  if (plus && (plus.identifier !== REVENUECAT.entitlement || plus.isActive !== true ||
    typeof plus.productIdentifier !== "string" || !plus.productIdentifier || typeof plus.willRenew !== "boolean" ||
    (plus.expirationDate !== null && !Number.isFinite(Date.parse(plus.expirationDate))))) throw new PurchaseFailure("unknown");
  // isActive is SDK evidence, never household authority. Reject locally expired evidence too.
  const valid = plus && (plus.expirationDate === null || Date.parse(plus.expirationDate) > now);
  return { status: valid ? "active" : "none", entitlement: valid ? "plus" : null,
    expiration: valid ? plus.expirationDate : null, productIdentifier: valid ? plus.productIdentifier : null,
    willRenew: valid ? plus.willRenew : null, refreshedAt: new Date(now).toISOString(), issue: null,
    environment: valid && typeof plus.isSandbox === "boolean" ? plus.isSandbox ? "sandbox" : "production" : null };
}
export function offeringPackage(offerings: PurchasesOfferings, plan: PurchasePlan): PurchasesPackage {
  const offering = offerings?.current;
  if (!offering || offering.identifier !== REVENUECAT.offering) throw new PurchaseFailure("offering");
  const matches = offering.availablePackages?.filter(p => p.identifier === REVENUECAT.packages[plan]);
  if (matches?.length !== 1) throw new PurchaseFailure("offering");
  const [pack] = matches;
  // This integration accepts Apple appl_ keys only. Test Store identifiers are deliberately rejected.
  if (pack.product?.identifier !== REVENUECAT.appleProducts[plan] ||
    pack.presentedOfferingContext?.offeringIdentifier !== REVENUECAT.offering) throw new PurchaseFailure("offering");
  return pack;
}
