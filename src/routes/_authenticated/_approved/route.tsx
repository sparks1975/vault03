import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { getMyAccess } from "@/lib/access.functions";

export const Route = createFileRoute("/_authenticated/_approved")({
  ssr: false,
  beforeLoad: async () => {
    const access = await getMyAccess();
    if (access.accessStatus !== "approved") {
      throw redirect({ to: "/access" });
    }
    return { access };
  },
  component: () => <Outlet />,
});
