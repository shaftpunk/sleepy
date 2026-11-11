# RevenueCat authenticated iOS SDK foundation

Implemented locally for review. No paywall, product gates, household funding
writes, webhook processing, server reconciliation, beta grants or deployment.

## Audited architecture and dependencies

The existing Supabase UUID authentication, session generation, explicit
user/baby/household context, private entitlement funding/grant schema and
`resolve_household_entitlements` remain authoritative for household access.
`EntitlementProvider` still uses that RPC; its tier/isPlus/canUse behavior does
not depend on RevenueCat. The feature registry and compatibility switch are unchanged.

Installed only `@revenuecat/purchases-capacitor` 14.1.0, pinned exactly. Its peer
requirement is Capacitor >=8; Sleepy has Capacitor 8.5.1. Its one JavaScript
dependency is the official internal types/runtime package 20.1.0. No UI SDK or
unrelated dependency upgrade. Installed declarations and Swift package manifest
were inspected, in addition to the official documentation:

- https://www.revenuecat.com/docs/getting-started/installation/capacitor
- https://www.revenuecat.com/docs/customers/identifying-customers
- https://www.revenuecat.com/docs/projects/restore-behavior

The user confirmed RevenueCat restore behavior is **Keep with original App User
ID**, including Sandbox. This dashboard protection also affects purchases; it
cannot be enforced by the client SDK alone. Keep it in place to prevent one
Apple Account's purchase being reassigned to a different Sleepy login.

The previously audited unauthenticated legacy send-push endpoint and feeding
identity mismatch are separate unresolved issues. This integration does not
change or use those endpoints.

## Public key setup

Add this variable to the existing ignored `.env.local` for local builds:

```dotenv
# Value: RevenueCat Sleepy iOS/App Store public SDK key (appl_ prefix).
VITE_REVENUECAT_IOS_API_KEY=
```

Do not overwrite the existing Supabase/VAPID variables. Vite reads `.env.local`
for both production and native modes. Restart Vite/rebuild after changing it.
This is a public key embedded in the app, not a server credential.

For GitHub Actions, create repository Actions secret
`VITE_REVENUECAT_IOS_API_KEY` containing the same iOS public key. Both
`ios-build.yml` and `ios-release.yml` map it only to the native preparation/build
step. No secret was created or uploaded by this task. An absent key leaves
purchases unavailable while normal app builds and existing features still work.

This implementation accepts only `appl_` keys. It rejects `test_` Test Store keys,
secret keys and blank values. TestFlight/Sandbox uses the real Apple products and
iOS public key, not Test Store products. No .p8, RevenueCat secret, webhook secret
or Supabase service-role key is added to the client.

## Identity and lifecycle

`RevenueCatSession` runs under AuthProvider, outside AuthGate, and initializes
only after auth loading completes and a UUID user exists. It also revalidates
that UUID with Supabase auth.getUser before configuration and money operations.
Configure supplies appUserID explicitly; existing SDK configuration uses direct
logIn when its current identity differs. getAppUserID and isAnonymous are checked
before exposing data or performing purchases/restores. Emails, babies,
households and installation IDs are never purchase identities.

All SDK identity changes, reads, listener cleanup, purchases and restores are
serialized. Epoch and existing auth-session-generation fences reject stale
operations/results. Logout clears local evidence synchronously and queues listener
cleanup. Supabase logout does not wait for a pending Apple sheet/network request.
The next SDK login waits for previous SDK work, so it cannot change identity
under an outstanding purchase. A completed old-account purchase is never
published into the new account's evidence.

SDK logOut is deliberately not called: it creates an anonymous identity. The
previous identified native cache can remain in the SDK while signed out, but
Sleepy's service exposes no customer state or purchase operation until a current
authenticated UUID is verified. Login switches directly between custom UUIDs;
no anonymous restore, anonymous purchase, email alias or automatic syncPurchases.

One effective CustomerInfo listener is registered per active session. Its closure
is fenced and removed during reset. Because callback payloads have no reliable
current-account scope, callbacks trigger a serialized fresh CustomerInfo read
under a verified UUID instead of publishing the payload. Refreshes also occur
on foreground/resume. No polling or Supabase writes are added.

## Service API, state and household boundary

Only the centralized service accesses the SDK. Available APIs:

- initializeRevenueCat(userId)
- getRevenueCatCustomerInfo / refreshRevenueCatState (sanitized evidence)
- getRevenueCatOffering (validated official offering/package types)
- purchaseRevenueCatPackage(plan, {userId, babyId, householdId})
- restoreRevenueCatPurchases()
- resetRevenueCatSession()

The React lifecycle supplies the current validated household context. Purchase
calls must match it and the authenticated UUID. Before presenting Apple purchase
UI, membership/baby links are freshly read through existing RLS-protected services.
Context changes while preparation is pending invalidate the request, including
switching away and back. One purchase/restore may be active at once; a duplicate
call cannot queue a second purchase sheet. Once Apple has begun a purchase, the
store transaction cannot be undone by changing Sleepy's selected household.

Central constants specify `plus`, `default`, `$rc_monthly`, `$rc_annual`,
`sleepy_plus_monthly` and `sleepy_plus_yearly`. Purchases use the package fetched
from the current default offering and validate its product and presented-offering
mapping. Unexpected/missing packages or Test Store product mappings fail safely.
No price is hardcoded.

PurchaseEvidence distinguishes unavailable, loading, known none, active plus and
error/unknown. Its only subscription metadata is entitlement, expiration,
product identifier, willRenew and refresh time. Malformed data and refresh
failures never become a known Free result. Expired evidence is not treated as
active. This state is exposed as `useEntitlements().purchaseEvidence` alongside
the independent server household resolution. No receipts, transactions, provider
customer identifiers or originalAppUserId are put into general app state.

