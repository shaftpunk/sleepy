import { useEffect } from "react";

export function useLoadAliveStyles(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    import("./alive.css").catch((error) => {
      console.error("Could not load Alive theme styles:", error);
    });
  }, [active]);
}
