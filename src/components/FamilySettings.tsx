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


export default function FamilySettings() {
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
              : "Could not load family."
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
          : "Could not create invitation."
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
        "Could not copy invitation code."
      );
    }
  }


  if (loading) {
    return (
      <section className="settings-section">
        <h2>
          Family
        </h2>

        <p>
          Loading family…
        </p>
      </section>
    );
  }


  return (
    <section className="settings-section">

      <div className="section-heading">
        <div>
          <p className="eyebrow">
            Sleepy 3.0
          </p>

          <h2>
            Family
          </h2>
        </div>
      </div>


      <p className="page-description">
        Invite another person to share the same baby and history.
      </p>


      {households.length === 0 ? (
        <p>
          No family found.
        </p>
      ) : (
        <>
          <label className="settings-field">
            <span>
              Family
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
              Access
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
                Parent
              </option>

              <option value="caregiver">
                Caregiver
              </option>

              <option value="viewer">
                Viewer
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
              ? "Creating…"
              : "Create invitation"}
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
            Invitation code
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
              ? "Copied"
              : "Copy invitation code"}
          </button>


          {expiresAt && (
            <p className="page-description">
              Expires{" "}
              {new Intl.DateTimeFormat(
                "nb-NO",
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
              )}
            </p>
          )}

        </div>
      )}

    </section>
  );
}