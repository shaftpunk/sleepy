import { useTranslation } from "../i18n";

export default function About() {
    const { t } = useTranslation();

    return (
      <main className="about-page">
        <header className="page-header">
          <p className="eyebrow">{t("common.appName")}</p>
          <h1>{t("about.pageTitle")}</h1>
          <p className="page-description">
            {t("about.pageDescription")}
          </p>
        </header>

        <section className="about-hero">
          <div className="about-moon">☾</div>
          <h2>Sleepy 2.0</h2>
          <h2>v.2.2.0</h2>
          <p>{t("about.heroTagline")}</p>
        </section>

        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">{t("about.sleepTrackingTitle")}</p>
            <p className="muted">
              {t("about.sleepTrackingDescription")}
            </p>
          </div>
        </section>

        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">{t("about.feedingTitle")}</p>
            <p className="muted">
              {t("about.feedingDescription")}
            </p>
          </div>
        </section>

        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">{t("about.analysisTitle")}</p>
            <p className="muted">
              {t("about.analysisDescription")}
            </p>
          </div>
        </section>

        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">{t("about.realtimeTitle")}</p>
            <p className="muted">
              {t("about.realtimeDescription")}
            </p>
          </div>
        </section>

        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">{t("about.profilesTitle")}</p>
            <p className="muted">
              {t("about.profilesDescription")}
            </p>
          </div>
        </section>

        <p className="about-version">
          {t("about.footer")}
        </p>
      </main>
    );
  }