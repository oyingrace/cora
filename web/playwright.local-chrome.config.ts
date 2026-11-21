// Temporary local-only config: reuses the main config but runs on the
// system Chrome install (the bundled Playwright browser isn't downloaded
// on this machine). Deleted after verification.
import base from './playwright.config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...base,
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
});
