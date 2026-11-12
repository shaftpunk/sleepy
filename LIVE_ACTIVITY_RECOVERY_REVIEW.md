# Live Activity Wake and stale-presentation recovery

Local implementation only. No commit, push, migration or deployment is authorized
by this task. RevenueCat, feature enforcement, notifications, classifier,
estimates, Home layout and sound detection are unchanged.

## Evidence and limits

A read-only production catalog comparison verified the deployed end_sleep body
matches 20261111090000_end_sleep_command.sql exactly. Arguments are p_sleep_id
uuid and p_ended_at timestamptz; result is SETOF sleep. It is security-invoker,
authenticated may execute, anon may not. Native JSON-array decoding agrees with
PostgREST's normal response; React single() requests its single-row representation.
Already-ended rows return their original end timestamp without another update.
No production sleep mutation or authenticated Wake test was performed.

We do not have yesterday's device logs, Keychain state, token expiry or activity
creation timestamp. The exact historical failure cannot be proved retrospectively.
The following defects and failure paths are confirmed by code/reproductions.

## Wake failure paths

Before this change, a missing/expired/invalid mirrored token failed immediately
inside SleepWakeSession.usable / SleepWakeCommand, before the RPC. Native stored
an app-only access token; only JS could refresh. A background/locked WebView does
not guarantee JS execution or token rotation. A long background interval can
therefore make an otherwise authorized Wake impossible until app auth resumes.
This is a likely explanation for the evening case, not a claimed device diagnosis.
No two-hour sleep-duration cutoff exists. JWT age is separate from sleep age.

All relevant failure conditions:

- Missing/unreadable Keychain data, locked/inaccessible Keychain, malformed JWT,
  sub/user mismatch, expired mirrored expiry or JWT exp: authentication failure.
- Missing/wrong native owner or account generation change: local fencing failure.
- HTTP 401: rejected/expired token. Previously no recovery.
- HTTP 403: authorization/RLS denial, displayed as authentication/access feedback.
- Offline/timeout, non-HTTP response, other status/server error, malformed JSON,
  wrong sleep/baby, non-ended/deleted row or invalid end date: unconfirmed failure.
- Activity ID/sleep ID mismatch, no matching activity, or an already ended UI:
  original guard returned without a mutation. It did not itself set a failure.
- The previous native guard also rejected past presentationEndsAt. This guard
  concerned ActivityKit presentation age, not sleep age. The app no longer adds
  that deadline restriction to an otherwise active/stale user action.

wake_auth and wake_unconfirmed are previous-attempt feedback. sleep_check_app is
a different existing string rendered when ActivityKit considers content stale;
it is not evidence that a Wake RPC was attempted or rejected.

## Wake fix and authentication boundary

1. Match the exact activity, sleep and baby, then deduplicate concurrent Wake taps.
2. Use an owner-matched valid app-only access token. If absent/expired, request a
   fresh token from the existing JS Supabase auth client through an app bridge event.
3. Wait at most three seconds using a continuation, not background polling. JS
   retains refresh ownership and mirrors only access token/user/expiry/public config.
4. POST the existing authenticated end_sleep RPC. On HTTP 401, request JS-owned
   refresh and retry once. Never extend a JWT or send an expired one deliberately.
5. If an RPC response is lost/invalid, a bounded authenticated/RLS-protected GET
   may confirm the exact sleep/baby is already ended. Empty, active, inaccessible,
   deleted or mismatched rows are not success.
6. Only authoritative confirmation stops matching native monitoring (existing
   stopConfirmedSleep finalization path), followed by immediate activity dismissal.
7. Genuine unresolved failures retain the activity and existing localized feedback.
   Added native diagnostic messages contain only controlled outcomes, no IDs/tokens.

An expired same-account resume snapshot no longer clears or overwrites fresher native auth.
An expired unknown/different-account snapshot still clears previous credentials.
Same-account out-of-order mirrors cannot downgrade a later expiry. Logout and
account changes invalidate pending credential waits and stale async work.

This is a best-effort improvement, not a promise that iOS runs the WebView while
locked or after termination. If no valid access token can be obtained, Open Sleepy
remains the honest fallback. Guaranteed multi-hour native authentication would
require a separately reviewed native-owned/coordinated refresh-session design in
the APP's Keychain, or a narrowly scoped authenticated server command design.
Neither is silently introduced here; no refresh token enters app-native/widget code.
Do not lengthen production JWT expiry or weaken RLS to conceal this limitation.

## Stale presentation and the morning observation

