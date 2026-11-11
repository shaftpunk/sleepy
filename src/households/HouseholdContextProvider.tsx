import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { registerBeforeSignOut, sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";
import { useAppStore } from "../stores/appStore";
import { getHouseholdCandidates, subscribeHouseholdContext } from "../services/householdContextService";
import { chooseHouseholdId, readHouseholdChoice, saveHouseholdChoice, type HouseholdCandidate } from "./context";

type Snapshot = { userId: string; babyId: string; generation: number; candidates: HouseholdCandidate[]; householdId: string | null; unavailable: boolean };
type Value = { userId: string | null; babyId: string | null; householdId: string | null; candidates: HouseholdCandidate[];
  loading: boolean; unavailable: boolean; choose: (id: string) => void; refresh: () => void };
const Context = createContext<Value | undefined>(undefined);
export function HouseholdContextProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const babyId = useAppStore(state => state.currentBabyId);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => registerBeforeSignOut(async () => { setSnapshot(null); }), []);
  useEffect(() => {
    if (authLoading || !userId || !babyId) return;
    let current = true, request = 0;
    async function load() {
      const version = ++request, generation = sessionGeneration();
      try {
        const candidates = await getHouseholdCandidates(userId!, babyId!);
        if (!current || request !== version || !isSessionGenerationCurrent(generation)) return;
        const selected = chooseHouseholdId(candidates, readHouseholdChoice(userId!, babyId!));
        saveHouseholdChoice(userId!, babyId!, selected);
        setSnapshot({ userId: userId!, babyId: babyId!, generation, candidates, householdId: selected, unavailable: false });
      } catch {
        if (current && request === version && isSessionGenerationCurrent(generation)) {
          setSnapshot({ userId: userId!, babyId: babyId!, generation, candidates: [], householdId: null, unavailable: true });
        }
      }
    }
    void load();
    const visible = () => { if (!document.hidden) void load(); };
    const unsubscribe = subscribeHouseholdContext(userId, babyId, visible);
    // Realtime publication is optional. Foreground polling also catches lost
    // sockets and membership removals that are no longer visible through RLS.
    const timer = window.setInterval(visible, 60000);
    document.addEventListener("visibilitychange", visible); document.addEventListener("resume", visible);
    return () => { current = false; unsubscribe(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible); document.removeEventListener("resume", visible); };
  }, [authLoading, userId, babyId, revision]);
  const scoped = !authLoading && userId && babyId && snapshot?.userId === userId && snapshot.babyId === babyId && isSessionGenerationCurrent(snapshot.generation) ? snapshot : null;
  const choose = (id: string) => {
    if (!scoped || !scoped.candidates.some(candidate => candidate.id === id)) return;
    saveHouseholdChoice(scoped.userId, scoped.babyId, id);
    setSnapshot({ ...scoped, householdId: id });
  };
  return <Context.Provider key={userId ?? "signed-out"} value={{ userId, babyId, householdId: scoped?.householdId ?? null,
    candidates: scoped?.candidates ?? [], loading: Boolean(authLoading || (userId && babyId && !scoped)),
    unavailable: scoped?.unavailable ?? false, choose, refresh }}>{children}</Context.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useHouseholdContext(): Value {
  const value = useContext(Context);
  if (!value) throw new Error("HouseholdContextProvider is required");
  return value;
}
