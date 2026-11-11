# Verified RevenueCat funding backend — local review

Status: reviewed local implementation, approved for Git commit/push only. No
Supabase migration/function deployment, production secrets, webhook or schedule
configuration has occurred. SDK and backend form one coordinated implementation.

## Architecture inspected

Reviewed REVENUECAT_SDK_REVIEW.md, the installed Capacitor SDK, AuthProvider and
session-generation fencing, active user/baby/household context, feature registry,
EntitlementProvider, entitlement service/parser, private funding/grant tables,
household authorization baseline, existing Edge Function conventions/config and
the Phase 1 resolver. This implementation extends that architecture. It does
not replace role authorization or the household resolver.

Official API contracts reviewed:

- https://www.revenuecat.com/docs/api-v2
- https://www.revenuecat.com/docs/api-v2/customer/resources
- https://www.revenuecat.com/docs/api-v2/subscription-data-model
- https://www.revenuecat.com/docs/api-v2/subscription
- https://www.revenuecat.com/docs/api-v2/product
- https://www.revenuecat.com/docs/api-v2/app
- https://www.revenuecat.com/docs/integrations/webhooks
- https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields

REST v2's store_subscription_identifier is the latest Apple transaction ID, not
an original transaction ID. RevenueCat subscription IDs persist across renewals
but may change for paid product changes/re-subscription. Funding segment keys remain project + app + RevenueCat subscription ID, qualified
by environment. A separate private chain is keyed by project + app + environment +
Apple originalTransactionId. It owns exactly one explicit household destination.
The latest Apple transaction is not mislabelled as an original chain ID.

## Initial purchase and durable intent

1. Client requires its current authenticated explicit user/baby/household context.
2. subscription-reconcile/prepare verifies the JWT with Supabase auth.getUser.
   Its caller-scoped resolver verifies target household membership. Current
   provider state is fetched independently, then the server-only prepare RPC
   rechecks membership and the baby link atomically.
3. A private two-hour intent stores purchaser, target household/baby, Apple
   product, previously observed subscription IDs, status and timestamps. Exactly
   one pending intent per purchaser/project/app prevents simultaneous devices
   choosing different destinations. A matching attempt UUID retry reuses it; a new attempt cannot inherit it.
4. The client only then presents Apple's package purchase sheet.
5. After success it supplies the opaque intent ID and SDK transaction identifier
   as a correlation hint. It never supplies an authoritative user ID, tier,
   validity or subscription object.
6. The server independently fetches current owned subscriptions, then resolves
   the transaction hint through RevenueCat's subscription-search endpoint. Only
   an already verified source can receive that correlation.
7. Initial binding requires the exact intent, unexpired authorization, current
   membership/baby link, matching product, exactly one matching transaction-backed
   source absent from the pre-purchase snapshot, and an Apple transaction purchase time after intent creation.
8. Binding, source upserts and intent consumption are atomic. An unassigned old
   restored source is not swept into the new purchase's household.

Apple verifies the stable original transaction chain before database application.

Webhooks and restores cannot choose/consume a pending initial intent implicitly.
They store verified unassigned sources until the exact post-purchase proof arrives
or the purchaser explicitly assigns/transfers them. If the webhook arrives first,
the authenticated post-purchase request can bind its verified source idempotently.

Intents that expire, pending approvals that outlive two hours, unavailable
transaction correlation, ambiguous matches or reinstall before final binding
result in assignmentRequired. They never guess a household. Explicit SDK cancellation expires its matching intent through an authenticated
server action. Pending approval is not cancellation. If cancellation cannot reach
the server, a fresh attempt is blocked until cancellation succeeds or expiry; it
cannot silently reuse the previous attempt. A future paywall
must handle that deliberate conservative behavior.

## Chain-scoped ownership (final approved adjustment)

No account/purchaser/app-wide destination remains. revenuecat_accounts contains
only request revision/rate-limit state. Each Apple original transaction chain
has one row in revenuecat_subscription_chains, unique by project, app, environment
and original transaction ID. Multiple RC subscription segments can refer to it.
A composite deferred foreign key enforces that their funding destination matches
that chain's destination. No segment can independently fund another household.

Monthly/yearly changes in the same Apple group preserve the original chain and
therefore preserve the household, even when RC creates a new subscription ID.
An already bound chain cannot consume an intent targeting another household.
A distinct future chain may explicitly fund another household for the same
purchaser. No automatic transfer follows active-context or membership changes.
Multiple households return verifiedMultiple, with no arbitrary household chosen.

### Apple server-only lineage verification

