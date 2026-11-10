# Sleepy native sound monitoring

## Capture, detection and lifetime

Start on Home during an active sleep is the only way to start native capture.
The saved preference, navigation, app startup, unlock and foregrounding never
start a new microphone session. An already-running native session is adopted
when React returns; leaving Home does not stop it.

The App target declares `UIBackgroundModes = audio`. The real microphone input,
not playback/silent audio or WebView keepalive, is its background audio activity.
`AVAudioSession` remains `.record` / `.default` / no options. `AVAudioEngine` reads
input via a float32 input tap. Only numerical energy/peak values reach native
main-queue processing. The native detector continues while locked/backgrounded.
Web/PWA retains its existing getUserMedia/Web Audio path and foreground policy.

`ios/NativeSoundCore` contains the platform-independent detector, bounded queue,
monitoring-intent and remote-deadline code. App compiles those same sources;
Swift Package tests do not use a second copy of the algorithm.

### Exact detector semantics

`src/sound/detector.ts` remains unchanged. Swift implements the same rules:

- Linear RMS, clamped to 0–1; low/medium/high thresholds **0.12/0.06/0.025**.
- At least **2000ms** above threshold confirms an event. Short noises reset.
- Quiet during a confirmed event is bridged until **2500ms**; the event then
  ends at the beginning of quiet, not at the end of the quiet timeout.
- Sum/count average and maximum aggregation, including the same quiet samples
  as TypeScript; no new sensitivity, cooldown or speech/cry classification.
- A sampling gap over **1000ms** or backwards clock flushes through the last
  sample. Explicit stop/interruption flushes only observed time, not suspension.

Native detection consumes aggregated RMS at about 100ms cadence. Foreground
visual cadence is separate. Parity fixtures are produced from the real TS
detector by `scripts/sound-parity-vectors.cjs`. Node verifies the fixture remains
current; XCTest executes the Swift detector against the same timestamps/levels
and expected event boundaries/averages/peaks. `ios-prepare.mjs` now runs
`swift test --package-path ios/NativeSoundCore` on macOS before the native build.
The Swift tests cannot execute on the current Windows environment.

## Metadata queue and synchronization

Completed events have a native UUID, owner/baby/sleep UUIDs, timestamps, average
and maximum RMS. They are atomically saved under Application Support/SleepySound,
excluded from backups, protected until first device unlock. That protection
allows metadata writes while subsequently locked during user-started capture.

The queue holds at most **256 finalized events**. Capture stops before exhausting
capacity, reserving a slot for its final flush; old unacknowledged events are
never evicted. Storage failure also stops capture. No unbounded per-sample queue
or audio file is created. In-progress events live as detector aggregates; a
process kill can lose that unfinished event. Finalized queued events survive.
Force-quit/OS termination ends capture and never auto-restarts it on launch.

On foreground/startup or event availability, the signed-in user drains batches
of 20 metadata events through existing `createSoundEvent`, including its RLS
sleep validation/clipping and idempotent UUID upsert. Native acknowledgement
occurs **after** successful persistence. A crash between write and ack can retry
the same UUID without duplicating the row. Offline writes leave native metadata
unacknowledged; another account cannot drain/upload the previous owner's events.
Queued metadata remains for that owner until successful retry or app removal.
No new database migration or sound-event schema is required.

## Remote sleep end: under-60-second stop policy

The selected policy is native remote validity checking, including while locked.
One new Edge Function, `sound-monitor-status`, is required. It has two actions:

1. `issue`: requires the normal Supabase user JWT and an RLS-visible active sleep.
   The server creates a **24-hour**, domain-separated HMAC capability restricted
   to boolean validity checks for that user/baby/sleep. It is not an Auth JWT.
2. `validate`: verifies the signed capability, expiry and matching context, then
   checks that the auth user, active sleep and current household access remain.
   It returns only `active`. No sound observations are sent on this path.

Gateway JWT verification is disabled **only for this new function**, because the
native validation capability is not a Supabase JWT. Both actions authenticate
inside the handler. HMAC key material is domain-separated from the existing
server-only SUPABASE_SERVICE_ROLE_KEY. It never leaves Supabase. No new secret,
service-role client credential or native Auth/refresh-token implementation is
needed. Rotating the server role key invalidates outstanding leases safely.

Native uses an ephemeral, non-caching URLSession. The capability exists only in
memory and is cleared on Stop. It is not encoded in session/event queue files.
Polls run every **20 seconds**, with a **10-second network timeout** and native
**12-second watchdog** (checked every 2 seconds). Negative, expired, malformed,
unauthorized or failed responses stop capture; inability to check is NOT treated
as permission to continue. Expected stop latency is about 20–36 seconds, below
the requested 60-second budget while iOS schedules the running capture process.
If iOS terminates the process, the microphone stops as well. This is not a safety
or real-time guarantee. **Network loss deliberately stops monitoring.**

A long permission sheet/interruption requires fresh native validity before
microphone startup/resume. Foreground realtime/validation can stop sooner.
Ending a sleep on another family device also causes the existing metadata writer
to trim/discard out-of-sleep observations when queued events are later uploaded.
After 24 hours the lease expires and capture stops; a fresh user Start obtains
a new one. No credential or automatic restart survives process termination.

Before the next TestFlight build, manually deploy only the new function from root:

```powershell
supabase functions deploy sound-monitor-status --project-ref zebrmlignzctngbxijql
```

Do not redeploy push functions or run database migrations for this work. This
implementation has not deployed any function or changed production configuration.
Verify the deployed endpoint against real Sleepy RLS/membership data before release.

