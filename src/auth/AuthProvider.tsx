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

  useEffect(() => {
    let active = true;

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

      if (active) {
        accountUser.current = data.session?.user.id ?? null;
        setSession(data.session ?? null);
        setLoading(false);
      }
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        const nextUser = nextSession?.user.id ?? null;
        if (!nextSession || accountUser.current !== nextUser) {
          invalidateSessionWork();
          useAppStore.getState().clearAccountState();
        }
        accountUser.current = nextUser;
        setSession(nextSession);
        setLoading(false);
      },
    );

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await prepareSignOut();
    const { error } =
      await supabase.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }
    useAppStore.getState().clearAccountState();
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
