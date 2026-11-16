// Temporary test-panel data only. Never retain error objects, userInfo, receipts,
// transactions, identifiers, headers or credentials, or forward them to console.
export type PurchaseOperation = "configure" | "customerInfo" | "offerings" | "package lookup" |
  "purchase" | "restore" | "reconciliation";
export type PurchaseDiagnostic = {
  operation: PurchaseOperation;
  outcome: "success" | "error" | "cancelled";
  code: string | null;
  message: string | null;
  storeKitIssue: boolean;
  configurationIssue: boolean;
};
export type OfferingDiscovery = {
  status: "not_checked" | "available" | "error";
  currentOfferingExists: boolean | null;
  expectedOfferingMatches: boolean | null;
  monthlyPackageFound: boolean | null;
  annualPackageFound: boolean | null;
  monthlyMappingValid: boolean | null;
  annualMappingValid: boolean | null;
};
export const EMPTY_OFFERING_DISCOVERY: OfferingDiscovery = {
  status: "not_checked", currentOfferingExists: null, expectedOfferingMatches: null,
  monthlyPackageFound: null, annualPackageFound: null, monthlyMappingValid: null, annualMappingValid: null,
};

function safeMessage(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  // Messages occasionally embed request/receipt dumps. Abstain for those; do
  // not attempt to sanitize entire payloads or stringify any nested objects.
  if (/[{}[\]]|receipt|transaction|authorization|bearer|jwt|api[_ -]?key|\btoken\b|private[_ ]|access[_ -]?token|app.?user.?id|customer.?id/i.test(value)) {
    return "Message omitted (potential sensitive data).";
  }
  return value
    .replace(/https?:\/\/\S+/gi, "[URL removed]")
    .replace(/\b(?:appl|sk|test)_[A-Za-z0-9_-]+\b/g, "[key removed]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[ID removed]")
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token removed]")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[email removed]")
    .replace(/\b[A-Za-z0-9_+/-]{24,}={0,2}\b/g, "[value removed]")
    .split("").map(character => character.charCodeAt(0) < 32 ? " " : character).join("").slice(0, 360);
}

export function purchaseDiagnostic(operation: PurchaseOperation, error?: unknown): PurchaseDiagnostic {
  if (error === undefined) return { operation, outcome: "success", code: null, message: null, storeKitIssue: false, configurationIssue: false };
  const source = error as { code?: unknown; message?: unknown; underlyingErrorMessage?: unknown; userInfo?: { underlyingErrorMessage?: unknown } } | null;
  const codeValue = String(source?.code ?? "");
  const code = /^\d{1,3}$/.test(codeValue) ? codeValue : null;
  const message = safeMessage(source?.message);
  const underlying = safeMessage(source?.underlyingErrorMessage ?? source?.userInfo?.underlyingErrorMessage);
  const text = [message, underlying].filter(Boolean).join(" | ") || "No safe error message supplied.";
  return { operation, outcome: code === "1" ? "cancelled" : "error", code, message: text,
    storeKitIssue: ["2", "5", "32", "38"].includes(code ?? "") || /storekit|app store|store configuration/i.test(text),
    configurationIssue: ["11", "17", "23"].includes(code ?? "") || /configuration|configured/i.test(text) };
}
