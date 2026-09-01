import {
  useState,
  type FormEvent,
} from "react";

import {
  createHouseholdWithBaby,
} from "../services/householdService";

import JoinHousehold
  from "../components/JoinHousehold";

import { useTranslation } from "../i18n";


interface OnboardingProps {
  onComplete: () => Promise<void>;
}

type OnboardingMode =
  | "create"
  | "join";


export default function Onboarding({
  onComplete,
}: OnboardingProps) {
  const { t } = useTranslation();

  const [
    mode,
    setMode,
  ] =
    useState<OnboardingMode>(
      "create"
    );

  const [
    householdName,
    setHouseholdName,
  ] =
    useState("");

  const [
    babyName,
    setBabyName,
  ] =
    useState("");

  const [
    birthDate,
    setBirthDate,
  ] =
    useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    errorMessage,
    setErrorMessage,
  ] =
    useState<string | null>(
      null
    );


  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage(null);

    try {
      await createHouseholdWithBaby(
        householdName,
        babyName,
        birthDate || null,
      );

      await onComplete();

    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("errors.generic"),
      );

    } finally {
      setLoading(false);
    }
  }


  async function handleJoined() {
    await onComplete();
  }


  return (
    <main className="auth-page">

      <section className="auth-card">

        <div className="auth-brand">

          <p className="eyebrow">
            {t("common.appName")}
          </p>

          <h1>
            {mode === "create"
              ? t("onboarding.createFamilyHeading")
              : t("onboarding.joinFamilyHeading")}
          </h1>

          <p className="muted">
            {mode === "create"
              ? t("onboarding.createDescription")
              : t("family.joinDescription")}
          </p>

        </div>


        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "1fr 1fr",
            gap: "8px",
            marginBottom: "24px",
          }}
        >

          <button
            type="button"
            className={
              mode === "create"
                ? "primary-button"
                : "secondary-button"
            }
            onClick={() => {
              setMode("create");
              setErrorMessage(null);
            }}
          >
            {t("onboarding.createFamilyButton")}
          </button>


          <button
            type="button"
            className={
              mode === "join"
                ? "primary-button"
                : "secondary-button"
            }
            onClick={() => {
              setMode("join");
              setErrorMessage(null);
            }}
          >
            {t("family.joinFamily")}
          </button>

        </div>


        {mode === "create" ? (

          <form
            className="auth-form"
            onSubmit={handleSubmit}
          >

            <label className="auth-field">

              <span>
                {t("onboarding.familyNameLabel")}
              </span>

              <input
                type="text"
                value={householdName}
                onChange={(event) =>
                  setHouseholdName(
                    event.target.value,
                  )
                }
                required
                maxLength={100}
                placeholder={t("onboarding.familyNamePlaceholder")}
              />

            </label>


            <label className="auth-field">

              <span>
                {t("onboarding.babyNameLabel")}
              </span>

              <input
                type="text"
                value={babyName}
                onChange={(event) =>
                  setBabyName(
                    event.target.value,
                  )
                }
                required
                maxLength={100}
                placeholder={t("onboarding.babyNamePlaceholder")}
              />

            </label>


            <label className="auth-field">

              <span>
                {t("onboarding.dateOfBirthLabel")}
              </span>

              <input
                type="date"
                value={birthDate}
                max={
                  new Date()
                    .toISOString()
                    .split("T")[0]
                }
                onChange={(event) =>
                  setBirthDate(
                    event.target.value,
                  )
                }
              />

            </label>


            {errorMessage && (
              <p className="auth-message auth-message--error">
                {errorMessage}
              </p>
            )}


            <button
              type="submit"
              className="primary-button auth-submit"
              disabled={loading}
            >
              {loading
                ? t("family.creating")
                : t("onboarding.createFamilyButton")}
            </button>

          </form>

        ) : (

          <JoinHousehold
            onJoined={
              handleJoined
            }
          />

        )}

      </section>

    </main>
  );
}
