import { translate, type Language } from "../i18n";

// Display formatting only; Home's existing calculators still supply durations.
export function formatHomeDuration(totalMinutes: number, language: Language): string {
  const total = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(total / 60), minutes = total % 60;
  const number = new Intl.NumberFormat(language === "no" ? "nb" : "en");
  return translate(language, hours ? minutes ? "home.durationHoursMinutes" : "home.durationHours" : "home.durationMinutes",
    { hours: number.format(hours), minutes: number.format(minutes) });
}
