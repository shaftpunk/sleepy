# Approved visual specification

## What makes the reference feel premium
- **Warm, luminous light theme:** ivory foundation with pale blush/lavender, never blue-gray.
- **One coherent composition:** header, tracking actions, and Sleep Wave share a tonal family. Avoid a pastel chart bolted onto a navy home.
- **Editorial display hierarchy:** expressive serif style for brand/card titles only. Use clear, readable UI typography for time, controls, status and labels.
- **Layered surfaces:** fine ivory edge, subtle soft shadow, restrained radial highlights. Avoid thick strokes, neon bloom, and glass everywhere.
- **Meaningful chart:** fine baselines, gentle gradient fields, minimal ticks, high-contrast now marker.
- **Deliberate spacing:** preserve prominent primary tracking CTA and enough breathing room, but no giant empty spaces in card.

## Candidate palette
| Role | Hex |
| --- | --- |
| Warm ivory | `#FAF1ED` |
| Warm paper | `#F5E8E7` |
| Blush | `#D9B4C7` |
| Lavender | `#C5ACDD` |
| Mauve | `#76556D` |
| Deep plum | `#342238` |
| Dark ink | `#38273C` |
| Muted ink | `#765F78` |

These are direction, not color values sampled or guaranteed from the image. Reconcile with existing tokens and verify contrast.

## Composition priorities
1. Header and baby selector
2. Current sleep/awake state and existing start/stop workflow
3. Sleep Wave with **real** previous sessions and optional Next Sleep
4. Existing Home content and navigation

## Graph semantics
- Each x-coordinate represents a timestamp within the shared time domain.
- Recorded intervals = actual duration; do not inflate short sessions.
- Active intervals = ongoing, not completed.
- Predicted interval = *possible onset window*, **not** predicted nap duration.
- Future waves only if a real forecast engine supports them. No made-up peaks.
- Consider multiple states (sleeping, awake with forecast, insufficient evidence) and explicit midnight handling.

## Scope
Visual Home redesign only. No modifications to sleep writes, analytics engines, RevenueCat, Live Activities, sound monitoring, or navigation behavior.
