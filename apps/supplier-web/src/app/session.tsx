import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Capability, SessionResponse, SupplierLoginRequest } from '@tmmin-henkaten/contracts';
import { ApiProblemError } from '@tmmin-henkaten/api-client';

import { queryClient } from './query';
import { setCsrfToken, setSessionExpiredHandler, supplierApi } from './api';

type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

interface SessionContextValue {
  status: SessionStatus;
  session: SessionResponse | null;
  login: (input: SupplierLoginRequest) => Promise<SessionResponse>;
  logout: () => Promise<void>;
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
  hasCapability: (capability: Capability) => boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<SessionResponse | null>(null);

  const clear = useCallback(async () => {
    setCsrfToken(null);
    setSession(null);
    setStatus('anonymous');
    sessionStorage.removeItem('supplier-henkaten:intended-path');
    await queryClient.cancelQueries();
    queryClient.clear();
  }, []);

  const accept = useCallback((next: SessionResponse) => {
    setCsrfToken(next.csrfToken);
    setSession(next);
    setStatus('authenticated');
  }, []);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      accept(await supplierApi.session());
    } catch (error) {
      if (error instanceof ApiProblemError && error.problem.status === 401) {
        await clear();
        return;
      }
      setStatus('anonymous');
      throw error;
    }
  }, [accept, clear]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      void clear();
    });
    void refresh().catch(() => undefined);
    return () => setSessionExpiredHandler(null);
  }, [clear, refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      async login(input) {
        const next = await supplierApi.login(input);
        await queryClient.cancelQueries();
        queryClient.clear();
        accept(next);
        return next;
      },
      async logout() {
        try {
          await supplierApi.logout();
        } finally {
          await clear();
        }
      },
      async changePassword(input) {
        await supplierApi.changePassword(input);
        await clear();
      },
      hasCapability: (capability) => session?.capabilities.includes(capability) ?? false,
      refresh,
    }),
    [accept, clear, refresh, session, status],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider.');
  return value;
}

export function rememberIntendedPath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/login')) return;
  sessionStorage.setItem('supplier-henkaten:intended-path', path);
}

export function consumeIntendedPath(): string {
  const value = sessionStorage.getItem('supplier-henkaten:intended-path');
  sessionStorage.removeItem('supplier-henkaten:intended-path');
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}
