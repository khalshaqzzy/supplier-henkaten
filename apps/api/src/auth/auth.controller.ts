import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  passwordChangeRequestSchema,
  supplierLoginRequestSchema,
  supplierAdminMagicLinkRequestSchema,
  tmminLoginRequestSchema,
} from '@tmmin-henkaten/contracts';

import { Authenticated, Public } from '../common/policy.js';
import type { ContextRequest } from '../common/request-context.js';
import { ValidatedBody } from '../common/zod.js';
import { AuthControllerFacade } from './auth.facade.js';
import { SupplierAdminMagicLinkService } from './supplier-admin-magic-link.service.js';

@Controller('/api/v1/auth/supplier')
export class SupplierAuthController {
  constructor(
    private readonly facade: AuthControllerFacade,
    private readonly magicLinks: SupplierAdminMagicLinkService,
  ) {}

  @Public()
  @Post('/magic-link/redeem')
  @HttpCode(200)
  redeem(
    @ValidatedBody(supplierAdminMagicLinkRequestSchema) body: { token: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.magicLinks.redeem(body.token, request, response);
  }

  @Public()
  @Post('/login')
  @HttpCode(200)
  login(
    @ValidatedBody(supplierLoginRequestSchema)
    body: { supplierCode: string; username: string; password: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.facade.login('SUPPLIER', body, request, response, body.supplierCode);
  }

  @Authenticated()
  @Get('/session')
  session(@Req() request: ContextRequest) {
    return this.facade.session(request);
  }

  @Authenticated()
  @Post('/change-password')
  changePassword(
    @ValidatedBody(passwordChangeRequestSchema)
    body: { currentPassword: string; newPassword: string },
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.facade.changePassword(body, request, response);
  }

  @Authenticated()
  @Post('/logout')
  logout(@Req() request: ContextRequest, @Res({ passthrough: true }) response: Response) {
    return this.facade.logout(request, response);
  }
}

@Controller('/api/v1/auth/tmmin')
export class TmminAuthController {
  constructor(private readonly facade: AuthControllerFacade) {}

  @Public()
  @Post('/login')
  @HttpCode(200)
  login(
    @ValidatedBody(tmminLoginRequestSchema) body: { username: string; password: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.facade.login('TMMIN', body, request, response);
  }

  @Authenticated()
  @Get('/session')
  session(@Req() request: ContextRequest) {
    return this.facade.session(request);
  }

  @Authenticated()
  @Post('/change-password')
  changePassword(
    @ValidatedBody(passwordChangeRequestSchema)
    body: { currentPassword: string; newPassword: string },
    @Req() request: ContextRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.facade.changePassword(body, request, response);
  }

  @Authenticated()
  @Post('/logout')
  logout(@Req() request: ContextRequest, @Res({ passthrough: true }) response: Response) {
    return this.facade.logout(request, response);
  }
}
