# Sleepy Live Activity — Stage 1

This is optional, local iOS presentation of the existing database-backed active
sleep. ActivityKit never creates, stops, resumes or calculates a Sleepy sleep.
No database migration, Edge Function, deployment, credential or APNs change is
part of this implementation. No App Intent or recording/playback is introduced.

## Existing architecture and integration

The App uses Capacitor 8, a manually registered app-local Swift plugin and the
App scheme in `ios/App/App.xcodeproj`. App's minimum iOS version remains 15.0;
Live Activities require iOS 16.2+ here. Earlier devices continue normal sleep
registration. The Widget Extension deployment target is 16.2.

Sleepy selects one baby in the UI but its services query active sleep per baby.
Different babies can have different active rows. Stage 1 uses the existing
`getActiveSleep(babyId)` semantics for every accessible baby and identifies each
activity by `sleepId`. It does not introduce additional simultaneous-session
rules. ActivityKit can refuse an activity because of system limits or settings.

`sleepService.ts` emits a best-effort presentation event only after existing
successful start/stop/resume/edit/manual-create/delete/split writes. The SQL
payloads, validation, return values and errors are unchanged. A listener/bridge
failure cannot fail the sleep write. The no-op lifecycle component under App
receives that event, successful database reads, existing sleep realtime events
and foreground/resume notifications. It submits an authoritative active-sleep
snapshot to native code. Failed reads are not interpreted as empty snapshots.
An initially empty baby catalog is treated as still loading, not proof of no
active sleep; reconciliation waits for an accessible catalog.

There is no elapsed-time JS/native heartbeat. SwiftUI renders the timer from
the real sleep start date. Live Activity state never feeds back into sleep data.

## Native model and bridge

The identical `SleepActivityAttributes.swift` source is compiled into App and
SleepyWidgets:

- Static: `sleepId`, `babyId`, `babyName`, `startedAt`, `presentationEndsAt`.
- ContentState: `soundMonitoringActive: Bool` only.

`presentationEndsAt` is the ActivityKit presentation deadline, NOT the sleep's
endtime. It bounds the system-rendered timer and marks retained content stale.
Baby display name is the name at creation. A corrected start time/baby identity
ends the old presentation instead of leaving an incorrect timer or silently
renewing its lifetime. The sleep itself remains unchanged.

The manually registered Capacitor plugin is `SleepyLiveActivity`:

```text
startSleep({ ownerId, sleepId, babyId, babyName, startedAt })
updateSleep({ sleepId, soundMonitoringActive })
endSleep({ sleepId })
reconcile({ ownerId, sleeps: [{ sleepId, babyId, babyName, startedAt }] })
endAll()
```

The app coordinator normally uses `reconcile`, not separate current-activity
variables. Start obtains sound status from the native capture coordinator;
JavaScript does not guess from an enabled preference. UUIDs/dates/payload shape
are validated. Logs contain only safe operational messages, not names, sleep
identifiers, credentials, tokens or technical microphone values.

## Native sound status

Existing SoundMeter state-publication and finish transitions submit a best-effort
ActivityKit update based on `AVAudioEngine.isRunning`, keyed by sleepId. Start,
interruption/pause, safe resume, Stop and background validity failures can update
this flag even without an executing WebView. The microphone's engine/session,
thresholds, detector, queue, network validity checks and persistence are unchanged.
Bridge operations and native sound transitions share an ordered main-actor queue.
Repeated identical status does not cause another ActivityKit content update.
A fresh native input-plugin instance clears any previous bridge instance's
sound flag before reconciliation; merely reloading JS with the same still-running
native instance leaves its real capture status intact.

## Lifecycle and recovery

