import { defineConfig, devices } from '@playwright/test'

// WebKit is the point of this config. Every browser on iOS is a WebKit shell —
// Chrome on iPhone included — so WebKit is the only engine that tells us anything
// about the devices this app is actually watched on.
//
// The honest limit: WebKit-on-desktop is not iOS WebKit. Layout, pointer events
// and CSS agree closely; media playback does not (no ManagedMediaSource, a
// different autoplay policy, a different HLS implementation). So these specs own
// the interface, `tools/hls-probe.mjs` owns the server, and the client log owns
// what happens on the phone itself.

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // Standing in for the phone: WebKit, touch input, a notched-phone viewport.
      name: 'iphone-webkit',
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
    {
      name: 'ipad-webkit',
      use: { ...devices['iPad (gen 7)'], browserName: 'webkit' },
    },
    {
      // Desktop keeps the hover-dependent affordances honest: they may only be
      // hover-dependent *here*.
      name: 'desktop-webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
