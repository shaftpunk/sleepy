import {
  useEffect,
  useState,
} from "react";

import {
  createHouseholdInvitation,
  type HouseholdRole,
} from "../services/invitationService";

import {
  getMyHouseholds,
  type Household,
} from "../services/householdService";

import { LOCALES, useTranslation } from "../i18n";


export default function FamilySettings() {
  const { t, lang } = useTranslation();

  const [
    households,
    setHouseholds,
  ] =
    useState<Household[]>([]);

  const [
    selectedHouseholdId,
    setSelectedHouseholdId,
  ] =
    useState("");

  const [
    role,
    setRole,
  ] =
    useState<HouseholdRole>(
      "parent"
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    creating,
    setCreating,
  ] =
    useState(false);

  const [
    inviteToken,
    setInviteToken,
  ] =
    useState<string | null>(
      null
    );

  const [
    expiresAt,
    setExpiresAt,
  ] =
    useState<string | null>(
      null
    );

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  const [
    copied,
    setCopied,
  ] =
    useState(false);


  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);

        const data =
          await getMyHouseholds();

        if (!mounted) {
          return;
        }

        setHouseholds(data);

        if (data.length > 0) {
          setSelectedHouseholdId(
            data[0].id
          );
        }

      } catch (err) {
        console.error(
          "Could not load households:",
          err
        );

        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : t("family.errorCouldNotLoad")
          );
        }

      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
    // Loads once on mount; `t` only phrases the fallback error message and
    // isn't a real dependency (see NotificationSettings.tsx for the same
    // pattern, and why including it here caused a render loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  async function handleCreateInvite() {
    if (!selectedHouseholdId) {
      return;
    }

    try {
      setCreating(true);
      setError(null);
      setInviteToken(null);
      setExpiresAt(null);
      setCopied(false);

      const invitation =
        await createHouseholdInvitation(
          selectedHouseholdId,
          role,
          24
        );

      setInviteToken(
        invitation.token
      );

      setExpiresAt(
        invitation.expires_at
      );

    } catch (err) {
      console.error(
        "Could not create invitation:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : t("family.errorCouldNotCreateInvitation")
      );

    } finally {
      setCreating(false);
    }
  }


  async function handleCopy() {
    if (!inviteToken) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        inviteToken
      );

      setCopied(true);

      window.setTimeout(
        () => {
          setCopied(false);
        },
        2000
      );

    } catch (err) {
      console.error(
        "Could not copy invitation:",
        err
      );

      setError(
        t("family.errorCouldNotCopyCode")
      );
    }
  }


  if (loading) {
    return (
      <section className="settings-section">
        <h2>
          {t("family.heading")}
        </h2>

        <p>
          {t("family.loadingFamily")}
        </p>
      </section>
    );
  }


  return (
    <section className="settings-section">

      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {t("family.eyebrow")}
          </p>

          <h2>
            {t("family.heading")}
          </h2>
        </div>
      </div>


      <p className="page-description">
        {t("family.description")}
      </p>


      {households.length === 0 ? (
        <p>
          {t("family.noFamilyFound")}
        </p>
      ) : (
        <>
          <label className="settings-field">
            <span>
              {t("family.familyLabel")}
            </span>

            <select
              value={
                selectedHouseholdId
              }
              onChange={(event) => {
                setSelectedHouseholdId(
                  event.target.value
                );

                setInviteToken(null);
                setExpiresAt(null);
              }}
            >
              {households.map(
                (household) => (
                  <option
                    key={
                      household.id
                    }
                    value={
                      household.id
                    }
                  >
                    {
                      household.name
                    }
                  </option>
                )
              )}
            </select>
          </label>


          <label className="settings-field">
            <span>
              {t("family.accessLabel")}
            </span>

            <select
              value={role}
              onChange={(event) =>
                setRole(
                  event.target
                    .value as HouseholdRole
                )
              }
            >
              <option value="parent">
                {t("family.roleParent")}
              </option>

              <option value="caregiver">
                {t("family.roleCaregiver")}
              </option>

              <option value="viewer">
                {t("family.roleViewer")}
              </option>
            </select>
          </label>


          <button
            className="primary-button"
            disabled={
              creating ||
              !selectedHouseholdId
            }
            onClick={
              handleCreateInvite
            }
          >
            {creating
              ? t("family.creating")
              : t("family.createInvitation")}
          </button>
        </>
      )}


      {error && (
        <p className="settings-error">
          {error}
        </p>
      )}


      {inviteToken && (
        <div className="settings-card">

          <strong>
            {t("family.invitationCode")}
          </strong>

          <p
            style={{
              wordBreak:
                "break-all",
            }}
          >
            {inviteToken}
          </p>


          <button
            className="secondary-button"
            onClick={
              handleCopy
            }
          >
            {copied
              ? t("family.copied")
              : t("family.copyInvitationCode")}
          </button>


          {expiresAt && (
            <p className="page-description">
              {t("family.expires", {
                date: new Intl.DateTimeFormat(
                  LOCALES[lang],
                  {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }
                ).format(
                  new Date(
                    expiresAt
                  )
                ),
              })}
            </p>
          )}

        </div>
      )}

    </section>
  );
}