| Situation | Stage 1 behavior |
| --- | --- |
| Successful start while foregrounded | Read database, request activity if supported/allowed |
| Successful local end/delete | Read database, immediately dismiss matching obsolete activity |
| Navigation, background or lock | Native activity and system timer continue without JS |
| Foreground/relaunch/WebView recovery | Re-read accessible babies' active rows, reuse/update matches, end stale/duplicate activities |
| User dismisses activity or it expires | Do not automatically recreate for that same still-active sleep |
| New active sleep with no previous activity | May restore while foregrounded, if ActivityKit permits |
| Read/network failure | Keep existing presentation; do not invent sleep completion |
| Logout/account change | Fence pending reads, end activities best-effort; never block logout for ActivityKit errors |
| Process termination | No background database/reconciliation service is added; existing activity may remain system-managed |

A bounded app-private UserDefaults ledger remembers which active sleeps already
had an activity, including across process restarts. It prevents repeated requests
after dismissal/expiry. Entries are pruned by a successful database snapshot and
cleared for account cleanup. Normal sleep completion removes the entry; an
explicit later resume of that database session can therefore obtain a new
presentation. App-private metadata storage needs no App Group entitlement.
App's new PrivacyInfo.xcprivacy declares the app-only UserDefaults required reason
CA92.1 for this ledger. It does not assert new data-collection/privacy-label claims
or change existing SDK privacy manifests. See
[Apple's required-reason documentation](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons).

Reconciliation never creates two activities for one sleep; any legacy duplicates
are dismissed. New requests only occur in the foreground. No periodic restart or
renewal workaround is used. An App reload/unmount may dismiss its presentation
before it is restored from the next successful snapshot.

### Important local-only limitations

Stage 1 cannot observe another parent's sleep edit/end while this app is suspended
or terminated. It reconciles when React runs again; foreground realtime may do
so sooner. The existing sound monitor's validity logic is NOT repurposed as a
remote Live Activity service. It can turn the sound flag off, but cannot change
sleep data or independently assert the database sleep ended.

Abrupt termination stops microphone execution, but no termination callback can
be guaranteed to update ActivityKit. Sound on/off is the last reported native
status and can remain stale until foreground reconciliation or activity expiry.
After relaunch the coordinator defaults to off unless native capture is actually
running. This display is not a safety/baby-alarm guarantee.

## Eight-hour limit and overnight sleep

Apple permits an activity to remain active for at most eight hours from its
request. It then leaves Dynamic Island; the Lock Screen may retain it for up to
four additional hours (up to twelve hours total). An ended activity no longer
accepts content updates. The timer in this implementation is bounded by the
presentation deadline, and stale presentation asks the user to open Sleepy.

The eight-hour clock is an ActivityKit lifetime, not the baby's sleep duration.
A restored activity may first be requested after sleep already started. Stage 1
does not automatically replace/renew an activity at eight hours, even if Sleepy
still has an active overnight sleep. The database session continues normally.
No fake stop/start, silent audio, background JS or push token is used to extend
ActivityKit lifetime. OS/user restrictions can end presentation sooner.

Apple references:
- [ActivityKit lifecycle and recovery](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)
- [Activity/background restrictions](https://developer.apple.com/documentation/activitykit/activity)
- [Live Activity layout guidance](https://developer.apple.com/design/human-interface-guidelines/live-activities)

## Widget Extension and UI

`SleepyWidgets` is a real embedded WidgetKit app-extension target, with only an
ActivityConfiguration. No normal Home Screen/accessory widget is registered.
It shares the attributes source, not the Capacitor package or sound engine.

Lock Screen shows Sleepy, baby/sleep identity, system-rendered elapsed timer,
localized start time and microphone active/off text. Layout is compact to fit
Apple's 160pt limit. Dynamic Island provides minimal/compact and expanded views;
compact trailing uses a small monospaced timer. Timer format is system-rendered
hours/minutes/seconds, not a manually refreshed localized duration string.

Native `en.lproj`/`nb.lproj` Localizable.strings provide English/Norwegian copy.
The extension follows iOS/per-app language; the React-only language preference
is not synchronized to the extension in Stage 1. Dates/timers use native locale
formatting. Long names allow two lines; VoiceOver retains the full text. System
light/dark colors and purple accents are used; the Island retains white text on
its dark system surface. Microphone state includes text, not just an icon.

Tapping uses `sleepy://active-sleep`, registered as a custom URL scheme in App.
Existing SceneDelegate forwarding opens Sleepy. Stage 1 does not force a route
change: warm launch may remain on the last screen; Home is the active-sleep view.
Direct authenticated navigation/scene handling is a Stage 2 enhancement. URLs
contain no user/session identifiers or credentials. No Start/Stop buttons exist.

## Signing and Apple Developer manual steps

Bundle IDs:
- App, unchanged: `no.strandeconsulting.sleepy`
- SleepyWidgets: `no.strandeconsulting.sleepy.widgets`

Lars must perform these steps before a signed release:

1. Register an explicit **Sleepy Widgets** App ID with the extension bundle ID,
   under the SAME Apple Developer team as Sleepy.
2. Create an **App Store distribution provisioning profile** for that ID. Select
   the existing Apple Distribution certificate used by Sleepy's GitHub build.
   Suggested name: **Sleepy Widgets App Store**.
3. Download the profile and set repository secret
   **BUILD_WIDGET_PROVISION_PROFILE_BASE64** to its base64-encoded contents.
   Do not put profile/certificate data in source control or logs.
4. Keep BUILD_PROVISION_PROFILE_BASE64 pointing at the MAIN APP's existing profile.
   Do not replace it with the widget profile. Existing P12/certificate/password and
   App Store Connect API secrets remain unchanged.
5. For a local device Debug build, choose the same signing team for BOTH App and
   SleepyWidgets in Xcode (automatic Debug signing). No Debug profile is fabricated.

No separate App Store Connect app record is needed for the embedded extension;
the existing Sleepy app upload includes it. No new certificate is required if
the existing distribution certificate is valid and selected in the new profile.

App's Info.plist adds `NSSupportsLiveActivities = YES` and the URL scheme. Its
existing aps-environment, Apple Sign in entitlement, microphone descriptions,
background audio and deployment target are preserved. Stage 1 adds no private
ActivityKit entitlement, App Group, push-to-start capability or extension copy of
App.entitlements. Merely adding this Info.plist flag does not require replacing
the existing main App profile. The extension has its own profile.

## GitHub Actions and Xcode structure

App has an explicit dependency on SleepyWidgets and embeds its .appex under
PlugIns. The shared App scheme builds dependencies for both Debug and archive.
No CapApp-SPM source/signing setting is modified.
Widget configurations follow the original App/project configurations because
Capacitor 8's sync scans the first deployment-target occurrence. This preserves
the generated Capacitor SPM minimum at iOS 15 while the extension uses 16.2.

The existing manual release workflow adds a separate secure widget-profile step:
decode to temporary files, verify explicit bundle/team, distribution type and
expiry and matching imported Distribution certificate, install by UUID, and
remove it in always() cleanup. No profile contents
are printed. Missing secret fails with an actionable instruction before archive.

App Release still references SLEEPY_PROVISIONING_PROFILE_SPECIFIER. Widget Release
references SLEEPY_WIDGET_PROVISIONING_PROFILE_SPECIFIER. Both reuse the existing
SLEEPY_DEVELOPMENT_TEAM/SLEEPY_CODE_SIGN_IDENTITY variables. No provisioning profile
is passed globally to xcodebuild/package targets. Archive adds only the custom
widget-profile variable. The existing CURRENT_PROJECT_VERSION build-number
override gives App and extension identical GitHub run numbers; marketing version
stays 1.0. ExportOptions gains the widget bundle/profile mapping. Archive and IPA
checks verify embedded extension identifier, versions and signature. Existing
App checks, keychain, artifact upload, TestFlight upload and cleanup are retained.
The unsigned ios-build.yml is unchanged and builds both targets through App's
dependency. The established release export method is retained.

## Validation and physical-device plan

Node tests cover successful/failed DB notifications, optional bridge failure,
failed reads vs empty snapshots, all-baby identity, foreground gating, account
switch/logout races, project dependencies/resources and target-scoped profiles.
The new pure Swift policy package tests duplicate/stale cleanup, foreground
permission, suppression after dismissal/expiry and independent sleep identities.
Native preparation runs both NativeSoundCore and LiveActivityCore Swift tests.

Windows can validate JS, builds, plist/YAML structure, shell syntax, target graph
and Capacitor sync. It cannot prove SwiftUI/ActivityKit compilation, simulator
rendering, signing or a successful archive. Required macOS gates are the unchanged
unsigned simulator workflow, native Swift tests, then the signed release workflow
after the widget profile secret is configured. Do not claim archive success from
the Windows structural checks alone.

Physical TestFlight procedure (iOS 16.2+):

1. Confirm macOS Swift tests, unsigned App+extension build, signed archive/export
   and extension checks pass. Install the new build; check Live Activities are
   enabled in iOS Settings for Sleepy.
2. Start a normal sleep. Confirm the normal record, then one Lock Screen activity.
   Verify name/start time and timer against Home, including a backdated start.
3. Test compact, minimal and expanded Island on supported hardware, plus Lock
   Screen on a device without Island. Tap: Sleepy opens, without stopping sleep.
4. Start native sound monitoring. Verify active; lock/switch apps; stop, interrupt
   with a call and resume. Verify the flag follows actual engine transitions.
   Confirm sound detection/events/background capture still work unchanged.
5. Stop sleep normally. Activity should dismiss. Simulate disabled Live Activities
   and verify sleep start/stop still succeeds with no disruptive user error.
6. Navigate/reopen/foreground repeatedly: no duplicates. Relaunch while sleep
   remains active: reuse matching activity, or restore if never presented.
7. Dismiss the activity manually; foreground/relaunch must not recreate it for
   that still-active sleep. End that sleep and start another: new activity works.
8. Logout/account switch: old presentation disappears; no old-child activity is
   reused for the new account. Verify Apple login and native push still work.
9. If multiple babies are used, change selection without ending another baby's
   activity. Device/system concurrent-activity limits may refuse extra activities.
10. Change/end sleep from another device while this app is backgrounded/terminated;
    expect Stage 1 cached presentation until foreground reconciliation. Verify
    errors/offline reads do not mistakenly end a database sleep or infer an end.
11. Test an overnight sleep beyond eight hours. Activity expires without restarting;
    Home/database sleep remains active. Check retained tile/stale timer behavior.
12. Test process termination with sound active: document last-reported sound-state
    limitation; on relaunch verify off unless native capture is actually running.
13. Test native English/Norwegian app language, long names, both system appearances,
    larger text and VoiceOver. Check the 160pt system height limit on real hardware.

## Later stages (not implemented)

Direct active-sleep routing; explicit privacy-aware lifecycle freshness UI;
remote ActivityKit update/end/start infrastructure and its separate token/topic
design; multi-device presentation policy; deliberate user-controlled restoration;
Home/accessory widgets; App Intent actions; sound-event summaries/charts; and
subscription/paywall integration. None of these are silently enabled by Stage 1.

## Local validation results

- Full Node suite: **103 passed**, including 14 new service/project checks.
- Lint: zero errors; the pre-existing Home effect-dependency warning remains.
- Production and native Vite builds passed. Capacitor iOS sync passed; copied
  native web assets match dist-ios.
- Xcode project parsing/target graph, shared sources, resources, bundle IDs,
  localized keys, plist/privacy manifest and target-scoped profile checks passed.
- Existing App Debug/Release build settings, App.entitlements, delegates,
  CapApp-SPM package and unsigned workflow compare unchanged with the baseline.
- Release YAML parses; all 13 shell blocks pass bash syntax validation.
- git diff --check passed. No dependencies, commits, pushes or deployments.
- Four new Swift policy tests are supplied but **not executed locally**: this
  Windows machine has no Swift/Xcode toolchain. Widget rendering, weak-linking on
  older iOS, actual archive/signing/export and physical-device behavior remain
  macOS/TestFlight gates. The new widget profile secret is required first for a
  signed build; no provisioning profile has been created or installed remotely.
