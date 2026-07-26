import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vault.03 — Sports Card Portfolio" },
      { name: "description", content: "Track, value, and share your sports card collection with Vault.03." },
      { property: "og:title", content: "Vault.03 — Sports Card Portfolio" },
      { property: "og:description", content: "Track, value, and share your sports card collection with Vault.03." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
  component: () => null,
});
