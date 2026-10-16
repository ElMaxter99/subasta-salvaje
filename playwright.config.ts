import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    // Si tu Chromium no coincide con la versión de Playwright: PW_CHROMIUM_PATH=/ruta/a/chrome
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    // Servidor en modo DEMO con datos y .next aislados (no toca tu entorno de desarrollo).
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/runtime`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_DIST_DIR: '.next-e2e', DEMO_DATA_DIR: '.demo-data-e2e', FORCE_DEMO_MODE: 'true', NODE_ENV: 'development' },
  },
});
