# Live Activity Stage 2 review

Scope: visual redesign only, approved for commit and push. Background Wake up
and an active-sleep wake-up estimate remain deferred for the reasons below.
No workflow dispatch, deployment, database change, or signing change.

Final pre-commit review confirmed that this change contains only the widget's
visual presentation and this review document. Sleep/database behavior, native
sound behavior, ActivityKit lifecycle, signing/provisioning/capabilities and
EN/NO localization are unchanged. The system elapsed timer is unchanged and
needs no periodic updates. Lock Screen colors meet the calculated contrast
ratios below, and the Dynamic Island retains its system-controlled background.
Unrelated working-tree changes are excluded from the commit.

## A. Cause of the black presentation

The previous Lock Screen used UIKit secondarySystemBackground, which resolves
to a near-black neutral in dark appearance. Most other styling was system
white/secondary text with no Sleepy palette. The Dynamic Island's opaque black
background is system-controlled and cannot be recolored like the Lock Screen.

## B. Selected existing Sleepy colors

Values are copied from src/App.css and src/pages/Settings.css, not a new theme.
The Live Activity follows the device appearance independently of the app's
in-app theme preference.

| Role | Light | Dark / Dynamic Island |
| --- | --- | --- |
| Lock Screen background | #f4effa | #2c2143 |
| Primary text | #261f32 | #f7f4ff |
| Secondary text | #695d78 | #b9afc9 |
| Brand/icon accent | #5d477e | #d4c6ff |
| Island keyline | #8f74df | #8f74df |

Calculated nominal text/background contrast: light primary 14.02:1, secondary
5.40:1, accent 6.96:1; dark primary 13.76:1, secondary 7.14:1, accent 9.48:1.
Actual system compositing, Always-On and StandBy require device verification.

## C. Lock Screen design

Small Sleepy/moon header, baby sleeping headline, larger rounded elapsed timer,
then start time and microphone status. The footer stacks if it cannot fit
horizontally. Names can occupy two lines and scale modestly; VoiceOver retains
the full text. The timer keeps the original system-derived timerInterval and
presentation deadline. No JS/native timer updates were added.

activityBackgroundTint supplies the appearance-specific lavender/plum surface.
activitySystemActionForegroundColor supplies the system auxiliary action's
foreground, not a sleep-ending control. Standard 14-point margins remain.
No forced Island background, extra material layer, glass effect, or widget
containerBackground modifier was added. ActivityConfiguration uses ActivityKit's
background API; ordinary widget container styling is not needed here.

## D. Dynamic Island design

- Compact leading and minimal: only the lavender sleep icon.
- Compact trailing: existing restrained elapsed timer, with monospaced digits.
- Expanded: lavender Sleepy/moon header, a larger elapsed timer, baby sleeping
  headline and secondary sound status. Long names retain two-line wrapping.

The Island stays black. No estimate or control is squeezed into compact/minimal.
All existing EN/Norwegian native strings and locale-formatted start times remain.
Microphone state uses both text and mic/mic.slash symbols, never color alone.
The existing stale-state message and accessibility timer label/value remain.

## E. Can Wake up safely run in the background today?

Not with the repository's current authentication and command boundaries.
Stopped before implementing any database mutation, as requested. No Wake up
button or placeholder intent was added. Tapping the activity retains the existing
open-Sleepy behavior and does not end a sleep.

src/lib/supabase.ts creates a JavaScript Supabase client without a custom native
storage adapter. Authentication is managed in the WebView/JS client; there is no
native Keychain session provider, refresh coordination, or native end-sleep
domain service. Running an intent in the app process does not guarantee that
the Capacitor WebView exists or its JS/authentication can execute in background.
The native sound validity lease is read-only and cannot authorize sleep writes.
It must not be repurposed into a write credential.

Normal flow audited:

1. Home.handleSleep captures the current active sleep and calls stopSleep with
   its id/start time and the chosen minutesAgo (zero means now).
