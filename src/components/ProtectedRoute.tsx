"use client";

/**
 * Auth gate for client-only pages.
 * Middleware already redirects unauthenticated users; this component
 * renders children immediately without a redundant /api/auth/session fetch.
 */
interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  return <>{children}</>;
}
