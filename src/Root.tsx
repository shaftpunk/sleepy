import { useEffect, useState } from "react";

import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import AuthGate from "./components/AuthGate";
import BabyLoader from "./components/BabyLoader";
import SplashScreen from "./components/SplashScreen";
import { useAppStore } from "./stores/appStore";
import { useLoadAliveStyles } from "./themes/alive/useLoadAliveStyles";
import { useLoadOutrunStyles } from "./themes/outrun/useLoadOutrunStyles";
import { HouseholdContextProvider } from "./households/HouseholdContextProvider";
import { EntitlementProvider } from "./entitlements/EntitlementProvider";
import { RevenueCatSession, RevenueCatHouseholdContext } from "./purchases/RevenueCatSession";

// The splash is a brief branding overlay, not a gate on real readiness.
// Previously it sat OUTSIDE the auth chain (in App.tsx) and blocked on the
// splash video's `onEnded` event (~5s) AFTER the session/household checks
// had already finished - a flat +5s tax stacked on top of the real load,
// not overlapping it. Now the real tree (AuthProvider -> AuthGate ->
// BabyLoader -> App) mounts and starts loading immediately, and the splash
// is rendered ON TOP of it for a short, bounded duration. Total time to a
// usable app is therefore max(SPLASH_DURATION_MS, real load time) instead
// of SPLASH_DURATION_MS + real load time. If real loading takes longer than
// this, AuthGate's own lightweight "Loading..." text takes over underneath
// - never an unbounded wait on the (decorative) splash.
const SPLASH_DURATION_MS = 700;

export default function Root() {
  const [showSplash, setShowSplash] = useState(true);
  const visualTheme = useAppStore((state) => state.visualTheme);
  const theme = useAppStore((state) => state.theme);
  const language = useAppStore((state) => state.language);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Applied to <html> (not a wrapping div) so every element - including
  // <body> itself, useful for covering mobile overscroll/bounce - is a
  // valid CSS descendant of `[data-visual-theme="outrun"]` in outrun.css.
  useEffect(() => {
    document.documentElement.dataset.visualTheme = visualTheme;
  }, [visualTheme]);

  // Colour scheme on <html> (a separate attribute, so existing [data-theme]
  // rules don't start matching <html>) lets the premium canvas cover iOS
  // overscroll. Premium also tints the browser/status chrome; Alive and Outrun
  // keep their previous behaviour (no theme-color).
  useEffect(() => {
    document.documentElement.dataset.appearance = theme;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][data-sleepy]');
    if (visualTheme !== "default") { meta?.remove(); return; }
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.dataset.sleepy = "";
      document.head.appendChild(meta);
    }
    meta.content = theme === "light" ? "#fbf3ef" : "#342238";
  }, [theme, visualTheme]);

  // Optional theme styles and assets are loaded only when selected, keeping
  // the original theme's initial bundle lean.
  useLoadOutrunStyles(visualTheme === "outrun");
  useLoadAliveStyles(visualTheme === "alive");

  return (
    <div data-theme={theme} lang={language === "no" ? "nb" : "en"}>
      <AuthProvider>
        <RevenueCatSession>
        <AuthGate>
          <BabyLoader>
            <HouseholdContextProvider>
              <RevenueCatHouseholdContext />
              <EntitlementProvider><App /></EntitlementProvider>
            </HouseholdContextProvider>
          </BabyLoader>
        </AuthGate>
        </RevenueCatSession>
      </AuthProvider>

      {showSplash && <SplashScreen />}
    </div>
  );
}
