import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Auth gate. The Supabase network call can hang on flaky mobile connections
 * (or inside a storage-restricted preview iframe), which would leave the app
 * stuck on the pending/loading screen forever. Any lookup that does not answer
 * quickly falls back to the locally cached session instead of blocking.
 */
const AUTH_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
  ]);
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const result = await withTimeout(supabase.auth.getUser(), AUTH_TIMEOUT_MS);

    if (result !== "timeout" && !result.error && result.data.user) {
      return { user: result.data.user };
    }

    // Network hiccup or slow response: trust the persisted session if present
    // so an already signed-in user is never bounced or left hanging.
    const cached = await withTimeout(supabase.auth.getSession(), 2000);
    if (cached !== "timeout" && cached.data.session?.user) {
      return { user: cached.data.session.user };
    }

    throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
});
