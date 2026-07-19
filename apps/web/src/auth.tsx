import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "./api.js";
import type { AuthResponse, Environment, Project } from "./types.js";

interface AuthContextValue {
  auth: AuthResponse | null;
  project: Project | null;
  environment: Environment | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  signup(name: string, email: string, password: string): Promise<void>;
  refresh(): Promise<void>;
  logout(): Promise<void>;
  selectEnvironment(environmentId: string): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ENVIRONMENT_KEY = "qmon_environment_id";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [environmentId, setEnvironmentId] = useState(() => localStorage.getItem(ENVIRONMENT_KEY));
  const [loading, setLoading] = useState(true);

  const adoptAuth = useCallback((value: AuthResponse) => {
    setAuth(value);
    setEnvironmentId((current) => {
      const environments = value.projects.flatMap((project) => project.environments);
      const selected = environments.some((environment) => environment.id === current)
        ? current
        : (environments[0]?.id ?? null);
      if (selected) localStorage.setItem(ENVIRONMENT_KEY, selected);
      else localStorage.removeItem(ENVIRONMENT_KEY);
      return selected;
    });
  }, []);

  useEffect(() => {
    api
      .me()
      .then(adoptAuth)
      .catch((error: unknown) => {
        if (!(error instanceof ApiError) || error.status !== 401) console.error(error);
        setAuth(null);
      })
      .finally(() => setLoading(false));
  }, [adoptAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      project: auth?.projects.find((item) => item.environments.some((environment) => environment.id === environmentId)) ?? null,
      environment: auth?.projects.flatMap((item) => item.environments).find((item) => item.id === environmentId) ?? null,
      loading,
      async login(email, password) {
        adoptAuth(await api.login(email, password));
      },
      async signup(name, email, password) {
        adoptAuth(await api.signup(name, email, password));
      },
      async refresh() {
        adoptAuth(await api.me());
      },
      async logout() {
        try {
          await api.logout();
        } finally {
          setAuth(null);
        }
      },
      selectEnvironment(nextEnvironmentId) {
        if (!auth?.projects.some((item) => item.environments.some((environment) => environment.id === nextEnvironmentId))) return;
        localStorage.setItem(ENVIRONMENT_KEY, nextEnvironmentId);
        setEnvironmentId(nextEnvironmentId);
      },
    }),
    [adoptAuth, auth, environmentId, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
