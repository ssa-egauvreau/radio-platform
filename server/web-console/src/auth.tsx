import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, SESSION_EXPIRED_EVENT, setToken, type SessionUser } from "./api";

const TOKEN_KEY = "securityradio.token";

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  login: (username: string, password: string, agencySlug?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setReady(true);
      return;
    }
    setToken(stored);
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setReady(true));
  }, []);

  // The api client clears the token and fires this whenever the server returns
  // 401 mid-session (account disabled, signed-in elsewhere, etc.). Reacting
  // here drops the React user state in the same tick so the app falls back to
  // the login screen without waiting for the next user interaction.
  useEffect(() => {
    function onSessionExpired() {
      setUser(null);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      async login(username, password, agencySlug) {
        const res = await api.login(username, password, agencySlug);
        localStorage.setItem(TOKEN_KEY, res.token);
        setToken(res.token);
        setUser(res.user);
      },
      logout() {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      },
    }),
    [user, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
