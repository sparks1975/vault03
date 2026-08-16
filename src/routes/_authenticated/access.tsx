import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";

import { getMyAccess, redeemInvite } from "@/lib/access.functions";
import {
  DEVICE_REGISTERED_KEY,
  clearPendingInviteCode,
  getPendingInviteCode,
} from "@/lib/invite-storage";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/access")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Enter your invite code — Vault.03" },
      {
        name: "description",
        content: "Vault.03 is invite-only. Enter your single-use invite code to activate your account.",
      },
      { property: "og:title", content: "Enter your invite code — Vault.03" },
      {
        property: "og:description",
        content: "Vault.03 is invite-only. Enter your single-use invite code to activate your account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccessPage,
});

function AccessPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const redeem = useServerFn(redeemInvite);
  const checkAccess = useServerFn(getMyAccess);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [revoked, setRevoked] = useState(false);

  function markDeviceRegistered() {
    try {
      window.localStorage.setItem(DEVICE_REGISTERED_KEY, "1");
    } catch {
      /* storage blocked */
    }
  }



  useEffect(() => {
    let mounted = true;
    const stored = getPendingInviteCode();
    (async () => {
      const access = await checkAccess();
      if (!mounted) return;
      if (access.accessStatus === "approved") {
        markDeviceRegistered();
        clearPendingInviteCode();
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      if (access.accessStatus === "revoked") {
        setRevoked(true);
        return;
      }
      // Code was verified before sign-in — redeem it automatically.
      if (stored) {
        const result = await redeem({ data: { code: stored } });
        if (!mounted) return;
        clearPendingInviteCode();
        if (result.ok) {
          markDeviceRegistered();
          await queryClient.invalidateQueries();
          navigate({ to: "/dashboard", replace: true });
          return;
        }
        toast.error("That invite code isn't valid anymore. Enter a new one to continue.");
      }
      // Signed in but no invitation: this account doesn't exist in Vault.03.
      // Sign back out and send them to the invite gate.
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      if (!mounted) return;
      navigate({ to: "/invite", replace: true });
    })();
    return () => {
      mounted = false;
    };
  }, [checkAccess, navigate, redeem, queryClient]);



  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const result = await redeem({ data: { code } });
      if (result.ok) {
        await queryClient.invalidateQueries();
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      toast.error(
        result.reason === "invalid"
          ? "That code isn't valid, has already been used, or has expired."
          : "Something went wrong. Try again in a moment.",
      );
    } catch {
      toast.error("Something went wrong. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <p className="text-xl font-extrabold italic tracking-tighter text-foreground">VAULT.03</p>
          <h1 className="mt-5 font-display text-3xl md:text-[50px] font-extrabold italic leading-none tracking-tighter text-foreground">
            {revoked ? "Access removed" : "Invite only"}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {revoked
              ? "Your access to Vault.03 has been removed. Contact the vault owner if you think this is a mistake."
              : "Vault.03 is currently limited access. Enter the single-use code from your invitation to activate your account."}
          </p>
        </div>

        {!revoked && (
          <form
            onSubmit={submit}
            className="mt-8 rounded-lg border border-border bg-card p-6 space-y-4"
          >
            <div className="space-y-2">
              <label
                htmlFor="invite-code"
                className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
              >
                Invite code
              </label>
              <Input
                id="invite-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="V03-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                className="font-mono tracking-widest"
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full py-5 text-sm font-semibold">
              {busy && <Loader2 className="size-4 animate-spin" />} Activate my account
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Don&apos;t have a code?{" "}
              <Link to="/request-access" className="font-semibold text-accent underline">
                Request an invitation
              </Link>
            </p>
          </form>
        )}

        <button
          onClick={signOut}
          className="mt-6 mx-auto flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-3" /> Sign out
        </button>
      </div>
    </div>
  );
}
