import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';

import type { Observable } from 'rxjs';

@Injectable()
export class RequestRouteInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      route?: { path?: string };
      logRoute?: string;
    }>();
    if (request.route?.path) request.logRoute = request.route.path;
    return next.handle();
  }
}
