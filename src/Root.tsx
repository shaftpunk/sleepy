import { useEffect, useState } from "react";

import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import AuthGate from "./components/AuthGate";
import BabyLoader from "./components/BabyLoader";
import SplashScreen from "./components/SplashScreen";
import { useAppStore } from "./stores/appStore";
import { useLoadRetroStyles } from "./themes/retro/useLoadRetroStyles";

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

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Applied to <html> (not a wrapping div) so every element - including
  // <body> itself, useful for covering mobile overscroll/bounce - is a
  // valid CSS descendant of `[data-visual-theme="retro"]` in retro.css.
  useEffect(() => {
    document.documentElement.dataset.visualTheme = visualTheme;
  }, [visualTheme]);

  // Loaded on demand (see useLoadRetroStyles) so choosing "Original Sleepy"
  // never downloads a single byte of retro.css.
  useLoadRetroStyles(visualTheme === "retro");

  return (
    <>
      <AuthProvider>
        <AuthGate>
          <BabyLoader>
            <App />
          </BabyLoader>
        </AuthGate>
      </AuthProvider>

      {showSplash && <SplashScreen />}
    </>
  );
}