RevenueCat v2 does not expose Apple's original transaction ID. The user approved
adding Apple's authenticated Get Transaction Info API to verify lineage without
waiting for a webhook. Server-only ES256 JWTs authorize fixed Apple HTTPS endpoints:
production api.storekit.apple.com; sandbox api.storekit-sandbox.apple.com.
The server checks transaction ID, bundle, environment, purchased ownership,
subscription type, product, original transaction ID and transaction purchase date.
A purchase hint must independently correlate through RC and the same Apple chain.

The payload is decoded ONLY from a successful authenticated fixed-origin Apple
HTTPS response. This is TLS-based API response authentication, not independent
JWS signature verification. No caller-supplied receipt/JWS or webhook JWS can enter
this path. Requests reject redirects, have timeouts/retry limits and return safe
errors. No Apple SDK/native dependency or local certificate store was added.

Apple references:
- https://developer.apple.com/documentation/appstoreserverapi/get-transaction-info
- https://developer.apple.com/documentation/appstoreserverapi/generating-json-web-tokens-for-api-requests

## Authoritative verification

RevenueCat requests use a v2 secret key, fixed HTTPS origin/project prefix,
redirect rejection, bounded same-resource pagination, response limits, 3.5-second
timeouts, one retry for network/429/server failures and a 25-second per-customer
budget. Incomplete/malformed snapshots abort; they never erase known access as
if a successful empty response had been received.

The configured app/project and bundle ID must match Sleepy App Store. Customer
ID must equal the authenticated canonical Supabase UUID; original_customer_id
must also match for grantable subscriptions. Emails/anonymous IDs/aliases and
transferred-in purchases do not become ownership. Known subscriptions absent
from the customer list are checked individually, so a source moved away from
its original purchaser can be revoked without granting it to the new account.
An original-owner conflict is rejected and requires manual review.

Only App Store, purchased ownership, the two approved Apple product identifiers,
an active plus mapping and current gives_access qualify. Family Sharing, Test
Store, other apps/stores/products and promotional entitlements are excluded.
All API source environments are validated explicitly.

Cancellation preserves access while RevenueCat still gives access. Revocation,
refund, expiration and billing retry follow current provider access state rather
than the webhook's kind/date. Grace with a future provider end uses it; if
RevenueCat says gives_access but supplies no future end, a five-minute verified
access lease is used and must be maintained by the protected refresh job. No
medical/sleep prediction or subscription duration is invented.

## Storage and RPCs

Migration: `20261113090000_revenuecat_verified_funding.sql`.

Extends private.entitlement_funding_sources with provider project/app, store,
provider subscription status, renewal state, pending-payment flag and latest
store transaction metadata. Existing validity/status/environment/ownership and
one-destination columns remain. No existing funding rows are seeded or converted.

Five new private tables:

- revenuecat_accounts: reconciliation revision fence and per-user request window
  (30 starts/minute), with no household destination.
- revenuecat_subscription_chains: verified Apple original chain ownership and
  explicit destination, independent of RC segment/product changes.
- revenuecat_purchase_intents: durable pre-purchase authorization and consumption.
- revenuecat_webhook_inbox: event key, app/project/environment, type/time, affected
  canonical UUIDs, minimized payload hash, processing state/attempt metadata.
- revenuecat_audit: append-only server audit of binding, reconciliation and
  transfer. No receipt, token, email, subscriber attributes or raw webhook body.

Eight public RPCs, executable by service_role only:

- revenuecat_begin
- revenuecat_prepare
- revenuecat_apply
- revenuecat_transfer (explicit chain UUID required)
- revenuecat_cancel_intent
- revenuecat_accept_event
- revenuecat_finish_event
- revenuecat_maintenance_work

Trusted Edge code derives purchaser UUID from verified Supabase JWT, then passes
it to these server-only RPCs. A normal client cannot call them to impersonate a
purchaser. Normal client table access is revoked; RLS is enabled without client
policies. Audit rows have server SELECT/INSERT only, not server UPDATE/DELETE.
No existing household/baby/sleep/feed policies or role helpers are rewritten.

## Reconciliation and transfers

A begin RPC issues a monotonically increasing per-purchaser/app revision before
network reads. Apply locks that account and rejects an older revision, preventing
an older request completing late from overwriting a newer verification.

Apply operates on the complete verified snapshot. Missing sources cease to
qualify, current sources upsert by stable RC source key, and ownership conflicts
cannot overwrite another purchaser's row. Independent sources combine through
the existing resolver. Expiring one source does not remove another source or
grant. Production qualification remains production-only.

Leaving a funded household immediately stops that source qualifying through the
existing resolver's membership check. Data, other memberships and audit records
are retained. Joining another household never moves funding.

The authenticated transfer action first reconciles current provider ownership,
then verifies destination membership and moves only that selected chain's sources
atomically to one explicit destination with an audit record. It also fences
pending older reconciliations and invalidates pending intents. There is no
cooldown and no transfer UI. It never changes roles or memberships. Restore
retains a valid association or returns assignmentRequired; the active household
is never sent as an implicit restore destination.

