import {
  useState,
} from "react";

import {
  acceptHouseholdInvitation,
} from "../services/invitationService";

import { useTranslation } from "../i18n";


type Props = {
  onJoined: () => void;
};


export default function JoinHousehold({
  onJoined,
}: Props) {
  const { t } = useTranslation();

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
        t("family.errorEnterInvitationCode")
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
        t("family.joinedSuccess", { name: result.household_name })
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
          : t("family.errorCouldNotJoin")
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
            {t("family.eyebrow")}
          </p>

          <h2>
            {t("family.joinHeading")}
          </h2>
        </div>
      </div>


      <p className="page-description">
        {t("family.joinDescription")}
      </p>


      <label className="settings-field">
        <span>
          {t("family.invitationCode")}
        </span>

        <input
          type="text"
          value={token}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("family.pasteInvitationCode")}
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
          ? t("family.joining")
          : t("family.joinFamily")}
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