The activity timer runs from sleep start to presentationEndsAt. The latter is
request time plus eight hours, not the authoritative sleep end. A timer frozen
near 8:15 is consistent with a sleep backdated approximately 15 minutes before
activity creation. This timing is an inference, not a recovered activity timestamp.

Apple ends activities after its eight-hour active limit and can retain their
Lock Screen presentation for up to four more hours. staleDate alone is not an
end or dismissal command. The widget's existing stale copy explains the morning
Open Sleepy text. This does not make a card remaining after a known DB end correct.

Confirmed recovery gaps:

- React stops emitted only a generic event requiring another full DB read.
- Home and Live Activity read independently. Home knowing Awake did not itself
  notify ActivityKit; a failed/delayed companion fetch could leave stale content.
- Capacitor 8.5.1 emits document resume on UIScene.willEnterForeground, before
  visibility/applicationState necessarily becomes active. The old service skipped
  hidden reads and native creation required .active, without a didBecomeActive hook.
- Logout cleanup queued behind optional database work could be delayed.
- The lifecycle used all accessible babies, without selection-specific cleanup.

## Reconciliation fix

- Confirmed end_sleep results emit the exact ended sleep ID for direct dismissal.
  Home tap, long press and Change time already use that same command.
- Successful getActiveSleep reads publish baby, active ID/null and captured auth
  generation. The same no-active result Home received removes obsolete activities
  immediately, independently of a second DB fetch. Failed reads never become empty.
- Live Activity's own full read suppresses this event to avoid recursion; its
  request has an eight-second abort bound. Stale revisions remain fenced.
- Read publication is fenced against intervening successful writes and newer
  same-baby reads, so an old empty response cannot dismiss a newly started sleep.
- Native reconcileBaby only removes wrong/ended presentation; partial snapshots
  never invent a new activity. A current active result schedules normal reconciliation.
- Account and selected-baby context cleanup happens before DB reconciliation.
  There is no arbitrary household selection and no role/context mutation.
- Native didBecomeActive and cold-start-active recovery remove expired/ended
  presentations and request normal authoritative JS reconciliation. Existing
  visibility/resume, foreground focus and selected-baby realtime signals remain.
- Known activity handles are retained while the process lives so system-ended
  cards can also receive immediate dismissal. No silent activity renewal is added.
- Logout and direct confirmed-end cleanup bypass stalled optional JS read queues.
- A fresh matching authoritative snapshot clears old Wake failure feedback.

The app cannot discover another device's write immediately while completely
suspended/offline. Realtime is used while executing; foreground recovery refetches
missed changes. Guaranteed remote dismissal during suspension would need reviewed
ActivityKit/APNs end pushes. This task adds no push architecture or background poll.
OS-retained cards after complete process termination remain a physical test case.

## Validation and physical test plan

Node tests exercise direct end, failed independent fetch, Home read publication,
missed early resume, cold start/no active row, changed sleep, account/baby fencing,
OFF/ON preference and unchanged classification/estimate presentation. Auth tests
exercise stale mirror, JS-owned refresh, missing/failed auth and logout fencing.

New Swift HTTP tests exercise valid/already-ended rows, exact auth headers, long
duration independence, lost-response recovery, expired JWT, unauthorized/offline,
wrong baby/sleep and malformed responses. Existing Swift operation tests preserve
confirmation -> matching sound stop -> dismissal and duplicate-tap ordering.
Swift/Xcode is not installed on this Windows host; native compilation/tests are
not claimed. Existing Xcode project structure and Capacitor header/API checks are
performed statically. Final executable results are reported with this review.

Final Windows validation: 241/241 Node tests passed (including isolated end_sleep
database, auth/session, Home, Live Activity and Sound regressions); production and
native web builds passed; Capacitor iOS sync passed; lint has zero errors and the
existing Home effect-dependency warning; the existing PWA deprecation warning
remains; git diff --check passed. Swift/Xcode tests were added but not executed.

TestFlight must cover: fresh token; several hours locked with JS suspended; forced
termination; expired/revoked auth; network loss before/after commit; already ended
by another parent; duplicate taps; normal/long-press/exact-time app stop; cold start;
account/baby switching; monitoring finalization; and overnight eight-hour expiry.
Specifically verify that Home Awake at 07:27 (awake since 07:12) leaves no stale
22:24 card after recovery. Record controlled native Wake outcome logs if it fails.

References:
- https://supabase.com/docs/guides/auth/sessions
- https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- https://developer.apple.com/documentation/activitykit/activitycontent/staledate

Unrelated dirty CLI metadata, family-message and .claude files are preserved.
