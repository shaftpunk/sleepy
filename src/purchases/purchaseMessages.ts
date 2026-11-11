import type { TranslationKey } from "../i18n";
import type { PurchaseResult } from "./revenueCatModel";
// Future UI translates a typed result; it never renders Error.message from SDKs.
export function purchaseMessageKey(result: PurchaseResult): TranslationKey {
  if(result.reconciliation && ["purchased","restored","alreadySubscribed","completedUnknown"].includes(result.status)){
    if(result.reconciliation.state==="assignmentRequired")return "purchases.assignmentRequired";
    if(result.reconciliation.state==="sandboxVerified")return "purchases.sandboxVerified";
    if(result.reconciliation.state==="verified"||result.reconciliation.state==="verifiedMultiple"||result.reconciliation.state==="free")return "purchases.statusUpdated";
    if(result.status!=="completedUnknown")return "purchases.activationPending";
  }
  if (result.status === "error" || result.status === "unavailable") return `purchases.${result.issue ?? "unknown"}`;
  return `purchases.${result.status}`;
}
