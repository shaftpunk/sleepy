import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { supabase } from "../lib/supabase";
import { useTranslation } from "../i18n";

type AuthMode =
  | "login"
  | "register"
  | "forgot"
  | "reset";


export default function Auth() {
  const { t } = useTranslation();

  const [mode, setMode] =
    useState<AuthMode>("login");

  const [displayName, setDisplayName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const [successMessage, setSuccessMessage] =
    useState<string | null>(null);


  useEffect(() => {
    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (event) => {
          if (
            event ===
            "PASSWORD_RECOVERY"
          ) {
            setMode("reset");
            setPassword("");
            setConfirmPassword("");
            setErrorMessage(null);
            setSuccessMessage(null);
          }
        },
      );

    return () => {
      subscription.unsubscribe();
    };
  }, []);


  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (mode === "register") {
        const {
          data,
          error,
        } =
          await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: {
                display_name:
                  displayName.trim(),
              },
            },
          });

        if (error) {
          throw error;
        }

        if (!data.session) {
          setSuccessMessage(
            t("auth.accountCreatedMessage"),
          );
        }

        return;
      }


      if (mode === "login") {
        const { error } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

        if (error) {
          throw error;
        }

        return;
      }


      if (mode === "forgot") {
        const cleanEmail =
          email.trim();

        if (!cleanEmail) {
          throw new Error(
            t("auth.enterEmailError"),
          );
        }

        const { error } =
          await supabase.auth.resetPasswordForEmail(
            cleanEmail,
            {
              redirectTo:
                window.location.origin,
            },
          );

        if (error) {
          throw error;
        }

        setSuccessMessage(
          t("auth.resetLinkSentMessage"),
        );

        return;
      }


      if (mode === "reset") {
        if (password.length < 6) {
          throw new Error(
            t("auth.passwordMinLengthError"),
          );
        }

        if (
          password !==
          confirmPassword
        ) {
          throw new Error(
            t("auth.passwordsDontMatchError"),
          );
        }

        const { error } =
          await supabase.auth.updateUser({
            password,
          });

        if (error) {
          throw error;
        }

        setPassword("");
        setConfirmPassword("");

        setSuccessMessage(
          t("auth.passwordUpdatedMessage"),
        );

        /*
         * updateUser keeps the user signed in.
         * AuthProvider/AuthGate should therefore
         * take over automatically.
         */
      }

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


  function changeMode(
    nextMode: AuthMode,
  ) {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setErrorMessage(null);
    setSuccessMessage(null);
  }


  function getHeading() {
    if (mode === "register") {
      return t("auth.createAccountHeading");
    }

    if (mode === "forgot") {
      return t("auth.resetPasswordHeading");
    }

    if (mode === "reset") {
      return t("auth.chooseNewPasswordHeading");
    }

    return t("auth.welcomeBack");
  }


  function getDescription() {
    if (mode === "register") {
      return t("auth.createAccountDescription");
    }

    if (mode === "forgot") {
      return t("auth.forgotDescription");
    }

    if (mode === "reset") {
      return t("auth.resetDescription");
    }

    return t("auth.signInDescription");
  }


  return (
    <main className="auth-page">

      <section className="auth-card">

        <div className="auth-brand">

          <p className="eyebrow">
            {t("common.appName")}
          </p>

          <h1>
            {getHeading()}
          </h1>

          <p className="muted">
            {getDescription()}
          </p>

        </div>


        {(
          mode === "login" ||
          mode === "register"
        ) && (
          <div className="auth-tabs">

            <button
              type="button"
              className={
                mode === "login"
                  ? "auth-tab auth-tab--active"
                  : "auth-tab"
              }
              onClick={() =>
                changeMode("login")
              }
            >
              {t("auth.signInTab")}
            </button>


            <button
              type="button"
              className={
                mode === "register"
                  ? "auth-tab auth-tab--active"
                  : "auth-tab"
              }
              onClick={() =>
                changeMode("register")
              }
            >
              {t("auth.createAccountTab")}
            </button>

          </div>
        )}


        <form
          className="auth-form"
          onSubmit={handleSubmit}
        >

          {mode === "register" && (
            <label className="auth-field">

              <span>
                {t("auth.nameLabel")}
              </span>

              <input
                type="text"
                value={displayName}
                onChange={(event) =>
                  setDisplayName(
                    event.target.value,
                  )
                }
                required
                autoComplete="name"
                placeholder={t("auth.namePlaceholder")}
              />

            </label>
          )}


          {mode !== "reset" && (
            <label className="auth-field">

              <span>
                {t("auth.emailLabel")}
              </span>

              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value,
                  )
                }
                required
                autoComplete="email"
                placeholder={t("auth.emailPlaceholder")}
              />

            </label>
          )}


          {(
            mode === "login" ||
            mode === "register"
          ) && (
            <label className="auth-field">

              <span>
                {t("auth.passwordLabel")}
              </span>

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value,
                  )
                }
                required
                minLength={6}
                autoComplete={
                  mode === "login"
                    ? "current-password"
                    : "new-password"
                }
                placeholder="••••••••"
              />

            </label>
          )}


          {mode === "reset" && (
            <>
              <label className="auth-field">

                <span>
                  {t("auth.newPasswordLabel")}
                </span>

                <input
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value,
                    )
                  }
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />

              </label>


              <label className="auth-field">

                <span>
                  {t("auth.confirmPasswordLabel")}
                </span>

                <input
                  type="password"
                  value={
                    confirmPassword
                  }
                  onChange={(event) =>
                    setConfirmPassword(
                      event.target.value,
                    )
                  }
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />

              </label>
            </>
          )}


          {mode === "login" && (
            <button
              type="button"
              className="auth-link-button"
              onClick={() =>
                changeMode("forgot")
              }
            >
              {t("auth.forgotPasswordLink")}
            </button>
          )}


          {errorMessage && (
            <p className="auth-message auth-message--error">
              {errorMessage}
            </p>
          )}


          {successMessage && (
            <p className="auth-message auth-message--success">
              {successMessage}
            </p>
          )}


          <button
            type="submit"
            className="primary-button auth-submit"
            disabled={loading}
          >
            {loading
              ? t("auth.pleaseWait")
              : mode === "login"
                ? t("auth.signInTab")
                : mode === "register"
                  ? t("auth.createAccountTab")
                  : mode === "forgot"
                    ? t("auth.sendResetLink")
                    : t("auth.updatePassword")}
          </button>


          {mode === "forgot" && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                changeMode("login")
              }
            >
              {t("auth.backToSignIn")}
            </button>
          )}

        </form>

      </section>

    </main>
  );
}
