import { useHouseholdContext } from "./HouseholdContextProvider";
import { useTranslation } from "../i18n";
import "./HouseholdContext.css";

export default function HouseholdContextSelector() {
  const { householdId, candidates, loading, unavailable, choose, refresh } = useHouseholdContext();
  const { t } = useTranslation();
  if (loading || (!unavailable && candidates.length < 2)) return null;
  if (unavailable) return <aside className="household-context-notice" role="status">
    <p>{t("family.contextUnavailable")}</p>
    <button type="button" className="text-button" onClick={refresh}>{t("common.retry")}</button>
  </aside>;
  return <label className="household-context-notice">
    <span>{t("family.activeHousehold")}</span>
    <select className="settings-select" value={householdId ?? ""} onChange={event => choose(event.target.value)}>
      <option value="" disabled>{t("family.chooseHousehold")}</option>
      {candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
    </select>
  </label>;
}
