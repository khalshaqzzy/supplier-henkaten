import { Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '../common/scope.js';
import { SupplierAuthController, TmminAuthController } from './auth.controller.js';
import { AuthControllerFacade } from './auth.facade.js';
import { CsrfGuard, GlobalRateLimitGuard, SessionAuthenticationGuard } from './auth.guards.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { SessionService } from './session.service.js';
import { SupplierAdminMagicLinkService } from './supplier-admin-magic-link.service.js';
import { PushModule } from '../push/push.module.js';

@Module({
  imports: [PushModule],
  controllers: [SupplierAuthController, TmminAuthController],
  providers: [
    AuthControllerFacade,
    AuthService,
    PasswordService,
    RateLimiterService,
    SessionService,
    SupplierAdminMagicLinkService,
    SessionAuthenticationGuard,
    CsrfGuard,
    GlobalRateLimitGuard,
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [
    RateLimiterService,
    AuthService,
    PasswordService,
    SessionService,
    SupplierAdminMagicLinkService,
    SessionAuthenticationGuard,
    CsrfGuard,
    GlobalRateLimitGuard,
  ],
})
export class AuthModule {}
