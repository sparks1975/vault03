import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2 } from "lucide-react";

import { submitAccessRequest } from "@/lib/access.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/request-access")({
  head: () => ({
    meta: [
      { title: "Request an invitation — Vault.03" },
      {
        name: "description",
        content:
          "Vault.03 is an invite-only baseball card portfolio app. Request an invitation to catalogue and value your collection.",
      },
      { property: "og:title", content: "Request an invitation — Vault.03" },
      {
        property: "og:description",
        content:
          "Vault.03 is an invite-only baseball card portfolio app. Request an invitation to catalogue and value your collection.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RequestAccessPage,
});

function RequestAccessPage() {
  const submit = useServerFn(submitAccessRequest);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setBusy(true);
    try {
      await submit({ data: { name: name.trim(), email: email.trim() } });
      setDone(true);
    } catch {
      toast.error("Could not send your request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <p className="text-xl font-extrabold italic tracking-tighter text-foreground">VAULT.03</p>
          <h1 className="mt-5 font-display text-3xl md:text-[50px] font-extrabold italic leading-none tracking-tighter text-foreground">
            {done ? "Request received" : "Request an invitation"}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {done
              ? "Thanks — you're on the list. You'll get an email with a single-use invite code once you're approved."
              : "Vault.03 is invite-only while we grow. Leave your name and email and we'll be in touch with a code."}
          </p>
        </div>

        {done ? (
          <div className="mt-8 rounded-lg border border-border bg-card p-6 text-center">
            <CheckCircle2 className="mx-auto size-8 text-accent" />
            <p className="mt-4 text-sm text-muted-foreground">
              Already have a code?{" "}
              <Link to="/auth" className="font-semibold text-accent underline">
                Sign in to activate it
              </Link>
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-8 rounded-lg border border-border bg-card p-6 space-y-4"
          >
            <div className="space-y-2">
              <label
                htmlFor="req-name"
                className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
              >
                Name
              </label>
              <Input
                id="req-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="req-email"
                className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
              >
                Email
              </label>
              <Input
                id="req-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={255}
                required
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full py-5 text-sm font-semibold">
              {busy && <Loader2 className="size-4 animate-spin" />} Request an invitation
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Already have a code?{" "}
              <Link to="/auth" className="font-semibold text-accent underline">
                Sign in to activate it
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
