# Sleepy Plus: Phase 1 entitlement foundation

Status: implemented locally for review. No migrations/functions/config deployed;
no commit or push. RevenueCat, purchases, paywalls and feature restrictions are absent.

## Database baseline

Read-only inspection of the linked Supabase database captured nine exact function
definitions and their execution ACLs, 17 relevant policies, six household tables'
31 columns, 22 constraints, RLS settings and 77 table privilege entries in
`supabase/baselines/household-authorization.json`.

This includes invitation creation/acceptance, household and baby creation, the
new-user handler and private membership/role/baby-access helpers. Existing
invitations remain owner-created, token-hashed, expiring and single-use;
acceptance uses the existing locking and authorization. Add-child remains
owner/parent-authorized. Sleep/feed writers remain owner/parent/caregiver;
viewers remain read-only. No tier check was inserted into these operations.

The baseline migration checks captured function bodies, policies and RLS settings
and fails on drift. It does not recreate or replace deployed objects. The test
fixture installs the captured definitions, constraints, ACLs and policies to
reproduce the relevant authorization slice. It is not a complete database reset
baseline: the repository still does not contain every historical production
migration, full GoTrue schema, auth trigger wiring or unrelated table definition.
Reconstructing those safely is a separate database-baselining task. Existing
`create_baby_for_household` has an anon execution grant but rejects null auth;
this baseline preserves and tests the authorization rather than changing it.

Tests use isolated PGlite/PostgreSQL. Test-only adapters supply pgcrypto's digest
and random-byte interfaces; captured RPC bodies are unchanged. These adapters
must never be deployed. No live user, invitation or subscription data is copied
into tests.

## Explicit household context

`HouseholdContextProvider` resolves the intersection of the authenticated user's
memberships, visible household catalog, and the selected baby's household links.
Exactly one candidate selects itself. Multiple candidates require a valid saved
choice or explicit selection through a compact localized selector. There is no
first-row fallback. With no valid candidate the context remains unresolved.

Choice persistence is local, keyed by authenticated user UUID and baby UUID.
Saved values are preferences, never authorization. They are validated against
fresh RLS-protected reads before use. Invalid choices are pruned. User/baby changes
immediately fence old snapshots and pending responses; sign-out clears memory.
Per-user saved preferences may survive logout, but cannot become active without
fresh validation at the next login. Account changes remount context children so
old household form state and invitation tokens cannot leak into another account.

Membership/link realtime events, foreground/resume and visible 60-second polling
revalidate context. Realtime is optional; no publication changes are required.
This is eventual client context refresh, not a substitute for per-operation RLS.
Network failure leaves metadata unresolved and existing screens usable.

Invitation and add-child forms retain their explicit operation target, with a
valid active context or sole household as defaults. Their RPCs and role semantics
are unchanged. A form may deliberately target another accessible household;
that does not transfer the active baby's entitlement or authorize that operation.

## Registry and client API

`src/entitlements/features.json` is the canonical registry; SQL parity is tested.

| Free | Plus |
|---|---|
| core_tracking | family |
| basic_history | sound_monitoring |
| basic_analysis | sound_activity |
| basic_live_activity | smart_live_activity |
| notifications | advanced_analysis |
| | full_history |
| | export |
| | smart_insights |

`EntitlementProvider` / `useEntitlements()` expose householdId, real tier
(`free`, `plus`, or unknown/null), isPlus, loading, verificationState, canUse,
wouldAllow and enforcementEnabled. Only the service calls the authenticated RPC;
components do not read billing tables. Responses must match the requested
household, supported policy version, expected feature registry and valid dates.

`ENTITLEMENT_ENFORCEMENT_ENABLED = false` is a deliberate code-level release
switch. `canUse` allows all registered capabilities in Phase 1, while `wouldAllow`
evaluates the real Free/Plus requirement for tests and future integration. Unknown
feature names fail closed. A Free household stays Free: compatibility does not
manufacture Plus grants or replace role authorization. No existing feature
screen has been gated.

The provider fences user/baby/household/session changes, refreshes on foreground
and resolver-specified boundaries (at most five minutes), and retries errors.
Missing/pre-deployment RPC, offline and authorization failures produce unknown,
not Plus. There is no persisted entitlement cache or offline access credential in
Phase 1. Future enforcement needs the separately reviewed cache/expiry policy;
changing the client switch alone is not an enforcement rollout.

## Two new private tables

1. `private.entitlement_funding_sources` represents a verified, provider-neutral
   subscription/purchase lineage: purchaser, at most one selected household,
   provider, external customer/stable transaction identity, product, environment,
   validity, status, verification time, provenance and timestamps. The external
   transaction identity must be the stable original purchase/subscription identity,
   not a new source for every renewal. A provider/environment/identity uniqueness
   constraint prevents duplicate assignment. Renewals update that source. Atomic
   reassignment replaces its one household value; unassignment is supported.
2. `private.household_access_grants` represents server-issued beta, promotional,
   admin or lifetime access, with household, tier, source, environment, validity,
   status, issuer/provenance and timestamps. Nullable end supports indefinite
   grants. No 90-day beta grants have been issued.

