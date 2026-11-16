# Next Sleep, phase 1

Home now presents this engine through `sleep-wave/SleepWaveCard` immediately
after tracking/status and before sound monitoring. It replaces the old median next-nap hint. Sleeping
babies retain the existing sleep estimate; there is no second sleeping timer.
Analysis probability and rhythm timeline stay in Analysis.

## Model

`analytics/nextSleep.ts` is pure, takes normalized sessions for one baby, and
returns epoch milliseconds, consistent with the analytics domain. It reuses
the probability engine's plausible completed-interval union, the existing
wake-window extractor, local clock helpers and stepped recency weights. It
does not use clock-time sleep probability as onset probability.

Historical wake gaps must be 15–360 elapsed minutes, from the last 21 days,
with wake-up clock time within three circular local-clock hours of the current
wake-up. Weight is the existing recency weight multiplied by
`1 - clockDistanceMinutes / 240`. Today uses the first recency tier.

Require six observations across four local dates, including three dates in
the last seven days. Each gap also needs three merged recorded sleeps within
18 hours on either side, spanning at least 12 hours with no gap over six hours
in that surrounding context. Rejected intervening
records and implausibly long merged boundary sessions invalidate a sample.
The latest wake-up must be within six hours; an invalid newer record prevents
using an older wake-up as the current anchor.

For babies at least 90 days old use weighted 20th/80th percentiles with ten
minutes of padding. Younger babies or unknown age use 10th/90th percentiles
with twenty minutes of padding. Age never supplies an invented schedule.
The window is at least fifteen minutes wide and rounded up to five-minute
instants. The internal likely onset is the weighted median of observations
longer than the current awake duration. Require four such observations over
three dates, otherwise abstain; never continually move an expired prediction
forward. Returned times are never before the supplied calculation instant.

High confidence requires ten observation dates, five recent dates and a
quantile spread below 25% of the median. Medium requires six dates, four
recent dates and spread below 50%. Young/unknown age is always low. These are
engineering coverage/variation categories, not medically validated probabilities;
the card displays neither percentages nor confidence claims.

## Data and lifecycle

The existing analytics hook remains the history source. Baby-tagged results,
request ordering and effect-lifecycle guards prevent stale cross-baby responses.
Failed history refreshes remove forecast evidence. Successful local write
events and existing realtime events refresh history; active-state read snapshots
do not trigger extra history reads. Existing foreground heartbeat, visibility,
focus, route mount and native resume handling provide freshness. No new polling,
store, backend, database change or dependencies are introduced. Home memoizes
prediction at minute granularity, using the next minute boundary so a displayed
window cannot become past-dated between calculations. Local date and age changes
are reflected at that boundary. Real elapsed milliseconds handle midnight/DST;
local wall time is used only for comparing historical context and formatting.
Windows crossing a UTC-offset change show offsets to disambiguate repeated times.

## Limitations and device verification

There is no logging-completeness signal. Coverage is only a conservative proxy:
a missed nap can still resemble a legitimate gap, and complete logs from some
consolidated or irregular sleepers will not qualify. Forecasts abstain after
six hours awake, with sparse comparable observations, or after failed reads.
The model is a heuristic with no external calibration or clinical validation.

Verify on iPhone: locked-screen/background resume refresh; route return and
baby switching during slow network reads; family realtime edits/deletions;
Dynamic Type and narrow safe-area layouts in both languages/themes; date labels
at midnight. Confirm existing tracking, Live Activity and sound monitoring on
device. Browser checks do not verify native behavior.