2. sleepService.stopSleep anchors end time to the click, validates an integer
   nonnegative offset and end > start, then calls supabase.auth.getUser().
3. The authenticated/RLS-controlled sleep update sets endtime,
   durationminutes = max(0, round((end - start) / 60000)), updated_by_user_id and
   updated_at. It filters id and deleted_at IS NULL and requires a returned row
   through select().single(). It does not currently filter endtime IS NULL.
4. Only a successful write emits the optional sleep presentation event. Home
   reloads sleep data; errors remain visible and saving state resets.
5. Live Activity lifecycle reconciles a successful active-sleep database snapshot.
   A failed read is not an empty snapshot. Sleep realtime subscribers also refresh.
6. The existing database sleep_notify_event trigger detects active-to-ended
   transitions and dispatches the existing sleep-notify notification flow. The
   frontend does not send a separate wake notification. This remains untouched.

## F. Correct App Intent architecture and safest options

Apple supports Button(intent:) with an iOS 17+ LiveActivityIntent in Lock Screen
and expanded presentations. The intent executes in the app process without
requiring foreground presentation. Its parameter must be populated with the
exact activity.attributes.sleepId; selected baby/current Home state is not a
safe substitute. The existing widget deployment target remains iOS 16.2, so an
eventual interactive control needs an iOS 17 availability guard.

The preferred future sequence, not implemented in this change:

1. One shared end-sleep command used by both normal UI and the intent, with the
   existing validation, rounding, attribution and notification behavior preserved.
   This is additional domain/auth architecture; duplicating the JS update in
   Swift would create the inconsistent second implementation the request forbids.
2. App-target LiveActivityIntent with a parameterized sleepId and a declaration
   visible where the extension constructs the button. Its perform method invokes
   that shared command; it must work after process death, not only with warm JS.
3. Verify the authenticated owner and RLS-visible exact row at execution, handle
   already-ended/deleted/revoked sessions, and serialize repeated taps. A command
   must not accidentally overwrite an end timestamp after a retry.
4. After authoritative success, stop matching native monitoring using its existing
   shutdown path and reconcile/end only the matching Live Activity.

Safe immediate option remains opening Sleepy and using the existing authenticated
flow. True background execution needs a separately reviewed shared command and
native session lifecycle. An authenticated, idempotent server command is another
option, but would require a backend review and still needs reliable native user
authentication. No endpoint, RPC or schema change was added or deployed.

## G. Authenticated Supabase mutation

No new mutation is implemented. A future background design must keep credentials
in the app's protected storage, coordinate refresh with the existing JS session,
invalidate access on logout/account switch, and use the signed-in user's RLS
permissions. Copying a one-time access token to UserDefaults or ActivityAttributes
would not solve expiry, revocation, account races or cold execution. No service
role, widget secrets, unauthenticated endpoint or RLS relaxation is acceptable.

## H. Offline and failure behavior

This patch has no new mutation or optimistic ended state. Existing failed reads
retain the activity; normal Stop errors do not imply a successful sleep end.
Existing ActivityKit expiry/stale behavior remains presentation-only.

For a future intent: await an authoritative returned/verified ended row before
dismissing. On offline, refresh, permission or database failure retain the active
presentation and show a localized status such as inability to verify completion,
with retry/open-app guidance. Activity content can carry pending/failed status
while preserving the active timer; do not rely on a thrown intent error producing
a visible Lock Screen alert. Apple recommends handling errors and updating the
Live Activity's interface. A Button is appropriate; an optimistic Toggle is not.

If a server write may have committed but its response was lost, re-read that exact
sleep before any retry. A failed confirmation means unknown, not definitely active
or ended. The UI must communicate that uncertainty rather than report success.
Retries must not replace a server-confirmed end time or duplicate notifications.

## I. Sound-monitor shutdown

