import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Sensitivity } from "../sound/detector";

type SoundSettings = {
  enabled: boolean;
  sensitivity: Sensitivity;
  setEnabled: (enabled: boolean) => void;
  setSensitivity: (sensitivity: Sensitivity) => void;
};

export const useSoundStore = create<SoundSettings>()(persist((set) => ({
  enabled: false, sensitivity: "medium",
  setEnabled: (enabled) => set({ enabled }),
  setSensitivity: (sensitivity) => set({ sensitivity }),
}), {
  name: "sleepy_sound_preferences_v1",
  partialize: ({ enabled, sensitivity }) => ({ enabled, sensitivity }),
  merge: (saved, current) => {
    const data = saved as Partial<SoundSettings> | null;
    return { ...current, enabled: data?.enabled === true,
      sensitivity: data?.sensitivity === "low" || data?.sensitivity === "high" ? data.sensitivity : "medium" };
  },
}));
