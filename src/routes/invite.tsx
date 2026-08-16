import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";

import { verifyInviteCode } from "@/lib/access.functions";
import { setPendingInviteCode } from "@/lib/invite-storage";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/invite")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Enter your invite code — Vault.03" },
      {
        name: "description",
        content:
          "Vault.03 is invite-only. Enter the single-use code from your invitation to unlock sign-in.",
      },
      { property: "og:title", content: "Enter your invite code — Vault.03" },
      {
        property: "og:description",
        content:
          "Vault.03 is invite-only. Enter the single-use code from your invitation to unlock sign-in.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const navigate = useNavigate();
  const verify = useServerFn(verifyInviteCode);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  // An invite link (/invite?code=...) pre-fills the field.
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("code");
    if (preset) setCode(preset.toUpperCase());
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    setVerifying(true);
    try {
      const result = await verify({ data: { code: value } });
      if (!result.ok) {
        toast.error("That code isn't valid, has already been used, or has expired.");
        return;
      }
      setPendingInviteCode(value);
      toast.success("Code accepted — sign in to activate your account.");
      navigate({ to: "/auth", search: { invited: "1" }, replace: true });
    } catch {
      toast.error("Something went wrong. Try again in a moment.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <p className="text-xl font-extrabold italic tracking-tighter text-foreground">VAULT.03</p>
          <h1 className="mt-5 font-display text-3xl md:text-[50px] font-extrabold italic leading-none tracking-tighter text-foreground">
            Invite only
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Vault.03 is limited access. Enter the single-use code from your invitation, then sign in
            with the email your invite was sent to.
          </p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="space-y-2">
            <label
              htmlFor="invite-gate-code"
              className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              Invite code
            </label>
            <Input
              id="invite-gate-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="V03-XXXX-XXXX"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="font-mono tracking-widest"
            />
          </div>
          <Button
            type="submit"
            disabled={verifying || !code.trim()}
            className="w-full gap-2 py-5 text-sm font-semibold"
          >
            {verifying ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Continue to sign-in
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have a code?{" "}
            <Link to="/request-access" className="font-semibold text-accent underline-offset-4 hover:underline">
              Request an invitation
            </Link>
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth" className="font-semibold text-accent underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
