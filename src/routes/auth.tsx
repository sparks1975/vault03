import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  const [oauthMessage, setOauthMessage] = useState("Signing you in…");

  // Detect an OAuth return: either tokens in the URL hash (full-page redirect)
  // or the ?oauth=1 marker we set on the redirect_uri. While true, we hide the
  // login form and show a clear "Signing you in…" screen so it doesn't look
  // like the user was bounced back to login.
  const [finishingOAuth, setFinishingOAuth] = useState(() => {
    if (typeof window === "undefined") return false;
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    return (
      hash.includes("access_token=") ||
      hash.includes("error=") ||
      search.includes("oauth=1")
    );
  });

  async function redirectIfSignedIn() {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      navigate({ to: "/dashboard", replace: true });
      return true;
    }

    const { data } = await supabase.auth.getUser();
    if (data.user) {
      navigate({ to: "/dashboard", replace: true });
      return true;
    }

    return false;
  }

  async function finishOAuthFromUrl() {
    if (typeof window === "undefined" || !window.location.hash) return false;

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const error = hashParams.get("error");
    const errorDescription = hashParams.get("error_description");

    if (error) {
      window.history.replaceState(null, "", `${window.location.origin}/auth`);
      setFinishingOAuth(false);
      setLoading(false);
      toast.error(errorDescription || error);
      return true;
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (!accessToken || !refreshToken) return false;

    setFinishingOAuth(true);
    setOauthMessage("Finishing your Google sign in…");
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    window.history.replaceState(null, "", `${window.location.origin}/auth`);

    if (sessionError) {
      setFinishingOAuth(false);
      setLoading(false);
      toast.error(sessionError.message);
      return true;
    }

    navigate({ to: "/dashboard", replace: true });
    return true;
  }

  useEffect(() => {
    let intervalId: number | undefined;
    let timeoutId: number | undefined;

    void finishOAuthFromUrl().then((handled) => {
      if (!handled) void redirectIfSignedIn();
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") navigate({ to: "/dashboard", replace: true });
    });

    if (finishingOAuth) {
      intervalId = window.setInterval(() => {
        void finishOAuthFromUrl().then((handled) => {
          if (!handled) void redirectIfSignedIn();
        });
      }, 1000);
      timeoutId = window.setTimeout(() => {
        setOauthMessage("Still waiting for Google to finish. If approval opened in another tab, return here after it closes.");
      }, 9000);
    }

    return () => {
      authListener.subscription.unsubscribe();
      if (intervalId) window.clearInterval(intervalId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [navigate, finishingOAuth]);

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
    setFinishingOAuth(true);
    setOauthMessage("Google sign in is open. Approve access, then we’ll bring you to your dashboard.");
    const onReturn = () => void redirectIfSignedIn();
    const onVisible = () => {
      if (document.visibilityState === "visible") onReturn();
    };
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    document.addEventListener("visibilitychange", onVisible);
    const sessionPoll = window.setInterval(() => void redirectIfSignedIn(), 1000);
    const fallback = window.setTimeout(() => {
      setOauthMessage("Still waiting for Google to finish. If approval opened in another tab, return here after it closes.");
    }, 9000);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/auth?oauth=1`,
      });

      if (result.error) {
        toast.error(result.error.message);
        setFinishingOAuth(false);
        return;
      }
      if (result.redirected) {
        setOauthMessage("Finishing your Google sign in…");
        setFinishingOAuth(true);
        return;
      }
      if (!(await redirectIfSignedIn())) {
        navigate({ to: "/dashboard", replace: true });
      }

    } finally {
      window.clearTimeout(fallback);
      window.clearInterval(sessionPoll);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
      document.removeEventListener("visibilitychange", onVisible);
      setLoading(false);
    }
  }

  if (finishingOAuth) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-4">
        <div className="h-8 w-8 rounded-full border-2 border-border border-t-accent animate-spin" />
        <p className="text-sm font-medium">Signing you in…</p>
        <p className="max-w-xs text-center text-xs text-muted-foreground">{oauthMessage}</p>
      </div>
    );
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
