import { useEffect } from "react";

// Dynamically imports the retro stylesheet only when the retro theme is
// actually selected, so the default theme's bundle/load time is completely
// unaffected (retro.css never downloads unless a user opts in). A failed
// import (e.g. offline after the first successful load was cached) is
// swallowed - per "if a retro asset is unavailable, it must not prevent the
// app from functioning," the app just continues without the extra styling
// rather than throwing.
export function useLoadRetroStyles(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    import("./retro.css").catch((error) => {
      console.error("Could not load retro theme styles:", error);
    });
  }, [active]);
}
