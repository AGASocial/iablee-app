/**
 * Route handler timing instrumentation for production observability.
 * Logs structured timing data; integrate with Vercel log drain or APM.
 */

export interface TimingMeta {
  route: string;
  method?: string;
  durationMs: number;
  status?: number;
}

/** Alert thresholds documented in plan/PERFORMANCE-REVIEW.md */
export const TIMING_THRESHOLDS_MS = {
  warn: 500,
  critical: 2000,
} as const;

export function logRouteTiming(meta: TimingMeta): void {
  const level =
    meta.durationMs >= TIMING_THRESHOLDS_MS.critical
      ? 'critical'
      : meta.durationMs >= TIMING_THRESHOLDS_MS.warn
        ? 'warn'
        : 'ok';

  console.log(
    JSON.stringify({
      type: 'route_timing',
      level,
      ...meta,
      timestamp: new Date().toISOString(),
    })
  );
}

type RouteHandler<T extends Request = Request> = (
  request: T,
  context?: unknown
) => Promise<Response>;

/**
 * Wraps a route handler to measure and log execution duration.
 */
export function withTiming<T extends Request = Request>(
  routeName: string,
  handler: RouteHandler<T>
): RouteHandler<T> {
  return async (request: T, context?: unknown) => {
    const start = performance.now();
    let status = 500;
    try {
      const response = await handler(request, context);
      status = response.status;
      return response;
    } finally {
      logRouteTiming({
        route: routeName,
        method: request?.method ?? 'GET',
        durationMs: Math.round(performance.now() - start),
        status,
      });
    }
  };
}
