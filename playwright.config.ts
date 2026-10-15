import { defineConfig } from '@playwright/test';

// Playwright's downloaded browsers don't run on every Linux (e.g. NixOS); point
// CHROMIUM_PATH at a system Chromium to use that instead.
const executablePath = process.env.CHROMIUM_PATH || undefined;
const whisper = !!process.env.E2E_WHISPER;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5174',
    launchOptions: { executablePath },
  },
  webServer: [
    {
      // The dev server: the fake speech engine only exists in dev builds.
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
    },
    // The real production build (with its CSP) for the opt-in Whisper test.
    ...(whisper
      ? [
          {
            command: 'npx vite build && npx vite preview --port 4175 --strictPort',
            url: 'http://localhost:4175',
            // E2E_REUSE=1: use a server already on 4175 (e.g. the dev server, for dev hooks).
            reuseExistingServer: !!process.env.E2E_REUSE,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
