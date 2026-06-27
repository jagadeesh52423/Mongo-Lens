import { defineConfig, devices } from '@playwright/test';

/**
 * Boot smoke test config. Runs the Vite dev server (the exact path that broke
 * when a CommonJS module was pulled into the startup bundle) and drives it in
 * headless Chromium. The unit suite (vitest/jsdom + mocked Tauri) cannot catch
 * module-eval / boot failures; this can.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:1420',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
