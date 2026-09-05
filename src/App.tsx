import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
} from "react-router-dom";

import "./App.css";

import { useAppStore } from "./stores/appStore";
import { useTranslation } from "./i18n";

// Route-level code splitting: the default route (Home) no longer needs to
// download/parse the Analysis page's code (5 tabs plus the age-guide/
// personal-profile/prediction analytics, its heaviest surface) just to
// render. Each page becomes its own chunk, fetched on first visit.
const Home = lazy(() => import("./pages/Home"));
const History = lazy(() => import("./pages/History"));
const Analysis = lazy(() => import("./pages/Analysis"));
const Settings = lazy(() => import("./pages/Settings"));
const About = lazy(() => import("./pages/About"));

function App() {
  const { t } = useTranslation();
  const theme = useAppStore((state) => state.theme);

  return (
    <div data-theme={theme}>
      <BrowserRouter>
        <div className="app-shell">
          <Suspense fallback={<div className="empty-card">{t("common.loading")}</div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/history" element={<History />} />
              <Route path="/analysis" element={<Analysis />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/about" element={<About />} />
            </Routes>
          </Suspense>
        </div>

        <nav className="bottom-nav">
          <NavLink to="/">
            <span className="nav-icon">⌂</span>
            <span>{t("nav.home")}</span>
          </NavLink>

          <NavLink to="/history">
            <span className="nav-icon">◷</span>
            <span>{t("nav.history")}</span>
          </NavLink>

          <NavLink to="/analysis">
            <span className="nav-icon">⌁</span>
            <span>{t("nav.analysis")}</span>
          </NavLink>

          <NavLink to="/settings">
            <span className="nav-icon">⚙</span>
            <span>{t("nav.settings")}</span>
          </NavLink>
        </nav>
      </BrowserRouter>
    </div>
  );
}

export default App;