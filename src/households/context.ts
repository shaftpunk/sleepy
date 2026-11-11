export type HouseholdRole = "owner" | "parent" | "caregiver" | "viewer";
export type HouseholdCandidate = { id: string; name: string; role: HouseholdRole };
export type HouseholdContext = { userId: string; babyId: string; householdId: string };

export function chooseHouseholdId(candidates: readonly { id: string }[], stored: string | null): string | null {
  if (stored && candidates.some(candidate => candidate.id === stored)) return stored;
  if (candidates.length === 1) { const [only] = candidates; return only.id; }
  return null;
}
const storageKey = (userId: string) => `sleepy.household-context.v1:${userId}`;
export function readHouseholdChoice(userId: string, babyId: string): string | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
    const value = (saved as Record<string, unknown>)[babyId];
    return typeof value === "string" ? value : null;
  } catch { return null; }
}
export function saveHouseholdChoice(userId: string, babyId: string, householdId: string | null): void {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "{}");
    const saved: Record<string, unknown> = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    if (householdId) saved[babyId] = householdId; else delete saved[babyId];
    localStorage.setItem(storageKey(userId), JSON.stringify(saved));
  } catch { /* Valid in-memory context remains usable when storage is unavailable. */ }
}
