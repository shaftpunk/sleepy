# Codex prompt: Sleepy Premium Home (visual pass)

Inspect the existing Sleepy Home page, Sleep Wave components/styles, current theme tokens and responsive tests. Use `design/sleepy-premium/reference/sleep-wave-approved.png` as the approved **visual** direction. The accompanying chart/card crops provide visual detail. Review `guides/DESIGN-SPEC.md`.

**Goal:** make the actual Home screen cohesive with the reference's warm ivory, blush, lavender, muted plum editorial luxury styling. Preserve all existing functionality and semantic data fidelity.

**Small iteration rule:** Start ONLY with Home-level light theme color/surface harmonization and the immediate controls around Sleep Wave. Map values into existing design tokens; do not import the sample reference CSS directly. Leave layout geometry, React behavior, Sleep Wave chart paths/positions, and prediction algorithm unchanged. Implement warm complementary dark mode styling only where needed for token consistency. Avoid unrelated pages.

**Before changes:** report what existing selectors/theme variables are involved, which Home background is currently setting the navy/purple tone, and the exact proposed file scope.

**After changes:** provide changed file list, before/after screenshot comparisons if browser capture is available (same viewport and same fixture state), 320–430px checks in NO/EN and both themes, contrast results, test/build results and any visual gaps. No commits, pushes or releases.

**Non-negotiable:** no fabricated naps, probabilities, times or chart geometry for aesthetics; no altered tracking interactions; no new font or UI dependency without strong justification; maintain reduced motion and accessible text.

Stop after this visual pass. Subsequent iterations can refine layout, graph visual treatments and typography separately.
