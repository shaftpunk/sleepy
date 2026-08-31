import {
  useState,
} from "react";

import {
  acceptHouseholdInvitation,
} from "../services/invitationService";


type Props = {
  onJoined: () => void;
};


export default function JoinHousehold({
  onJoined,
}: Props) {
  const [
    token,
    setToken,
  ] =
    useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  const [
    success,
    setSuccess,
  ] =
    useState<string | null>(
      null
    );


  async function handleJoin() {
    const cleanToken =
      token.trim();

    if (!cleanToken) {
      setError(
        "Enter an invitation code."
      );

      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const result =
        await acceptHouseholdInvitation(
          cleanToken
        );

      setSuccess(
        `You joined ${result.household_name}.`
      );

      setToken("");

      window.setTimeout(
        () => {
          onJoined();
        },
        500
      );

    } catch (err) {
      console.error(
        "Could not join family:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Could not join family."
      );

    } finally {
      setLoading(false);
    }
  }


  return (
    <section className="settings-section">

      <div className="section-heading">
        <div>
          <p className="eyebrow">
            Sleepy 3.0
          </p>

          <h2>
            Join family
          </h2>
        </div>
      </div>


      <p className="page-description">
        Enter an invitation code from a family member.
      </p>


      <label className="settings-field">
        <span>
          Invitation code
        </span>

        <input
          type="text"
          value={token}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste invitation code"
          onChange={(event) => {
            setToken(
              event.target.value
            );

            setError(null);
            setSuccess(null);
          }}
        />
      </label>


      <button
        className="primary-button"
        disabled={
          loading ||
          !token.trim()
        }
        onClick={
          handleJoin
        }
      >
        {loading
          ? "Joining…"
          : "Join family"}
      </button>


      {error && (
        <p className="settings-error">
          {error}
        </p>
      )}


      {success && (
        <p>
          {success}
        </p>
      )}

    </section>
  );
}