import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

/**
 * iOS standalone / Safari back-navigation recovery.
 *
 * When an external link (e.g. an eBay sold listing) is opened from the
 * installed app, coming back can restore a page whose React tree was torn
 * down, leaving a blank screen. On restore we either re-validate the router
 * (tree still alive) or hard-reload (tree is gone).
 */
export function PageRestore() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    let recoveryTimer: number | undefined;
    const RELOAD_GUARD_KEY = "vault03-page-restore-reload";

    const looksBlank = () => {
      const root = document.body;
      if (!root) return true;
      return root.innerText.trim().length === 0;
    };

    const recover = async (persisted: boolean) => {
      if (!alive) return;

      // A visible PageRestore means the React tree is still mounted. Let the
      // router repair it first instead of immediately aborting the document
      // request with location.reload().
      if (persisted || looksBlank()) {
        await router.invalidate().catch(() => undefined);
      }

      if (!alive || !looksBlank() || document.readyState !== "complete") return;

      // WebKit can briefly report an empty body while repainting a restored
      // page. Only reload after it stayed blank, and never enter a reload loop.
      recoveryTimer = window.setTimeout(() => {
        if (!alive || !looksBlank()) return;
        const lastReload = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
        if (Date.now() - lastReload < 10_000) return;
        window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
        window.location.reload();
      }, 750);
    };

    const onPageShow = (e: PageTransitionEvent) => {
      // Give WebKit time to paint the restored page before measuring.
      window.setTimeout(() => void recover(e.persisted), 150);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        window.setTimeout(() => void recover(false), 150);
      }
    };

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
