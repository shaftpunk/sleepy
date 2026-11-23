# Subscription reconciliation: safe server diagnostics

The native public SDK key and the server V2 secret key are separate credentials.
Healthy native configuration/offerings do not verify the server key's permissions.
An existing POST 503 log alone cannot establish which dependency failed.

## RevenueCat requests and minimum V2 read permissions

Base: `https://api.revenuecat.com/v2/projects/{project_id}`. All requests are GET.

| Path after base | Safe log category | Required permission |
| --- | --- | --- |
| `/apps/{app_id}` | `app` | `project_configuration:apps:read` |
| `/customers/{customer_id}` | `customer` | `customer_information:customers:read` |
| `/customers/{customer_id}/subscriptions?limit=100` | `customer_subscriptions` | `customer_information:subscriptions:read` |
| `/subscriptions/{subscription_id}` | `subscription` | `customer_information:subscriptions:read` |
| `/products/{product_id}` | `product` | `project_configuration:products:read` |
| `/subscriptions/{subscription_id}/entitlements?limit=100` | `subscription_entitlements` | `customer_information:subscriptions:read` |
| `/subscriptions?store_subscription_identifier={hint}&limit=100` | `subscription_search` | `customer_information:subscriptions:read` |

The app lookup runs before the customer lookup, including for customers without
subscriptions. Product reads are needed when subscriptions exist. Known missing
subscriptions are verified individually. Entitlement lists use the paginated
endpoint only when the embedded list is incomplete. Search runs only with a
transaction correlation hint. Pagination uses the same endpoint category.

No RevenueCat write, purchases, offerings, or project-list permission is required
by these server GET requests. All four read scopes must cover the configured
RevenueCat project. The Apple server credentials are separate again.

Official references:
- https://www.revenuecat.com/docs/api-v2/app
- https://www.revenuecat.com/docs/api-v2/customer
- https://www.revenuecat.com/docs/api-v2/customer/resources
- https://www.revenuecat.com/docs/api-v2/product
- https://www.revenuecat.com/docs/api-v2/subscription

## Log contract

Each JSON event has `event: subscription_diagnostic`, a static `stage` and an
`outcome`. REST attempts include static `endpoint`, actual `http_status` (or null
if no response), one-based `attempt`, sanitized `request_id`, and `elapsed_ms`.
The app/product/entitlement categories cover the additional validation endpoints
used by the implementation; none of the categories contains an identifier.

HTTP 401/403 produces `category: provider_auth_or_permission` and the real upstream
status. The client still receives the original 503 `provider_unavailable` error.
429/5xx retries, missing 404s, transport/timeouts and malformed responses are
distinguishable. Retry counts, deadlines, redirects, source validation, and
entitlement application behavior remain unchanged.

The staged path is `reconciliation` -> `reconciliation_job` ->
`revenuecat_snapshot` -> REST lookups -> Apple verification when sources exist ->
`apply_rpc` -> `entitlement_resolve` when a household is returned. Job/apply/resolve
boundaries log start and completion/failure. Runtime RPC events add only the
allowlisted `rpc_name`, SQLSTATE or PostgREST `postgres_code`, timing and outcome.
They never include arguments, database messages, details or hints.

Apple events separate `apple_credentials`, `apple_http_verification`, and
`apple_response_validation`, beneath `apple_verification`. HTTP events include
status/attempt/timing. Configuration/signing failure and response/chain validation
use fixed categories, never Apple error bodies or transaction identifiers.

The event builder allowlists keys and enum values and never serializes error
objects. Only bounded UUID/hex/provider-style `x-request-id` values are accepted;
echoes of known credentials, user/subscription IDs or transaction hints are
dropped. No URLs, query strings, API keys, authorization headers, JWTs, receipts,
subscription IDs, transaction IDs or customer/billing response bodies are logged.
Logger sink failure is optional and cannot alter verification results.

## Deploy scope (commands only; not deployed by this change)

For the current authenticated endpoint only, from the repository root:

```powershell
node_modules/.bin/supabase.cmd functions deploy subscription-reconcile --project-ref zebrmlignzctngbxijql
```

These two functions import the same shared runtime. Deploy them individually only
when also rolling the diagnostics out to webhook and maintenance execution:

```powershell
node_modules/.bin/supabase.cmd functions deploy revenuecat-webhook --project-ref zebrmlignzctngbxijql
node_modules/.bin/supabase.cmd functions deploy subscription-maintenance --project-ref zebrmlignzctngbxijql
```

Do not run an unqualified all-functions deployment: other local function changes
are unrelated. JWT verification settings and handler authentication are unchanged.
