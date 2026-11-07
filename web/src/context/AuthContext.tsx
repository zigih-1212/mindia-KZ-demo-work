import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, clearSession, getStoredUser, getToken, storeSession } from "../services/api";
import type { LoginResult, User } from "../types";

interface AuthState {
  user: User | null;
  /** true, пока профиль проверяется по токену при старте приложения. */
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    fullName: string;
    position?: string;
    role?: string;
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [initializing, setInitializing] = useState<boolean>(() => Boolean(getToken()));

  // При старте: есть токен — подтверждаем его настоящим /me.
  useEffect(() => {
    if (!getToken()) {
      setInitializing(false);
      return;
    }
    let alive = true;
    api
      .me()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch(() => {
        if (alive) {
          clearSession();
          setUser(null);
        }
      })
      .finally(() => {
        if (alive) setInitializing(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const applyResult = useCallback((res: LoginResult) => {
    storeSession(res.token, res.user);
    setUser(res.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      applyResult(await api.login(email, password));
    },
    [applyResult],
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      fullName: string;
      position?: string;
      role?: string;
    }) => {
      applyResult(await api.register(input));
    },
    [applyResult],
  );

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, initializing, login, register, logout }),
    [user, initializing, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
