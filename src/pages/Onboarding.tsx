import {
  useState,
  type FormEvent,
} from "react";

import {
  createHouseholdWithBaby,
} from "../services/householdService";

interface OnboardingProps {
  onComplete: () => Promise<void>;
}

export default function Onboarding({
  onComplete,
}: OnboardingProps) {
  const [householdName, setHouseholdName] =
    useState("");

  const [babyName, setBabyName] =
    useState("");

  const [birthDate, setBirthDate] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

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
          : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <p className="eyebrow">
            Sleepy
          </p>

          <h1>Create your family</h1>

          <p className="muted">
            Set up your family and first baby.
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={handleSubmit}
        >
          <label className="auth-field">
            <span>Family name</span>

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
              placeholder="Strande family"
            />
          </label>

          <label className="auth-field">
            <span>Baby's name</span>

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
              placeholder="Amalie"
            />
          </label>

          <label className="auth-field">
            <span>Date of birth</span>

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
              ? "Creating..."
              : "Create family"}
          </button>
        </form>
      </section>
    </main>
  );
}