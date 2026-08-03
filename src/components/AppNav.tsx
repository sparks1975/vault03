import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

export function SignOutButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function handle() {
    setBusy(true);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <button
      onClick={handle}
      disabled={busy}
      title="Sign out"
      className="p-2 rounded-sm border border-border hover:bg-secondary transition-colors disabled:opacity-60"
    >
      <LogOut className="size-4" />
    </button>
  );
}

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/vault", label: "My Vault" },
  { to: "/showdown", label: "Showdown" },
] as const;

export function AppNav({ actions, leading }: { actions?: ReactNode; leading?: ReactNode }) {
  return (
    <nav className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-4 md:px-6 h-16 flex items-center justify-between gap-3">
      <div className="flex items-center gap-4 md:gap-8 min-w-0">
        {leading}
        <Link to="/dashboard" className="font-extrabold tracking-tighter text-lg md:text-xl italic shrink-0 pr-1">
          VAULT.03
        </Link>
        <div className="hidden lg:flex gap-6 whitespace-nowrap text-xs font-black uppercase tracking-widest text-muted-foreground">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeProps={{ className: "text-accent" }}
              className="hover:text-foreground transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex gap-2 md:gap-3 items-center shrink-0">
        {actions}
        <SignOutButton />
      </div>
    </nav>
  );
}

export function MobileNavTabs() {
  return (
    <div className="lg:hidden flex gap-px bg-border border border-border text-[10px] font-black uppercase tracking-widest">
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          activeProps={{ className: "text-accent" }}
          className="flex-1 bg-background py-2 text-center text-muted-foreground whitespace-nowrap"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