Normal Home Stop does not synchronously call the microphone plugin. The active
row update is observed by NativeSoundLifecycle's realtime subscriber and checked
by validateNativeSoundSleep; Home also stops presenting the eligible active row.
Resume/visibility checks validate the monitored sleep. In the background, the
unchanged read-only validity lease polls on the native policy's 20-second cadence,
with a 12-second watchdog, a 10-second network timeout and lease expiry checks.
An ended/revoked row or validity failure stops capture through native finish.

finish flushes the existing detector, retains the existing event queue, cancels
health/validity work, releases AVAudioEngine/AVAudioSession, and publishes sound
off to ActivityKit. Metadata continues through its existing authenticated,
idempotent persistence/acknowledgement path. No thresholds, sensitivity, detector,
event persistence, lease policy or capture architecture changed.

A future intent must use that same native finish path for the matching owner and
sleep after success, including when JS is suspended. The existing private method
has no shared app-command interface today. It must not stop another sleep's run.
An offline mutation failure does not itself prove the sleep ended; existing sound
remote-validity failure can independently stop capture as it does today.

## Estimated wake-up audit

There is no existing per-active-sleep expected end Date to reuse.

- Home: analytics/home.ts computeNextSleepHint estimates the NEXT SLEEP, using
  lastSessionEndMs + medianWakeWindowMinutes * 60000 after at least five wake
  windows. It returns null while currently asleep. Its predicted-time variant
  applies while awake duration is more than five minutes below the median.
- Analysis: analytics/sleepPrediction.ts computeSleepPrediction also predicts the
  NEXT SLEEP. It immediately returns status sleeping for an active sleep. When
  awake, likelySleepMs = lastWakeMs + clampedLikelyMinutes * 60000. Minutes blend
  the age-guideline wake-window midpoint with a personal time-of-day median (or
  overall median). Age/personal weights by usable history days are 100/0 below
  3 days, 70/30 at 3, 40/60 at 7, and 25/75 at 14. Without personal data the model
  uses age only. Bounds clamp to 0.5 * guideline minimum through 1.5 * guideline
  maximum, or 30-300 minutes without a guideline. These are awake windows, not
  expected sleep durations.
- analytics/personalSleepProfile.ts has retrospective median nap/night durations
  and typicalWakeTime. Over the default 14-day lookback it drops invalid >12-hour
  and overlapping sessions and requires three history days for profile stats.
  typicalWakeTime requires two night sessions and is the circular mean of their
  local end times: atan2(mean(sin(2*pi*m/1440)), mean(cos(2*pi*m/1440))) mapped
  back to minutes of day. It is not a dated estimate tied to the current sleep
  and does not define expected nap endings. Turning it or the medians into an
  active-sleep end Date would introduce a new prediction rule.

Consequently the row is omitted entirely, per the no-fake/default-estimate rule.
No calculation changed or was added. No estimatedWakeTime currently reaches
ActivityKit and there are no estimate updates. ContentState remains compatible
with Stage 1 (soundMonitoringActive only).

When Sleepy gains an authoritative application-wide active-sleep estimate, the
smallest clean transport is an optional ISO-8601 absolute instant from the same
app source in LiveSleep, parsed into ContentState.estimatedWakeTime: Date?. Native
reconciliation should compare that Date and update only on actual change,
including clearing it to nil. Sound-only updates must retain it. SwiftUI should
format the Date using the device locale and the uncertainty wording requested:
EN "Likely wake-up around" / NO "Forventet oppvåkning ca.". Omit nil/stale values;
never derive a countdown or per-minute update. Keep it out of compact/minimal and
use it in expanded only if space remains after higher-priority content. This is
a proposed data path, not dormant production code in this patch.

## J. Files changed by this work

- ios/App/SleepyWidgets/SleepLiveActivityWidget.swift: palette and presentation.
- LIVE_ACTIVITY_STAGE2_REVIEW.md: audit, limitations, validation and device plan.

Pre-existing supabase/.temp/cli-latest, supabase/functions/family-message/index.ts
and .claude/ changes are unrelated and were left untouched.

## K. Apple APIs, capabilities and signing

