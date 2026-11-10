# Native iOS sound monitoring

## Capture and privacy

The Web/PWA `getUserMedia({ audio: true })` / Web Audio pipeline is unchanged.
Native iOS now selects a small app-local `SleepySoundMeter` Capacitor input
adapter: AVAudioSession (.record/.default), AVAudioEngine input tap, float32
noninterleaved samples, and on-device linear RMS/peak/dBFS calculation. Only
derived scalar metadata crosses the bridge at approximately 10 Hz. There is no
audio recorder, file output or audio-data bridge. No npm dependency was added.
The existing SoundMonitor, thresholds, detector and Supabase event queue remain.

The old native path still used Web Audio, reported listening immediately after
setup, and displayed linear RMS directly on a 0–1 meter. Permission/engine state
did not establish that actual samples reached the analyser. The device's exact
WebKit failure cannot be proven statically. The new native input removes that
boundary and identifies each signal stage independently; a new device run must
verify it. Native now reports listening only after a valid level event. No
events within 3 seconds after engine startup is an error, not quiet listening.
Valid zero-valued buffers are still accepted as quiet input.

The app already includes NSMicrophoneUsageDescription and English/Norwegian
InfoPlist.strings. iOS chooses the permission prompt language; Sleepy's language
controls in-app messages. Web retains its HTTPS gate and automatic start.

Native monitoring starts only after tapping Start on Home during active sleep.
The persisted Settings opt-in alone never requests microphone access on iOS.
The native audio session requests system authorization; Sleepy does not automatically
retry denied requests. Denial directs the user to iPhone Settings. Unavailable
or restricted capture and runtime acquisition errors have separate messages.

The native tap reads transient time-domain samples and calculates RMS locally;
web retains its existing analyser. The thresholds and detector are unchanged. No recorder,
audio file, speech recognition, speaker connection, stream transmission or raw
audio persistence is introduced. Only the existing timestamps and average/peak
relative levels enter the existing sound-event queue and Supabase service.

## Foreground lifetime

Stop releases the native input tap/engine/audio session (or web tracks, audio
nodes and AudioContext), watchdog/timer, listeners and authenticated logout hook.
Pending permission cannot revive a stopped monitor. Run IDs prevent an old
capture's events or cleanup from affecting another capture. Duplicate
start calls on one instance are ignored. Account/session generation checks
reject stale acquisition and stop a running sampling loop after a session change.

Capture ends on manual Stop, disabling the preference, sensitivity change,
navigation/unmount, baby/sleep/user change, sleep ending, logout, hidden document,
page hide, track ending/muting, or AudioContext interruption. Native iOS also
listens to Capacitor's built-in document `pause` event, dispatched for the scene
entering the background. Thus switching apps or locking the phone stops capture;
returning leaves it stopped and requires another Start tap. A stalled sampling
loop is also stopped rather than fabricating observations across suspension.
There is no background audio mode, silent-audio workaround or automatic resume.

## Physical iPhone verification

1. Build a new IPA through the existing release workflow. The microphone usage
   input adapter requires a new native build; a web-only update cannot add it.
   No microphone provisioning entitlement/profile change is
   needed. Preserve the existing Apple/push profile requirements independently.
2. Enable sound monitoring in Settings, start a sleep, and open Home. Confirm no
   microphone prompt appears until Start is tapped.
3. Tap Start, allow access, and confirm the native active state and a meter that
   responds to quiet/noise. Sustained sound should produce the same derived
   events as web. The native meter displays sqrt(RMS) for visibility of ordinary
   low amplitudes, holding the highest RMS between UI updates to show brief
   claps. Native emission aggregates energy from every intervening tap buffer
   rather than dropping them. Detector input and stored levels remain linear RMS.
   Compare quiet, speech and a nearby clap. Local mocks do not prove physical capture.
4. Stop/restart repeatedly. Confirm iOS's microphone indicator disappears after
   Stop and that only one monitoring loop is active.
5. Deny access on a fresh permission state. Confirm useful iPhone Settings
   guidance, no automatic retry, and recovery after enabling access in Settings.
6. Navigate away, end sleep, disable monitoring, switch baby, log out and log in
   as another user. Capture must end; native monitoring must not auto-start.
7. Switch apps, lock/unlock, and test an audio interruption (e.g. a call).
   Returning must not claim to be listening until explicitly restarted.
8. Verify English/Norwegian messages and permission localization, browser/PWA
   monitoring, Apple login, and native push. Confirm persisted sound events
   contain only the established metadata fields.

Local mocks cover permission outcomes, RMS/event output, duplicate starts,
pending acquisition, interruption and session cleanup. Windows cannot validate
Xcode compilation or the real iOS microphone/permission stack.

## Temporary signal diagnostics

Native unified logs use subsystem `no.strandeconsulting.sleepy`, category
`SoundMeter`: session activation/input availability, sample rate/channel format,
engine running state, then buffer count/frame count/RMS/peak/dBFS about once per
second. JS console entries prefixed `[Sleepy sound]` identify listeners ready,
bridge reception, detector/state input and React's raw/displayed meter values.
Only whitelisted derived numbers are logged. No raw samples, buffers, account
identifiers, session credentials or recordings are logged. Remove these numeric
diagnostics after device verification; sound-level history is still sensitive.

Interpretation: engine started but no buffer logs means native input/tap failure;
changing native numbers without bridge reception means bridge/listener failure;
bridge numbers without detector logs means session/lifecycle filtering; detector
numbers without React updates means component eligibility/rendering. All stages
changing but a static meter means a UI/display problem. No buffer is emitted
before native format validation; JS validates metadata and run identity too.

## Background/lock investigation — not implemented

- Inactive: no unconditional stop solely on becoming inactive; permission sheets
  must be allowed to complete. Audio interruptions can still stop capture.
- Background/lock: the previous explicit JS pause/hidden handlers intentionally
  stopped monitoring, as required by the original foreground-only scope. They
  remain. Native scene-background notification also releases input if JS is
  suspended. iOS/WebKit suspension is an additional limitation, not the only cause.
- Foreground: the saved enable preference is retained, but capture requires Start;
  monitoring is not automatically resumed or claimed to be active.

A separately approved background implementation would require all of:

1. Add `audio` to App target Info.plist UIBackgroundModes / Background Modes.
   This task does not add it. No silent audio or process-keepalive workaround.
2. Keep a deliberately user-started, active AVAudioSession capture category
   (.record; .playAndRecord only if actual playback is also needed), input tap
   and engine alive. Handle calls, route changes, media resets and explicit Stop.
3. Change the intentional pause/hidden policy for that explicit background mode.
   Do not depend on WKWebView timers/React/Capacitor JS running while locked.
4. Run equivalent threshold/event detection natively or design a bounded derived
   event queue with identical timing semantics. Reconcile metadata on foreground;
   do not buffer raw audio or assume Supabase JS requests execute while suspended.
5. Provide explicit background opt-in, persistent understandable status/Stop UX,
   accurate privacy copy and iOS microphone indication. Measure battery/thermal
   use during realistic overnight tests and rate-limit metering/diagnostics.
6. Explain the actual user-started baby sound monitoring to App Review, demonstrate
   it on-device and describe no recording/storage/transmission of audio. Apple
   permits background audio capture technically, but approval is not guaranteed.

Sources: [Apple audio capture category/background behavior](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/record),
[App Review Guidelines: background services, power and microphone consent](https://developer.apple.com/app-store/review/guidelines/).
