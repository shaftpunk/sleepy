# Sleepy Live Activity: nap progress and Wake up review

## Personalized active-sleep presentation update

This working-tree update is intended for the single commit `Personalize active
sleep estimates`. The following rules supersede the original estimate rules
recorded in A–D below.

Home and the Live Activity share `classifyPersonalSleep` and `estimateActiveSleep`.
They return SHORT_SLEEP_LIKE, LONG_SLEEP_LIKE or UNCERTAIN. Only SHORT_SLEEP_LIKE
contains an estimated wake date. LONG_SLEEP_LIKE displays the localized moon
indicator “Likely night sleep” / “Trolig nattsøvn”. UNCERTAIN has neither a
prediction nor a night indicator. Product text contains no internal evidence
counts. Wake up, native sound status, authentication and the end-sleep command
retain their existing behavior.

Classification uses completed history in the 14 days preceding the active start,
with existing invalid-duration and overlap cleaning. Explicit nap/night types
are respected. For unlabelled history, a duration split requires at least three
days in each group, a gap of at least 60 minutes, a boundary ratio of at least
1.5 and a long-group median at least three times the short-group median. Select
the largest eligible boundary ratio; ties select the lower-duration boundary.

For an unlabelled current sleep, compare historical start times within 90 minutes
using circular clock distance across midnight. Each group contributes its
closest sample per distinct day. A winning group needs at least three days and
twice the opposing support. Otherwise classification is UNCERTAIN. An explicit
nap may use supported short-sleep history across three days. An explicit night
maps to LONG_SLEEP_LIKE. Short-group estimates use the median of the selected
samples, require at least one minute, and are anchored to the actual start.
There is no global bedtime cutoff. Historical analytics retain their existing
classification function.

The previously audited 23:25 history was replayed locally through this code and
returned LONG_SLEEP_LIKE, nine long-sleep days, one short-sleep day and a null
estimated wake date. Its Lock Screen and Home copy is therefore “Trolig nattsøvn”.
No night-duration prediction is returned or transported.

To keep classification local, the estimate service now reuses the existing
35-day reads from useAnalyticsData. It issues no database request. Its cache is
scoped to baby, authenticated session generation and the returned time interval.
Missing or incomplete history yields UNCERTAIN until a normal history load
finishes. Babies whose history has not been loaded also remain UNCERTAIN. Older
responses and responses from a previous account cannot overwrite fresh data.
The normal analytics read schedule remains the source of history refreshes.

History publication can update an already-created Live Activity through the
new presentation-only bridge method. That method checks owner, baby, sleep ID,
start time and activity state. It updates the classification/date on an existing
activity while preserving sound and wake-failure state. It cannot create or end
an activity. Identical results produce no ActivityKit update. Existing payloads
without a classification remain readable; a previous non-null nap date maps to
the short-sleep presentation. New long/uncertain payloads clear any nap date.

The elapsed timer and system-driven nap progress/relative-time fallback retain
their existing rendering. The progress view remains present past its estimate
and never ends a sleep. The exact literal past-estimate text while suspended
still requires the native rendering validation described in the initial review.

New coverage exercises the known 23:25 case, late/early naps, daytime long sleeps,
the 19:00 boundary, midnight matching, ambiguous evidence, three distinct days,
explicit labels, history cleaning, EN/NO Home markup, native presentation gates,
shared Home/bridge results, late history updates and account/baby isolation.
Native Wake up, sound, elapsed and progress view definitions are compared with
the current released source. Native rendering and compilation remain physical
device/macOS checks.

No database migration, server endpoint or Supabase deployment is required.

Personalization validation passed all 128 Node tests, including the isolated
PostgreSQL regression test. The 28 focused classification, rendering, bridge and
project tests also passed after Capacitor sync. Lint passed with the existing
Home effect warning. Production and native web builds and local iOS sync passed.
Swift/Xcode compilation and physical Lock Screen rendering remain unavailable
on this Windows host. The exact suspended past-estimate wording continues to use
the previously approved system-formatting fallback pending native validation.

Both features were reviewed before deployment. The SQL integration test uses
disposable in-memory PostgreSQL with synthetic data. The previous Stage 2 review
remains the record of the visual release.

## A–D. Original estimate and progression

