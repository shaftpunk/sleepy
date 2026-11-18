# Analysis recency audit and methodology

## Scope and finding

Analysis describes two different things: exact recorded periods and estimates of
the baby's current pattern. These must not share a misleading aggregation merely
because they use the same history. No schema, tracking, write, billing, permissions,
sound, Live Activity or forecasting behavior is changed by this work.

The old Personal Sleep Profile was an equal-weight rolling **14 × 24h** sample,
including today. Its daily sleep was a mean of daily totals on any date with sleep,
even a partial date. Its nap rate divided nap starts by days with any session start.
Its duration and wake-window medians were unweighted. Bedtime and waking were
circular means over every night-labelled session, rather than one observation per
night. Thus incomplete dates lowered totals, fragmented nights added multiple
"bedtimes", unusual sessions moved means, and older behavior had equal influence.
The Overview nap KPI additionally counted all sleeps as naps.

## Pre-change audit

"Loaded" below means approximately 35 days returned by useAnalyticsData, without
a metric-level cutoff. "No" in the weighted column means no recency weighting.

| Metric / feature | Previous lookback | Previous aggregation / weighting | Recent weighted? | Consistent with Probability? | Decision |
|---|---|---|---|---|---|
| Sleep Probability | Previous 30 completed local days | Usable observations; four-tier weighted proportion | Yes | Reference | Extract constants and interval validation; preserve calculations |
| Profile daily sleep | Rolling 14 days including today | Mean of daily totals on dates with any recorded sleep | No | No | Weighted median of usable completed-day totals |
| Profile naps/day | Rolling 14 days | Nap starts / dates with any session start | No | No | Weighted median of actual nap starts per usable day |
| Profile nap/night duration | Rolling 14 days | Session medians | No | No | Weighted session medians; nap middle-half range |
| Profile bedtime/wake | Rolling 14 days | Circular means over all night-labelled sessions | No | No | One reconstructed main episode per night; weighted circular L1 center |
| Profile overall/time-of-day wake windows | Rolling 14 days | Median gaps, excluding >8h | No | No | Weighted medians on usable anchor days; middle-half range |
| Overview rhythm | Loaded | Circular means, unweighted gap median | No | No | Reuse profile timing/window fields |
| Overview naps/day | Last 7 days including today | All session starts / days with data | No | No | Reuse typical nap count; correct night-as-nap bug |
| Overview night share | Loaded | Summed night minutes / summed minutes | No | No | Weighted median of daily night shares on usable days |
| Overview longest sleep | Loaded | Exact maximum session duration | No | Factual exception | Exact maximum of valid session starts in previous 30 completed dates; explicit period label |
| Overview 7-day average | Last 7 dates including today | Mean daily totals on any date with a record | No | Factual exception | Equal-weight usable completed days, 1–7 |
| Overview weekly trend | Two 7-day windows, elapsed-time offset | Difference of the above averages | No | Period-comparison exception | Completed local dates 1–7 vs 8–14; minimum 3 usable days each; equal weights |
| Day/Month bars, total, average, best date | 7/30 local dates including today | Recorded minutes/counts, mean/max | No | Factual exception | Preserve factual chart values and calendar splitting |
| Usual sleep hours / busiest window insight | Rolling 30 × 24h | Sum of minutes in eight 3h buckets | No | No | Recency-weighted clipped minutes on usable completed days; DST-safe bucketing |
| Wake windows through day / ordinal trend insight | Loaded | Gap medians by ordinal position | No | No | Shared recent evidence and weighted medians; retain actual sample counts |
| Insight typical rhythm/durations/night share/daily share | Loaded or 7 days | Circular means, arithmetic means, ratios | No | No | Reuse profile fields exactly |
| Insight bedtime consistency | Loaded | Circularly unwrapped population standard deviation | No | No | Weighted RMS circular distance from robust center, one reconstructed night per observation |
| Insight nap consistency | Last 7 dates | Range of all sleep counts | No | Fixed-period exception; incorrect counting | Actual nap count range on usable completed days 1–7 |
| Insight quality estimate | Loaded | Mean session rating | No | No | Recency-weighted mean of valid ratings in recent completed observations |
| Insight quality trend | Loaded | First vs second half by session count | No | No meaningful fixed periods | Equal-weight completed dates 1–7 vs 8–14; at least 3 rated dates each |
| Quality distribution / night-day breakdown | Loaded | Actual rated counts, sleep counts and summed minutes | No | Factual exception | Explicit previous 30 completed-day period; retain exact values; clip sleep minutes at period boundaries |
| Best-day / longest-session milestone insight | Last 7 / loaded | Exact maxima | No | Factual exception | Usable completed last-7 dates / explicit completed 30-date session period |
| Feed interval | Loaded | Median start-to-start gaps, rejects >12h | No | No | Recent weighted median; no full sleep-day eligibility needed |
| Feeding per-day average/chart/type shares/night proportion | 7 dates / loaded | Recorded counts, means, proportions | No | Factual exception | Retain exact period descriptions; bound loaded-history rows to 30 local dates including today |
| Age guide | Rolling 24h | Recorded sleep, nap count, gap median | No | Fixed-period exception | Preserve |
| Sleep timeline / Sleep Wave / Next Sleep / estimation | Separate forecast windows | Forecast-specific methods | Varies | Intentional exception | Preserve; explicitly separate legacy forecast profile input |

