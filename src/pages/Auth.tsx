import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { supabase } from "../lib/supabase";
import { useTranslation } from "../i18n";
import { appleSignInSupported, signInWithApple } from "../services/appleAuthService";

type AuthMode =
  | "login"
  | "register"
  | "forgot"
  | "reset";


export default function Auth() {
  const { t } = useTranslation();
  const nativeApple = appleSignInSupported();

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


  async function handleAppleSignIn() {
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await signInWithApple();
    } catch {
      setErrorMessage(t("auth.appleSignInError"));
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

    return t(nativeApple ? "auth.welcomeToSleepy" : "auth.welcomeBack");
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


        {nativeApple && mode === "login" && (
          <>
            <button type="button" className="apple-sign-in" disabled={loading}
              onClick={() => void handleAppleSignIn()}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M17.05 12.54c.03 3.16 2.77 4.21 2.8 4.22-.02.08-.44 1.5-1.45 2.97-.87 1.27-1.78 2.53-3.2 2.56-1.4.03-1.85-.83-3.45-.83-1.59 0-2.09.8-3.41.86-1.37.05-2.41-1.37-3.29-2.63-1.78-2.58-3.14-7.3-1.31-10.49.91-1.58 2.54-2.58 4.31-2.6 1.35-.03 2.62.91 3.45.91.82 0 2.37-1.13 3.99-.96.68.03 2.58.27 3.8 2.05-.1.06-2.27 1.32-2.24 3.94zM14.43 4.82c.73-.88 1.22-2.1 1.09-3.32-1.05.04-2.32.7-3.07 1.58-.67.78-1.26 2.02-1.1 3.21 1.17.09 2.36-.6 3.08-1.47z" />
              </svg>
              {t("auth.continueWithApple")}
            </button>
            <p className="auth-divider">{t("auth.or")}</p>
          </>
        )}

        {(!nativeApple || mode !== "login") && (
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
              aria-pressed={mode === "login"}
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
              aria-pressed={mode === "register"}
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


          {mode === "login" && !nativeApple && (
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

          {nativeApple && mode === "login" && (
            <>
              <button type="button" className="auth-link-button" disabled={loading}
                onClick={() => changeMode("register")}>
                {t("auth.newAccountLink")}
              </button>
              <button type="button" className="auth-link-button" disabled={loading}
                onClick={() => changeMode("forgot")}>
                {t("auth.forgotPasswordLink")}
              </button>
            </>
          )}


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
