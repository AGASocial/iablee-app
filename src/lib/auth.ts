import { useCallback, useEffect, useState } from 'react';

interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    [key: string]: unknown;
  };
}

interface SessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        setUser(null);
        setError('Failed to get session');
        return;
      }

      const data = (await response.json()) as SessionResponse;
      setUser(data.authenticated ? data.user : null);
      setError(null);
    } catch (err) {
      console.error('Error loading auth session:', err);
      setUser(null);
      setError('Failed to get session');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/auth/session', {
          method: 'GET',
          credentials: 'include',
        });

        if (cancelled) return;

        if (!response.ok) {
          setUser(null);
          setError('Failed to get session');
          return;
        }

        const data = (await response.json()) as SessionResponse;
        if (cancelled) return;
        setUser(data.authenticated ? data.user : null);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading auth session:', err);
        setUser(null);
        setError('Failed to get session');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const onAuthChanged = () => {
      setLoading(true);
      void refreshSession();
    };

    window.addEventListener('auth-changed', onAuthChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('auth-changed', onAuthChanged);
    };
  }, [refreshSession]);

  const signOut = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? 'Failed to sign out');
        return;
      }

      setUser(null);
      setError(null);
      window.dispatchEvent(new Event('auth-changed'));
    } catch (err) {
      console.error('Error signing out:', err);
      setError('Failed to sign out');
    }
  };

  return {
    user,
    loading,
    error,
    signOut,
    isAuthenticated: !!user,
  };
}
