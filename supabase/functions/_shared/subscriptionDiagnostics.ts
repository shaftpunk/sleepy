// Server-only structured diagnostics. Never accept URLs, request/response bodies,
// error messages, credentials, RPC arguments or customer/billing identifiers.
const stages = ["reconciliation", "reconciliation_job", "provider_configuration", "revenuecat_snapshot",
  "revenuecat_app_lookup", "revenuecat_customer_lookup", "revenuecat_subscriptions_lookup",
  "revenuecat_known_subscription_lookup", "revenuecat_product_lookup", "revenuecat_entitlements_lookup",
  "revenuecat_subscription_search", "apple_verification", "apple_credentials", "apple_http_verification",
  "apple_response_validation", "apply_rpc", "entitlement_resolve", "rpc"] as const;
export type DiagnosticStage = typeof stages[number];
const endpoints = ["app", "customer", "customer_subscriptions", "subscription", "product", "subscription_entitlements", "subscription_search"] as const;
export type ProviderEndpoint = typeof endpoints[number];
const categories = ["provider_auth_or_permission", "provider_http_failure", "provider_transport_failure",
  "provider_response_validation", "provider_configuration", "provider_timeout", "provider_snapshot_limits",
  "apple_credential_configuration", "apple_http_verification", "apple_response_validation",
  "rpc_failure", "reconciliation_validation", "unexpected_failure"] as const;
type Category = typeof categories[number];
const rpcNames = ["revenuecat_begin", "revenuecat_apply", "revenuecat_prepare", "revenuecat_cancel_intent",
  "revenuecat_transfer", "revenuecat_accept_event", "revenuecat_finish_event", "revenuecat_maintenance_work",
  "resolve_household_entitlements"];
type Fields = { endpoint?: ProviderEndpoint; http_status?: number | null; attempt?: number;
  request_id?: string | null; elapsed_ms?: number; category?: Category; rpc_name?: string; postgres_code?: string | null };
export type SubscriptionDiagnosticEvent = Fields & { event: "subscription_diagnostic"; stage: DiagnosticStage;
  outcome: "start" | "success" | "failure" | "missing" | "retry" };
type Sink = (event: SubscriptionDiagnosticEvent) => void;

export function safeProviderRequestId(value: string | null, forbidden: readonly string[] = []): string | null {
  // Accept only UUID/hex/provider-style request IDs. Drop echoes of any known
  // private identifier, numeric transaction IDs, keys, tokens and arbitrary text.
  if (!value || forbidden.some(secret => secret && value.toLowerCase().includes(secret.toLowerCase()))) return null;
  return /^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?=[a-f0-9]*[a-f])[a-f0-9]{16,64}|req_[A-Za-z0-9]{8,64})$/i.test(value) ? value : null;
}

function failureCategory(error: unknown): Category {
  // Match only our finite public error codes; never retain arbitrary messages.
  const message = (error as { message?: unknown } | null)?.message;
  if (message === "apple_configuration_unavailable") return "apple_credential_configuration";
  if (message === "apple_verification_unavailable") return "apple_http_verification";
  if (["invalid_apple_response", "invalid_apple_transaction", "apple_product_mismatch", "purchase_chain_mismatch"].includes(String(message))) return "apple_response_validation";
  if (message === "subscription_configuration_unavailable") return "provider_configuration";
  if (message === "provider_timeout") return "provider_timeout";
  if (["provider_snapshot_too_large", "provider_snapshot_incomplete"].includes(String(message))) return "provider_snapshot_limits";
  if (["invalid_provider_response", "invalid_provider_page", "invalid_provider_dates", "provider_app_mismatch", "identity_mismatch", "subscription_ownership_conflict"].includes(String(message))) return "provider_response_validation";
  if (message === "provider_unavailable") return "provider_http_failure";
  if (message === "subscription_operation_unavailable") return "rpc_failure";
  if (["invalid_reconciliation_job", "invalid_entitlement_result", "account_unavailable"].includes(String(message))) return "reconciliation_validation";
  return "unexpected_failure";
}

export function createSubscriptionDiagnostics(sink: Sink = event => console.info(JSON.stringify(event)), now = () => Date.now()) {
  function emit(stage: DiagnosticStage, outcome: SubscriptionDiagnosticEvent["outcome"], fields: Fields = {}) {
    if (!(stages as readonly string[]).includes(stage) || !["start", "success", "failure", "missing", "retry"].includes(outcome)) return;
    const event: SubscriptionDiagnosticEvent = { event: "subscription_diagnostic", stage, outcome };
    if (fields.endpoint && (endpoints as readonly string[]).includes(fields.endpoint)) event.endpoint = fields.endpoint;
    if (fields.http_status === null || (Number.isInteger(fields.http_status) && fields.http_status! >= 100 && fields.http_status! <= 599)) event.http_status = fields.http_status;
    if (Number.isInteger(fields.attempt) && fields.attempt! >= 1 && fields.attempt! <= 2) event.attempt = fields.attempt;
    if (fields.request_id !== undefined) event.request_id = safeProviderRequestId(fields.request_id);
    if (Number.isFinite(fields.elapsed_ms) && fields.elapsed_ms! >= 0) event.elapsed_ms = Math.round(fields.elapsed_ms!);
    if (fields.category && (categories as readonly string[]).includes(fields.category)) event.category = fields.category;
    if (fields.rpc_name && rpcNames.includes(fields.rpc_name)) event.rpc_name = fields.rpc_name;
    if (fields.postgres_code !== undefined) event.postgres_code = typeof fields.postgres_code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(fields.postgres_code) ? fields.postgres_code : null;
    try { sink(event); } catch { /* Optional diagnostics must not change verification or fail-closed behavior. */ }
  }
  async function run<T>(stage: DiagnosticStage, work: () => Promise<T>): Promise<T> {
    const start = now(); emit(stage, "start");
    try { const result = await work(); emit(stage, "success", { elapsed_ms: Math.max(0, now() - start) }); return result; }
    catch (error) { emit(stage, "failure", { category: failureCategory(error), elapsed_ms: Math.max(0, now() - start) }); throw error; }
  }
  async function rpc<T extends { error: { code?: string } | null }>(name: string, work: () => PromiseLike<T>): Promise<T> {
    const start = now();
    try {
      const result = await work();
      emit("rpc", result.error ? "failure" : "success", { rpc_name: name, ...(result.error ? { category: "rpc_failure", postgres_code: result.error.code ?? null } : {}), elapsed_ms: Math.max(0, now() - start) });
      return result;
    } catch (error) {
      emit("rpc", "failure", { rpc_name: name, category: "rpc_failure", postgres_code: (error as { code?: string } | null)?.code ?? null, elapsed_ms: Math.max(0, now() - start) });
      throw error;
    }
  }
  return { emit, run, rpc };
}
export type SubscriptionDiagnostics = ReturnType<typeof createSubscriptionDiagnostics>;
