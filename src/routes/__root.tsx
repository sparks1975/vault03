import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { PageRestore } from "../components/PageRestore";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl md:text-[50px] font-extrabold text-foreground tracking-tighter font-display leading-none">404</h1>
        <p className="mt-4 text-sm font-mono uppercase tracking-widest text-muted-foreground">
          Asset not found
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-sm bg-foreground px-4 py-2 text-xs font-bold uppercase tracking-widest text-background hover:bg-accent transition-colors"
        >
          Return to Vault
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">System error</p>
        <h1 className="mt-2 text-xl md:text-[50px] font-extrabold tracking-tight font-display leading-none">This page didn't load</h1>
        <div className="mt-6 flex gap-2 justify-center">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-sm bg-foreground px-4 py-2 text-xs font-bold uppercase tracking-widest text-background hover:bg-accent transition-colors"
          >Try again</button>
          <a href="/" className="rounded-sm border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-secondary transition-colors">Home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" },
      { name: "theme-color", content: "#6B21A8" },
      { title: "Vault.03 — Baseball Card Portfolio" },
      { name: "application-name", content: "Vault.03" },
      { name: "apple-mobile-web-app-title", content: "Vault.03" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { property: "og:site_name", content: "Vault.03" },
      { name: "description", content: "Catalogue your baseball cards, track live market values, comparable sales, and current player statistics in one collector-grade portfolio." },
      { property: "og:title", content: "Vault.03 — Baseball Card Portfolio" },
      { property: "og:description", content: "Catalogue your baseball cards, track live market values, comparable sales, and current player statistics in one collector-grade portfolio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Vault.03 — Baseball Card Portfolio" },
      { name: "twitter:description", content: "Catalogue your baseball cards, track live market values, comparable sales, and current player statistics in one collector-grade portfolio." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@400;500;800&family=Bangers&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <PageRestore />
      <Outlet />
      <Toaster position="top-right" theme="light" />
    </QueryClientProvider>
  );
}
