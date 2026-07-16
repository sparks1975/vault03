import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Wallet, TrendingUp, Search, Activity } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Sign in — Vault.03" }],
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

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        navigate({ to: "/dashboard", replace: true });
      } else {
        setChecking(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        navigate({ to: "/dashboard", replace: true });
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  async function handleGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Sign-in failed");
        setLoading(false);
        return;
      }
      if (result.redirected) return;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <span className="inline-flex items-center rounded-full bg-accent/10 px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-accent">
            Vault.03
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tighter italic text-foreground">
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

          <div className="mt-8">
            <Button
              variant="outline"
              onClick={handleGoogle}
              disabled={loading}
              className="w-full gap-3 py-5 text-sm font-semibold"
            >
              {loading ? (
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
