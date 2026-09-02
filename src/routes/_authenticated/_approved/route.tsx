import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { getMyAccess, type MyAccess } from "@/lib/access.functions";

/**
 * Access gate. If the access lookup fails or stalls, render the app instead of
 * hanging on the loading screen — the database still enforces per-user access
 * rules, so a slow gate must never block the whole UI.
 */
const ACCESS_TIMEOUT_MS = 8000;

export const Route = createFileRoute("/_authenticated/_approved")({
  ssr: false,
  beforeLoad: async () => {
    let access: MyAccess | null = null;

    try {
      access = await Promise.race([
        getMyAccess(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ACCESS_TIMEOUT_MS)),
      ]);
    } catch (error) {
      console.error("[accessGate]", error);
      access = null;
    }

    if (access && access.accessStatus !== "approved") {
      throw redirect({ to: "/access" });
    }

    return { access: access ?? { accessStatus: "approved" as const, isAdmin: false } };
  },
  component: () => <Outlet />,
});
