import { describe, expect, it } from 'vitest';

import { loadAppConfig } from '../config/app-config.js';
import { PasswordService } from './password.service.js';

const config = loadAppConfig({
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:55432/database',
  SESSION_CSRF_SECRET: 'csrf-secret-that-is-at-least-thirty-two-characters',
  AUTH_THROTTLE_SECRET: 'throttle-secret-at-least-thirty-two-characters',
});

describe('PasswordService', () => {
  it('uses Argon2id and creates high-entropy temporary passwords', async () => {
    const service = new PasswordService(config);
    const temporary = service.temporaryPassword();
    const hash = await service.hash(temporary);
    expect(temporary.length).toBeGreaterThanOrEqual(32);
    expect(hash).toContain('$argon2id$v=19$');
    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
    expect(hash).toContain('p=1');
    await expect(service.verify(hash, temporary)).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });
});
