import { defineConfig } from '@playwright/test';

/**
 * Electron end-to-end tests. They launch the BUILT app (out/main/index.js) with
 * PRISM_E2E_FIXTURES=1, so every source is a local, deterministic fixture and
 * nothing touches the network. Run `npm run build` first (test:e2e does).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
});
