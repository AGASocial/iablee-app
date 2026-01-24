import { renderHook, waitFor } from '@testing-library/react';
import { useAuth } from '../auth';
import { supabase } from '../supabase';

jest.mock('../supabase');

describe('useAuth', () => {
  const mockSupabase = supabase as jest.Mocked<typeof supabase>;
  const mockUnsubscribe = jest.fn();
  const mockSubscription = {
    data: { subscription: { unsubscribe: mockUnsubscribe } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with loading state', () => {
    mockSupabase.auth.getSession = jest.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockSupabase.auth.onAuthStateChange = jest.fn().mockReturnValue(mockSubscription);

    const { result } = renderHook(() => useAuth());

    expect(result.current.loading).toBe(true);
  });

  it('should return user when session exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockUser: any = {
      id: 'user-123',
      email: 'test@example.com',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSession: any = {
      user: mockUser,
      access_token: 'token',
    };

    mockSupabase.auth.getSession = jest.fn().mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });
    mockSupabase.auth.onAuthStateChange = jest.fn().mockReturnValue(mockSubscription);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should return null user when no session', async () => {
    mockSupabase.auth.getSession = jest.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockSupabase.auth.onAuthStateChange = jest.fn().mockReturnValue(mockSubscription);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('should handle session errors', async () => {
    const errorMessage = 'Session error';
    mockSupabase.auth.getSession = jest.fn().mockResolvedValue({
      data: { session: null },
      error: { message: errorMessage },
    });
    mockSupabase.auth.onAuthStateChange = jest.fn().mockReturnValue(mockSubscription);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(errorMessage);
  });

  it('should call signOut successfully', async () => {
    mockSupabase.auth.getSession = jest.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockSupabase.auth.onAuthStateChange = jest.fn().mockReturnValue(mockSubscription);
    mockSupabase.auth.signOut = jest.fn().mockResolvedValue({
      error: null,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.signOut();

    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  });

  it('should handle signOut errors', async () => {
    const errorMessage = 'Sign out error';
    mockSupabase.auth.getSession = jest.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockSupabase.auth.onAuthStateChange = jest.fn().mockReturnValue(mockSubscription);
    mockSupabase.auth.signOut = jest.fn().mockResolvedValue({
      error: { message: errorMessage },
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.signOut();

    expect(result.current.error).toBe(errorMessage);
  });

  it('should unsubscribe on unmount', () => {
    mockSupabase.auth.getSession = jest.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockSupabase.auth.onAuthStateChange = jest.fn().mockReturnValue(mockSubscription);

    const { unmount } = renderHook(() => useAuth());

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});

