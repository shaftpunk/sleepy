import { useState } from "react";

import { useAppStore } from "../stores/appStore";
import { useAuth } from "../auth/AuthProvider";
import NotificationSettings from "../components/NotificationSettings";
import SleepEventNotificationSettings from "../components/SleepEventNotificationSettings";
import SoundMonitoringSettings from "../components/SoundMonitoringSettings";
import FamilySettings from "../components/FamilySettings";
import { useTranslation } from "../i18n";
import { isValidBirthDateInput } from "../analytics/localDate";
import { updateBabyBirthDate } from "../services/householdService";

export default function Settings() {
  const { t } = useTranslation();
  const { signOut, user } = useAuth();
  const [activeTab, setActiveTab] = useState<
    "baby" | "notifications" | "appearance" | "account"
  >("baby");

  // Still read (not shown in the UI anymore, see below) because
  // NotificationSettings/notification_settings and push_subscriptions are
  // still keyed by this legacy id, not the Sleepy 3.0 baby_id.
  const currentBbyId = useAppStore(
    (state) => state.currentBbyId,
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

  const visualTheme = useAppStore(
    (state) => state.visualTheme,
  );

  const setVisualTheme = useAppStore(
    (state) => state.setVisualTheme,
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

  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const accountName =
    (typeof user?.user_metadata?.full_name === "string" &&
      user.user_metadata.full_name.trim()) ||
    (typeof user?.user_metadata?.name === "string" &&
      user.user_metadata.name.trim()) ||
    user?.email ||
    t("settings.accountUnknownUser");

  async function handleLogout() {
    setLogoutError(null);

    try {
      setLoggingOut(true);
      await signOut();
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : t("settings.logoutError"),
      );
      setLoggingOut(false);
    }
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

      <div
        className="settings-tab-bar"
        role="tablist"
        aria-label={t("settings.pageTitle")}
      >
        {(
          [
            ["baby", t("settings.tabBaby")],
            ["notifications", t("settings.tabNotifications")],
            ["appearance", t("settings.tabAppearance")],
            ["account", t("settings.tabAccount")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={activeTab === key ? "settings-tab active" : "settings-tab"}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="settings-tab-content" role="tabpanel">
      {activeTab === "baby" && <>
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
      </>}

      {activeTab === "appearance" && <>
      <section className="settings-card appearance-card">
        <div className="appearance-row">
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
        </div>

        <div className="appearance-row">
          <div className="setting-copy">
            <p className="setting-title">
              {t("settings.visualThemeTitle")}
            </p>

            <p className="muted">
              {t("settings.visualThemeNote")}
            </p>
          </div>

          <div className="side-buttons">
            <button
              type="button"
              className={
                visualTheme === "default"
                  ? "side-button active"
                  : "side-button"
              }
              onClick={() => setVisualTheme("default")}
            >
              {t("settings.visualThemeDefault")}
            </button>

            <button
              type="button"
              className={
                visualTheme === "retro"
                  ? "side-button active"
                  : "side-button"
              }
              onClick={() => setVisualTheme("retro")}
            >
              {t("settings.visualThemeRetro")}
            </button>
          </div>
        </div>
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
      </>}

      {activeTab === "notifications" && <>
      <NotificationSettings
        bbyid={currentBbyId}
      />

      {currentBabyId && selectedBaby && (
        <SleepEventNotificationSettings
          key={currentBabyId}
          babyId={currentBabyId}
          babyName={selectedBaby.name}
        />
      )}

      <SoundMonitoringSettings />
      </>}

      {activeTab === "account" && <>
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

      <section className="settings-card account-card">
        <div className="account-identity" aria-hidden="true">
          {accountName.slice(0, 1).toLocaleUpperCase()}
        </div>

        <div className="setting-copy">
          <p className="setting-title">
            {t("settings.accountTitle")}
          </p>

          <p className="account-name">{accountName}</p>

          {user?.email && user.email !== accountName && (
            <p className="muted account-email">{user.email}</p>
          )}

          {logoutError && (
            <p className="settings-error">{logoutError}</p>
          )}
        </div>

        <button
          type="button"
          className="secondary-button"
          disabled={loggingOut}
          onClick={handleLogout}
        >
          {loggingOut ? t("settings.loggingOut") : t("settings.logoutButton")}
        </button>
      </section>
      </>}
      </div>
    </main>
  );
}
