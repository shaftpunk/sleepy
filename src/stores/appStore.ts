import { create } from "zustand";

export type BabyId = "Hamar" | "Drammen";
export type ThemeMode = "dark" | "light";

export interface Baby {
  id: string;
  name: string;
  birth_date: string | null;
}

type AppState = {
  // Existing Sleepy data
  currentBbyId: BabyId;
  theme: ThemeMode;

  setBbyId: (bbyid: BabyId) => void;
  toggleTheme: () => void;

  // Sleepy 3.0
  babies: Baby[];
  currentBabyId: string | null;

  setBabies: (babies: Baby[]) => void;
  setCurrentBabyId: (babyId: string) => void;
};

const savedBbyId =
  (localStorage.getItem("sleepy_bbyid") as BabyId) || "Hamar";

const savedTheme =
  (localStorage.getItem("sleepy_theme") as ThemeMode) || "dark";

const savedBabyId =
  localStorage.getItem("sleepy_current_baby_id");

export const useAppStore = create<AppState>((set) => ({
  // --------------------------------------------------
  // Existing Sleepy state
  // --------------------------------------------------

  currentBbyId: savedBbyId,
  theme: savedTheme,

  setBbyId: (bbyid) => {
    localStorage.setItem("sleepy_bbyid", bbyid);

    set({
      currentBbyId: bbyid,
    });
  },

  toggleTheme: () =>
    set((state) => {
      const newTheme =
        state.theme === "dark" ? "light" : "dark";

      localStorage.setItem(
        "sleepy_theme",
        newTheme,
      );

      return {
        theme: newTheme,
      };
    }),

  // --------------------------------------------------
  // Sleepy 3.0
  // --------------------------------------------------

  babies: [],

  currentBabyId: savedBabyId,

  setBabies: (babies) => {
    set({
      babies,
    });
  },

  setCurrentBabyId: (babyId) => {
    localStorage.setItem(
      "sleepy_current_baby_id",
      babyId,
    );

    set({
      currentBabyId: babyId,
    });
  },
}));