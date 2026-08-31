import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { supabase } from "../lib/supabase";

type AuthMode =
  | "login"
  | "register"
  | "forgot"
  | "reset";


export default function Auth() {
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
            "Account created. Check your email to confirm your account.",
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
            "Enter your email address.",
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
          "If an account exists for this email, a password reset link has been sent.",
        );

        return;
      }


      if (mode === "reset") {
        if (password.length < 6) {
          throw new Error(
            "Password must contain at least 6 characters.",
          );
        }

        if (
          password !==
          confirmPassword
        ) {
          throw new Error(
            "The passwords do not match.",
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
          "Password updated successfully.",
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
          : "Something went wrong.",
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
      return "Create your account";
    }

    if (mode === "forgot") {
      return "Reset your password";
    }

    if (mode === "reset") {
      return "Choose a new password";
    }

    return "Welcome back";
  }


  function getDescription() {
    if (mode === "register") {
      return "Create your Sleepy account to get started.";
    }

    if (mode === "forgot") {
      return "Enter your email and we'll send you a secure reset link.";
    }

    if (mode === "reset") {
      return "Enter the new password you want to use for Sleepy.";
    }

    return "Sign in to continue to Sleepy.";
  }


  return (
    <main className="auth-page">

      <section className="auth-card">

        <div className="auth-brand">

          <p className="eyebrow">
            Sleepy
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
              Sign in
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
              Create account
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
                Name
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
                placeholder="Your name"
              />

            </label>
          )}


          {mode !== "reset" && (
            <label className="auth-field">

              <span>
                Email
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
                placeholder="name@example.com"
              />

            </label>
          )}


          {(
            mode === "login" ||
            mode === "register"
          ) && (
            <label className="auth-field">

              <span>
                Password
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
                  New password
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
                  Confirm password
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
              Forgot password?
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
              ? "Please wait..."
              : mode === "login"
                ? "Sign in"
                : mode === "register"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Update password"}
          </button>


          {mode === "forgot" && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                changeMode("login")
              }
            >
              Back to sign in
            </button>
          )}

        </form>

      </section>

    </main>
  );
}