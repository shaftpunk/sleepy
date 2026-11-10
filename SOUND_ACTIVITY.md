# Sound activity V1

Completed sleeps show Sound Activity inside the existing History sleep modal.
The section reads through the existing paginated getSoundEventsForSleep service
and authenticated RLS. It never writes events or changes sleeps.

The timeline shows detected intervals, not continuous samples or monitoring
coverage. Empty areas cannot establish quiet. The summary counts visible events
and merges overlapping clipped intervals before summing detected duration.
Edits clip display geometry only. Details retain original times/duration and
explain any clipping. Original average/maximum levels are never recalculated.

Presentation-only maximum-RMS calibration is isolated in activityTimeline.ts:
low below 0.08, medium from 0.08 to below 0.20, high at/above 0.20. These are
relative visual categories, not calibrated decibels or detection thresholds.
Short marks have a minimum painted width of 5px and a separate hit area. Lane
placement accounts for hit areas; dense clusters scroll vertically. An optional
event list shows 20 items at a time, with additional items available on request.

No migration, RPC, Edge Function, microphone or detector change is required.
Sleep splitting remains an existing audit item: inspect the live
split_sleep_session definition before claiming that split sessions reassign
their sound events. V1 always uses the stored sleep_id, never time-based guessing.
Late native queue synchronization is visible on reopening/retrying the section;
this completed-sleep section does not add a realtime subscription.