## Shared recency and calendar semantics

`sleepHistory.ts` owns `RECENT_PATTERN_DAYS`, `getRecencyWeight`, completed local
day selection, interval union, and usable-day selection. Sleep Probability
re-exports its existing public helpers and uses the extracted implementation.

| Completed local days ago | Observation weight |
|---|---:|
| 1–7 | 1.00 |
| 8–14 | 0.75 |
| 15–21 | 0.50 |
| 22–30 | 0.25 |
| Today, future, >30, noninteger ages | 0 |

Calendar arithmetic uses local midnight and `setDate`, never elapsed 24h age
rounding, UTC date substrings or UTC hours. Day 30 is inclusive. DST days may be
23 or 25 hours. Sleep Probability retains its selected-clock ambiguity/gap
abstention and minimum five usable days unchanged.

The 35-day data fetch already supplies the entire recent calendar window plus
overnight/DST buffer; it intentionally remains unchanged. No new network reads
or dependencies were added.

## Observation eligibility

`sleepEvidence.ts` contains the existing plausibility guard, overlap cleaning,
and availability thresholds. Forecast consumers retain their original behavior.
Analysis additionally requires finite timestamps, positive elapsed durations,
completed observations, and the existing 12h plausibility ceiling.

Full-day estimates require at least two disjoint recorded intervals spanning at
least 12 real hours within the clipped local day, matching Probability's logging
proxy. An active registration intersecting a historical day excludes that day.
Only the selected-clock containment test is specific to Probability and is not
used for daily estimates. Missing/insufficient days contribute **no observation**,
not a zero total or awake day. Observed zero nap starts on an otherwise usable day
are a legitimate daily observation.

Session duration and rating estimates can use valid completed sessions even if
their dates do not qualify for full-day statistics. Session samples are anchored
to the start local date and finish by today's midnight. A completed sleep ending
today can supply yesterday's clipped recorded minutes, but is not yet a session
sample in the completed-day profile. A carry-in night from before day 30 can supply
clipped day-30 minutes but cannot contribute an older session-duration sample.

