import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthForm } from '../auth-form';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// Mock dependencies
jest.mock('@/lib/supabase');
jest.mock('sonner');

describe('AuthForm', () => {
  const mockSupabase = supabase as jest.Mocked<typeof supabase>;
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock router
    const mockRouter = {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.spyOn(require('next/navigation'), 'useRouter').mockReturnValue(mockRouter);
  });

  describe('Login Form', () => {
    it('should render login form correctly', () => {
      render(<AuthForm type="login" />);
      
      expect(screen.getByText('welcome')).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /signIn/i })).toBeInTheDocument();
    });

    it('should show validation error for invalid email', async () => {
      const user = userEvent.setup();
      render(<AuthForm type="login" />);
      
      const emailInput = screen.getByLabelText(/email/i);
      const submitButton = screen.getByRole('button', { name: /signIn/i });
      
      await user.type(emailInput, 'invalid-email');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/valid email/i)).toBeInTheDocument();
      });
    });

    it('should show validation error for short password', async () => {
      const user = userEvent.setup();
      render(<AuthForm type="login" />);
      
      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /signIn/i });
      
      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'short');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
      });
    });

    it('should call signInWithPassword on successful login', async () => {
      const user = userEvent.setup();
      mockSupabase.auth.signInWithPassword = jest.fn().mockResolvedValue({
        data: { user: mockUser, session: {} },
        error: null,
      });
      mockSupabase.auth.getUser = jest.fn().mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });
      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({
              data: [{ id: 'asset-1' }],
              error: null,
            }),
          }),
        }),
      });

      render(<AuthForm type="login" />);
      
      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /signIn/i });
      
      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
        });
        expect(toast.success).toHaveBeenCalledWith('Login successful!');
      });
    });

    it('should show error toast on login failure', async () => {
      const user = userEvent.setup();
      const errorMessage = 'Invalid credentials';
      mockSupabase.auth.signInWithPassword = jest.fn().mockResolvedValue({
        data: { user: null, session: null },
        error: { message: errorMessage },
      });

      render(<AuthForm type="login" />);
      
      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /signIn/i });
      
      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(errorMessage);
      });
    });
  });

  describe('Register Form', () => {
    it('should render register form with fullName field', () => {
      render(<AuthForm type="register" />);
      
      expect(screen.getByText('createAnAccount')).toBeInTheDocument();
      expect(screen.getByLabelText(/fullName/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it('should call signUp on successful registration', async () => {
      const user = userEvent.setup();
      mockSupabase.auth.signUp = jest.fn().mockResolvedValue({
        data: { user: mockUser, session: null },
        error: null,
      });

      render(<AuthForm type="register" />);
      
      const fullNameInput = screen.getByLabelText(/fullName/i);
      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /createAccount/i });
      
      await user.type(fullNameInput, 'John Doe');
      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
          options: {
            data: {
              full_name: 'John Doe',
            },
            emailRedirectTo: expect.any(String),
          },
        });
        expect(toast.success).toHaveBeenCalled();
      });
    });
  });

  describe('OAuth Buttons', () => {
    it('should render Google sign in button', () => {
      render(<AuthForm type="login" />);
      
      const googleButton = screen.getByRole('button', { name: /signInWithGoogle/i });
      expect(googleButton).toBeInTheDocument();
    });

    it('should call signInWithOAuth when Google button is clicked', async () => {
      const user = userEvent.setup();
      mockSupabase.auth.signInWithOAuth = jest.fn().mockResolvedValue({
        data: { provider: 'google', url: 'https://oauth.google.com' },
        error: null,
      });

      render(<AuthForm type="login" />);
      
      const googleButton = screen.getByRole('button', { name: /signInWithGoogle/i });
      await user.click(googleButton);
      
      await waitFor(() => {
        expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
          provider: 'google',
          options: {
            redirectTo: expect.any(String),
          },
        });
      });
    });

    it('should render Apple sign in button', () => {
      render(<AuthForm type="login" />);
      
      const appleButton = screen.getByAltText(/signInWithApple/i);
      expect(appleButton).toBeInTheDocument();
    });
  });
});

