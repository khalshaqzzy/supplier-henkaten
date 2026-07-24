import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiProblemError } from '@tmmin-henkaten/api-client';
import type { SessionResponse, TmminLoginRequest } from '@tmmin-henkaten/contracts';

import { setCsrfToken, setExpiredHandler, tmminApi } from './api';

type SessionValue = {
  status: 'loading' | 'anonymous' | 'authenticated';
  session: SessionResponse | null;
  login: (input: TmminLoginRequest) => Promise<SessionResponse>;
  logout: () => Promise<void>;
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
};

const Context = createContext<SessionValue | null>(null);

export function TmminSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue['status']>('loading');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const clear = useCallback(() => {
    setCsrfToken(null);
    setSession(null);
    setStatus('anonymous');
    sessionStorage.removeItem('tmmin-henkaten:intended-path');
  }, []);
  const accept = useCallback(
    (next: SessionResponse) => {
      if (next.principal.realm !== 'TMMIN') {
        clear();
        return;
      }
      setCsrfToken(next.csrfToken);
      setSession(next);
      setStatus('authenticated');
    },
    [clear],
  );
  useEffect(() => {
    setExpiredHandler(clear);
    void tmminApi
      .session()
      .then(accept)
      .catch((error) => {
        if (error instanceof ApiProblemError && error.problem.status === 401) clear();
        else setStatus('anonymous');
      });
    return () => setExpiredHandler(null);
  }, [accept, clear]);
  const value = useMemo<SessionValue>(
    () => ({
      status,
      session,
      async login(input) {
        const next = await tmminApi.login(input);
        accept(next);
        return next;
      },
      async logout() {
        try {
          await tmminApi.logout();
        } finally {
          clear();
        }
      },
      async changePassword(input) {
        await tmminApi.changePassword(input);
        clear();
      },
    }),
    [accept, clear, session, status],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTmminSession() {
  const value = useContext(Context);
  if (!value) throw new Error('useTmminSession must be inside provider.');
  return value;
}
