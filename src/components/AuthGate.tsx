import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "../auth/AuthProvider";
import Auth from "../pages/Auth";
import Onboarding from "../pages/Onboarding";

import {
  getMyHouseholds,
} from "../services/householdService";

type AccountState =
  | "loading"
  | "needs-onboarding"
  | "ready";

export default function AuthGate({
  children,
}: {
  children: ReactNode;
}) {
  const {
    session,
    loading: authLoading,
  } = useAuth();

  const [accountState, setAccountState] =
    useState<AccountState>("loading");

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const checkAccount = useCallback(
    async () => {
      if (!session) {
        setAccountState("loading");
        return;
      }

      try {
        setErrorMessage(null);

        const households =
          await getMyHouseholds();

        setAccountState(
          households.length > 0
            ? "ready"
            : "needs-onboarding",
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not load your account.",
        );
      }
    },
    [session],
  );

  useEffect(() => {
    if (!session) return;

    void checkAccount();
  }, [session, checkAccount]);

  if (authLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">
            Sleepy
          </p>

          <h1>Loading...</h1>
        </section>
      </main>
    );
  }

  if (!session) {
    return <Auth />;
  }

  if (errorMessage) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">
            Sleepy
          </p>

          <h1>Something went wrong</h1>

          <p className="auth-message auth-message--error">
            {errorMessage}
          </p>

          <button
            className="primary-button"
            onClick={() =>
              void checkAccount()
            }
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (
    accountState === "loading"
  ) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">
            Sleepy
          </p>

          <h1>Loading family...</h1>
        </section>
      </main>
    );
  }

  if (
    accountState ===
    "needs-onboarding"
  ) {
    return (
      <Onboarding
        onComplete={checkAccount}
      />
    );
  }

  return <>{children}</>;
}