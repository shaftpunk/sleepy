# Sleep prediction methodology

Sleepy estimates what the child may do next from the child's own sleep log.
Longitudinal pediatric studies report changing sleep consolidation and
substantial differences in timing and variability across infancy. They inform
the design direction. Infant sleep changes over time and individual variation
is substantial, so recent personal behavior is useful context. A recorded
onset is directly available to Sleepy, while unlogged waking and fragmentation
are not. As future events depend on earlier ones, uncertainty accumulates.

Sleepy uses research-informed statistical heuristics. The prediction model
has not been clinically validated. The exact numerical rules below are product
choices, not pediatric recommendations. Internal forecast model version:
`2` (defined in `forecastModelVersion.ts`).

- [Longitudinal observations across the first year](https://pubmed.ncbi.nlm.nih.gov/25317093/)
- [Longitudinal actigraphy and diaries at 3, 6 and 12 months](https://pubmed.ncbi.nlm.nih.gov/33333904/)

## Evidence and recency

Current patterns and Likely Asleep use up to 30 completed local dates. Next
Sleep and the remaining-day forecast use up to 21 completed local dates.
The preliminary coming-day forecast can use 30. Actual current observations,
such as the last wake-up, are anchors rather than historical samples.

The base tiers are 1.00 for days 1–7, 0.75 for 8–14, 0.50 for 15–21 and
0.25 for 22–30. With a known age, weight is base raised to
`1 + exp(-ageDays / 120)`. The first week stays at full weight. Missing age
uses the base tiers and conservative forecast intervals. The scale of 120 days
makes the transition gradual and has no clinical interpretation. Local calendar
boundaries preserve dates across daylight-saving changes. Forecasts measure
elapsed time between observations. Each model applies recency once and may
multiply by its own similarity factor.

Usable-day analysis requires at least two separated sleep periods spanning
at least 12 hours from the first to the last evidence. Individual valid
sessions still contribute to session statistics where appropriate. Likely
Asleep also requires records to bracket the selected time on five usable days.
Missing logging is not treated as evidence that the child was awake.

A historical transition must end at the next valid recorded sleep onset and
begin at the preceding recorded sleep end. The coverage proxy requires at
least three recorded intervals within an 18-hour neighborhood on each side,
a first-to-last span of at least 12 hours, and no gap over six hours within
that neighborhood. A rejected record spanning the gap blocks the comparison.
A log ending without another observation supplies no transition. These are
comparisons of recorded onsets, with no claim of continuous wakefulness.
A missed short sleep within a well-covered span may still go undetected.

Next Sleep uses time since the last recorded end as a live anchor and excludes
past outcomes from the remaining-onset comparison. A daily historical sequence
breaks at the first unsupported transition. Only an observed supported
night-like successor counts as ending the nap sequence. Going overnight
without a morning entry does not rule out an earlier wake; only an active
sleep can rule out earlier historical wake times. Current-day counts and sleep
durations describe the records that exist rather than presumed completeness.

## Main sleep classification

The recent profile groups unlabeled sleep records and explicitly marked nights
across gaps of at most 45 minutes, within a 14-hour cluster span. Candidates
need at least three hours of recorded sleep across their fragments. The
algorithm looks for at least three completed dates with a cluster centered
within two clock hours of the same time. Recency-weighted recorded minutes
favor the dominant cluster. A separated alternative with at least 70% of its
support makes the result ambiguous. Explicit labels take precedence. Each eligible date contributes one supporting cluster. For three or four
dates, every supporting midpoint must lie within 45 circular minutes of the
weighted circular median. With five or more dates, the weighted 80th
percentile of absolute circular deviations must be at most 90 minutes.
Sparse or ambiguous histories fall back to the existing clock-based inference.
Bedtime and wake time use the profile's existing night reconstruction and
robust circular timing. Classification does not rewrite records. Exact
historical day/night breakdowns retain their original labels. Forecast scenario
boundaries retain their separate duration/context rules.

## Next Sleep and later forecasts

Home, Analysis Overview, Data Basis and the History planner use the same Next
Sleep engine. It compares the latest completed sleep and wake-up with
historical transitions. Similarity uses local clock time, the preceding
sleep duration, and the count and accumulated duration of completed sleeps
ending on the anchor's local date. These are recorded sequence features, so
they can differ from the profile's typical nap count. The model requires
recent comparable evidence across days and checks whether enough examples
are consistent with the child still being awake.

The window uses weighted quantiles, with smooth extra conservatism for
younger babies. Weighted median absolute deviation adds up to 20 minutes
of extra padding and helps reduce the confidence tier when evidence varies.
Confidence is qualitative. Age never sets a target wake window or nap count.

The remaining-day engine matches whole continuations using clock time,
nap sequence, earlier accumulated sleep and the most recent sleep duration.
The first onset comes from Next Sleep. Later onsets follow offsets from
matched trajectories, which retain the connection between naps, wake gaps
and durations. Active-sleep continuations also match elapsed sleep and
ordinal context. At night the preliminary model follows whole historical
days and uses the current bedtime when available.

Later forecasts require evidence across days, have progressively wider
windows, and stop when support thins or the window exceeds the age-adjusted
120–150 minute cap. Onset may be shown alone when duration is too variable.
Missing or unsupported durations prevent projection of further transitions.
Sleep Wave softens later, weaker waves and keeps recorded geometry separate.

## Forecast tuning rules

- Next Sleep accepts gaps of 15 minutes to six hours and historical anchor
  clocks within 180 minutes. Clock similarity falls linearly with distance
  on a 240-minute scale. Shared sequence matching uses exponential penalties
  with scales of three recorded sleeps, 360 accumulated minutes and 0.5 for the
  absolute log duration ratio.
- Next Sleep requires six samples on four dates, including three dates in the
  recent week. After the elapsed-time comparison it needs four samples on
  three dates. It abstains if the elapsed anchor exceeds the upper quantile
  by 20 minutes or the window extends beyond six hours since the last record.
- Next Sleep uses tails from 10% to 20% with age caution, a minimum 15-minute
  window, and five-minute rounding. Padding starts at 10 minutes, with up to
  10 more for age caution and up to 20 from half the weighted median absolute
  deviation. Higher confidence requires caution below 0.5. High confidence
  needs 10 dates, five recent dates and relative spread below 0.25. Medium
  needs six dates, four recent and spread below 0.50.
- Daily Forecast matches clock time on a 90-minute scale and penalizes ordinal
  nap differences by a factor of 0.6 per nap. Unknown ordinal contributes 0.8.
  Matches below 0.1 are suppressed and the first historical onset must agree
  within 30 minutes of the Next Sleep window. Continuation rules use five
  scenario dates, at least three effective scenarios and three contributing
  dates as applicable, with a 0.6 continuation share. Later daytime events can
  require up to one additional effective scenario for higher age caution.
- Later windows grow by at least five minutes where possible. A 150-minute
  cap decreases by up to 30 minutes with age caution. The duration spread
  allowance is the larger of 45 minutes and 1.2 times the typical duration.
  Scenario episode boundaries, forecast clock limits, horizon limits and the
  active-nap checks are also product rules, listed alongside the model in
  `dailySleepForecast.ts`. Qualitative confidence is a support description,
  never an empirical probability.

## Historical replay

`backtestSleepPredictions` runs the real forecasting functions at the first
completed recorded wake-up on each eligible local date. At each checkpoint,
only sessions ending by that instant are passed to the model, age is computed
at that instant, and the child is evaluated just after waking. Future intervals
are used only to score onset estimates. Overlapping logs and gaps beyond six
hours can prevent scoring. Later horizons use chronological daytime targets
and stop at a night-like episode or local date boundary.

The report includes checkpoint and forecast counts, scored observations by
horizon, median absolute onset error in minutes, shares within 15 and 30
minutes, and window coverage. Shares are fractions from zero to one. Sparse
logs can produce no scored horizons. The companion synthetic scripts also
exercise preliminary and active-state forecasts.

Replay is a development tool. The live engine has no replay or evaluation
dependency and neither its forecasts nor its confidence labels use this output.
Replay does not modify input records, persist results or set a global model state.
Historical logs lack their original entry timestamps, so replay cannot reproduce
what the app actually knew before later edits or backfilled sessions. Synthetic
replay helps compare regressions and does not establish clinical performance.

## Prospective evaluation contract

The pure helpers in `predictionEvaluation.ts` create versioned snapshots with
the issuance time, predicted onset, window bounds, horizon and evidence count.
The evaluator compares the point estimate with the actual onset for the same
horizon in elapsed minutes, and reports inclusive window coverage. Missing,
invalid or pre-issuance onsets remain unscored. No live recording, data storage
or user-facing reporting is wired to this contract.
