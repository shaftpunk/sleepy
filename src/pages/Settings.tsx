import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAppStore, type Baby, type VisualTheme } from "../stores/appStore";
import { useAuth } from "../auth/AuthProvider";
import { useHouseholdContext } from "../households/HouseholdContextProvider";
import HouseholdContextSelector from "../households/HouseholdContextSelector";
import type { HouseholdRole } from "../households/context";
import NotificationSettings from "../components/NotificationSettings";
import SleepEventNotificationSettings from "../components/SleepEventNotificationSettings";
import SoundMonitoringSettings from "../components/SoundMonitoringSettings";
import FamilyMessageModal from "../components/FamilyMessageModal";
import FamilySettings from "../components/FamilySettings";
import AddChildSettings from "../components/AddChildSettings";
import JoinHousehold from "../components/JoinHousehold";
import { ReminderSetting } from "../components/PredictionReminderLifecycle";
import LiveActivityDiagnostics, { showLiveActivityDiagnostics } from "../components/LiveActivityDiagnostics";
import LiveActivitySettings from "../components/LiveActivitySettings";
import SleepyPlusSettings from "../components/SleepyPlusSettings";
import { useTranslation, type Language, type TranslationKey } from "../i18n";
import { isValidBirthDateInput } from "../analytics/localDate";
import { getHouseholdMemberRoles, getMyBabies, updateBabyBirthDate } from "../services/householdService";
import { sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";
import "./Settings.css";

const sections = [
  ["family", "settings.familyTitle", "M4 11l8-7 8 7v9H4zm5 9v-5h6v5"],
  ["notifications", "settings.tabNotifications", "M18 8a6 6 0 0 0-12 0c0 8-2 7-2 9h16c0-2-2-1-2-9m-8 12a2 2 0 0 0 4 0"],
  ["appearance", "settings.appearanceTitle", "M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z"],
  ["plus", "settings.plusTitle", "M12 4l2.4 5.6 6.1.5-4.7 4 1.5 6-5.3-3.2L6.7 20l1.5-6-4.7-4 6.1-.5Z"],
  ["account", "settings.accountTitle", "M8 8a4 4 0 1 1 8 0 4 4 0 0 1-8 0Zm-3 12a7 7 0 0 1 14 0"],
  ["about", "settings.aboutTitle", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-1v5m0-8h.01"],
] as const;

type Section = "family" | "notifications" | "appearance" | "plus" | "account" | "sound";

export function SettingsScreen({ title, back = "/settings", children }: { title: string; back?: string; children: ReactNode }) {
  const { t, lang } = useTranslation();
  return <main className="settings-page settings-detail" lang={lang === "no" ? "nb" : "en"}>
    <header className="settings-screen-header">
      <Link className="settings-back" to={back} aria-label={t(back === "/settings" ? "nav.settings" : "settings.tabNotifications")}>&lsaquo;</Link>
      <h1>{title}</h1>
    </header>
    {children}
  </main>;
}

export default function Settings({ section }: { section?: Section }) {
  const { t, lang } = useTranslation();
  if (!section) return <main className="settings-page settings-index" lang={lang === "no" ? "nb" : "en"}>
    <h1>{t("settings.pageTitle")}</h1>
    <ul className="settings-index-list">
      {sections.map(([path, title, icon]) => <li key={path}>
        <Link className="settings-index-row" to={path}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon} /></svg>
          <span>{t(title)}</span>
          <span aria-hidden="true">&rsaquo;</span>
        </Link>
      </li>)}
    </ul>
    {showLiveActivityDiagnostics() && <LiveActivityDiagnostics />}
  </main>;
  if (section === "sound") return <SettingsScreen title={t("sound.title")} back="/settings/notifications">
    <SoundMonitoringSettings />
  </SettingsScreen>;

  const title = sections.find(([path]) => path === section)![1];
  const Panel = { family: FamilySection, notifications: NotificationsSection, appearance: AppearanceSection,
    plus: SleepyPlusSettings, account: AccountSection }[section];
  return <SettingsScreen title={t(title)}><Panel /></SettingsScreen>;
}

function FamilySection() {
  const { t } = useTranslation();
  const babies = useAppStore(state => state.babies);
  const babyId = useAppStore(state => state.currentBabyId);
  const setBaby = useAppStore(state => state.setCurrentBabyId);
  const household = useHouseholdContext();
  const selected = babies.find(baby => baby.id === babyId);
  const selectedHousehold = household.candidates.find(candidate => candidate.id === household.householdId);
  const [messageBabyId, setMessageBabyId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(false);
  const [familyRevision, setFamilyRevision] = useState(0);

  async function refreshAfterJoin(generation: number) {
    if (!isSessionGenerationCurrent(generation)) return;
    try {
      const next = await getMyBabies();
      if (!isSessionGenerationCurrent(generation)) return;
      const state = useAppStore.getState();
      state.setBabies(next);
      const added = next.find(baby => !state.babies.some(previous => previous.id === baby.id));
      const nextBaby = added ?? (!next.some(baby => baby.id === state.currentBabyId) ? next[0] : undefined);
      if (nextBaby) state.setCurrentBabyId(nextBaby.id);
      household.refresh();
      setFamilyRevision(value => value + 1);
      setJoining(false);
    } catch {
      if (isSessionGenerationCurrent(generation)) setJoinError(true);
    }
  }

  const generation = sessionGeneration();
  return <>
    <HouseholdContextSelector />
    {selectedHousehold && household.candidates.length === 1 && <p className="settings-context">{t("family.activeHousehold")}: {selectedHousehold.name}</p>}
    <section className="settings-card">
      <label htmlFor="settings-baby" className="setting-title">{t("settings.babyTitle")}</label>
      {babies.length ? <select id="settings-baby" className="settings-select" value={babyId ?? ""}
        onChange={event => setBaby(event.target.value)}>
        {!babyId && <option value="" disabled>&mdash;</option>}
        {babies.map(baby => <option key={baby.id} value={baby.id}>{baby.name}</option>)}
      </select> : <p className="muted">{t("settings.noBabiesFound")}</p>}
    </section>
    {selected && <BirthDate key={selected.id} baby={selected} />}
    {selectedHousehold && !household.loading && <FamilyMembers
      key={[household.userId, selectedHousehold.id, familyRevision].join(":")} householdId={selectedHousehold.id} />}
    <AddChildSettings />
    <FamilySettings key={familyRevision} />
    <div className="settings-detail-actions">
      <button type="button" className="secondary-button" aria-expanded={joining} onClick={() => {
        setJoinError(false);
        setJoining(value => !value);
      }}>{t("family.joinHeading")}</button>
      {selected && <button type="button" className="secondary-button"
        onClick={() => setMessageBabyId(selected.id)}>{t("familyMessage.send")}</button>}
    </div>
    {joining && <JoinHousehold onJoined={() => void refreshAfterJoin(generation)} />}
    {joinError && <p role="alert">{t("errors.generic")} <button type="button" className="text-button"
      onClick={() => void refreshAfterJoin(generation)}>{t("common.retry")}</button></p>}
    {selected && messageBabyId === selected.id && <FamilyMessageModal babyId={selected.id} babyName={selected.name}
      onClose={() => setMessageBabyId(null)} />}
  </>;
}

const memberRoles = [
  ["owner", "settings.roleOwner"], ["parent", "family.roleParent"],
  ["caregiver", "family.roleCaregiver"], ["viewer", "family.roleViewer"],
] as const;

function FamilyMembers({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<HouseholdRole[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    const generation = sessionGeneration();
    void getHouseholdMemberRoles(householdId).then(values => {
      if (current && isSessionGenerationCurrent(generation)) setRoles(values);
    }).catch(() => {
      if (current && isSessionGenerationCurrent(generation)) setFailed(true);
    });
    return () => { current = false; };
  }, [householdId]);
  return <section className="settings-card settings-card--stack">
    <h2 className="setting-title">{t("settings.membersTitle")}</h2>
    {failed ? <p className="muted">{t("settings.membersUnavailable")}</p> : roles ? (
      roles.length ? <dl className="settings-member-roles">
        {memberRoles.map(([role, label]) => {
          const count = roles.filter(value => value === role).length;
          return count > 0 && <div key={role}><dt>{t(label)}</dt><dd>{count}</dd></div>;
        })}
      </dl> : <p className="muted">{t("settings.membersUnavailable")}</p>
    ) : <p role="status">{t("common.loading")}</p>}
  </section>;
}

function BirthDate({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(baby.birth_date ?? "");
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    if (!isValidBirthDateInput(value, Date.now())) {
      setError(true);
      setMessage(t(value ? "settings.birthDateFuture" : "settings.birthDateInvalid"));
      return;
    }
    const generation = sessionGeneration();
    setSaving(true);
    setMessage(null);
    setError(false);
    try {
      await updateBabyBirthDate(baby.id, value || null);
      if (!isSessionGenerationCurrent(generation)) return;
      const state = useAppStore.getState();
      state.setBabies(state.babies.map(item => item.id === baby.id ? { ...item, birth_date: value || null } : item));
      setMessage(t("settings.birthDateSaved"));
    } catch {
      setError(true);
      setMessage(t("errors.generic"));
    } finally {
      setSaving(false);
    }
  }
  return <section className="settings-card settings-card--stack">
    <label className="setting-title" htmlFor="settings-birth-date">{t("settings.birthDateLabel")}</label>
    <div className="settings-control-row">
      <input type="date" id="settings-birth-date" className="settings-select" value={value} disabled={saving}
        onChange={event => { setValue(event.target.value); setMessage(null); }} />
      <button type="button" className="secondary-button" disabled={saving} onClick={() => void save()}>
        {t(saving ? "common.saving" : "settings.birthDateSave")}
      </button>
    </div>
    {message && <p className={error ? "settings-error" : "muted"} role={error ? "alert" : "status"}>{message}</p>}
  </section>;
}

function NotificationsSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const baby = useAppStore(state => state.babies.find(item => item.id === state.currentBabyId));
  const legacyBabyId = useAppStore(state => state.currentBbyId);
  return <>
    <NotificationSettings bbyid={legacyBabyId}>
      {user && baby && <ReminderSetting key={user.id + baby.id} user={user.id} baby={baby.id} />}
      {baby && <SleepEventNotificationSettings key={baby.id} babyId={baby.id} babyName={baby.name} />}
    </NotificationSettings>
    <LiveActivitySettings />
    <Link className="settings-index-row settings-inline-link" to="/settings/notifications/sound">
      <span>{t("sound.title")}</span><span aria-hidden="true">&rsaquo;</span>
    </Link>
  </>;
}

const themes: Record<VisualTheme, TranslationKey> = {
  default: "settings.visualThemeDefault", alive: "settings.visualThemeAlive", outrun: "settings.visualThemeOutrun",
};

function AppearanceSection() {
  const { t } = useTranslation();
  const theme = useAppStore(state => state.theme);
  const toggleTheme = useAppStore(state => state.toggleTheme);
  const language = useAppStore(state => state.language);
  const setLanguage = useAppStore(state => state.setLanguage);
  const visualTheme = useAppStore(state => state.visualTheme);
  const setVisualTheme = useAppStore(state => state.setVisualTheme);
  return <div className="settings-preference-list">
    <label className="settings-preference-row">
      <span>{t("settings.appearanceTitle")}</span>
      <select value={theme} onChange={event => { if (event.target.value !== theme) toggleTheme(); }}>
        <option value="light">{t("settings.themeLight")}</option><option value="dark">{t("settings.themeDark")}</option>
      </select>
    </label>
    <label className="settings-preference-row">
      <span>{t("settings.languageTitle")}</span>
      <select value={language} onChange={event => setLanguage(event.target.value as Language)}>
        <option value="no" lang="nb">Norsk</option><option value="en" lang="en">English</option>
      </select>
    </label>
    <label className="settings-preference-row">
      <span>{t("settings.visualThemeTitle")}</span>
      <select value={visualTheme} onChange={event => setVisualTheme(event.target.value as VisualTheme)}>
        {Object.entries(themes).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
      </select>
    </label>
  </div>;
}

function AccountSection() {
  const { t } = useTranslation();
  const { signOut, user } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = [user?.user_metadata?.full_name, user?.user_metadata?.name]
    .find(value => typeof value === "string" && value.trim());
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setFailed(false);
    try { await signOut(); }
    catch { setFailed(true); setLoggingOut(false); }
  }
  return <>
    <div className="settings-account">
      <strong>{name || user?.email || t("settings.accountUnknownUser")}</strong>
      {name && user?.email && name !== user.email && <p className="muted">{user.email}</p>}
    </div>
    <button type="button" className="secondary-button" disabled={loggingOut} onClick={() => void logout()}>
      {t(loggingOut ? "settings.loggingOut" : "settings.logoutButton")}
    </button>
    {failed && <p role="alert">{t("settings.logoutError")}</p>}
  </>;
}
