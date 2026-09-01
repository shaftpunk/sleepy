import "./SplashScreen.css";
import { useTranslation } from "../i18n";

type SplashScreenProps = {
  onFinished: () => void;
};

export default function SplashScreen({
  onFinished,
}: SplashScreenProps) {
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
          onEnded={onFinished}
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