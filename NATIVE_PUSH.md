# Sleepy native iOS push

## Two independent transports

- Web/PWA retains PushManager, `push_subscriptions`, VAPID and `src/sw.ts`.
- Native iOS uses official `@capacitor/push-notifications` 8.1.3 and APNs tokens
  in `native_push_tokens`. The existing Settings buttons route by native platform.
- `send-push` remains the legacy Web Push test sender. Native test requests use
  the authenticated `send-native-push` function and only the caller's devices.
- Sleep, feeding and family functions retain their Web Push loops and add APNs
  through `_shared/nativePush.ts`. APNs failure does not stop browser delivery.
  Native sends are inactive until APNS_PRIVATE_KEY is configured. Feeding's
  success marker counts either transport. Existing user/baby recipient logic is
  retained; existing legacy feeding settings vs UUID-based scheduler differences
  are not redesigned here.

## Before the next TestFlight build

1. In Apple Developer, open the existing App ID `no.strandeconsulting.sleepy`.
   Confirm **Push Notifications** is enabled as well as **Sign in with Apple**.
   Do not assume the profile generated for Apple sign-in includes push.
2. If push was not enabled when the profile was generated, regenerate/download
   the App Store profile after enabling push. Replace GitHub's existing
   BUILD_PROVISION_PROFILE_BASE64 secret. Keep the existing certificate/password,
   bundle ID, signing architecture and App Store Connect upload API credentials.
3. Review/apply only `supabase/migrations/20261110120000_native_push_tokens.sql`
   using your normal migration process. It has not been deployed by this work.
   It creates a new table and authenticated registration RPC; it does not modify
   `push_subscriptions`, profiles, households or baby authorization.
4. Create an Apple **APNs authentication key** authorized for production pushes
   to this topic (or an appropriately scoped existing APNs key). This is not an
   App Store Connect API key and not the Distribution signing certificate.
5. Configure Supabase Edge Function secrets using the dashboard or a secure local
   secrets file (never commit it or paste values into logs):

   - APNS_PRIVATE_KEY: complete PEM contents of the APNs `.p8` signing key
   - APNS_KEY_ID: its key ID
   - APNS_TEAM_ID: Apple Developer Team ID
   - APNS_TOPIC: `no.strandeconsulting.sleepy`

   Preserve existing VAPID and webhook secrets. No APNs secret belongs in GitHub
   VITE variables or the client bundle.
6. Deploy `send-native-push`, `sleep-notify`, `check-feeding-reminders`, and
   `family-message` with their shared modules. Review the pre-existing local
   family-message diagnostics separately before deployment. No deployment ran
   during implementation. Preserve existing function authorization configuration;
   new native test function checks the caller using Supabase Auth.
7. Smoke-test the APNs HTTP/2 transport in the actual hosted Edge runtime.
   `_shared/apns.ts` explicitly uses `Deno.createHttpClient({http2:true,http1:false})`
   with production APNs. Local Deno type-checking and mocked transport tests do
   not prove hosted-runtime compatibility or real Apple credentials. If the
   hosted runtime cannot supply this HTTP/2 API, use a dedicated server APNs
   relay; do not send native tokens through VAPID or silently fall back to HTTP/1.
8. Run the existing `node scripts/ios-prepare.mjs` on macOS / existing GitHub
   release workflow. Sync includes both Apple Sign-In and PushNotifications.
   Inspect the signed IPA's app entitlements and embedded profile: both must
   authorize Apple sign-in and `aps-environment = production`. The source uses
   one shared App.entitlements referenced only by App Debug/Release settings.
   This initial implementation targets TestFlight/App Store production APNs;
   development/sandbox APNs builds need a separately coordinated environment.
9. Install the new TestFlight build. Sign in, tap Enable notifications, grant
   permission, confirm Enabled only after the token write succeeds, and send a
   test notification. Test foreground banner, background/terminated delivery,
   tap navigation, token refresh/relaunch, denied permission, logout, and login
   as a second account. Verify that account must explicitly enable notifications.
   Re-test Web Push and Apple/email login. Provider acceptance is not proof of
   on-device delivery; Focus/notification settings can suppress presentation.

## Ownership and logout

One random installation ID and 256-bit installation key live in the app's local
storage (same WebView trust boundary as the existing Supabase session). Neither
APNs tokens nor this key are logged. The server stores only the key's SHA-256
hash. RLS permits reading only own-user rows; direct client writes are revoked.
An authenticated SECURITY DEFINER RPC derives the user from auth.uid(), validates
installation possession, and serializes updates. Only one row exists per
installation; tokens are unique for the production topic.

Each operation reserves an increasing revision before network work. Logout
invalidates callback work synchronously, queues a newer detach behind in-flight
writes, waits for confirmed detach while still authenticated, and unregisters
APNs. A tombstone retains its revision/key hash so an older request cannot restore
the previous user. Offline detach fails logout for retry rather than silently
leaving that user subscribed. An unsolicited account change invalidates previous
work and detaches by installation credential without inheriting the prior opt-in.
Registration listeners stay installed once for the process; UI observers clean
up independently. Successful registration re-upserts current tokens on relaunch
and foreground resume. Permission revocation disables the server registration.

Disabled tombstones are not client-readable and must not be routinely deleted
while stale requests could still arrive. Clearing app storage loses the local
installation credential; reinstall/restore token collisions fail safely instead
of transferring ownership without proof. A support/reconciliation policy can be
added later if these collisions occur.

Foreground presentation is controlled by Capacitor's banner/list/sound settings.
Only allowlisted internal paths are accepted on notification taps; routing waits
until the authenticated App/router is mounted. No silent-background processing,
Firebase, external testers, or additional App Store upload changes are included.

## Local checks

```text
npm run lint
npm run build
node --test tests/*.test.cjs
node node_modules/vite/bin/vite.js build --mode native
npx cap sync ios
git diff --check
```

`tests/native-push-migration.cjs` also exercises the migration in an isolated,
in-memory PostgreSQL engine. Install `@electric-sql/pglite@0.3.14` in a temporary
directory, set PGLITE_MODULE to that package's absolute location, then run
`node tests/native-push-migration.cjs`. It never connects to Supabase.

Known existing sender concerns: the legacy `send-push` endpoint and feeding cron
have no handler-level caller authentication; harden those separately with a
coordinated caller/scheduler rollout. The new native test endpoint is authenticated.
The family sender's existing profile lookup uses `id` although the supplied live
schema uses `user_id`; its auth-metadata fallback remains in place, unchanged here.
