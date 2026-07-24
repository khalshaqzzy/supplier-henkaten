import { sessionResponseSchema, type TmminLoginRequest } from '@tmmin-henkaten/contracts';

import { ApiClient } from './core';

export class TmminApi {
  constructor(private readonly client: ApiClient) {}

  login(body: TmminLoginRequest) {
    return this.client.request('/api/v1/auth/tmmin/login', {
      method: 'POST',
      body,
      responseSchema: sessionResponseSchema,
      authenticated: false,
    });
  }

  session() {
    return this.client.request('/api/v1/auth/tmmin/session', {
      responseSchema: sessionResponseSchema,
    });
  }

  changePassword(body: { currentPassword: string; newPassword: string }) {
    return this.client.request('/api/v1/auth/tmmin/change-password', {
      method: 'POST',
      body,
      responseType: 'void',
    });
  }

  logout() {
    return this.client.request('/api/v1/auth/tmmin/logout', {
      method: 'POST',
      responseType: 'void',
    });
  }
}
