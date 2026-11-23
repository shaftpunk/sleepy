// Server-only. Current contract: RevenueCat REST API v2 (official subscription
// data model). No client CustomerInfo, webhook expiry, or event ordering grants access.
import { createSubscriptionDiagnostics, safeProviderRequestId, type DiagnosticStage, type ProviderEndpoint } from "./subscriptionDiagnostics.ts";
export type RCConfig = { secret: string; project: string; app: string; webhookApp: string; webhookAuthorization: string; maintenanceAuthorization?:string };
export type VerifiedSource = { id: string; product: string; environment: "production" | "sandbox";
  startsAt: string; endsAt: string; access: boolean; status: string; renewal: string; pending: boolean; transaction: string; correlation?:string;
  chain?:string; purchaseAt?:string };
export class SubscriptionError extends Error {
  readonly status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new SubscriptionError(502, "invalid_provider_response");
  return v as Record<string, unknown>;
};
export function text(v: unknown, max = 255): string {
  if (typeof v !== "string" || !v.length || v.length > max) throw new SubscriptionError(502, "invalid_provider_response"); return v;
}
function timestamp(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) <= 0 || (v as number) > 8640000000000000) throw new SubscriptionError(502,"invalid_provider_response");
  return v as number;
}
export function createRevenueCatAPI(config: RCConfig, fetcher: typeof fetch = fetch, now = () => Date.now(), diagnostics = createSubscriptionDiagnostics()) {
  if (!/^sk_[A-Za-z0-9]+$/.test(config.secret) || !/^proj[A-Za-z0-9]+$/.test(config.project) || !/^app[A-Za-z0-9]+$/.test(config.app)) {
    diagnostics.emit("provider_configuration", "failure", { category: "provider_configuration" });
    throw new SubscriptionError(503,"subscription_configuration_unavailable");
  }
  const prefix = `/v2/projects/${encodeURIComponent(config.project)}`;
  const deadline = now()+25000;
  const forbiddenRequestIds: string[] = [config.secret];
  async function get(path: string, stage: DiagnosticStage, endpoint: ProviderEndpoint, missing = false): Promise<unknown> {
    // Never follow provider-controlled redirects/pages to an arbitrary URL with credentials.
    if (!path.startsWith(prefix+"/") || path.includes("..") || path.includes("\\")) throw new SubscriptionError(502,"invalid_provider_page");
    for (let attempt=0; attempt<2; attempt++) {
      if (now()>deadline) {
        diagnostics.emit(stage, "failure", { endpoint, attempt: attempt + 1, http_status: null, category: "provider_timeout" });
        throw new SubscriptionError(503,"provider_timeout");
      }
      const started = now(); let response: Response | undefined; let reported = false;
      const facts = () => ({ endpoint, attempt: attempt + 1, http_status: response?.status ?? null,
        request_id: safeProviderRequestId(response?.headers.get("x-request-id") ?? null, forbiddenRequestIds), elapsed_ms: Math.max(0, now() - started) });
      try {
        response = await fetcher(`https://api.revenuecat.com${path}`, { headers: { Authorization: `Bearer ${config.secret}` },
          redirect: "error", signal: AbortSignal.timeout(3500) });
        if (response.status===404 && missing) { diagnostics.emit(stage, "missing", facts()); return null; }
        if ((response.status===429 || response.status>=500) && attempt===0) { diagnostics.emit(stage, "retry", { ...facts(), category: "provider_http_failure" }); await new Promise(r=>setTimeout(r,200)); continue; }
        if (!response.ok) {
          diagnostics.emit(stage, "failure", { ...facts(), category: response.status === 401 || response.status === 403 ? "provider_auth_or_permission" : "provider_http_failure" });
          reported = true; throw new SubscriptionError(503,"provider_unavailable");
        }
        const raw = await response.text();
        if (raw.length>1000000) throw new SubscriptionError(502,"invalid_provider_response");
        const value = JSON.parse(raw); diagnostics.emit(stage, "success", facts()); return value;
      } catch (error) {
        if (!reported) diagnostics.emit(stage, error instanceof SubscriptionError || attempt === 1 ? "failure" : "retry", {
          ...facts(), category: response?.ok ? "provider_response_validation"
            : ["TimeoutError", "AbortError"].includes(String((error as { name?: unknown } | null)?.name)) ? "provider_timeout" : "provider_transport_failure" });
        if (error instanceof SubscriptionError) throw error;
        if (attempt===1) throw new SubscriptionError(503,"provider_unavailable");
      }
    }
    throw new SubscriptionError(503,"provider_unavailable");
  }
  async function list(path: string, stage: DiagnosticStage, endpoint: ProviderEndpoint): Promise<unknown[]> {
    const items: unknown[] = []; const visited = new Set<string>();
    const resourcePath = path.split("?")[0];
    for (let page=0;page<5;page++) {
      if (visited.has(path) || path.split("?")[0]!==resourcePath) throw new SubscriptionError(502,"invalid_provider_page"); visited.add(path);
      const value = record(await get(path, stage, endpoint));
      if (value.object!=="list" || !Array.isArray(value.items)) throw new SubscriptionError(502,"invalid_provider_response");
      items.push(...value.items); if (items.length>100) throw new SubscriptionError(503,"provider_snapshot_too_large");
      if (value.next_page===null) return items;
      const next = new URL(text(value.next_page,5000),"https://api.revenuecat.com");
      if (next.origin!=="https://api.revenuecat.com") throw new SubscriptionError(502,"invalid_provider_page");
      path = next.pathname+next.search;
    }
    throw new SubscriptionError(503,"provider_snapshot_incomplete");
  }
  async function snapshot(user: string, knownIds: string[] = [],transactionHint?:string): Promise<VerifiedSource[]> {
    if (!uuid(user)) throw new SubscriptionError(403,"identity_mismatch");
    forbiddenRequestIds.push(user, ...knownIds, ...(transactionHint ? [transactionHint] : []));
    const app = record(await get(`${prefix}/apps/${config.app}`, "revenuecat_app_lookup", "app"));
    if (app.id!==config.app || app.project_id!==config.project || app.type!=="app_store" || record(app.app_store).bundle_id!=="no.strandeconsulting.sleepy") {
      throw new SubscriptionError(502,"provider_app_mismatch");
    }
    const path = `${prefix}/customers/${encodeURIComponent(user)}`;
    const customer = await get(path, "revenuecat_customer_lookup", "customer", true);
    if (customer!==null && (record(customer).id!==user || record(customer).project_id!==config.project)) throw new SubscriptionError(403,"identity_mismatch");
    const subscriptions = customer===null ? [] : await list(`${path}/subscriptions?limit=100`, "revenuecat_subscriptions_lookup", "customer_subscriptions");
    const mapped = new Map<string,Record<string,unknown>>();
    for (const value of subscriptions) { const s=record(value); if(s.customer_id!==user) throw new SubscriptionError(403,"identity_mismatch"); mapped.set(text(s.id),s); }
    if (knownIds.length>100) throw new SubscriptionError(503,"provider_snapshot_too_large");
    // Verify missing known sources individually, including moved/revoked sources.
    for (const id of knownIds) if(!mapped.has(id)) {
      const value=await get(`${prefix}/subscriptions/${encodeURIComponent(text(id))}`, "revenuecat_known_subscription_lookup", "subscription", true);
      if(value!==null) { const s=record(value); if(s.id!==id)throw new SubscriptionError(502,"invalid_provider_response"); mapped.set(id,s); }
    }
    const sources: VerifiedSource[]=[]; const products=new Map<string,Record<string,unknown>>();
    for(const s of mapped.values()) {
      for (const value of [s.id, s.customer_id, s.original_customer_id, s.store_subscription_identifier]) {
        if (typeof value === "string") forbiddenRequestIds.push(value);
      }
      if (s.object!=="subscription") throw new SubscriptionError(502,"invalid_provider_response");
      if (s.store!=="app_store" || s.ownership!=="purchased") continue; // No Test Store/Family Sharing/promotional grants.
      const productId=text(s.product_id);
      if (!products.has(productId)) products.set(productId,record(await get(`${prefix}/products/${encodeURIComponent(productId)}`, "revenuecat_product_lookup", "product")));
      const product=products.get(productId)!;
      if(product.id!==productId || product.object!=="product") throw new SubscriptionError(502,"invalid_provider_response");
      if(product.app_id!==config.app) continue;
      const productName=text(product.store_identifier);
      if(!["sleepy_plus_monthly","sleepy_plus_yearly"].includes(productName) || product.type!=="subscription") continue;
      if(s.original_customer_id!==user) throw new SubscriptionError(409,"subscription_ownership_conflict");
      const moved=s.customer_id!==user;
      if(moved && !knownIds.includes(text(s.id))) throw new SubscriptionError(403,"identity_mismatch");
      if(!["production","sandbox"].includes(String(s.environment)) || typeof s.gives_access!=="boolean" || typeof s.pending_payment!=="boolean") {
        throw new SubscriptionError(502,"invalid_provider_response");
      }
      const entitlements = record(s.entitlements);
      let entitlementItems: unknown[];
      if(entitlements.next_page===null && Array.isArray(entitlements.items)) entitlementItems=entitlements.items;
      else entitlementItems=await list(`${prefix}/subscriptions/${encodeURIComponent(text(s.id))}/entitlements?limit=100`, "revenuecat_entitlements_lookup", "subscription_entitlements");
      const plus = entitlementItems.some(e=> {const item=record(e); return item.object==="entitlement" && item.state==="active" && item.project_id===config.project && item.lookup_key==="plus";});
      const start=timestamp(s.starts_at), end=s.ends_at===null ? null : timestamp(s.ends_at);
      if(start>now()+60000) throw new SubscriptionError(502,"invalid_provider_dates");
      // RevenueCat gives_access includes grace. If it supplies no future end,
      // grant only a short verified-access lease, never an invented night/month.
      const access=s.gives_access && plus && !moved;
      const until=access && (end===null || end<=now()) ? now()+5*60000 : end;
      if(until===null || until<=start) { if(access) throw new SubscriptionError(502,"invalid_provider_dates"); continue; }
      sources.push({id:text(s.id),product:productName,environment:s.environment as VerifiedSource["environment"],
        startsAt:new Date(start).toISOString(),endsAt:new Date(until).toISOString(),access,status:moved?"transferred":text(s.status),
        renewal:text(s.auto_renewal_status),pending:s.pending_payment,transaction:text(s.store_subscription_identifier)});
    }
    if(transactionHint){
      // A client transaction ID is only a correlation hint. Resolve it through
      // RevenueCat, then match only subscriptions already verified above.
      const matches=await list(`${prefix}/subscriptions?store_subscription_identifier=${encodeURIComponent(text(transactionHint))}&limit=100`, "revenuecat_subscription_search", "subscription_search");
      const ids=new Set(matches.map(value=>text(record(value).id)));
      for(const source of sources)if(ids.has(source.id))source.correlation=transactionHint;
    }
    return sources;
  }
  return {snapshot};
}

