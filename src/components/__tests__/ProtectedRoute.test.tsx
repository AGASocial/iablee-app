import React from 'react';
import { render, screen } from '@testing-library/react';
import { ProtectedRoute } from '../ProtectedRoute';
import * as authModule from '@/lib/auth';

// Mock the useAuth hook
jest.mock('@/lib/auth', () => ({
  useAuth: jest.fn(),
}));

describe('ProtectedRoute', () => {
  const mockUseAuth = authModule.useAuth as jest.MockedFunction<typeof authModule.useAuth>;
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.spyOn(require('next/navigation'), 'useRouter').mockReturnValue(mockRouter);
  });

  it('should render children when user is authenticated', () => {
    mockUseAuth.mockReturnValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user: { id: '1', email: 'test@example.com' } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session: {} as any,
      loading: false,
      error: null,
      signOut: jest.fn(),
      isAuthenticated: true,
    });

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('should show loading state when checking authentication', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      loading: true,
      error: null,
      signOut: jest.fn(),
      isAuthenticated: false,
    });

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should redirect to login when user is not authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      loading: false,
      error: null,
      signOut: jest.fn(),
      isAuthenticated: false,
    });

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(mockRouter.replace).toHaveBeenCalledWith('/en/auth/login');
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should render custom fallback when provided', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      loading: true,
      error: null,
      signOut: jest.fn(),
      isAuthenticated: false,
    });

    render(
      <ProtectedRoute fallback={<div>Custom Loading</div>}>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Custom Loading')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });
});

