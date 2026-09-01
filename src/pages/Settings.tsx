import { useState } from "react";

import { useAppStore } from "../stores/appStore";
import NotificationSettings from "../components/NotificationSettings";
import FamilySettings from "../components/FamilySettings";
import { useTranslation } from "../i18n";
import { isValidBirthDateInput } from "../analytics/localDate";
import { updateBabyBirthDate } from "../services/householdService";

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

  const setBabies = useAppStore(
    (state) => state.setBabies,
  );

  const selectedBaby =
    babies.find(
      (baby) => baby.id === currentBabyId,
    ) ?? null;

  const [birthDateInput, setBirthDateInput] = useState(
    selectedBaby?.birth_date ?? "",
  );

  const [birthDateError, setBirthDateError] = useState<string | null>(null);
  const [birthDateMessage, setBirthDateMessage] = useState<string | null>(null);
  const [savingBirthDate, setSavingBirthDate] = useState(false);

  // Changing the selected profile must show THAT baby's own birth date, not
  // whatever was left over in the input from the previous profile. Adjusted
  // during render (React's recommended pattern for "reset state when a key
  // prop changes") rather than in an effect, which would commit the stale
  // value for one frame before resetting it.
  const [renderedBabyId, setRenderedBabyId] = useState(currentBabyId);

  if (renderedBabyId !== currentBabyId) {
    setRenderedBabyId(currentBabyId);
    setBirthDateInput(selectedBaby?.birth_date ?? "");
    setBirthDateError(null);
    setBirthDateMessage(null);
  }

  async function handleSaveBirthDate() {
    if (!currentBabyId) return;

    setBirthDateMessage(null);

    if (!isValidBirthDateInput(birthDateInput, Date.now())) {
      setBirthDateError(
        birthDateInput
          ? t("settings.birthDateFuture")
          : t("settings.birthDateInvalid"),
      );
      return;
    }

    const normalized = birthDateInput || null;

    try {
      setSavingBirthDate(true);
      setBirthDateError(null);

      await updateBabyBirthDate(currentBabyId, normalized);

      setBabies(
        babies.map((baby) =>
          baby.id === currentBabyId
            ? { ...baby, birth_date: normalized }
            : baby,
        ),
      );

      setBirthDateMessage(t("settings.birthDateSaved"));
    } catch (error) {
      setBirthDateError(
        error instanceof Error ? error.message : t("errors.generic"),
      );
    } finally {
      setSavingBirthDate(false);
    }
  }

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

      {currentBabyId && (
        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">
              {t("settings.birthDateLabel")}
            </p>

            <label className="birth-date-field">
              <input
                type="date"
                className="settings-select"
                value={birthDateInput}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => {
                  setBirthDateInput(event.target.value);
                  setBirthDateError(null);
                  setBirthDateMessage(null);
                }}
              />
            </label>

            {birthDateError && (
              <p className="settings-error">{birthDateError}</p>
            )}

            {birthDateMessage && (
              <p className="muted">{birthDateMessage}</p>
            )}
          </div>

          <button
            className="secondary-button"
            disabled={savingBirthDate}
            onClick={handleSaveBirthDate}
          >
            {savingBirthDate ? t("common.saving") : t("settings.birthDateSave")}
          </button>
        </section>
      )}

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
