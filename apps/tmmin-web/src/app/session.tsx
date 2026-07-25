import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiProblemError } from '@tmmin-henkaten/api-client';
import type { SessionResponse, TmminLoginRequest } from '@tmmin-henkaten/contracts';
import type { Capability } from '@tmmin-henkaten/contracts';

import { setCsrfToken, setExpiredHandler, tmminApi } from './api';
import { queryClient } from './query';

type SessionValue = {
  status: 'loading' | 'anonymous' | 'authenticated';
  session: SessionResponse | null;
  login: (input: TmminLoginRequest) => Promise<SessionResponse>;
  logout: () => Promise<void>;
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
  hasCapability: (capability: Capability) => boolean;
  refresh: () => Promise<void>;
};

const Context = createContext<SessionValue | null>(null);

export function TmminSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue['status']>('loading');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const identityRef = useRef<string | null>(null);
  const clear = useCallback(async () => {
    setCsrfToken(null);
    identityRef.current = null;
    setSession(null);
    setStatus('anonymous');
    sessionStorage.removeItem('tmmin-henkaten:intended-path');
    await queryClient.cancelQueries();
    queryClient.clear();
  }, []);
  const accept = useCallback(
    (next: SessionResponse) => {
      if (next.principal.realm !== 'TMMIN') {
        void clear();
        return;
      }
      if (identityRef.current && identityRef.current !== next.principal.userId) {
        void queryClient.cancelQueries();
        queryClient.clear();
      }
      identityRef.current = next.principal.userId;
      setCsrfToken(next.csrfToken);
      setSession(next);
      setStatus('authenticated');
    },
    [clear],
  );
  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      accept(await tmminApi.session());
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
    setExpiredHandler(() => void clear());
    void refresh().catch(() => undefined);
    return () => setExpiredHandler(null);
  }, [clear, refresh]);
  const value = useMemo<SessionValue>(
    () => ({
      status,
      session,
      async login(input) {
        const next = await tmminApi.login(input);
        await queryClient.cancelQueries();
        queryClient.clear();
        accept(next);
        return next;
      },
      async logout() {
        try {
          await tmminApi.logout();
        } finally {
          await clear();
        }
      },
      async changePassword(input) {
        await tmminApi.changePassword(input);
        await clear();
      },
      hasCapability: (capability) => session?.capabilities.includes(capability) ?? false,
      refresh,
    }),
    [accept, clear, refresh, session, status],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function rememberIntendedPath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/login')) return;
  sessionStorage.setItem('tmmin-henkaten:intended-path', path);
}

export function consumeIntendedPath(): string {
  const value = sessionStorage.getItem('tmmin-henkaten:intended-path');
  sessionStorage.removeItem('tmmin-henkaten:intended-path');
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function useTmminSession() {
  const value = useContext(Context);
  if (!value) throw new Error('useTmminSession must be inside provider.');
  return value;
}
