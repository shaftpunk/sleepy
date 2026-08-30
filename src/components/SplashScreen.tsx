import "./SplashScreen.css";

type SplashScreenProps = {
  onFinished: () => void;
};

export default function SplashScreen({
  onFinished,
}: SplashScreenProps) {
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

        <div className="loading-dots" aria-label="Loading">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}