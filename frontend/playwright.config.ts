import { defineConfig } from '@playwright/test'
const existingServer = process.env.PLAYWRIGHT_BASE_URL
const baseURL = existingServer || 'http://127.0.0.1:5173'
export default defineConfig({
  testDir: './e2e',
  use: { channel: 'chrome', baseURL },
  webServer: existingServer
    ? undefined
    : { command: 'npm run dev', url: baseURL, reuseExistingServer: true },
  reporter: 'list',
})
