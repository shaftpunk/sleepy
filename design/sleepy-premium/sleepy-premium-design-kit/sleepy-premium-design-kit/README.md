# Sleepy Premium Design Kit — approved direction

This package is **design guidance, not drop-in application code**. The image `reference/sleep-wave-approved.png` is the primary visual reference (original concept supplied in the conversation). The close-ups are crops of that same illustration.

## Intended use
1. Copy this folder into `design/sleepy-premium/` in the Sleepy repository.
2. Give Codex `guides/CODEX-BRIEF.md`, pointing it to the reference image.
3. Ask Codex to **inspect existing Home/Theme/SleepWave CSS before edits**. Do not copy palette variables blindly into app files: map them onto the existing token system.
4. Implement in small visual iterations. Start with a cohesive **light** Home palette, not sleep-logic changes.
5. Compare real iPhone/browser captures with the approved reference. Validate both themes.

## Contents
- `reference/sleep-wave-approved.png`: approved concept, for visual comparison only
- `reference/sleep-wave-chart-detail.png`: graph crop
- `reference/sleep-wave-card-detail.png`: card crop
- `guides/DESIGN-SPEC.md`: color, typography, composition, and information hierarchy
- `guides/CODEX-BRIEF.md`: implementation prompt
- `guides/QA-CHECKLIST.md`: acceptance checklist
- `tokens.reference.css`: non-production starting palette, not a replacement for your existing CSS

## Critical caveat
The illustration is NOT a data specification. It contains future naps and other decorative labels. **Never fabricate forecasts, durations, probability curves, or session data to match the reference.** Retain existing tracking behavior, session normalization, and prediction logic. Preserve live accessibility and responsiveness.