## Interruptions and user control

Stop, disabling monitoring, changing baby/sensitivity, local/remote sleep end,
logout/account change, revoked permission, queue exhaustion or unrecoverable
audio/validity failure release the input tap, engine, session and native timers.

Backgrounding/lock only cancels the 60ms visual timer. Native capture/detection
continue; no meter events are bridged to suspended JS. Interruptions flush the
current detector event and pause capture while retaining explicit user intent.
On interruption end, resume is permitted only with Apple's `shouldResume`, a
still-requested session, valid permission and fresh remote validity. Stop clears
that intent and prevents delayed callbacks from restarting input. A route/media
reset gets one controlled recovery attempt; failure stops rather than looping.
Benign category changes caused by our own capture setup are ignored.

## Foreground display calibration

- Old native bridge cadence: about **100ms**; React about **250ms** (~4Hz).
- Old display: `sqrt(RMS)` with peak hold.
- New native visual timer: **60ms** (~16.7Hz); JS coalesces bursts below 50ms.
- Target: `clamp((20*log10(RMS) + 70) / 60, 0, 1)^1.4`.
- Fast attack: **25ms** time constant; decay: **180ms**, elapsed-time adjusted.
- Quiet/zero inputs are valid; zero/invalid display inputs map safely to zero.
- Highest RMS between visual ticks holds brief claps. Native detection and
  persisted RMS are NEVER fed the display transformation.

Steady visual targets: -70dBFS=0, -60=0.08, -45=0.29, -30=0.57, -20=0.77,
-10=1, 0=1. These are visual calibration defaults, not detector thresholds or
calibrated SPL/dB readings. Physical microphone gain differs across devices.
Foreground diagnostics log only RMS/dBFS/mapped display level about once/second.
There is no animation timer or continuous meter bridge traffic in background.

## Privacy and App Review

No AVAudioRecorder/MediaRecorder, audio files, speech recognition, sample storage,
audio buffers over Capacitor, audio upload or hidden microphone start is added.
Transient tap buffers are reduced to scalar energy/peak values immediately.
Only completed event metadata is persisted; the status endpoint sees only its
scoped capability/session identifiers, never microphone samples or events.
The iOS microphone indicator remains visible. Home shows active/paused state and
Stop; native Settings explains background operation and fail-closed networking.
English/Norwegian copy is retained. Review must use real hardware and the existing
review account; credentials should be supplied separately in App Store Connect.

Suggested App Review Notes:

> Sleepy includes optional, explicitly user-started sound-level logging during a
> baby's sleep session. Start a sleep, enable Sound Monitoring in Settings, then
> tap Start on Home and grant microphone permission. Continuous microphone input
> is analyzed locally with AVAudioEngine while the user switches apps or locks
> the screen. This is the purpose of the audio background mode; no silent playback
> or WebView keepalive is used. No audio recordings/files are created, and no raw
> audio is stored or transmitted. Only derived event timestamps and relative
> average/maximum sound levels are synchronized to the signed-in family's data.
> The user can Stop on Home or disable monitoring in Settings. Ending the sleep,
> logout, permission loss or inability to verify session validity stops capture.
> The iOS microphone indicator remains active during capture. This is a sound log,
> not a baby alarm, cry-recognition system, medical device or safety guarantee.

Apple supports background capture technically, but review approval is not
guaranteed. Measure battery/thermal use during overnight tests; network polling
and continuous microphone capture consume power. Sources:
[Apple record/background behavior](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/record),
[interruptions](https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions),
[Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## Physical-iPhone TestFlight plan

1. Run the macOS native preparation (including Swift tests), archive/sign with the
   existing workflow, and install a fresh TestFlight build. No provisioning change
   is needed for the audio Info.plist background declaration.
2. Deploy/verify the new function first. A missing/unavailable validity service
   intentionally prevents starting. Confirm no token values appear in logs.
3. Start an active sleep and tap Start. Confirm native permission, responsive
   quiet/speech/nearby-speech/clap movement, and unchanged sustained detection.
4. Navigate across Sleepy pages; return Home and confirm the same capture continues.
5. Switch apps for several minutes and lock for 10+ minutes. Produce separated
   sustained sounds. Confirm the system microphone indicator remains active.
6. Return; verify running/detected status, automatic metadata drain, correct event
   times/durations, and no duplicates after repeated foreground/background cycles.
7. While locked, end the sleep from a second family device. Time microphone release;
   it must stop within 60 seconds. Repeat after revoking household access.
8. Disable network while locked: verify fail-closed microphone release within the
   same budget and that finalized queued events upload on return/reconnection.
9. Test Stop, ending sleep locally, disabling preference, switching baby and logout.
   The microphone indicator must disappear. Another account must not inherit capture
   or receive prior-owner events. Retry queued metadata after the original user logs in.
10. Interrupt with a call/Siri; verify safe resume only if permitted/valid. Press Stop
    during interruption and verify it never resumes afterward. Test route changes.
11. Force-quit after finalized events have queued; reopen. Verify capture stays off,
    metadata survives, and retries do not duplicate server events. An unfinished event
    may be lost on process kill; capture cannot continue after force-quit.
12. Exercise queue capacity/storage-failure tests and confirm bounded behavior without
    evicting unacknowledged events. Measure foreground UI rate and overnight battery/heat.
13. Re-test Web/PWA microphone behavior and both languages. No push/auth changes are
    part of this work. Do not use this feature as a medical/safety monitor.
