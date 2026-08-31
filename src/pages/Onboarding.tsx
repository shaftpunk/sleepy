import {
  useState,
  type FormEvent,
} from "react";

import {
  createHouseholdWithBaby,
} from "../services/householdService";

import JoinHousehold
  from "../components/JoinHousehold";


interface OnboardingProps {
  onComplete: () => Promise<void>;
}

type OnboardingMode =
  | "create"
  | "join";


export default function Onboarding({
  onComplete,
}: OnboardingProps) {
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
          : "Something went wrong.",
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
            Sleepy
          </p>

          <h1>
            {mode === "create"
              ? "Create your family"
              : "Join a family"}
          </h1>

          <p className="muted">
            {mode === "create"
              ? "Set up your family and first baby."
              : "Use an invitation code to join an existing family."}
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
            Create family
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
            Join family
          </button>

        </div>


        {mode === "create" ? (

          <form
            className="auth-form"
            onSubmit={handleSubmit}
          >

            <label className="auth-field">

              <span>
                Family name
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
                placeholder="Strande family"
              />

            </label>


            <label className="auth-field">

              <span>
                Baby's name
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
                placeholder="Amalie"
              />

            </label>


            <label className="auth-field">

              <span>
                Date of birth
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
                ? "Creating..."
                : "Create family"}
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