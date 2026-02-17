import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthForm } from '../auth-form';
import { toast } from 'sonner';

describe('AuthForm', () => {
  const mockFetch = global.fetch as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();

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
      expect(screen.getByRole('button', { name: /^signIn$/i })).toBeInTheDocument();
    });

    it('should not submit with invalid email', async () => {
      const user = userEvent.setup();
      render(<AuthForm type="login" />);

      await user.type(screen.getByLabelText(/email/i), 'invalid-email');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /^signIn$/i }));

      await waitFor(() => {
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    it('should call backend login and show success on successful login', async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 'asset-1' }],
        });

      render(<AuthForm type="login" />);

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /^signIn$/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
          method: 'POST',
        }));
        expect(toast.success).toHaveBeenCalledWith('Login successful!');
      });
    });

    it('should show error toast on login failure', async () => {
      const user = userEvent.setup();
      const errorMessage = 'Invalid credentials';
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: errorMessage }),
      });

      render(<AuthForm type="login" />);

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /^signIn$/i }));

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

    it('should call backend register on successful registration', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<AuthForm type="register" />);

      await user.type(screen.getByLabelText(/fullName/i), 'John Doe');
      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /createAccount/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
          method: 'POST',
        }));
        expect(toast.success).toHaveBeenCalled();
      });
    });
  });

  describe('OAuth Buttons', () => {
    it('should call backend oauth start when Google button is clicked', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://oauth.example.com/start' }),
      });

      render(<AuthForm type="login" />);

      await user.click(screen.getByRole('button', { name: /signInWithGoogle/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/auth/oauth/start', expect.objectContaining({
          method: 'POST',
        }));
      });
    });

    it('should render Apple sign in button', () => {
      render(<AuthForm type="login" />);
      expect(screen.getByAltText(/signInWithApple/i)).toBeInTheDocument();
    });
  });
});
