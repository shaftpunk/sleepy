import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "../auth/AuthProvider";
import Auth from "../pages/Auth";
import Onboarding from "../pages/Onboarding";
import { useTranslation } from "../i18n";

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
  const { t } = useTranslation();

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
            : t("errors.couldNotLoadAccount"),
        );
      }
    },
    // `t` only phrases the fallback error message and doesn't affect
    // whether the account needs re-checking, so it's intentionally not a
    // dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            {t("common.appName")}
          </p>

          <h1>{t("common.loading")}</h1>
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
            {t("common.appName")}
          </p>

          <h1>{t("common.somethingWentWrongHeading")}</h1>

          <p className="auth-message auth-message--error">
            {errorMessage}
          </p>

          <button
            className="primary-button"
            onClick={() =>
              void checkAccount()
            }
          >
            {t("common.retry")}
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
            {t("common.appName")}
          </p>

          <h1>{t("family.loadingFamily")}</h1>
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