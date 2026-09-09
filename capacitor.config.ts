import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Vault.03 native shell.
 *
 * The app is a server-rendered site (auth, valuation and image processing all run
 * server-side), so the native build loads the live production site instead of a
 * static bundle. The website keeps working exactly as it does today.
 *
 * Point `server.url` at the preview build while testing on a device:
 *   https://project--06175a94-f581-45db-a1b7-1b13e4a953d7-dev.lovable.app
 */
const config: CapacitorConfig = {
  appId: "app.vault03.ios",
  appName: "Vault.03",
  // Unused (remote URL), but Capacitor requires the folder to exist.
  webDir: "public",
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    allowMixedContent: false,
  },
  server: {
    url: process.env["CAP_SERVER_URL"] ?? "https://vault03.app",
    cleartext: false,
    allowNavigation: [
      "vault03.app",
      "www.vault03.app",
      "*.lovable.app",
      "*.supabase.co",
      "accounts.google.com",
      "appleid.apple.com",
      "*.ebay.com",
    ],
  },
  plugins: {
    SplashScreen: {
      // Auto-hide so a slow or failed first load can never leave the user
      // stuck on the splash image forever.
      launchAutoHide: true,
      launchShowDuration: 1500,
      launchFadeOutDuration: 250,
      backgroundColor: "#1A0B2E",
      showSpinner: false,
    },
  },
};

export default config;
