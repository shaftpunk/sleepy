import type no from "./no";

// no.ts is the source of truth for structure; en.ts is checked against this
// (via `satisfies`) so a missing/extra key is a compile error.
export type Translations = typeof no;

export type Language = "no" | "en";

type Join<K extends string, Rest> = Rest extends string ? `${K}.${Rest}` : K;

// Flattens the nested Translations shape into every valid dot-path string
// (e.g. "common.save", "analysis.insights.busiestWindow"). Passing a typo'd
// or non-existent key to t()/translate() is then a compile error instead of
// a silent raw-key fallback at runtime.
type PathsOf<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : Join<K, PathsOf<T[K]>>;
    }[keyof T & string];

export type TranslationKey = PathsOf<Translations>;