Purchases handle success, cancellation, pending approval, already subscribed/
already owned, ownership conflict, network/store failure and completion followed
by failed refresh. The latter returns completedUnknown so future UI does not
suggest retrying a potentially completed charge. Restore requires authenticated
UUID identity, refreshes CustomerInfo and never changes household funding.
Typed result/issue codes map to localized EN/NO message keys; raw SDK error text
is never a user message. Development logs contain only issue/numeric SDK code.

## Native and web

Capacitor sync adds RevenuecatPurchasesCapacitor to the generated App SPM package.
The SDK's Swift package uses purchases-hybrid-common 20.1.0. The App target gets
In-App Purchase capability metadata as required by RevenueCat's installation
guide. No plist, signing profile, entitlements file, widget target, Live Activity,
Wake intent or sound code was changed. StoreKit is supplied by the SDK's native
dependency; no manual StoreKit bridge was added.

Web/PWA never initializes or calls the native purchase plugin and reports
unavailable. There is no RevenueCat Web Billing integration. Missing iOS key
also keeps all existing app features usable.

## Validation and limitations

Node tests use the real service factory and installed SDK error enums with a
fake SDK; they never invoke RevenueCat or StoreKit. They cover UUID identity,
account/logout races, listeners, offerings, malformed/expired data, household
changes, removed membership, duplicate calls, purchase results and restore.
Existing domain/database, auth, Home, Live Activity and Sound regression tests
run with the full suite. No production data is used.

Production and native web builds, lint, Capacitor sync and project structure
checks are run locally. Windows cannot resolve/build the complete iOS Swift
dependency graph or archive with Xcode; CI/macOS and physical Sandbox tests
remain required. No actual public key was supplied, so live RevenueCat setup
and product availability are not claimed as verified.

Final validation: full Node suite passes (183 tests, including 22 RevenueCat
tests; no skips). Lint has zero errors and only the existing Home.tsx dependency
warning. Production and native web builds, Capacitor sync, Live Activity project
checks and git diff --check pass. The unrelated CLI metadata, family-message
file and .claude settings retain their original hashes and remain excluded.

## Exact intended files

Modified:

- `.github/workflows/ios-build.yml`
- `.github/workflows/ios-release.yml`
- `ios/App/App.xcodeproj/project.pbxproj`
- `ios/App/CapApp-SPM/Package.swift` (generated by Capacitor)
- `package.json`
- `package-lock.json`
- `src/Root.tsx`
- `src/entitlements/EntitlementProvider.tsx`
- `src/i18n/en.ts`
- `src/i18n/no.ts`
- `tests/entitlements.test.cjs` (core SDK is now allowed; no-gating assertion remains)

Added:

- `REVENUECAT_SDK_REVIEW.md`
- `src/services/revenueCatService.ts`
- `src/purchases/revenueCatClient.ts`
- `src/purchases/revenueCatModel.ts`
- `src/purchases/PurchaseEvidenceContext.tsx`
- `src/purchases/RevenueCatSession.tsx`
- `src/purchases/purchaseMessages.ts`
- `tests/revenuecat.test.cjs`

## Manual physical TestFlight/Sandbox plan

1. Supply the iOS public key, confirm the protected restore policy, and build
   using the existing **iOS App Store release** workflow after code approval.
2. Login with email and Apple Sign In accounts; confirm each RevenueCat App User
   ID equals the corresponding Supabase UUID. Confirm no anonymous customer was
   created by normal launch/login/logout and no email identity is used.
3. Verify no-key and offline launches leave core app features working.
4. Verify the default offering maps both launch packages to Apple product IDs;
   localized prices come from Apple. Test Store IDs must not be substituted.
5. Using a separately approved internal test surface, exercise monthly/annual
   purchases, cancellation, pending approval, duplicate taps and interrupted
   refresh. There is intentionally no paywall, hidden debug menu or Settings
   purchase button in this phase, so normal TestFlight UI cannot initiate these
   service-only operations yet. Use Sandbox only during this foundation phase.
6. Restore on the original account; reinstall and restore; attempt restore under
   another Sleepy account using the same Apple Account and verify ownership is
   retained by the original Sleepy account.
7. Switch baby/household during preparation; remove access; switch/log out while
   requests are delayed. Old evidence must never appear on the new account.
8. Reopen/foreground to refresh renewal/expiry evidence. Confirm the household
   resolver remains Free without verified server funding, and every existing
   feature remains available due to compatibility mode.
9. Repeat sleep start/end, long press, Live Activity Wake up, Sound Monitoring,
   Family, History, Analysis and Settings smoke checks.

## Deferred server work

This section records the original SDK-only boundary. The subsequent coordinated
server implementation is documented in REVENUECAT_SERVER_REVIEW.md and supersedes
the deferred items below. Neither phase has been deployed to Supabase.

Before production purchase UI: authenticated server purchase-context/binding
flow, verified RevenueCat server reconciliation, idempotent authenticated
webhooks, stable transaction identity/ownership validation, explicit household
assignment/reassignment, multi-source resolution and audit handling. A local
purchase context is not a durable server funding assignment. Client CustomerInfo
must never insert a funding row or override role permissions. Until that later
phase, purchases provide evidence only and do not unlock a household.

Compatibility enforcement remains false. No existing feature is locked. No
Supabase migrations/functions were deployed, no App Store submission or
RevenueCat webhook was created, and nothing was committed or pushed.
