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

## Stuck on the blue Capacitor logo in the simulator

That white screen with the blue logo is Capacitor's default launch image. It means
the splash never got hidden (or the WebView had not finished loading the site yet).
The splash now auto-hides after 1.5s, but the native project only picks that up
after a sync:

```bash
npx cap sync ios
```

Then run again from Xcode. If it still stays on the logo, open Safari →
Develop → Simulator → Vault.03 and check the console/network tab: it usually
means the device could not reach `https://vault03.app` (no network in the
simulator, or the site has not been published yet).

If a normal sync does not replace the old native settings, fully refresh the
iOS project from the project folder:

```bash
rm -rf ios/App/App/public
npx cap copy ios
npx cap sync ios
rm -rf ~/Library/Developer/Xcode/DerivedData/App-*
npx cap open ios
```

In Xcode, choose **Product → Clean Build Folder**, then run the app again. Also
open Safari inside the simulator and confirm `https://vault03.app` loads there.
If Safari cannot load it, the native app cannot load it either.
