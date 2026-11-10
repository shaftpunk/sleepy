# Sleepy mobile UI polish audit

Scope: presentation and keyboard accessibility only. The route inventory is
App (Home, History, Analysis, Settings, About), AuthGate (loading/error, Auth,
Onboarding), their forms/modals, shared navigation and optional visual skins.
There is no separate subscription screen in the current reachable route tree.

## Screen and component findings

| Surface | Finding | Resolution |
| --- | --- | --- |
| Home, awake/active sleep | Long names competed with status; minute picker/control widths were rigid; feed action competed with copy | Wrapping header; fluid picker, stacked at narrow widths; full-width card action on phones; full-width numeric field |
| Sleep start/stop | Inconsistent numeric field size and border; cramped Norwegian label | Shared 48px field and spacing; original 44px wheel rows/scroll semantics retained |
| Feeding registration/edit | Narrow type/side choices; double-framed amount field; date input intrinsic sizing; unlabelled close | Flexible columns, one amount outline, constrained native date field, accessible dialog/close |
| Home feeding history | 34px delete target and potentially long notes | 44px target, destructive contrast, wrapping note text |
| Family message modal | Two long quick actions competed at 320px; footer action width; no viewport scrolling | Stacked narrow actions/footer; common scrolling surface and focus handling; sending close restriction preserved |
| History | Resume/split/delete crowded time/date text; header actions competed; clickable divs lacked keyboard access | Separate action row on phones; responsive header group; semantic edit buttons and labelled icon actions |
| Sleep detail/edit, manual entry, split | Only Sleep Detail had scrolling protection; close icons were undersized/unlabelled | Shared safe-area viewport modal styles for all; labelled dialogs; 44px icons; focus confinement/Escape/restore |
| Sound Monitoring states | Dense status/helper text and inconsistent card/button styling | Shared surface/spacing and full-width actions; readable helper text; native lifecycle/detector untouched |
| Sound Activity | Existing clipping/lanes/minimum widths were responsive | No timeline-specific changes; existing event interaction and empty/error semantics retained |
| Analysis: Overview | Dense 3-column metrics, long confidence badges, nested empty cards | Two-column readable metrics (single-column KPIs at 320px), wrapping headings/badges, flattened empty treatments |
| Analysis: Day | Wake-window comparisons cramped on narrow phones | Stacked narrow comparison grid; wrapping bar labels/value rows |
| Analysis: Month | Total badge competed with heading | Wrapping heading; stacked narrow footer; bars/calculations unchanged |
| Analysis: Insight/Feeding | Long secondary text and dense metric grids | Shared readable metric layout, helper sizing and gaps |
| Settings: Baby/Family | Already polished; common tokens were local; long IDs could overflow notification heading | Reused shared tokens; preserved card/field layouts; wrapping identifiers |
| Settings: Notifications | Toggle could shrink beside long copy; different form heights | Fixed toggle hit region and shared heights; no preference/push logic changes |
| Settings: Appearance/Account | Already polished responsive controls and long account-name handling | No screen-specific markup changes; shared primitive/focus updates only |
| Login, registration, recovery/reset | Nested 24px/28px padding wasted 320px width; browser-style link buttons; squeezed tab labels | Compact safe-area card, coherent links/fields, stacked very narrow tabs, selected-state semantics |
| Onboarding/create family | Rigid inline two-column mode buttons; narrow native date field | Class-based responsive mode group; full-width native field and shared rhythm |
| Join invitation | Fields outside Settings lacked its form layout | Shared labelled-field layout, readable long tokens/errors; join behavior unchanged |
| AuthGate loading/error | Long errors/headings could crowd narrow card | Shared wrapping/card sizing and theme applied before authenticated App |
| About | Card spacing/type inherited older defaults | Shared card rhythm and readable body line-height; no content/route changes |
| Splash | Existing responsive video/title fit | No component-specific changes; reduced-motion dots honored |
| 24-hour sleep ring | Already responsive with accessible picker/details | No ring/interaction/calculation changes; shared select/focus styling only |
| Native confirm dialogs | Existing platform confirm for delete/resume | Left intact; no custom replacement |
| BabyLoader, background/native lifecycle components | No independent visual controls | Audited; no changes |

