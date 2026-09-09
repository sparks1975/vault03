# Vault.03 native app (Capacitor)

The website keeps working exactly as before. The native app is a thin shell that
loads the live site (`https://vault03.app`), so anything shipped to the web is
instantly live in the app too — no re-submission needed for normal changes.

## One-time setup (on your Mac, with Xcode installed)

```bash
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

For Android (Android Studio installed):

```bash
npx cap add android
npx cap sync android
npx cap open android
```

## Testing against the preview build instead of production

```bash
CAP_SERVER_URL="https://project--06175a94-f581-45db-a1b7-1b13e4a953d7-dev.lovable.app" npx cap sync ios
```

Run `npx cap sync ios` again (without the variable) before submitting so the app
points at production.

## App Store checklist

- **Bundle ID**: `app.vault03.ios` (change in `capacitor.config.ts` and Xcode if you prefer another).
- **App icon / splash**: add a 1024×1024 icon in Xcode (`App/Assets.xcassets`). Splash background is `#1A0B2E`.
- **Sign in with Apple**: Apple requires it whenever Google sign-in is offered in an iOS app.
  Enable the Apple provider in the backend auth settings and add the "Sign In with Apple"
  capability in Xcode before submitting.
- **Camera / photo permissions**: card photos use the web file picker, so no extra
  permission strings are required. If you later add the native camera plugin, add
  `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` to `Info.plist`.
- **Privacy policy URL**: required by App Review; must be reachable publicly.
- **Account deletion**: apps with accounts must offer in-app account deletion.
- **Minimum iOS**: Capacitor 8 targets iOS 15+.

## What lives where

- `capacitor.config.ts` — app id/name, remote URL, allowed navigation domains.
- `src/lib/native.ts` — detects the native shell, styles the status bar, hides the splash.
- `src/components/NativeShell.tsx` — runs that setup after hydration.
- `src/styles.css` — `html.native-app` safe-area and no-text-select rules.