**Algorithm.** `estimateActiveSleepWakeTime` runs against the active baby's
completed history in the 14 days ending at the active sleep's start. It uses
the existing normalizer and personal-profile cleaning: exclude invalid/nonpositive
and over-12-hour durations and overlapping samples. Exclude the active row and
any session that ended after its start. Use the existing explicit nap/night
classification (otherwise local start hour 07:00–18:59 is a nap). Require
qualifying naps on at least three distinct local days, consistent with the
existing personal profile's minimum history. Use the median nap duration.

`estimatedWakeTime = activeStartInstant + medianNapMinutes × 60 seconds`.
If history is unavailable, the current sleep is classified as night, or the
median is under a minute, there is no estimate. This is a personal historical
estimate, not a promise. The age-guideline model predicts awake windows and
next sleep start; those are not reliable inputs for nap length. Existing sleep
history, next-sleep and age calculations retain their results.

**Sharing.** Home and the Live Activity service call the same `getActiveSleepEstimate`
reader and pure analytics function. The reader selects only the active baby's
history through existing Supabase RLS. The estimate is an ISO-8601 instant across
the Capacitor bridge and `estimatedWakeTime: Date?` in ActivityKit `ContentState`.
Reconciliation on existing sleep events or foreground reads changes the estimate
only when the resulting date changes. Failed estimate reads hide the estimate
without ending the activity; failed active-row reads still cannot imply no sleep.
Native sound-only updates preserve the date. There are no periodic writes,
new periodic JS timers, or push updates. The absolute date remains valid across
DST/zone changes; the historical nap classification follows the existing local
clock convention when recalculated.

**Rendering.** Apple's date-bound `ProgressView(timerInterval:countsDown:)`
fills from actual start to estimated end using the system clock, including when
Sleepy is suspended. The original elapsed timer remains primary. The bar has a
localized accessibility label and the system progress value, with an adjacent
localized time label. Home derives clamped progress, ceiling minutes remaining,
“Likely waking soon” within five minutes and “Past estimated wake time” at/after
the estimate using its existing foreground clock. With the approved system
formatting fallback, iOS 18+ Live Activity uses localized relative time
(including elapsed-past phrasing), and iOS 16.2/17 uses a countdown bounded at
zero. The native labels do not promise the exact Home wording. The bar never
ends the sleep. Expanded Island fits the button and sound/failure status;
prediction stays on the Lock Screen to keep the Island compact. Compact and
minimal retain the existing icon/timer and system-controlled background.

## E–G. Wake up command, authentication and authorization

**Original flow audited.** Home's `stopSleep` anchored the timestamp to the
tap minus the chosen offset, checked it against the displayed start, fetched the
authenticated user, and updated `endtime`, rounded duration, actor and update
time. A successful write notified the presentation and refreshed Home. The DB's
existing active-to-ended trigger handled notification dispatch. Native capture
stopped through the existing authoritative realtime/validity checks.

**Shared operation.** React now calls `endSleep(sleepId, endedAt)` after its
existing offset checks. Native calls the same `public.end_sleep` PostgREST RPC
with the tap time. `WakeSleepIntent` is available from iOS 17 in the Lock Screen
and expanded Island, requires local device authentication, and does not open
the app UI. It carries the sleep UUID and exact ActivityKit activity ID. App
validates the current active activity, matching sleep and account before sending.
Only the App target links Keychain/network logic; the extension can construct the
intent and has no write path. An ephemeral, bounded, no-redirect URLSession
authenticates to the configured Supabase HTTPS project origin. App checks the
returned row's sleep ID, baby ID and ended/nondeleted state before local effects.

**Native session (option A).** Mirror only the existing access JWT and expiry,
account UUID, and already public project URL/API key into the app's own Keychain
item, using `WhenUnlockedThisDeviceOnly` with synchronization disabled. WebView
remains the sole refresh owner. Restore/sign-in/token-refresh events and app
resume synchronize the copy. Sign-out clears it before signing out, and a failed
clear blocks that sign-out attempt; account changes replace it. There are no
refresh tokens in native storage, no shared access group, and no credentials in
ActivityKit or the widget. Both local account/JWT subject and expiry are checked;
Supabase validates the actual JWT signature and session claims for the RPC.
An account generation fence prevents stale completions from mutating the new
account's local presentation. It cannot undo a request already committed by the
server. Capacitor iOS bridge payload logging is disabled because debug logging
otherwise includes call arguments.

