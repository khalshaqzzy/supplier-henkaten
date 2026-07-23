import { Controller, Get } from '@nestjs/common';

import { Public } from '../common/policy.js';
import { buildOpenApiDocument } from './document.js';

@Controller('/api/v1')
export class OpenApiController {
  @Public()
  @Get('/openapi.json')
  document(): Record<string, unknown> {
    return buildOpenApiDocument();
  }
}
