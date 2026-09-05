// A small blocky pixel-art sprite for the retro theme's Home status panel -
// purely decorative, mirrors the reference image's centerpiece. Two simple
// states (sleeping / awake); no animation logic, no data of its own - the
// caller (Home.tsx) passes whether the baby is currently asleep.

type Props = {
  asleep: boolean;
};

export default function BabySprite({ asleep }: Props) {
  return (
    <svg
      className="baby-sprite"
      width={72}
      height={72}
      viewBox="0 0 24 24"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {/* blanket */}
      <path d="M4 15H20V21H4V15Z" fill="#8f74df" />
      <path d="M4 15H20V17H4V15Z" fill="#a68deb" />
      {/* pillow */}
      <path d="M3 17H9V21H3V17Z" fill="#f3ecff" opacity="0.9" />
      {/* head */}
      <path d="M8 6H16V14H8V6Z" fill="#f3c7a0" />
      <path d="M8 6H16V8H8V6Z" fill="#5a3d2b" />
      <path d="M6 7H8V10H6V7Z" fill="#5a3d2b" />

      {asleep ? (
        <>
          {/* closed eyes */}
          <path d="M10 10H12V10.6H10V10Z" fill="#5a3d2b" />
          <path d="M13 10H15V10.6H13V10Z" fill="#5a3d2b" />
          {/* "z z z" */}
          <text x="16" y="6" fontSize="4" fill="#dbe0ff" fontFamily="monospace">z</text>
          <text x="18.5" y="4" fontSize="3" fill="#dbe0ff" fontFamily="monospace">z</text>
        </>
      ) : (
        <>
          {/* open eyes */}
          <path d="M10 9.4H11.4V10.8H10V9.4Z" fill="#3a2415" />
          <path d="M13 9.4H14.4V10.8H13V9.4Z" fill="#3a2415" />
        </>
      )}

      {/* small smile */}
      <path d="M10.5 12H13.5V12.6H10.5V12Z" fill="#c98a6b" />
    </svg>
  );
}
