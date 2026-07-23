import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('dummy-password-that-is-never-valid');
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.argon2MemoryKib,
      timeCost: this.config.argon2Iterations,
      parallelism: this.config.argon2Parallelism,
      hashLength: 32,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  async verifyDummy(password: string): Promise<void> {
    await this.verify(this.dummyHash, password);
  }

  temporaryPassword(): string {
    return randomBytes(24).toString('base64url');
  }
}
