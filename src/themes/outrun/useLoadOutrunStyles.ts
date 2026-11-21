import { useEffect } from "react";

// Dynamically imports the outrun stylesheet only when the outrun theme is
// actually selected, so the default theme's bundle/load time is completely
// unaffected (outrun.css never downloads unless a user opts in). A failed
// import (e.g. offline after the first successful load was cached) is
// swallowed - per "if a outrun asset is unavailable, it must not prevent the
// app from functioning," the app just continues without the extra styling
// rather than throwing.
export function useLoadOutrunStyles(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    import("./outrun.css").catch((error) => {
      console.error("Could not load outrun theme styles:", error);
    });
  }, [active]);
}
