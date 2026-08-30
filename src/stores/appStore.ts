import { create } from "zustand";

export type BabyId = "Hamar" | "Drammen";
export type ThemeMode = "dark" | "light";

type AppState = {
  currentBbyId: BabyId;
  theme: ThemeMode;
  setBbyId: (bbyid: BabyId) => void;
  toggleTheme: () => void;
};

const savedBbyId =
  (localStorage.getItem("sleepy_bbyid") as BabyId) || "Hamar";

const savedTheme =
  (localStorage.getItem("sleepy_theme") as ThemeMode) || "dark";

export const useAppStore = create<AppState>((set) => ({
  currentBbyId: savedBbyId,
  theme: savedTheme,

  setBbyId: (bbyid) => {
    localStorage.setItem("sleepy_bbyid", bbyid);
    set({ currentBbyId: bbyid });
  },

  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === "dark" ? "light" : "dark";
      localStorage.setItem("sleepy_theme", newTheme);

      return {
        theme: newTheme,
      };
    }),
}));