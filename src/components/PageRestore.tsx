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

    const looksBlank = () => {
      const root = document.body;
      if (!root) return true;
      return root.innerText.trim().length === 0;
    };

    const recover = (persisted: boolean) => {
      if (!alive) return;
      if (looksBlank()) {
        window.location.reload();
        return;
      }
      if (persisted) void router.invalidate();
    };

    const onPageShow = (e: PageTransitionEvent) => {
      // Give WebKit a tick to paint the restored page before measuring.
      window.setTimeout(() => recover(e.persisted), 60);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        window.setTimeout(() => recover(false), 60);
      }
    };

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
