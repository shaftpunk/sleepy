import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";

import type {
  Session,
  User,
} from "@supabase/supabase-js";

import { supabase } from "../lib/supabase";
import { useAppStore } from "../stores/appStore";
import { invalidateSessionWork, prepareSignOut } from "./sessionLifecycle";
import { setNativePushUser } from "../services/nativePushService";
import { synchronizeNativeSleepSession } from "../services/nativeSleepSession";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [session, setSession] =
    useState<Session | null>(null);

  const [loading, setLoading] =
    useState(true);
  const accountUser = useRef<string | null>(null);
  const signingOut = useRef(false);

  useEffect(() => {
    let active = true;
    let authEventSeen = false;
    let latestSession: Session | null = null;
    function mirror(next: Session | null) {
      latestSession = next;
      if (!signingOut.current || !next) void synchronizeNativeSleepSession(next).catch(() => {});
    }

    async function loadSession() {
      const {
        data,
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error(
          "Could not load auth session:",
          error,
        );
      }

      if (active && !authEventSeen) {
        accountUser.current = data.session?.user.id ?? null;
        setSession(data.session ?? null);
        setLoading(false);
        mirror(data.session);
      }
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        authEventSeen = true;
        const nextUser = nextSession?.user.id ?? null;
        if (!nextSession || accountUser.current !== nextUser) {
          invalidateSessionWork();
          useAppStore.getState().clearAccountState();
        }
        accountUser.current = nextUser;
        setSession(nextSession);
        setLoading(false);
        // Only calls the Capacitor bridge; no Supabase work inside this callback.
        mirror(nextSession);
      },
    );

    const resume = () => { if (!document.hidden && authEventSeen) mirror(latestSession); };
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("resume", resume);
    return () => {
      active = false;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("resume", resume);
    };
  }, []);

  async function signOut() {
    signingOut.current = true;
    try {
      await prepareSignOut();
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(error.message);
      useAppStore.getState().clearAccountState();
    } finally {
      signingOut.current = false;
    }
  }

  useEffect(() => {
    // Keep Supabase network work outside onAuthStateChange's synchronous callback.
    void setNativePushUser(session?.user.id ?? null).catch(() => {
      // The notification service exposes a safe registration-failed state in Settings.
    });
    const onResume = () => {
      if (document.visibilityState === "visible") {
        void setNativePushUser(session?.user.id ?? null, true).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onResume);
    return () => document.removeEventListener("visibilitychange", onResume);
  }, [session?.user.id]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider",
    );
  }

  return context;
}
