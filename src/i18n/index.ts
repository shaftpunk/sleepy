import { useCallback } from "react";

import no from "./no";
import en from "./en";
import type { Language, TranslationKey, Translations } from "./types";
import { useAppStore } from "../stores/appStore";

export type { Language, TranslationKey, Translations };

const RESOURCES: Record<Language, Translations> = { no, en };

export const LOCALES: Record<Language, string> = {
  no: "nb-NO",
  en: "en-GB",
};

type Params = Record<string, string | number>;

function lookup(resource: Translations, key: string): string | undefined {
  let node: unknown = resource;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }

  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

// Falls back no -> en -> the raw key. English is always complete (checked at
// compile time via en.ts's `satisfies Translations`), so the raw-key case
// should never actually surface to a user. `key` is typed as TranslationKey
// (every valid dot-path into Translations), so a typo'd key is a compile
// error rather than a silent runtime fallback.
export function translate(lang: Language, key: TranslationKey, params?: Params): string {
  const template = lookup(RESOURCES[lang], key) ?? lookup(en, key) ?? key;
  return interpolate(template, params);
}

export function useTranslation() {
  const lang = useAppStore((state) => state.language);

  // Stable across renders as long as `lang` doesn't change — components
  // that (correctly or not) list `t` in a useEffect/useCallback dependency
  // array won't re-run on every render just because a new closure was
  // created. Without this, any effect that both reads `t` and sets state
  // unconditionally would loop forever (new render -> new `t` -> effect
  // re-fires -> setState -> new render -> ...).
  const t = useCallback(
    (key: TranslationKey, params?: Params) => translate(lang, key, params),
    [lang]
  );

  return { t, lang, locale: LOCALES[lang] };
}