Wake windows require bracketing valid sessions and a usable anchor date (the local
date of the preceding sleep's end). Gaps >8h remain excluded. They are candidate
observed wake windows, not proof of wakefulness throughout missing logging.

## New profile field methods

All numeric samples remain raw until aggregation. A daily value is calculated
without recency scaling and receives exactly one weight at its final aggregation.
No profile field is fed back as new historical evidence.

| Field | Observation and aggregation |
|---|---|
| `typicalTotalSleepPerDay` | Clipped recorded total per usable completed date; weighted median |
| `typicalNapCountPerDay` | Nap starts per usable date, including observed zero counts; weighted median |
| `medianNapDuration` | Valid completed nap duration; weighted median |
| `napDurationRange` | Same samples; weighted 25th and 75th observed quantiles |
| `medianNightSleepDuration` | Valid completed night-session duration; weighted median of stretches, not whole reconstructed nights |
| `medianWakeWindow` | Eligible bracketing gaps; weighted median |
| `morningWakeWindow`, `middayWakeWindow`, `eveningWakeWindow` | Same gap samples bucketed by local start hour (<12, 12–16, >=17); at least two samples per bucket |
| `wakeWindowRange` | Eligible gap samples; weighted 25th and 75th observed quantiles |
| `typicalBedtime`, `typicalWakeTime` | Group night-labelled sessions by noon-to-noon date; choose longest session, extend through adjacent night fragments at most 3h apart; use episode's start/end clock times; one weight from episode start date; circular weighted L1 medoid across at least two nights |
| `typicalLongestStretch` | One longest valid completed session start per usable date; weighted median of that distribution, no average of maxima |
| `atNightPct` | Night-labelled clipped minutes / all clipped minutes for each usable date; weighted median of daily percentages |
| `historyDays`, `completedSessionCount`, `usableDayCount` | Actual counts, never weighted or fractional |
| `confidence` | Existing low/medium/high thresholds, now based on usable full-day count; sparse results remain low confidence |

Quantiles use the inverse empirical weighted CDF, with no interpolation. Thus
nap counts remain observed integers and outliers do not create invented typical
durations. Circular timing chooses an observed clock time minimizing weighted
shortest-circle distance; ties use clock order for deterministic results. This
keeps midnight-adjacent times together without placing a mean between clusters.
Ranges are returned for analytical reuse; this task does not add new UI layouts.

Overview and Insight reuse these fields. The ordinal wake-window panel and its
trend share the same evidence and weights. The sleep-hours histogram applies the
date weight once to each clipped recorded minute; it steps through actual elapsed
minutes and buckets by local hour, preserving both fall-back occurrences.

Ratings use a weighted arithmetic mean because the product already treats its
bounded 1–5 scale as numeric quality. Bedtime variability uses weighted RMS
distance around the robust timing center to preserve existing variability units
and thresholds; unlike the timing center, it intentionally responds to outliers.

## Intentional exceptions and limits

- Exact chart totals, recorded distributions/counts, milestones and selected-period
  averages remain unweighted. Raw day/month history includes today, so its values
  can differ from the completed-day current-pattern profile by design.
- Trend comparisons use equal weights within explicit completed weeks. Applying
  the profile's age weights would change the meaning of an older-vs-newer period
  comparison. Missing periods never become zero-sleep observations. The Overview
  average includes however many usable dates exist; the trend requires three in
  each comparison window before displaying a direction.
- Longest-sleep KPI and milestone are **recorded maxima**, explicitly bounded to
  sessions starting in the completed 30-date period. They are not typical-duration
  estimates. `typicalLongestStretch` is separately available in the profile.
- Night/day recorded breakdown clips minutes at both period boundaries (including
  a carry-in night); counts refer to starts inside the period. Rating distributions
  likewise count completed records by session start date.
- Feed counts, type distribution and night share explicitly describe recorded
  periods; they cannot claim feeding-day completeness from sleep evidence.
- The old 14-day forecast profile is retained as `computeForecastSleepProfile`.
  Its constants are still used by classification/estimation. The current Analysis
  profile is separate; forecasting parity is intentional, not an overlooked
  analytics consumer.
- The model prioritizes recent **observations**, not a guaranteed winning week.
  With equally populated dates, the newest 14 days have 12.25 of 18 total units
  (about 68%); all 23 older dates can collectively outweigh the newest seven.
- There is no explicit complete-logging signal. The 12h span/two-interval proxy
  cannot prove all sleeps were recorded. Classification still uses explicit
  nap/night labels or the established 19:00–06:59 start-hour fallback. That
  fallback can mislabel unusual daytime nights/late naps; changing it would affect
  other product behavior and is outside this task.
- Timing reconstructs episodes conservatively with a documented 3h joining rule;
  it cannot infer an unlogged beginning/end of a night. Widely bimodal routines
  are summarized by one observed center rather than presented as multiple modes.

## Files

Created: `src/analytics/sleepEvidence.ts`, `sleepHistory.ts`, `weightedStats.ts`,
`recentSleepProfile.ts`, `recentPatterns.ts`; `tests/analysis-recency.test.cjs`;
this methodology document.

Modified analytics: `personalSleepProfile.ts`, `sleepProbability.ts`, `overview.ts`,
`day.ts`, `insights.ts`, `feed.ts`.

Modified integration/copy: `src/pages/Analysis.tsx`, Analysis `OverviewTab.tsx`,
`DayTab.tsx`, `InsightTab.tsx`, `FeedTab.tsx`; `PersonalSleepProfileCard.tsx`,
`NextSleepPredictionCard.tsx`; `src/i18n/en.ts`, `src/i18n/no.ts`.
Pre-existing local changes, including Analysis layout changes, are preserved.

## Validation

`tests/analysis-recency.test.cjs` covers tiers, boundaries, weighted utilities,
conflicting bedtimes, robust outliers, midnight timing, fragmented nights, sparse
data, incomplete logging, duplicate/invalid observations, active historical days,
cross-surface consistency, factual period exceptions, DST/timezone semantics,
feeding interval recency and legacy forecast parity. Its histogram and daily
aggregation cases explicitly distinguish single from squared recency weights.

Validation results:

- 21 focused Analysis tests passed, including both rendered languages.
- 15 existing Sleep Probability tests passed unchanged.
- Full `node --test tests/*.test.cjs`: 429 tests, 403 passed, 26 skipped, 0 failed.
  Skips are existing optional database suites requiring their external test runtime.
  The run includes Sleep Wave, Next Sleep, classification, active estimation,
  timeline, planner and daily/upcoming forecast regressions.
- Targeted ESLint on all changed TypeScript/TSX sources passed.
- Production `npm run build` passed. The existing service-worker build emits an
  `inlineDynamicImports` deprecation warning.
- Broad quick mobile layout run: 90 screen/state checks passed.
- Analysis mobile runs at 320, 375, 390 and 430px, both themes and both languages:
  34 checks each, **136 checks passed**, external requests blocked. One combined
  long run hit a navigation timeout; independent runs at every width passed.
- `git diff --check` passed for task files.

No commit or push is performed.
