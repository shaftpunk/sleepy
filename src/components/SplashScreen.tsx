import "./SplashScreen.css";
import { useTranslation } from "../i18n";

// A brief branding overlay only - it is not, and must not become, a gate on
// app readiness (see main.tsx for why: it's shown concurrently with the
// real auth/data loading, for a short fixed duration, not in sequence
// before or after it). The video autoplays for atmosphere but nothing waits
// on it finishing.
export default function SplashScreen() {
  const { t } = useTranslation();

  return (
    <div className="splash-screen">
      <div className="splash-content">
        <h1>Sleepy?</h1>

        <video
          className="splash-video"
          src="/sleep.mp4"
          autoPlay
          muted
          playsInline
        />

        <div className="loading-dots" aria-label={t("common.loading")}>
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}