/** Application-wide authentication state.
 *
 * The browser only receives an opaque HttpOnly session cookie. Keycloak
 * access and refresh tokens stay in the standalone Go authentication service.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "../types/api";
import {
  getKeycloakAccountUrl,
  getKeycloakProviderLoginUrl,
  keepKeycloakSessionAlive,
  loginWithKeycloak,
  logoutFromKeycloak,
  refreshAuthSession,
  registerWithKeycloak,
} from "../services/api";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  keycloak_not_configured: "Keycloak login is not configured on this server.",
  keycloak_denied: "Authentication was cancelled. Please try again.",
  keycloak_token_exchange: "Keycloak could not complete the login. Please try again.",
  invalid_oauth_state: "The login response could not be verified. Please start again.",
  invalid_identity_provider: "That identity provider is not allowed.",
};

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  authError: string | null;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    passwordConfirmation: string,
  ) => Promise<void>;
  loginWithProvider: (provider: "github" | "orcid") => void;
  signOut: () => Promise<void>;
  manageAccount: () => void;
  refreshSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAdmin: false,
  authError: null,
  login: async () => {},
  register: async () => {},
  loginWithProvider: () => {},
  signOut: async () => {},
  manageAccount: () => {},
  refreshSession: async () => false,
});

function consumeAuthError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("auth_error");
  if (!code) return null;
  url.searchParams.delete("auth_error");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return AUTH_ERROR_MESSAGES[code] ?? "Authentication failed. Please try again.";
}

function currentReturnPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError] = useState<string | null>(consumeAuthError);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const session = await refreshAuthSession();
      setUser(session.user);
      return true;
    } catch {
      setUser(null);
      return false;
    }
  }, []);

  useEffect(() => {
    let active = true;

    refreshAuthSession()
      .then((session) => {
        if (active) setUser(session.user);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    // Refresh the Keycloak token in the Go service before its default
    // five-minute access-token lifetime expires, then reload public claims.
    const interval = window.setInterval(() => {
      void keepKeycloakSessionAlive()
        .then(() => refreshAuthSession())
        .then((session) => {
          if (active) setUser(session.user);
        })
        .catch(() => {
          if (active) setUser(null);
        });
    }, 4 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const login = useCallback(async (emailOrUsername: string, password: string) => {
    const session = await loginWithKeycloak(emailOrUsername, password);
    setUser(session.user);
    setIsLoading(false);
  }, []);

  const register = useCallback(async (
    username: string,
    email: string,
    password: string,
    passwordConfirmation: string,
  ) => {
    await registerWithKeycloak(username, email, password, passwordConfirmation);
    const session = await loginWithKeycloak(username, password);
    setUser(session.user);
    setIsLoading(false);
  }, []);

  const loginWithProvider = useCallback((provider: "github" | "orcid") => {
    window.location.assign(getKeycloakProviderLoginUrl(provider, currentReturnPath()));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutFromKeycloak();
    } finally {
      setUser(null);
      setIsLoading(false);
    }
  }, []);

  const manageAccount = useCallback(() => {
    window.location.assign(getKeycloakAccountUrl());
  }, []);

  return (
    <AuthContext
      value={{
        user,
        isLoading,
        isAdmin: user?.is_admin ?? false,
        authError,
        login,
        register,
        loginWithProvider,
        signOut,
        manageAccount,
        refreshSession,
      }}
    >
      {children}
    </AuthContext>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