These distinguish purchaser-owned funding from household-issued access without
introducing purchase intents, webhook inboxes, RevenueCat-specific tables or
duplicated resolved-state rows. Resolution is computed. Provenance and source
timestamps support traceability; this is not an immutable billing event ledger.
Future server integration must verify provider identities and record reassignment
and webhook audit events before it can write funding rows.

## Resolver and security

`resolve_household_entitlements(p_household_id)` derives identity from auth.uid()
and rejects callers who are not actual members of that exact household. It is
SECURITY DEFINER with an empty search_path and schema-qualified object access.
Anonymous callers cannot execute it. Private tables have RLS enabled, no client
policies, and no authenticated/anon/public SELECT or mutation privileges.
Service-role server code can maintain sources; no service credential enters the app.

Only active, currently valid production grants/funding qualify. Funding also
requires that its purchaser still belongs to its selected household. Future,
expired, revoked, unverified-future and sandbox sources do not unlock production.
Independent sources combine with OR: expiration/revocation of one cannot cancel
another valid source. No source means Free. Nullable unlimited grants override
finite access end. Future activation and expiration boundaries inform refresh.

The response contains only household ID, tier/isPlus, allowed product capabilities,
verification state/time, validity/recheck time and policy version. It exposes no
customer identifiers, transactions, receipts or purchaser details. Product
capabilities do not confer database write permissions: Plus viewers remain viewers.
Existing household/baby/sleep/feed RLS policies are unchanged.

## Existing users and deferred work

Technical Free households, four-member collaboration, existing invitations,
roles, babies and data continue to work. No membership/data deletion, sharing
freeze, six-member limit, 30-day history limit, designated primary writer,
seven-day downgrade transition, trial or beta grant is activated. These approved
future rules require a later implementation/review. No pricing is embedded.

No native interface is needed for the current read-only foundation. ActivityKit
content, Wake up, sound status/monitoring, native auth and Settings preferences
are unchanged. A future verified native capability bridge must be designed with
the enforcement phase; React hiding controls will not be sufficient then.

## Local validation

- Full Node suite, including actual isolated SQL authorization tests and existing
  sleep/end_sleep, personalized estimate, Family, Sound Monitoring and Live
  Activity regressions.
- Real React provider browser lifecycle checks: Free/Plus/unknown, selection,
  persistence/reload, baby/account/logout changes, removed membership, delayed
  old responses and compatibility access. External requests blocked.
- Existing mobile screen, Settings and Home smoke/interaction checks.
- ESLint, production TypeScript/web build, native web build and git diff --check.
- No native files changed, so Capacitor sync is unnecessary. Windows cannot run
  an Xcode archive; no Swift or native project changes require one for Phase 1.

Final results: 161/161 Node tests passed, including eight new isolated database
tests and seven new client/domain tests; no skips. Provider browser lifecycle
checks passed. General mobile smoke: 90 checks. Settings: 146 checks at all four
widths, both languages and light/dark. Home interaction regression: 20 checks.
Production/native web builds passed. Lint passed with the pre-existing
`Home.tsx:336` dependency warning; no new errors/warnings. git diff --check passed.

## Exact intended files

Modified:

- `src/App.tsx`
- `src/Root.tsx`
- `src/components/AddChildSettings.tsx`
- `src/components/FamilySettings.tsx`
- `src/i18n/en.ts`
- `src/i18n/no.ts`
- `tests/mobile-layout.cjs`

Added:

- `PLUS_ENTITLEMENT_FOUNDATION_REVIEW.md`
- `src/entitlements/EntitlementProvider.tsx`
- `src/entitlements/features.json`
- `src/entitlements/features.ts`
- `src/entitlements/model.ts`
- `src/households/HouseholdContext.css`
- `src/households/HouseholdContextProvider.tsx`
- `src/households/HouseholdContextSelector.tsx`
- `src/households/context.ts`
- `src/services/entitlementService.ts`
- `src/services/householdContextService.ts`
- `supabase/baselines/household-authorization.json`
- `supabase/migrations/20261112090000_household_authorization_baseline.sql`
- `supabase/migrations/20261112091000_entitlement_foundation.sql`
- `tests/entitlement-db.test.cjs`
- `tests/entitlements.test.cjs`
- `tests/helpers/household-database.cjs`

Pre-existing changes in `supabase/.temp/cli-latest`,
`supabase/functions/family-message/index.ts` and `.claude/settings.local.json`
remain untouched (original Git blob hashes verified). Nothing is staged.

## Prepared migrations; deployment still prohibited pending approval

- `20261112090000_household_authorization_baseline.sql`: metadata-only drift guard.
- `20261112091000_entitlement_foundation.sql`: two private tables and resolver.

No Edge Functions are required. Later deployment should explicitly review/apply
only these migrations after rechecking the baseline, rather than blindly pushing
all pending migrations. Existing clients continue using unchanged APIs; the new
client remains compatible before the resolver is deployed by reporting unknown.

No further product decision is needed to review Phase 1. RevenueCat/webhooks,
verified reassignment, beta issuance, downgrade enforcement, native capabilities
and offline entitlement credentials remain future phases.
