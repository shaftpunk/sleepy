# Native Apple sign-in

The iOS-only Apple button uses `@capawesome/capacitor-apple-sign-in` 0.1.5.
Its iOS `AppleSignIn.swift` assigns `options.nonce` directly to the Apple request.
The app creates 32 random bytes, hashes the hexadecimal nonce once with SHA-256,
sends the hash to Apple, and sends the original nonce plus Apple's ID token to
Supabase `signInWithIdToken`. No client private key or browser OAuth is involved.

## Deployment order

1. No profile migration is required. The manually inspected live schema uses
   `profiles.user_id` (not `id`), nullable `display_name`, and timestamp defaults.
   The existing `on_auth_user_created` AFTER INSERT trigger calls
   `handle_new_user()`, which inserts `(user_id, display_name)` with
   `coalesce(metadata.display_name, email-prefix)` and `ON CONFLICT (user_id)
   DO NOTHING`. It already creates profiles for all auth providers. Keep it.
2. Native `signInWithIdToken` establishes the Supabase account/session before
   Apple name metadata can be saved through `updateUser`. The original INSERT
   trigger has already run by then. Save a nonempty first-consent name to missing
   name metadata after login, and update the authenticated user's profile only
   if its display name is NULL or empty. Even a nonempty generated email/relay
   prefix is preserved. No profile insert, fallback RPC, or data merge is used.
   Confirm production RLS allows own-profile UPDATE; errors are sanitized.
3. Run `node scripts/ios-prepare.mjs` on macOS and the existing release workflow.
   Verify the signed app and provisioning profile authorize Apple sign-in.
4. On a physical iPhone test first consent, repeat login, cancellation, revoked
   consent, Hide My Email, existing email account behavior, and create/join family.
   Confirm the resulting Supabase UUID, membership and baby access persist.

The provided live trigger safely accepts relay email, ordinary email, and absent
name metadata. If both name metadata and email are absent, it inserts NULL, which
the provided schema allows. Existing accounts missing profiles are a separate
integrity issue to audit; this client does not silently repair them. A later
display-name editing feature can let users replace generated email-prefix names.

## Entitlements and push integration

`ios/App/App/App.entitlements` is the single shared App entitlement file.
Only App Debug/Release build configurations reference it. There was no native
push implementation or `aps-environment` entitlement in this checkout when this
work started. Add the appropriate push entitlement to this same dictionary when
integrating push; do not replace this file or configure package entitlements.

Native push must use `src/auth/sessionLifecycle.ts`:

- Capture `sessionGeneration()` before registration and validate it using
  `isSessionGenerationCurrent()` before saving a token (also compare auth user).
- Register an authenticated installation-token removal callback through
  `registerBeforeSignOut()`. Return its disposer during lifecycle teardown.
- `prepareSignOut()` invalidates pending work synchronously, then awaits registered
  removal callbacks before Supabase sign-out. A failed callback aborts logout for
  retry. Native push still needs to implement this callback and its server-side
  race protection; the hook alone does not remove tokens.

## Deliberate follow-up work

No web Apple login, Settings identity linking, account merging, account deletion,
Apple token revocation, or native recovery redesign is included. Password-reset
links still need the separately audited native deep-link work. Do not claim these
features are ready for App Store review based on this change alone.

Do not log identity tokens, nonces, authorization codes, or session credentials.
The existing web/email login remains available. Test actual identity-linking
behavior in Supabase; never merge data using client-side email comparisons.
