/**
 * Configuración de ejemplo para Playwright en diferentes entornos
 * 
 * Para personalizar la configuración, copia este archivo a playwright.config.local.ts
 * y ajusta según tus necesidades.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  
  // Configuración para diferentes entornos
  use: {
    // URL base para pruebas locales
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',
    
    // Variables de entorno para pruebas
    // Puedes sobrescribirlas con .env.test
    // NEXT_PUBLIC_SUPABASE_URL=your_test_url
    // NEXT_PUBLIC_SUPABASE_ANON_KEY=your_test_key
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});



