# Sleep Wave, phase 1

The approved reference is `design/references/sleep-wave-premium.png`. The
implementation uses CSS gradients, system serif display typography and inline
SVG; the image is never shipped as a background or application screenshot.
The light palette is warm blush/ivory/lavender; dark mode uses a distinct plum
palette with ivory text. Fonts are system fonts; no packages were added.

## Integration and responsibilities

Home retains its tracking section, timer, primary start/stop action and active
sleep estimate. Immediately after that section, `SleepWaveCard` replaces the
former Next Sleep presentation, before sound monitoring and remaining content.
`nextSleep.ts` is unchanged. Existing normalized, baby-scoped analytics history
and the existing Next Sleep result supply all data. Home's active record can
suppress a stale forecast immediately after a local start. The existing clock,
realtime/history loading and app lifecycle handling are reused; no new timers,
backend behavior, stores, queries or entitlement decisions were introduced.

`analytics/sleepWaveModel.ts` converts normalized records into display segments,
the domain, ticks and positions. It has no React or service dependencies.
`components/sleep-wave/SleepWaveCard.tsx` handles copy, localized dates and the
accessible summary. `SleepWaveChart.tsx` renders SVG with instance-safe gradient
IDs. `SleepWave.css` contains all new styling, scoped to the card.

## Time and visual semantics

The baseline frame is today's local 06:00–21:00, extended to contain now, full
overnight records intersecting today, the current active interval and the entire
next onset window. Calendar dates advance with `setDate`, not fixed 24-hour
arithmetic. All positions and widths are elapsed milliseconds on one axis.
Ticks use actual instants; date/UTC-offset labels disambiguate midnight and DST.

Recorded sleep forms a solid, smooth Bézier area with exact timestamp boundaries.
Height is purely stylistic, softened for narrow intervals and capped; it is not
probability, sleep intensity or sleep stages. A compound path fills overlapping
records without adding opacity for duplicate registrations. Active sleep has a
distinct striped treatment and stops at the current time.

The forecast is an exact-width, dashed lavender onset band with a small onset
diamond. It is intentionally not another solid sleep wave: the engine predicts
when sleep may begin, not its duration. The note and legend make this explicit.
The chart API accepts an array of forecast segments for future extension; phase
1 supplies at most the existing next window. It creates no additional naps.

Sleeping suppresses forecasts without adding a wake prediction or another timer.
Insufficient history shows learning copy, available recorded sleep and now.
Missing forecast evidence never supplies an invented awake status. The integrated
summary contains at most three items: latest completed sleep, status and onset.

Geometry is memoized at minute granularity, with immediate updates on new records
and active-state changes. Reduced motion disables the optional marker transition.
SVG is hidden from assistive technology; the visible summary and screen-reader
record list provide equivalent data. Enlarged text wraps and summary columns
reflow without fixed card heights. Start/stop controls precede the card.

## Limitations and physical iPhone checks

- Forecast reliability and tracking-completeness limits are unchanged from Next
  Sleep. Sparse history may yield no forecast; absent sleep logs aren't filled in.
- A whole-day axis necessarily renders short sleep/onset intervals narrowly.
  Width is never exaggerated to match the illustrative reference.
- Very long or overnight records expand the domain, compressing short events.
- Now moves at minute resolution. There are no interactions, extra forecasts,
  confidence percentages, sleep stages, wake predictions or probability curves.
- Verify iPhone safe areas, Dynamic Type, VoiceOver reading order, light/dark
  palettes, native resume/lock-screen refresh, slow-network baby switching,
  realtime edits/deletions, midnight and timezone/DST changes. Verify existing
  tracking, Live Activity and sound monitoring on device.
- Browser enlarged-text tests scope to the new card; the existing global Home
  header/navigation may need separate Dynamic Type improvements at extreme sizes.
