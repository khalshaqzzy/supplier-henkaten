type RequestForLogging = {
  method?: string | undefined;
  route?: string | { path?: string | undefined } | undefined;
  logRoute?: string | undefined;
};

type LoggableObject = Record<string, unknown>;

export function completedRequestLog(
  request: RequestForLogging,
  loggable: LoggableObject,
): LoggableObject {
  const route =
    request.logRoute ?? (typeof request.route === 'string' ? request.route : request.route?.path);
  return {
    ...loggable,
    routeTemplate: route ?? 'UNMATCHED',
    req: {
      method: request.method,
    },
  };
}

export function failedRequestLog(
  request: RequestForLogging,
  _error: Error,
  loggable: LoggableObject,
): LoggableObject {
  return completedRequestLog(request, loggable);
}

export function serializeLoggedRequest(request: RequestForLogging) {
  return {
    method: request.method,
    route: typeof request.route === 'string' ? request.route : request.route?.path,
  };
}
