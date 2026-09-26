import { useEffect, useState, type FormEvent } from "react";

import { isValidBirthDateInput } from "../analytics/localDate";
import { useTranslation } from "../i18n";
import {
  createBabyForHousehold,
  getMyHouseholds,
  type Household,
} from "../services/householdService";
import { useAppStore } from "../stores/appStore";

function localTodayInputValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function AddChildSettings() {
  const { t } = useTranslation();
  const babies = useAppStore((state) => state.babies);
  const setBabies = useAppStore((state) => state.setBabies);
  const setCurrentBabyId = useAppStore((state) => state.setCurrentBabyId);

  const [households, setHouseholds] = useState<Household[]>([]);
  const [householdId, setHouseholdId] = useState("");
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [loadingHouseholds, setLoadingHouseholds] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadHouseholds() {
      try {
        const nextHouseholds = await getMyHouseholds();
        if (!active) return;

        setHouseholds(nextHouseholds);
        setHouseholdId((current) => current || nextHouseholds[0]?.id || "");
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("family.errorCouldNotLoad"),
        );
      } finally {
        if (active) setLoadingHouseholds(false);
      }
    }

    void loadHouseholds();
    return () => {
      active = false;
    };
  }, [t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!householdId || !name.trim()) {
      setError(t("settings.addChildRequired"));
      return;
    }

    if (!isValidBirthDateInput(birthDate, Date.now())) {
      setError(t("settings.birthDateFuture"));
      return;
    }

    try {
      setSaving(true);
      const baby = await createBabyForHousehold(
        householdId,
        name,
        birthDate || null,
      );

      setBabies([...babies.filter((item) => item.id !== baby.id), baby]);
      setCurrentBabyId(baby.id);
      setName("");
      setBirthDate("");
      setExpanded(false);
      setMessage(t("settings.addChildSuccess", { name: baby.name }));
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("settings.addChildError"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-card add-child-card">
      <div className="add-child-heading">
        <div className="setting-copy">
          <p className="setting-title">{t("settings.addChildTitle")}</p>
          <p className="muted">{t("settings.addChildDescription")}</p>
        </div>

        <button
          type="button"
          className="secondary-button"
          disabled={loadingHouseholds || households.length === 0}
          onClick={() => {
            setExpanded((current) => !current);
            setError(null);
            setMessage(null);
          }}
        >
          {expanded ? t("common.cancel") : t("settings.addChildButton")}
        </button>
      </div>

      {message && <p className="settings-success">{message}</p>}

      {!loadingHouseholds && households.length === 0 && (
        <p className="muted">{t("settings.addChildNoFamily")}</p>
      )}

      {expanded && (
        <form className="add-child-form" onSubmit={handleSubmit}>
          {households.length > 1 && (
            <label className="settings-field">
              <span>{t("family.familyLabel")}</span>
              <select
                value={householdId}
                onChange={(event) => setHouseholdId(event.target.value)}
              >
                {households.map((household) => (
                  <option key={household.id} value={household.id}>
                    {household.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="settings-field">
            <span>{t("settings.addChildName")}</span>
            <input
              type="text"
              value={name}
              maxLength={100}
              required
              placeholder={t("settings.addChildNamePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="settings-field">
            <span>{t("settings.birthDateLabel")}</span>
            <input
              type="date"
              value={birthDate}
              max={localTodayInputValue()}
              onChange={(event) => setBirthDate(event.target.value)}
            />
          </label>

          {error && <p className="settings-error">{error}</p>}

          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? t("settings.addingChild") : t("settings.addChildSubmit")}
          </button>
        </form>
      )}
    </section>
  );
}

