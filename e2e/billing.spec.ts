import { test, expect } from '@playwright/test';

test.describe('Billing', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the billing API responses
    await page.route('**/api/billing/subscriptions*', async route => {
      const method = route.request().method();

      if (method === 'GET') {
        await route.fulfill({
          json: {
            subscription: {
              id: 'sub_123',
              planId: 'plan_premium',
              status: 'active',
              currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
              cancelAtPeriodEnd: false,
              plan: {
                name: 'Premium Plan',
                amountCents: 2900,
                currency: 'USD',
                interval: 'month',
                features: {
                  max_assets: -1,
                  max_beneficiaries: -1,
                  max_storage_mb: 10000,
                  priority_support: true
                }
              }
            }
          }
        });
      } else if (method === 'DELETE') {
        await route.fulfill({ status: 200, json: { success: true } });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/billing/invoices', async route => {
      await route.fulfill({
        json: { invoices: [] }
      });
    });

    // Navigate to billing page
    await page.goto('/en/billing');
  });

  test('should display current subscription details', async ({ page }) => {
    await expect(page.getByText('Premium Plan')).toBeVisible();
    await expect(page.getByText('$29.00 / per month')).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
  });

  test('should handle subscription cancellation', async ({ page }) => {
    // Setup dialog handler before clicking
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to cancel your subscription?');
      await dialog.accept();
    });

    // Handle the re-fetch after cancellation to show canceled state
    await page.route('**/api/billing/subscriptions*', async route => {
      if (route.request().method() === 'GET') {
        // Return canceled state for the second fetch
        await route.fulfill({
          json: {
            subscription: {
              id: 'sub_123',
              planId: 'plan_premium',
              status: 'active',
              currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
              cancelAtPeriodEnd: true, // This should trigger the UI update
              plan: {
                name: 'Premium Plan',
                amountCents: 2900,
                currency: 'USD',
                interval: 'month',
                features: {
                  max_assets: -1,
                  max_beneficiaries: -1,
                  max_storage_mb: 10000,
                  priority_support: true
                }
              }
            }
          }
        });
      } else {
        await route.fallback();
      }
    });

    // Click cancel button
    const cancelButton = page.getByRole('button', { name: /cancel subscription/i });
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // Verify success message
    await expect(page.getByText('Subscription canceled successfully')).toBeVisible();

    // Verify UI updates to show resume button instead of cancel
    await expect(page.getByRole('button', { name: /resume subscription/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel subscription/i })).not.toBeVisible();
  });

  test('should handle subscription resumption', async ({ page }) => {
    // Override the GET mock to simulate a subscription scheduled for cancellation
    await page.route('**/api/billing/subscriptions*', async route => {
      const method = route.request().method();

      if (method === 'GET') {
        // Since we are not doing a real reload check here efficiently without intricate mocking,
        // we mainly trust the button click and the patch request.

        await route.fulfill({
          json: {
            subscription: {
              id: 'sub_123',
              planId: 'plan_premium',
              status: 'active',
              currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
              cancelAtPeriodEnd: true, // Initially set to cancel
              plan: {
                name: 'Premium Plan',
                amountCents: 2900,
                currency: 'USD',
                interval: 'month',
                features: {
                  max_assets: -1,
                  max_beneficiaries: -1,
                  max_storage_mb: 10000,
                  priority_support: true
                }
              }
            }
          }
        });
      } else if (method === 'PATCH') {
        // Mock successful resumption
        await route.fulfill({ status: 200, json: { success: true } });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/en/billing');

    // Verify "Resume Subscription" button is initially visible
    const resumeButton = page.getByRole('button', { name: /resume subscription/i });
    await expect(resumeButton).toBeVisible();

    // Click resume
    await resumeButton.click();

    // Verify success toast
    await expect(page.getByText('Subscription resumed successfully')).toBeVisible();
  });
});