**Authentication limit.** The action works without a running WebView while the
mirrored token is valid and the device can unlock Keychain. If the app has been
suspended past token expiry, the user must reopen Sleepy to let its normal
session refresh. This matters for naps longer than the token's remaining life;
physical testing must assess that experience before release. A coordinated
native refresh owner (option B) would require a separate auth lifecycle review.
An Edge Function (option C) still needs valid native authentication; it would
not solve expiry by itself and is not needed for this RPC.

**RLS.** SQL is `SECURITY INVOKER`, with execute revoked from `PUBLIC`/`anon`
and granted to `authenticated`. It checks `auth.uid()` and the actual baby's
household membership for owner/parent/caregiver, then writes through the same
existing RLS policies. No client-supplied household ID, service-role key, RLS
bypass or anonymous endpoint. The row is locked while ending. The RPC checks
end > authoritative start and rejects invalid/future timestamps (five seconds
of clock-skew tolerance), rounds positive elapsed minutes as before, and sets
server-time audit timestamp plus the authenticated actor. An already-ended row
returns unchanged. The existing trigger sees exactly one active-to-ended write.

## H–I. Failures, retries and native sound

Offline, timeout, expiry, denied membership, malformed response or server failure
never causes an optimistic dismissal. Localized feedback distinguishes access
failure from unconfirmed completion; the latter permits retry. An in-process
gate coalesces simultaneous taps for one sleep. If a response was lost after a
commit, the next tap retrieves the stored ended row without rewriting it. A
successful authoritative foreground snapshot can also reconcile the end. Stale
or missing activities do not initiate a mutation. A prediction has no write path.

After confirmation the native command calls the existing SoundMeter `finish`
path only when both running capture's sleep UUID and owner UUID match. It flushes
pending detector work, releases capture and retains queued metadata for the
existing persistence path (which trims events to the authoritative sleep end).
Then the matching Live Activity ends, keeping the suppression ledger until
reconciliation so an older snapshot cannot recreate it. Unrelated runs are
untouched. Normal React Stop retains its existing realtime and remote lease
shutdown. If an intent response fails after a server commit, those independent
authoritative checks can still stop capture. Detector, thresholds, sensitivity,
event storage, background capture and remote validity policy are unchanged.

## J. Files changed by this work

- Estimate and Home: `src/analytics/activeSleepEstimate.ts`,
  `src/analytics/personalSleepProfile.ts`, `src/services/sleepEstimateService.ts`,
  `src/pages/Home.tsx`, `src/i18n/en.ts`, `src/i18n/no.ts`.
- Commands/auth/bridge: `src/services/endSleepCommand.ts`, `src/services/sleepService.ts`,
  `src/services/liveActivityService.ts`, `src/services/nativeSleepSession.ts`,
  `src/auth/AuthProvider.tsx`, `src/lib/supabase.ts`, `capacitor.config.json`.
- iOS: `ios/App/App/SleepWakeCommand.swift`, `ios/App/App/SleepLiveActivity.swift`,
  `ios/App/App/SleepySoundMeter.swift`, `ios/App/Shared/SleepActivityAttributes.swift`,
  `ios/App/Shared/WakeSleepIntent.swift`, `ios/App/SleepyWidgets/SleepLiveActivityWidget.swift`,
  `ios/App/SleepyWidgets/en.lproj/Localizable.strings`,
  `ios/App/SleepyWidgets/nb.lproj/Localizable.strings`,
  `ios/App/App.xcodeproj/project.pbxproj`,
  `ios/LiveActivityCore/Sources/LiveActivityCore/SleepWakeOperation.swift`.
- Tests: `tests/active-sleep-estimate.test.cjs`, `tests/end-sleep-db.test.cjs`,
  `tests/native-sleep-session.test.cjs`, `tests/live-activity.test.cjs`,
  `tests/live-activity-project.test.cjs`,
  `ios/LiveActivityCore/Tests/LiveActivityCoreTests/WakeOperationTests.swift`.
- Migration below and this review document.

