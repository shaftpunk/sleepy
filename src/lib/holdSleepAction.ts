import { HOLD_DELAY_MS, HOLD_STEP_MS } from "./sleepActionTime";

type Options = {
  maximum: () => number;
  select: (minutes: number) => void;
  haptic: () => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clear?: (timer: ReturnType<typeof setTimeout>) => void;
};
// One pointer gesture, shared by Start and Wake up. Click/keyboard activation is
// handled by the semantic button; a hold/cancellation suppresses that click.
export function createSleepHold(options: Options) {
  const schedule = options.schedule ?? setTimeout, clear = options.clear ?? clearTimeout;
  let phase: "idle" | "pressing" | "holding" | "cancelled" = "idle";
  let minutes = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const stopTimer = () => { if (timer !== undefined) clear(timer); timer = undefined; };
  const cancel = () => { stopTimer(); phase = "cancelled"; minutes = 0; options.select(0); };
  const step = () => {
    const maximum = Math.floor(options.maximum() / 5) * 5;
    if (maximum < 5) { cancel(); return; }
    phase = "holding";
    const next = Math.min(maximum, minutes + 5);
    if (next !== minutes) { minutes = next; options.select(minutes); options.haptic(); }
    timer = schedule(step, HOLD_STEP_MS);
  };
  return {
    begin() { stopTimer(); phase = "pressing"; minutes = 0; timer = schedule(step, HOLD_DELAY_MS); },
    cancel,
    release(): { kind: "tap" | "hold" | "cancel"; minutes: number } {
      stopTimer();
      const result = { kind: phase === "pressing" ? "tap" : phase === "holding" ? "hold" : "cancel", minutes } as const;
      phase = "idle"; options.select(0); return result;
    },
    dispose() { stopTimer(); phase = "idle"; },
  };
}