export async function webhookAuthorized(actual: string | null, expected: string): Promise<boolean> {
  if (!actual || !expected.startsWith("Bearer ") || expected.length<39 || expected.length>512 || actual.length>512) return false;
  const [a,b]=await Promise.all([actual,expected].map(v=>crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))));
  const x=new Uint8Array(a),y=new Uint8Array(b);let difference=0;for(let i=0;i<x.length;i++)difference|=x[i]^y[i];return difference===0;
}
export function parseWebhook(input: unknown,config: RCConfig) {
  const body=record(input),event=record(body.event);
  if(body.api_version!=="1.0" || event.app_id!==config.webhookApp || (event.project_id!==undefined && event.project_id!==config.project)) throw new SubscriptionError(400,"invalid_webhook");
  const id=text(event.id),type=text(event.type);
  if(!/^[A-Z_]+$/.test(type))throw new SubscriptionError(400,"invalid_webhook");
  const environment=event.environment===undefined && type==="TRANSFER" ? "unspecified" : String(event.environment).toLowerCase();
  if(!["production","sandbox","unspecified"].includes(environment))throw new SubscriptionError(400,"invalid_webhook_environment");
  const users: string[]=[];
  if(type==="TRANSFER") {
    if(!Array.isArray(event.transferred_from)||!Array.isArray(event.transferred_to))throw new SubscriptionError(400,"invalid_webhook");
    for(const value of [...event.transferred_from,...event.transferred_to])if(uuid(value))users.push(value);
  } else {
    if(typeof event.app_user_id!=="string")throw new SubscriptionError(400,"invalid_webhook");
    if(uuid(event.app_user_id))users.push(event.app_user_id);
  }
  if(users.length>20)throw new SubscriptionError(400,"invalid_webhook");
  return {id,type,environment,at:new Date(timestamp(event.event_timestamp_ms)).toISOString(),users:[...new Set(users)].sort()};
}