No entitlements, bundle IDs, target membership, profiles, secrets, signing,
deployment targets, packages or workflows changed. No App Group is introduced.
Only existing iOS 16.2-compatible APIs plus SwiftUI ViewThatFits (iOS 16+) are
used by the redesign. A future LiveActivityIntent needs iOS 17, not a new widget
credential store; it runs in the app process. Capability changes are not needed
for the current presentation patch.

There is no installed Xcode/Apple SDK on this Windows host to inspect or compile.
The workflows use macos-latest and the preparation script requires Xcode 26+;
their exact resolved SDK version cannot be established locally. API behavior was
checked against Apple's documentation below; this is not an Xcode build result.

- [Live Activity appearance, colors and layout](https://developer.apple.com/design/human-interface-guidelines/live-activities)
- [Custom Live Activity views](https://developer.apple.com/documentation/activitykit/creating-custom-views-for-live-activities)
- [LiveActivityIntent](https://developer.apple.com/documentation/appintents/liveactivityintent)
- [Interactivity, execution process, availability and errors](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities)

## L. Validation on Windows

- node --test tests/*.test.cjs: 106 passed, zero failures.
- After sync, live-activity.test.cjs + live-activity-project.test.cjs: 14 passed,
  including project graph, resources, native localization and signing assertions.
- npm run lint: passed; existing Home.tsx effect-dependency warning remains.
- npm run build: passed (TypeScript + production Vite/PWA).
- Native Vite build --mode native: passed.
- Capacitor sync ios: passed; no tracked generated configuration changes.
- git diff --check: passed.
- Both Swift package test commands attempted: unavailable (swift not installed).
- xcodebuild -version attempted: unavailable (Xcode not installed). SwiftUI build,
  archive and actual layout/interaction verification remain macOS/device gates.
- Existing build warnings: bundle over 500 kB and PWA inlineDynamicImports
  deprecation. No changes made to unrelated build configuration.

## M. Physical TestFlight test plan (after separate release authorization)

1. On macOS record xcodebuild -version and SDK version; run both Swift packages'
   tests and an unsigned App+extension simulator build before signing/archive.
2. Install the approved future build. Test light/dark system appearance and app
   theme differences. Verify lavender/plum Lock Screen, readable system dismiss
   control, and black Island with lavender icon/keyline. Also test Always-On,
   reduced luminance, Increased Contrast and StandBy/night tint.
3. Start a sleep normally and compare its real start time/system timer against
   Home. Check backdated starts, one-hour rollover and a long-running sleep.
4. Test Amalie and very long names at narrow widths, English/Norwegian and 12/24h
   locale formats, larger text and VoiceOver. Check footer reflow and the 160pt
   system height limit; no clipping or loss of baby/status information.
5. Check compact leading/trailing, minimal with multiple activities and expanded
   Island. Test a Lock Screen device without Dynamic Island. No wake-up estimate
   or Wake up action should appear in this patch; tapping only opens Sleepy.
6. Enable native sound, lock/switch apps, interrupt and resume capture, then stop
   normally. Confirm mic text/symbol follows actual capture and persisted events
   still synchronize. Stop sleep on another device with sound running and verify
   native validity shutdown without needing foreground JS.
7. Stop in Home online: database row ends, monitoring stops and activity dismisses.
   Try offline/failed Stop: no claimed successful end; reconnect/reconcile. Native
   validity may independently stop monitoring under its existing fail-closed rules.
8. Reopen, logout/switch accounts, dismiss/expire an activity and reconcile. Check
   Stage 1 suppression, stale messaging and no accidental replacement/duplicates.
9. Before shipping a later real intent, separately test cold process, suspended JS,
   expired tokens, revoked membership, logout/account races, repeated taps, an
   already-ended/deleted sleep, multiple babies and response loss after a server
   commit. Verify one authoritative end, correct audit fields/notifications, exact
   sleep-specific sound shutdown and localized failure/accessibility feedback.
