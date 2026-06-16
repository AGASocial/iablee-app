import { test, expect } from '@playwright/test';

function createRequestCounter(page: import('@playwright/test').Page, pattern: RegExp) {
  const counts = new Map<string, number>();
  page.on('request', (req) => {
    if (pattern.test(req.url())) {
      const key = new URL(req.url()).pathname;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  });
  return {
    getCount: (path: string) => counts.get(path) || 0,
    getTotal: () => Array.from(counts.values()).reduce((a, b) => a + b, 0),
    counts,
  };
}

test.describe('Performance regression', () => {
  test('dashboard loads with bounded API calls when server-prefetched', async ({ page }) => {
    await page.route('**/api/dashboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          assets: [],
          beneficiaries: [],
          stats: { totalAssets: 0, totalBeneficiaries: 0, protectedAssets: 0, recentActivity: 0 },
        }),
      });
    });

    const counter = createRequestCounter(page, /\/api\//);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    expect(counter.getCount('/api/dashboard')).toBeLessThanOrEqual(1);
    expect(counter.getTotal()).toBeLessThanOrEqual(5);
  });

  test('navigation does not refetch check-session when cached', async ({ page }) => {
    let checkSessionCalls = 0;
    await page.route('**/api/security/check-session', async (route) => {
      checkSessionCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, hasPin: false, locked: true }),
      });
    });

    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');
    const afterDashboard = checkSessionCalls;

    await page.goto('/en/beneficiaries');
    await page.waitForLoadState('networkidle');

    expect(checkSessionCalls).toBe(afterDashboard);
  });
});
