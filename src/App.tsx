import { useState } from "react";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
} from "react-router-dom";

import "./App.css";

import Home from "./pages/Home";
import History from "./pages/History";
import Analysis from "./pages/Analysis";
import Settings from "./pages/Settings";
import About from "./pages/About";
import SplashScreen from "./components/SplashScreen";

import { useAppStore } from "./stores/appStore";
import { useTranslation } from "./i18n";

function App() {
  const { t } = useTranslation();
  const theme = useAppStore((state) => state.theme);
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return (
      <SplashScreen
        onFinished={() => setShowSplash(false)}
      />
    );
  }

  return (
    <div data-theme={theme}>
      <BrowserRouter>
        <div className="app-shell">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/history" element={<History />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/about" element={<About />} />
          </Routes>
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