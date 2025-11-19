import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/auth/login');
  });

  test('should display login form', async ({ page }) => {
    await expect(page.getByText(/welcome/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /signIn/i })).toBeVisible();
  });

  test('should show validation error for invalid email', async ({ page }) => {
    const emailInput = page.getByLabel(/email/i);
    const passwordInput = page.getByLabel(/password/i);
    const submitButton = page.getByRole('button', { name: /signIn/i });

    await emailInput.fill('invalid-email');
    await passwordInput.fill('password123');
    await submitButton.click();

    // Wait for validation error
    await expect(page.getByText(/valid email/i)).toBeVisible();
  });

  test('should show validation error for short password', async ({ page }) => {
    const emailInput = page.getByLabel(/email/i);
    const passwordInput = page.getByLabel(/password/i);
    const submitButton = page.getByRole('button', { name: /signIn/i });

    await emailInput.fill('test@example.com');
    await passwordInput.fill('short');
    await submitButton.click();

    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test('should navigate to register page', async ({ page }) => {
    const signUpLink = page.getByRole('link', { name: /signUp/i });
    await signUpLink.click();

    await expect(page).toHaveURL(/.*\/auth\/register/);
    await expect(page.getByText(/createAnAccount/i)).toBeVisible();
    await expect(page.getByLabel(/fullName/i)).toBeVisible();
  });

  test('should display Google sign in button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /signInWithGoogle/i })).toBeVisible();
  });

  test('should display Apple sign in button', async ({ page }) => {
    const appleButton = page.getByAltText(/signInWithApple/i);
    await expect(appleButton).toBeVisible();
  });

  test('should toggle between login and register forms', async ({ page }) => {
    // Start on login page
    await expect(page.getByText(/welcome/i)).toBeVisible();

    // Navigate to register
    await page.getByRole('link', { name: /signUp/i }).click();
    await expect(page.getByText(/createAnAccount/i)).toBeVisible();

    // Navigate back to login
    await page.getByRole('link', { name: /signIn/i }).click();
    await expect(page.getByText(/welcome/i)).toBeVisible();
  });
});



