# Next-sleep onset and preparation reminders

The outcome is the start of the next recorded sleep following the last completed sleep. The source observations are elapsed wake-to-next-onset intervals, drawn from the existing 21-completed-local-day history. They retain the Next Sleep coverage checks, recency and age weights, local clock matching, and sequence matching (preceding sleep count, accumulated duration and last duration). Only intervals longer than the current elapsed wake interval are eligible. The awake-at-a-clock-time probability tool measures a different outcome.

## Product rules

The existing broad window and weighted median remain available. Only medium- or high-confidence forecasts can gain a peak. We require at least five effective days (squared total weight divided by the sum of squared daily weights) and weighted mean sequence similarity of at least 0.65.

On the existing five-minute grid inside the broad window we sum weighted Gaussian kernels over observed onset offsets. The kernel width in minutes is 5 + 5 times the existing age caution + 10 divided by the square root of effective days + one third of the weighted median absolute deviation + remaining forecast horizon in minutes divided by 90. Scores are relative likelihoods, not calibrated probabilities.

We reject boundary modes and competing local maxima at least two grid points away with at least 80% of the highest score. The display window encloses the connected half-maximum region, rounded out to the first adjacent grid points below half maximum. We reject a region touching either forecast boundary or spanning more than 60 minutes above half maximum. These thresholds are Sleepy product heuristics, without clinical validation. No peak means the original window.

## Local reminders

The iOS switch is off initially and stored on the device separately for each signed-in user and baby. The app uses the existing iOS notification authorization and Capacitor router. One named local notification is replaceable across contexts. The event identity is the user, baby and last completed session ID. On relaunch, a persisted trigger that has elapsed is treated as already sent, even if the notification was dismissed.

The default and only lead time is ten minutes. A ten-minute change threshold spans two prediction grid steps and avoids replacing requests for single-step changes on the minute refresh. Loss of eligibility cancels immediately when observed. The scheduler consumes the same sleep history, active state, realtime and resume refreshes as the forecast. Feeding and diaper events do not supply onset evidence. iOS can deliver scheduled notifications while the app is suspended; a sleep registered elsewhere while this device is offline or suspended cannot reliably cancel an already scheduled local notification.

## Synthetic replay

Run the existing rolling-origin fixture generator with:

    node -e "console.log(require('./tests/daily-forecast-backtest.cjs').runOnsetReplay())"

For each checkpoint we supply only completed records available then and compare against the next recorded onset. The old forecast displayed a range, so the old point comparator is its underlying weighted median. Across three synthetic profiles and five seeds, 68 of 742 ready checkpoints qualified for a peak. On those paired cases median absolute error was 12.15 minutes for the old estimate and 9.92 for the peak. The corresponding counts within 10, 15 and 30 minutes were 31/44/61 and 34/44/61. Window coverage was 60/68 and 59/68. These repeated checkpoints measure behavior on synthetic recordings and do not establish accuracy for a real child.
