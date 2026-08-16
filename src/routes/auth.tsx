import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Wallet, TrendingUp, Search, Activity } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { getPendingInviteCode } from "@/lib/invite-storage";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RouteLoading } from "@/components/RouteLoading";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Vault.03" },
      { name: "description", content: "Sign in to Vault.03 to manage and value your sports card collection." },
      { property: "og:title", content: "Sign in — Vault.03" },
      { property: "og:description", content: "Sign in to Vault.03 to manage and value your sports card collection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const features = [
  {
    icon: Wallet,
    title: "Catalogue your collection",
    description: "Add cards, grades, purchase price, and quantity in one organized portfolio.",
  },
  {
    icon: TrendingUp,
    title: "Live market values",
    description: "Values update from real sales data every time you open the app.",
  },
  {
    icon: Search,
    title: "Recent comparables",
    description: "See the latest sold listings for each card to judge the market.",
  },
  {
    icon: Activity,
    title: "Player stats",
    description: "Current-season performance, right next to your card.",
  },
];

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44c-.28 1.4-1.09 2.6-2.34 3.4v2.83h3.78c2.21-2.04 3.61-5.05 3.61-8.47z" />
      <path fill="#34A853" d="M12 24c3.15 0 5.79-1.04 7.72-2.83l-3.78-2.83c-1.04.7-2.37 1.13-3.94 1.13-3.04 0-5.62-2.05-6.54-4.81H1.55v3.02C3.47 21.3 7.44 24 12 24z" />
      <path fill="#FBBC05" d="M5.46 14.66c-.23-.7-.36-1.44-.36-2.16s.13-1.46.36-2.16V7.32H1.55C.55 9.32 0 11.6 0 12.5c0 .9.55 3.18 1.55 5.18l3.91-3.02z" />
      <path fill="#EA4335" d="M12 4.75c1.71 0 3.25.59 4.46 1.74l3.34-3.34C17.79 1.19 15.15 0 12 0 7.44 0 3.47 2.7 1.55 6.82l3.91 3.02C6.38 6.8 8.96 4.75 12 4.75z" />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M16.36 12.78c.02 2.66 2.33 3.54 2.36 3.55-.02.06-.37 1.28-1.23 2.53-.74 1.08-1.51 2.16-2.72 2.18-1.19.02-1.57-.71-2.93-.71-1.36 0-1.78.69-2.9.73-1.17.04-2.06-1.15-2.81-2.23-1.63-2.36-2.87-6.68-1.2-9.59.83-1.45 2.31-2.37 3.92-2.39 1.15-.02 2.23.77 2.93.77.7 0 2.02-.95 3.4-.81.58.02 2.2.21 3.24 1.59-.08.05-1.94 1.13-1.92 3.38M14.13 3.9c.62-.75 1.04-1.79.93-2.83-.9.04-1.99.6-2.63 1.35-.58.66-1.08 1.72-.94 2.74 1 .08 2.02-.51 2.64-1.26" />
    </svg>
  );
}

function hasOAuthReturnParams() {
  if (typeof window === "undefined") return false;
  const search = window.location.search;
  const hash = window.location.hash;
  // Invite links use ?code=... on /auth; real OAuth returns carry state,
  // access_token, or error parameters. Only wait for session hydration when
  // those are present.
  return /(^|[?&#])(state|access_token|error|error_description)=/.test(search + hash);
}


// Mobile browsers block/partition storage for embedded frames (the editor
// preview), so an OAuth session can never land there. Detect it and send the
// user to a real tab instead of leaving them stuck on this screen.
function isBlockedEmbeddedContext() {
  if (typeof window === "undefined") return false;
  let embedded = false;
  try {
    embedded = window.top !== window.self;
  } catch {
    embedded = true;
  }
  if (!embedded) return false;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  let storageOk = true;
  try {
    const k = "__v03_probe";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
  } catch {
    storageOk = false;
  }
  return !storageOk || isMobile;
}


function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);
  const [checking, setChecking] = useState(true);
  const [embeddedBlocked, setEmbeddedBlocked] = useState(false);
  const [hasPendingInvite, setHasPendingInvite] = useState(false);

  useEffect(() => {
    setEmbeddedBlocked(isBlockedEmbeddedContext());
    setHasPendingInvite(Boolean(getPendingInviteCode()));
  }, []);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;

    const done = () => {
      if (!mounted) return;
      setChecking(false);
      // Drop any leftover OAuth params so a stale/failed attempt can't loop.
      if (hasOAuthReturnParams()) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    };

    const go = () => {
      if (!mounted) return;
      navigate({ to: "/dashboard", replace: true });
    };

    // Coming back from the provider: give supabase-js a moment to hydrate the
    // session from the URL before deciding the user is signed out.
    const returning = hasOAuthReturnParams();
    const deadline = Date.now() + (returning ? 12_000 : 0);

    const check = async () => {
      if (!mounted) return;
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        go();
        return;
      }
      if (Date.now() >= deadline) {
        done();
        return;
      }
      timer = window.setTimeout(check, 500);
    };
    timer = window.setTimeout(check, 0);

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) go();
    });

    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  async function handleOAuth(provider: "google" | "apple") {
    setLoading(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin + "/auth",
      });
      if (result.error) {
        toast.error(result.error.message ?? "Sign-in failed");
        setLoading(null);
        return;
      }
      // Full-page redirect in progress (typical on phones) — leave the button
      // spinning; the page is about to unload.
      if (result.redirected) return;

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      // Popup closed without delivering a session: recover the button so the
      // user is never stuck on a spinner.
      setLoading(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
      setLoading(null);
    }
  }

  if (embeddedBlocked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-md text-center">
          <p className="text-xl font-extrabold tracking-tighter italic text-foreground">VAULT.03</p>
          <h1 className="mt-5 font-display text-3xl md:text-[50px] font-extrabold leading-none tracking-tighter italic text-foreground">
            Open in your browser to sign in
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Your phone blocks sign-in inside an embedded preview window. Tap below to open Vault.03
            in a real browser tab and sign in there.
          </p>
          <Button asChild className="mt-8 w-full py-5 text-sm font-semibold">
            <a href={typeof window !== "undefined" ? window.location.href : "/auth"} target="_blank" rel="noreferrer">
              Open Vault.03
            </a>
          </Button>
        </div>
      </div>
    );
  }

  if (checking) {
    return <RouteLoading />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <p className="text-xl font-extrabold tracking-tighter italic text-foreground">
            VAULT.03
          </p>
          <h1 className="mt-5 text-3xl md:text-[50px] font-extrabold tracking-tighter italic text-foreground font-display leading-none">
            Your baseball card portfolio
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Catalogue your cards, track live market values, and stay on top of comparable sales — all in one collector-grade app.
          </p>
        </div>

        <div className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm">
          <ul className="space-y-4">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <li key={feature.title} className="flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-card-foreground">{feature.title}</p>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-8 space-y-3">
            <Button
              onClick={() => handleOAuth("apple")}
              disabled={loading !== null}
              className="w-full gap-3 py-5 text-sm font-semibold"
            >
              {loading === "apple" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <AppleIcon className="size-4" />
              )}
              Continue with Apple
            </Button>
            <Button
              variant="outline"
              onClick={() => handleOAuth("google")}
              disabled={loading !== null}
              className="w-full gap-3 py-5 text-sm font-semibold"
            >
              {loading === "google" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <GoogleIcon className="size-4" />
              )}
              Continue with Google
            </Button>
            <p className="mt-4 text-center text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Secure OAuth sign-in
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
