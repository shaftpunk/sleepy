import PredictionReminderLifecycle from "./components/PredictionReminderLifecycle";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import "./App.css";
import "./mobile.css";
import "./styles/premium-theme.css";

import { useAppStore } from "./stores/appStore";
import { useTranslation } from "./i18n";
import PixelIcon from "./themes/outrun/PixelIcon";
import NativePushNavigation from "./components/NativePushNavigation";
import NativeSoundLifecycle from "./components/NativeSoundLifecycle";
import SleepLiveActivityLifecycle from "./components/SleepLiveActivityLifecycle";
import HouseholdContextSelector from "./households/HouseholdContextSelector";

const Home = lazy(() => import("./pages/Home"));
const History = lazy(() => import("./pages/History"));
const Settings = lazy(() => import("./pages/Settings"));
const About = lazy(() => import("./pages/About"));

type AliveBackground = "morning" | "day" | "evening" | "night";

function getAliveBackground(date = new Date()): AliveBackground {
  const hour = date.getHours();

  if (hour >= 6 && hour < 8) return "morning";
  if (hour >= 8 && hour < 16) return "day";
  if (hour >= 16 && hour < 18) return "evening";
  return "night";
}

function ShellHouseholdSelector() {
  const { pathname } = useLocation();
  return /^\/settings(?:\/|$)/i.test(pathname) ? null : <HouseholdContextSelector />;
}

function LegacyHistoryRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "/log", search, hash }} replace />;
}

function App() {
  const { t } = useTranslation();
  const theme = useAppStore((state) => state.theme);
  const visualTheme = useAppStore((state) => state.visualTheme);
  const isOutrun = visualTheme === "outrun";
  const [aliveBackground, setAliveBackground] = useState(getAliveBackground);

  useEffect(() => {
    const updateAliveBackground = () => {
      setAliveBackground(getAliveBackground());
    };

    const timer = window.setInterval(updateAliveBackground, 30_000);
    document.addEventListener("visibilitychange", updateAliveBackground);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateAliveBackground);
    };
  }, []);

  function navIcon(name: "home" | "log" | "settings", glyph: string) {
    return isOutrun ? <PixelIcon name={name} /> : glyph;
  }

  return (
    <div
      data-theme={theme}
      data-alive-background={
        visualTheme === "alive" ? aliveBackground : undefined
      }
    >
      <BrowserRouter>
        <NativePushNavigation />
        <NativeSoundLifecycle />
        <PredictionReminderLifecycle />
        <SleepLiveActivityLifecycle />
        <div className="app-shell">
          <ShellHouseholdSelector />
          <Suspense fallback={<div className="empty-card">{t("common.loading")}</div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/log" element={<History />} />
              <Route path="/settings">
                <Route index element={<Settings />} />
                <Route path="family" element={<Settings section="family" />} />
                <Route path="notifications" element={<Settings section="notifications" />} />
                <Route path="notifications/sound" element={<Settings section="sound" />} />
                <Route path="appearance" element={<Settings section="appearance" />} />
                <Route path="plus" element={<Settings section="plus" />} />
                <Route path="account" element={<Settings section="account" />} />
                <Route path="about" element={<About />} />
              </Route>
              <Route path="/history" element={<LegacyHistoryRedirect />} />
              <Route path="/analysis" element={<Navigate to="/" replace />} />
              <Route path="/about" element={<Navigate to="/settings/about" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>

        <nav className="bottom-nav">
          <NavLink to="/" end>
            <span className="nav-icon" aria-hidden="true">{navIcon("home", "⌂")}</span>
            <span>{t("nav.home")}</span>
          </NavLink>

          <NavLink to="/log">
            <span className="nav-icon" aria-hidden="true">{navIcon("log", "?")}</span>
            <span>{t("nav.log")}</span>
          </NavLink>

          <NavLink to="/settings">
            <span className="nav-icon" aria-hidden="true">{navIcon("settings", "⚙")}</span>
            <span>{t("nav.settings")}</span>
          </NavLink>
        </nav>
      </BrowserRouter>
    </div>
  );
}

export default App;
