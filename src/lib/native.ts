/**
 * Browser-only helpers for the Capacitor native shell.
 * Safe to import from client components; every call is a no-op on the web.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function cap(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativeApp(): boolean {
  return cap()?.isNativePlatform?.() === true;
}

export function nativePlatform(): "ios" | "android" | "web" {
  const p = cap()?.getPlatform?.();
  return p === "ios" || p === "android" ? p : "web";
}

let initialised = false;

/** Marks the document as native, styles the status bar and hides the splash. */
export async function initNativeShell(): Promise<void> {
  if (initialised || typeof window === "undefined") return;
  initialised = true;
  if (!isNativeApp()) return;

  document.documentElement.classList.add("native-app", `native-${nativePlatform()}`);

  // Hide the splash first: everything below is cosmetic and must never be able
  // to keep the launch image on screen.
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    // splash plugin unavailable — ignore
  }

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    if (nativePlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#000000" });
    }
  } catch {
    // status bar plugin unavailable — ignore
  }

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    // splash plugin unavailable — ignore
  }
}