An expired verified source can also be reassigned explicitly for a future renewal;
that operation does not make it active or grant Plus. This prevents an expired
purchaser who left the previous household from being trapped in that old binding.

## Webhooks, retries and maintenance

Three prepared Edge Functions:

- subscription-reconcile: authenticated prepare/reconcile/restore/transfer.
- revenuecat-webhook: strong configured Authorization header, checked before
  reading the bounded body; no Supabase user JWT is expected here.
- subscription-maintenance: distinct server Authorization secret; retries inbox
  failures and periodically refreshes active sources.

Gateway verify_jwt=false is intentional for these handlers: the first verifies
the actual user with auth.getUser, the other two verify their respective server
secrets. No anonymous delivery/mutation route is introduced.

Webhook validation checks API version, app, optional project, environment, event
ID/type/time and canonical affected UUIDs. Transfers reconcile both from/to sets.
Transfer events with omitted environment are tagged unspecified in the inbox;
each actual source still receives its API-verified production/sandbox environment.
Anonymous aliases are not followed. Dashboard test events can be acknowledged
without creating a user or funding source.

An event is stored before any provider reconciliation. Unique event IDs and a
hash of minimized structural fields detect identity conflicts; processed events
are acknowledged without reapplying. Failed/pending events remain retryable.
Concurrent duplicate work is safe because source upserts and revision fences are
idempotent. Completion cannot be overwritten by a later failed duplicate.

Event timestamps do not order funding updates: every supported subscription
event triggers current-state verification, including purchase/renewal/cancel/
uncancel/expiry/billing/product change/extension/refund/revocation/transfer.

RevenueCat retries are finite. Before paid UI, deploy and schedule the dedicated
maintenance endpoint, ideally every minute, with its Authorization value read
from Vault. It refreshes up to five due active purchasers and one pending/failed
inbox event per invocation. Failed events rotate by last attempt. It returns
aggregate counts only. Monitor backlog/provider rate limits and scale batch or
schedule capacity as needed; the five-minute grace lease depends on timely work.
This task does not create or modify any cron job, including feeding reminders.

## Client behavior

The purchase service adds server prepare before Apple, and server reconciliation
after purchase/restore even if final SDK refresh fails. A completed payment with
server delay remains purchased/completedUnknown plus reconciliation.pending,
never a failed charge. Typed EN/NO messages cover activation, assignment and test
purchases without exposing server/SDK errors. Account/session fences still apply.

The server responds only with safe household entitlement resolution. The client
validates it and signals the matching user/household provider to refresh from the
existing RPC. SDK evidence, server reconciliation status and household entitlement
remain separate. If refresh is delayed, the existing provider can be unknown and
retry; no local funding is fabricated and no fake household Plus is assigned.

## Secrets and dashboard steps — required later, not performed

Supabase Edge secrets (never VITE or native/GitHub build variables):

| Name | Purpose |
|---|---|
| REVENUECAT_SECRET_API_KEY | v2 secret, least-privilege read-only RevenueCat API permissions |
| REVENUECAT_PROJECT_ID | Exact project ID from RevenueCat |
| REVENUECAT_APP_ID | Exact REST v2 iOS app ID |
| REVENUECAT_WEBHOOK_APP_ID | Exact app_id emitted by the selected iOS webhook |
| REVENUECAT_WEBHOOK_AUTHORIZATION | Full Bearer value with at least 32 random secret characters |
| REVENUECAT_MAINTENANCE_AUTHORIZATION | Different full Bearer secret for scheduled maintenance |
| APPLE_IAP_ISSUER_ID | App Store Server API issuer UUID |
| APPLE_IAP_KEY_ID | App Store Server API key identifier |
| APPLE_IAP_PRIVATE_KEY | Server-only PKCS8 .p8 signing key |

All nine names above are read only by Edge runtime; no actual values were created
or committed. Apple credentials require a later manual server configuration.

Supabase URL/anon/service-role variables are already supplied server-side by the
platform. The RevenueCat key needs customer_information:customers:read,
customer_information:subscriptions:read, project_configuration:products:read,
project_configuration:apps:read. It does not need provider mutation permissions.

After review, configure a RevenueCat webhook to the deployed revenuecat-webhook
URL, with the exact Authorization value, Sleepy iOS app filter, both Sandbox and
Production, and all subscription events including transfers. Keep the already
confirmed Keep with original App User ID restore policy, including Sandbox.
Do not put the Supabase anon key in place of the webhook authentication secret.
Configure the separate protected maintenance cron job using Vault; no plaintext
secret should be stored in a cron command or committed SQL.

## Environments and rollout

