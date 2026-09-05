// Small blocky inline-SVG icon set for the retro theme's nav (and anywhere
// else a themed icon is useful). Deliberately simple geometric shapes
// rendered with crisp edges rather than a bespoke pixel-grid art set - this
// is a CSS/presentation theme, not a new icon-design project, and simple
// shapes read clearly at nav-icon size.

export type PixelIconName =
  | "home"
  | "feed"
  | "analysis"
  | "history"
  | "settings"
  | "about";

type Props = {
  name: PixelIconName;
  size?: number;
};

const PATHS: Record<PixelIconName, string> = {
  // A simple bed: headboard + mattress block + legs.
  home: "M2 7H14V12H2V7Z M1 12H2V13H1V12Z M14 12H15V13H14V12Z M3 5H5V7H3V5Z",
  // A bottle: neck + body.
  feed: "M6 2H10V4H11V13H5V4H6V2Z M7 5H9V6H7V5Z",
  // A bar chart: three bars of increasing height.
  analysis: "M2 10H5V14H2V10Z M6.5 6H9.5V14H6.5V6Z M11 2H14V14H11V2Z",
  // A scroll: rolled ends + body.
  history: "M3 3H13V13H3V3Z M2 3H3V13H2V3Z M13 3H14V13H13V3Z M4 5H12V6H4V5Z M4 8H12V9H4V8Z M4 11H9V12H4V11Z",
  // A gear: ring with teeth notches.
  settings: "M6 2H10V3H6V2Z M6 13H10V14H6V13Z M2 6H3V10H2V6Z M13 6H14V10H13V6Z M4 4H12V12H4V4Z M6.5 6.5H9.5V9.5H6.5V6.5Z",
  // A small heart.
  about: "M3 4H6V3H10V4H13V7H12V9H11V10H10V11H9V12H7V11H6V10H5V9H4V7H3V4Z",
};

export default function PixelIcon({ name, size = 16 }: Props) {
  return (
    <svg
      className="pixel-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d={PATHS[name]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
