import { useAppStore } from "../stores/appStore";
import NotificationSettings from "../components/NotificationSettings";
import FamilySettings from "../components/FamilySettings";
import { useTranslation } from "../i18n";

export default function Settings() {
  const { t } = useTranslation();

  const currentBbyId = useAppStore(
    (state) => state.currentBbyId,
  );

  const setBbyId = useAppStore(
    (state) => state.setBbyId,
  );

  const theme = useAppStore(
    (state) => state.theme,
  );

  const toggleTheme = useAppStore(
    (state) => state.toggleTheme,
  );

  const babies = useAppStore(
    (state) => state.babies,
  );

  const currentBabyId = useAppStore(
    (state) => state.currentBabyId,
  );

  const setCurrentBabyId = useAppStore(
    (state) => state.setCurrentBabyId,
  );

  const language = useAppStore(
    (state) => state.language,
  );

  const setLanguage = useAppStore(
    (state) => state.setLanguage,
  );

  const selectedBaby =
    babies.find(
      (baby) => baby.id === currentBabyId,
    ) ?? null;

  return (
    <main className="settings-page">
      <header className="page-header">
        <p className="eyebrow">{t("common.appName")}</p>

        <h1>{t("settings.pageTitle")}</h1>

        <p className="page-description">
          {t("settings.pageDescription")}
        </p>
      </header>

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">
            {t("settings.babyTitle")}
          </p>

          <p className="muted">
            {t("settings.babyProfileNote")}
          </p>

          {selectedBaby?.birth_date && (
            <p className="muted">
              {t("settings.dateOfBirth", { date: selectedBaby.birth_date })}
            </p>
          )}
        </div>

        {babies.length > 0 ? (
          <select
            className="settings-select"
            value={currentBabyId ?? ""}
            onChange={(event) =>
              setCurrentBabyId(
                event.target.value,
              )
            }
          >
            {babies.map((baby) => (
              <option
                key={baby.id}
                value={baby.id}
              >
                {baby.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">
            {t("settings.noBabiesFound")}
          </p>
        )}
      </section>

      <FamilySettings />

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">
            {t("settings.locationTitle")}
          </p>

          <p className="muted">
            {t("settings.legacyProfileNote")}
          </p>
        </div>

        <select
          className="settings-select"
          value={currentBbyId}
          onChange={(event) =>
            setBbyId(
              event.target.value as
                | "Hamar"
                | "Drammen",
            )
          }
        >
          <option value="Hamar">
            Hamar
          </option>

          <option value="Drammen">
            Drammen
          </option>
        </select>
      </section>

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">
            {t("settings.appearanceTitle")}
          </p>

          <p className="muted">
            {t("settings.currentTheme", {
              theme: theme === "dark" ? t("settings.themeDark") : t("settings.themeLight"),
            })}
          </p>
        </div>

        <button
          className="secondary-button"
          onClick={toggleTheme}
        >
          {theme === "dark"
            ? t("settings.useLightMode")
            : t("settings.useDarkMode")}
        </button>
      </section>

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">
            {t("settings.languageTitle")}
          </p>

          <p className="muted">
            {t("settings.languageNote")}
          </p>
        </div>

        <div className="side-buttons">
          <button
            type="button"
            className={
              language === "no"
                ? "side-button active"
                : "side-button"
            }
            onClick={() => setLanguage("no")}
          >
            Norsk
          </button>

          <button
            type="button"
            className={
              language === "en"
                ? "side-button active"
                : "side-button"
            }
            onClick={() => setLanguage("en")}
          >
            English
          </button>
        </div>
      </section>

      <NotificationSettings
        bbyid={currentBbyId}
      />

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">
            {t("settings.aboutTitle")}
          </p>

          <p className="muted">
            {t("settings.aboutVersion")}
          </p>
        </div>
      </section>
    </main>
  );
}
