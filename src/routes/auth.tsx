import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const googleSignInPendingRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") navigate({ to: "/dashboard", replace: true });
    });

    return () => authListener.subscription.unsubscribe();
  }, [navigate]);

  async function finishGoogleReturn(resetIfMissing = true) {
    if (!googleSignInPendingRef.current) return;

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      googleSignInPendingRef.current = false;
      navigate({ to: "/dashboard", replace: true });
      return;
    }

    const { data } = await supabase.auth.getUser();
    if (data.user) {
      googleSignInPendingRef.current = false;
      navigate({ to: "/dashboard", replace: true });
      return;
    }
    if (resetIfMissing) setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Account created. You're in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back.");
      }
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    googleSignInPendingRef.current = true;
    // On mobile, OAuth often returns focus/pageshow without resolving the
    // popup promise. Re-check the session and unstick the UI when that happens.
    const onReturn = () => void finishGoogleReturn(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") onReturn();
    };
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    document.addEventListener("visibilitychange", onVisible);
    const sessionPoll = window.setInterval(() => void finishGoogleReturn(false), 1000);
    const fallback = window.setTimeout(onReturn, 8000);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message);
        googleSignInPendingRef.current = false;
        return;
      }
      if (result.redirected) return;
      googleSignInPendingRef.current = false;
      navigate({ to: "/dashboard", replace: true });
    } finally {
      window.clearTimeout(fallback);
      window.clearInterval(sessionPoll);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
      document.removeEventListener("visibilitychange", onVisible);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="border-b border-border h-16 px-6 flex items-center">
        <Link to="/" className="font-extrabold tracking-tighter text-xl italic">VAULT.03</Link>
      </nav>
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            {mode === "signin" ? "Access" : "Register"}
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight mb-8">
            {mode === "signin" ? "Enter the vault" : "Create your vault"}
          </h1>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full h-11 border border-border rounded-sm text-sm font-medium hover:bg-secondary transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <GoogleGlyph /> Continue with Google
          </button>

          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <input
                type="text"
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full h-11 px-3 border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
              />
            )}
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-3 border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3 border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-foreground text-background text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-accent transition-colors disabled:opacity-50"
            >
              {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-xs text-muted-foreground text-center">
            {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="text-foreground font-medium underline underline-offset-2"
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