## Shared rules

`src/mobile.css` extracts Settings' existing dimensions into shared tokens:
48px primary controls, 44px icon targets, 12px control radius, 20px card radius,
16px gaps, 18px/16px card padding, purple focus and existing light/dark palette.
Primary purple is slightly deeper for readable white labels; active Analysis
labels and light-theme metric/helper text no longer inherit low-contrast colors.
Settings aliases those tokens instead of defining a competing set. Optional
Alive artwork/Retro styling remain in their existing owners.

No page-level overflow hiding is added. Intrinsic sizing is fixed with min-width,
fluid grids and deliberate stacking. Legitimate wheel, event-lane and modal
scrolling remains. Native date/time/select pickers are retained. Input text is
16px where needed to avoid iOS focus zoom.

App safe-area/bottom-navigation budgets already existed and remain single-owner.
Auth gets its own safe-area budget, and every modal gets one viewport-contained
scroll area. The root now applies the existing theme/language to unauthenticated
screens too; auth/session behavior is unchanged. No keyboard keepalive or native
configuration changes are introduced.

## Reproducible layout verification

`tests/mobile-layout.cjs` renders actual components with synthetic service results,
blocks external network requests, and never writes application data. It launches
its own local Vite server. Use an existing Playwright installation (no app
dependency added):

```text
node tests/mobile-layout.cjs <path-to-playwright-module>
node tests/mobile-layout.cjs <path-to-playwright-module> --quick --skin=alive
node tests/mobile-layout.cjs <path-to-playwright-module> --quick --skin=retro
```

Optional environment variables: SLEEPY_CHROMIUM_PATH selects an installed browser;
SLEEPY_LAYOUT_PORT selects the test server port. Screenshots/reports are written
under the system temporary directory, not committed application assets.

The main matrix covers 320x568, 375x667, 390x844 and 430x932 in Norwegian/English,
light/dark: every route, all Analysis/Settings tabs, native/web auth modes,
onboarding create/join, modals, expanded add-child/invitation code, sound states,
empty/error/loading states and a reduced viewport to approximate the keyboard.
Checks include page/control overflow, touch/control heights, clipped buttons,
bottom-nav clearance, modal bounds, keyboard-opened sleep detail, focus wrapping,
Escape and focus restoration. Safe-area emulation additionally checks real CSS
env() values with 44px top/34px bottom insets. Optional skins get narrow smoke tests.

## Deliberately separate follow-up

Real iOS keyboard, native date picker presentation, Dynamic Type, VoiceOver and
landscape/split-screen need physical-device validation; Chromium is not WKWebView.
Month bars still expose their existing detailed values through title tooltips:
a dedicated mobile chart drill-down would be a separate interaction feature.
No sleep/sound/push/auth/API/schema calculations or persistence were changed.

## Validation results for this pass

- Lint: zero errors; existing Home effect-dependency warning remains.
- Complete Node suite: 89 passed.
- Requested four-size, two-language, two-theme matrix: 712 screen/state checks,
  including repeated safe-area checks, passed.
- Alive/Retro narrow smoke checks: 180 passed.
- Final Analysis layout/primary-action contrast checks across the full matrix:
  82 passed. Enabled solid primary/Analysis actions are checked at 4.5:1 contrast.
- Existing Settings (32) and sleep-clock (48) browser scenarios passed; existing
  Sound Activity and native sound-panel layout/interaction checks also passed.
- Production build, native Vite build and Capacitor sync passed; copied native
  web assets match dist-ios. No tracked native configuration change resulted.
- git diff --check passed. No dependencies, commits, pushes or deployments.

Screenshots were inspected for the major routes/forms in both palettes; all
matrix configurations also received automated geometry/interaction checks.
Existing build chunk-size/Workbox deprecation warnings were not part of this UI pass.