Existing `.claude/`, `supabase/.temp/cli-latest` and
`supabase/functions/family-message/index.ts` changes were left untouched.

## K–L. Rollout, database and Apple project

Prepared `supabase/migrations/20261111090000_end_sleep_command.sql`. No table,
policy, trigger or Edge Function changes. This migration is a **release
prerequisite for both web and iOS** because normal Stop now calls the RPC. Review
and verify with the real schema/policies in an isolated staging environment
before any production migration or client rollout. The current older client
remains compatible with the additive migration. After approval, an isolated
Supabase CLI dry run listed only this migration and the subsequent push applied
it. A rolled-back production check confirmed the caller privileges, rejected an
unrelated authenticated identity, and preserved the entire already-ended row on
two authorized calls with different end times. The release workflow remains
manually triggered.

The Xcode project only adds source/resource membership and the widget's
compilation condition. No capabilities, App Groups, Keychain sharing, deployment
targets, entitlements, profiles, signing, bundle IDs or packages changed.

Primary API references: [WidgetKit interactive Live Activities](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities),
[LiveActivityIntent](https://developer.apple.com/documentation/appintents/liveactivityintent),
[dynamic SwiftUI dates and progress](https://developer.apple.com/documentation/widgetkit/displaying-dynamic-dates),
[system time formatting](https://developer.apple.com/documentation/swiftui/systemformatstyle),
[PostgreSQL invoker privileges](https://www.postgresql.org/docs/16/sql-createfunction.html).

## M. Validation

- All **116** Node tests passed with the isolated PostgreSQL test enabled.
- After Capacitor sync, **24** focused estimate, auth, SQL, Live Activity and
  project tests passed. SQL tested denied anonymous/unrelated/read-only/RLS cases,
  deleted/invalid rows, rounded duration, idempotent retry and one end transition.
  It used PGlite 0.3.14 from a local cache without adding a dependency; set
  `SLEEPY_TEST_PGLITE` to its `dist/index.cjs` to run that optional integration test.
- Lint passed with the existing Home effect-dependency warning. TypeScript and
  production Vite/PWA build passed; native-mode Vite build passed. Capacitor iOS
  sync passed and generated config confirms iOS bridge logging disabled.
- `git diff --check` passed. No Swift/Xcode/Apple SDK on Windows. Both Swift
  package test commands were attempted but unavailable. New Swift tests cover
  post-confirmation ordering, duplicate taps, offline/timeout/auth/server errors.
  They and the actual App/extension compile remain macOS gates.

## N. Physical TestFlight test plan (after review and separate release approval)

1. Compile App and extension on macOS; run both Swift packages, unsigned build
   and signed archive checks. Confirm Xcode extracts the shared intent metadata
   and the extension does not link App-only session/transport code.
2. Against reviewed staging RPC/RLS, test parent, owner, caregiver and denied
   roles. Confirm an ordinary React Stop with and without a backdated end and a
   lock-screen Wake up produce matching audit, duration and notification behavior.
3. Seed a baby with three prior naps on distinct days, then a baby without enough
   history. Compare Home and Lock Screen estimate, missing estimate and overnight
   suppression. Test elapsed 0%, 50%, near/past end, one-minute estimate, DST/zone
   changes and no automatic sleep end. Lock and suspend Sleepy during progression.
4. On iOS 17 and 18+, tap Wake up on the Lock Screen after device authentication;
   test suspended/cold App process, repeated taps, app foreground, account switch
   and logout. Verify exact row changes once. Test inactive, already-ended, stale
   and deleted activity, revoked membership, expired token, offline, timeout,
   server errors and dropped response after commit. Confirm no premature end and
   that retry or reopen behaves as reported.
5. With native sound running, confirm the matching capture and microphone indicator
   stop, queued events synchronize without loss/duplication, and another sleep's
   capture is not stopped. Repeat the failure cases with sound running; distinguish
   the existing independent fail-closed lease behavior from wake confirmation.
6. Verify EN/NO and 12/24h locales, VoiceOver percentage/remaining time and button
   label, long names, larger text, light/dark/Always-On, compact/minimal/expanded
   Island, and Lock Screen on narrow devices. Check the 160-point height limit,
   system contrast, and device-controlled live text updates on each OS version.
