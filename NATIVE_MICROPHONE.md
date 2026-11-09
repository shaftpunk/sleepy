# Native iOS sound monitoring

## Capture and privacy

The existing `getUserMedia({ audio: true })` / Web Audio pipeline also serves
Capacitor iOS. No audio-recording plugin is installed. WKWebView microphone
access requires `NSMicrophoneUsageDescription`; the original native project
did not declare it. The app now includes English and Norwegian Bokmål
`InfoPlist.strings` resources. iOS chooses the permission prompt language;
Sleepy's in-app language controls the monitoring messages.

Native platform detection bypasses only the browser HTTPS pre-check. Actual
microphone and AudioContext support are still required. Missing APIs produce
a native unavailable message. Web retains the HTTPS gate and automatic start
when the existing enabled/active-sleep conditions hold.

Native monitoring starts only after tapping Start on Home during active sleep.
The persisted Settings opt-in alone never requests microphone access on iOS.
`getUserMedia` invokes system/WebKit authorization; Sleepy does not automatically
retry denied requests. Denial directs the user to iPhone Settings. Unavailable
or restricted capture and runtime acquisition errors have separate messages.

The existing analyser reads a transient, reused time-domain sample buffer and
calculates RMS locally. The thresholds and detector are unchanged. No recorder,
audio file, speech recognition, speaker connection, stream transmission or raw
audio persistence is introduced. Only the existing timestamps and average/peak
relative levels enter the existing sound-event queue and Supabase service.

## Foreground lifetime

Stop releases tracks, source/analyser connections, AudioContext, sampling timer,
event listeners and the authenticated logout cleanup hook. Pending permission
cannot revive a stopped monitor: a late stream is immediately stopped. Duplicate
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
   description/localized resources require a new native build; a web-only update
   cannot add them. No microphone provisioning entitlement/profile change is
   needed. Preserve the existing Apple/push profile requirements independently.
2. Enable sound monitoring in Settings, start a sleep, and open Home. Confirm no
   microphone prompt appears until Start is tapped.
3. Tap Start, allow access, and confirm the native active state and a meter that
   responds to quiet/noise. Sustained sound should produce the same derived
   events as web. A completely flat meter in a noisy room needs device/WebKit
   diagnosis; local mocks do not prove actual WKWebView capture/analysis.
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
