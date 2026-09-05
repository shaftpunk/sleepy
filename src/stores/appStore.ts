import { create } from "zustand";

import type { Language } from "../i18n/types";

export type BabyId = "Hamar" | "Drammen";
export type ThemeMode = "dark" | "light";

// The *visual skin* of the whole app - orthogonal to ThemeMode (which is
// just light/dark within a skin). Deliberately not a closed union of
// exactly two values in spirit: additional skins (e.g. "gameboy", "pastel")
// can be added later by extending this type and adding another CSS module
// under src/themes/, without changing how switching/persistence works.
export type VisualTheme = "default" | "retro";

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

  // i18n
  language: Language;
  setLanguage: (lang: Language) => void;

  // Visual theme (skin) - see VisualTheme above
  visualTheme: VisualTheme;
  setVisualTheme: (visualTheme: VisualTheme) => void;
};

const savedBbyId =
  (localStorage.getItem("sleepy_bbyid") as BabyId) || "Hamar";

const savedTheme =
  (localStorage.getItem("sleepy_theme") as ThemeMode) || "dark";

const savedBabyId =
  localStorage.getItem("sleepy_current_baby_id");

// Norwegian is the default for a fresh install and for any existing user
// with no saved preference.
const savedLanguage =
  (localStorage.getItem("sleepy_language") as Language) || "no";

// "default" (the existing, unchanged Sleepy look) for a fresh install and
// for any existing user with no saved preference - retro is strictly opt-in.
const savedVisualTheme =
  (localStorage.getItem("sleepy_visual_theme") as VisualTheme) || "default";

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

  // --------------------------------------------------
  // i18n
  // --------------------------------------------------

  language: savedLanguage,

  setLanguage: (lang) => {
    localStorage.setItem("sleepy_language", lang);

    set({
      language: lang,
    });
  },

  // --------------------------------------------------
  // Visual theme (skin)
  // --------------------------------------------------

  visualTheme: savedVisualTheme,

  setVisualTheme: (visualTheme) => {
    localStorage.setItem("sleepy_visual_theme", visualTheme);

    set({
      visualTheme,
    });
  },
}));