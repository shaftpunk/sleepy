# Measuring next-sleep estimates

Sleepy currently computes the next-sleep estimate from the selected baby's
logged sleeps. The prediction snapshot helper in `predictionEvaluation.ts`
is called only by the offline replay. Its snapshots lack a baby ID and are
never persisted. The on-device reminder stores scheduling state, and the
sleep event and sound tables store other kinds of events.

A small prototype could keep a bounded device-local history scoped to the
signed-in account and baby. Record one visible estimate per wake anchor under
a defined, consistent rule such as the first estimate shown. Store when it
was shown, the exact displayed window, the optional displayed peak, the baby
and wake anchor IDs, and the model version. Resolve it against the next
recorded onset for that same baby and anchor, with an explicit policy for
late, edited, deleted or missing records. Expire old or unresolvable entries.

For accuracy shared across devices, prefer a dedicated baby-scoped table with
household access policies, server timestamps, deduplication and retention.
Evaluate recent resolved observations only. Count onsets inside the stored
window and report median absolute error on the subset with a displayed peak.
Historical sleep logs alone cannot tell us what was shown.
