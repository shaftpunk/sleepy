// Birth dates come from a Postgres `date` column (via Supabase, as a plain
// "YYYY-MM-DD" string with no time/timezone component) and from a native
// <input type="date">, which also produces "YYYY-MM-DD". Parsing that with
// `new Date("YYYY-MM-DD")` treats it as UTC midnight, which silently shifts
// the calendar date by a day in some timezones once displayed locally. Every
// birth-date parse in this app must go through this file instead.

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Parses a "YYYY-MM-DD" string as a LOCAL calendar date (midnight in the
// browser's own timezone), never via the UTC-parsing `new Date(string)`
// constructor. Returns null for anything that isn't a real calendar date.
export function parseLocalDateOnly(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;

  const match = DATE_ONLY_PATTERN.exec(dateString.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(year, month - 1, day, 0, 0, 0, 0);

  // Reject "2024-02-30"-style overflow: the Date constructor normalizes it
  // into March, so a mismatch means the input wasn't a real calendar date.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function isValidLocalDateOnly(dateString: string | null | undefined): boolean {
  return parseLocalDateOnly(dateString) != null;
}

// A birth date is valid input if it's empty (allowed - "no birth date yet"),
// a real calendar date, and not in the future (compared as calendar days,
// not exact milliseconds, so "today" is always allowed regardless of the
// current time of day).
export function isValidBirthDateInput(
  dateString: string | null | undefined,
  nowMs: number
): boolean {
  if (!dateString) return true;

  const parsed = parseLocalDateOnly(dateString);
  if (!parsed) return false;

  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);

  return parsed.getTime() <= today.getTime();
}

// Age in whole days: birth date counts as day 0. Returns null for an empty/
// invalid/future birth date.
export function ageInDays(
  birthDateString: string | null | undefined,
  nowMs: number
): number | null {
  const birth = parseLocalDateOnly(birthDateString);
  if (!birth) return null;

  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);

  const diffMs = today.getTime() - birth.getTime();
  if (diffMs < 0) return null; // future birth date

  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}