- Local tests: synthetic provider responses + isolated PGlite; no live purchases.
- RevenueCat Test Store: excluded by both client key/product validation and
  server store/app/product checks.
- TestFlight/Apple Sandbox: verified sandbox rows only; the unchanged production
  resolver does not count them. A bound Sandbox purchase returns state=sandboxVerified, subscriptionState=sandbox,
  the exact household ID, and entitlement tier=free/is_plus=false. Compatibility preserves every current feature.
- Production App Store: only verified production rows can qualify for Plus.

Production verification returns subscriptionState=production and a Plus resolver
result only for its valid explicit funding household. No subscription returns
state=free/subscriptionState=none. Provider/network/auth failures return a safe
error; the client records pending/unknown rather than falsely Free. An unassigned
valid source returns assignmentRequired with its verified environment. Multiple
assigned destinations return verifiedMultiple with householdId=null, prompting
providers to refresh their own explicit context.

No resolver environment override or client-controlled sandbox unlock exists.
TestFlight and production have separate environment-qualified chains and funding. Do not interpret a Sandbox purchase as production Plus in test assertions.

Deploy order after approval: recheck migration history/collisions; apply this
single migration; configure server secrets; deploy only the three new functions;
verify permissions/roles/cross-household isolation and safe real API contracts;
configure maintenance; then configure RevenueCat webhook and Sandbox test. No
existing Edge Function needs redeployment. Do not bulk deploy all local functions.

## Validation, boundaries and remaining work

Tests cover provider contract validation, ownership, environment isolation,
transaction correlation, client identity/household scoping, stale responses,
durable intents, direct-client denials, source combinations, removal, explicit
transfer, inbox idempotency/retries, current-state event processing and maintenance
authentication. Actual SQL executes only in isolated PGlite fixtures.

Strict TypeScript checks cover the pure Edge helpers in addition to application
type-check/build. No live RevenueCat server key or real production API call was
used, and no Supabase schema/function/secret/job deployment or dashboard webhook
configuration occurred. A real Sandbox end-to-end test remains mandatory before
purchase UI. Deno/Supabase-hosted execution and Xcode/StoreKit testing are not
claimed from Windows unit tests.

Final local validation: 230/230 Node tests passed. Coverage includes isolated SQL,
RevenueCat, entitlement, household/auth, Home, Live Activity and Sound Monitoring
regressions. Production and native web builds passed; strict pure Edge helper
type checks passed. Lint has zero errors and the existing Home.tsx effect-dependency
warning. The existing Vite/PWA inlineDynamicImports deprecation warning remains.
No additional Capacitor sync was needed because this backend phase changes no
native dependency or configuration. Final git diff whitespace check passed.

Feature enforcement stays disabled. Existing role permissions, Family, Home,
sleep start/end/classifier, Live Activity/Wake up, Sound Monitoring/Activity,
History/Analysis/Export and notifications remain unchanged. The pending legacy
send-push/feeding security remediation is not included.

Remaining before paywall: deployment/security verification, real API contract and Sandbox
tests, operational retry/backlog monitoring, assignment/transfer UX, cancellation
intent UX, localized paywall/restore/manage-subscription flows and App Review
disclosures. Enabling feature enforcement remains a separate reviewed phase.

## Files changed in this backend phase

Added:

- `REVENUECAT_SERVER_REVIEW.md`
- `supabase/migrations/20261113090000_revenuecat_verified_funding.sql`
- `supabase/functions/_shared/revenuecat.ts`
- `supabase/functions/_shared/appleSubscriptionChain.ts`
- `supabase/functions/_shared/subscriptionHandlers.ts`
- `supabase/functions/_shared/subscriptionRuntime.ts`
- `supabase/functions/subscription-reconcile/index.ts`
- `supabase/functions/revenuecat-webhook/index.ts`
- `supabase/functions/subscription-maintenance/index.ts`
- `src/services/subscriptionReconciliationService.ts`
- `tests/subscription-db.test.cjs`
- `tests/subscription-server.test.cjs`
- `tests/apple-subscription-chain.test.cjs`
- `tests/subscription-client.test.cjs`

Updated existing local SDK/foundation files:

- `supabase/config.toml` (only three new function entries)
- `src/services/revenueCatService.ts`
- `src/purchases/revenueCatClient.ts`
- `src/purchases/revenueCatModel.ts`
- `src/purchases/purchaseMessages.ts`
- `src/entitlements/EntitlementProvider.tsx`
- `src/i18n/en.ts`
- `src/i18n/no.ts`
- `tests/revenuecat.test.cjs`
- `tests/entitlements.test.cjs`

Earlier SDK-only working-tree changes remain separate in scope; this phase adds
no native dependency or signing change. The unrelated CLI metadata,
family-message function and .claude files retain their original hashes. Only the reviewed integration may be committed/pushed. Nothing is deployed.
