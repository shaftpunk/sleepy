import {
  useState,
  type FormEvent,
} from "react";

import { supabase } from "../lib/supabase";

type AuthMode = "login" | "register";

export default function Auth() {
  const [mode, setMode] =
    useState<AuthMode>("login");

  const [displayName, setDisplayName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const [successMessage, setSuccessMessage] =
    useState<string | null>(null);

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
        } = await supabase.auth.signUp({
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
      } else {
        const { error } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

        if (error) {
          throw error;
        }
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

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <p className="eyebrow">
            Sleepy
          </p>

          <h1>
            {mode === "login"
              ? "Welcome back"
              : "Create your account"}
          </h1>

          <p className="muted">
            {mode === "login"
              ? "Sign in to continue to Sleepy."
              : "Create your Sleepy account to get started."}
          </p>
        </div>

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

        <form
          className="auth-form"
          onSubmit={handleSubmit}
        >
          {mode === "register" && (
            <label className="auth-field">
              <span>Name</span>

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

          <label className="auth-field">
            <span>Email</span>

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              required
              autoComplete="email"
              placeholder="name@example.com"
            />
          </label>

          <label className="auth-field">
            <span>Password</span>

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
                : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}