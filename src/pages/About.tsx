import AppVersion from "../components/AppVersion";
import { useTranslation } from "../i18n";
import { SettingsScreen } from "./Settings";

function httpsDestination(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

const destinations = [
  ["settings.privacy", httpsDestination(import.meta.env.VITE_SLEEPY_PRIVACY_URL)],
  ["settings.terms", httpsDestination(import.meta.env.VITE_SLEEPY_TERMS_URL)],
  ["settings.support", httpsDestination(import.meta.env.VITE_SLEEPY_SUPPORT_URL)],
] as const;

export default function About() {
  const { t } = useTranslation();
  return <SettingsScreen title={t("settings.aboutTitle")}>
    <div className="about-page settings-about-content">
      <AppVersion />
      {destinations.map(([label, href]) => href && <a className="settings-index-row settings-inline-link"
        key={label} href={href} target="_blank" rel="noopener noreferrer">
        <span>{t(label)}</span><span aria-hidden="true">&rsaquo;</span>
      </a>)}
    </div>
  </SettingsScreen>;
}
