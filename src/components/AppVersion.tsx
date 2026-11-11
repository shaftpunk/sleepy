import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { liveActivityBridge, liveActivitiesSupported } from "../services/liveActivityService";
import packageInfo from "../../package.json";

export default function AppVersion() {
  const { t } = useTranslation();
  const [native, setNative] = useState<{ version: string; build: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (liveActivitiesSupported()) void liveActivityBridge.getAppInfo()
      .then(info => { if (active) setNative(info); })
      .catch(() => { /* Do not present the web package as a native release. */ });
    return () => { active = false; };
  }, []);
  return <section className="settings-card settings-card--stack settings-about">
    <h2 className="setting-title">{t("settings.aboutTitle")}</h2>
    {liveActivitiesSupported() ? native && <p className="muted">
      Sleepy {native.version}{native.build && <> · {t("settings.appBuild", { build: native.build })}</>}
    </p> : <p className="muted">{t("settings.webVersion", { version: packageInfo.version })}</p>}
  </section>;
}
