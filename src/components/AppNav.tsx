import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import logoAsset from "@/assets/logo-knockout.svg.asset.json";


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
      className="p-2 rounded-sm border border-white/20 hover:bg-white/10 transition-colors disabled:opacity-60 text-white"
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
    <nav className="sticky top-0 z-40 bg-black text-white px-4 md:px-6 h-16 flex items-center justify-between gap-3">
      <div className="flex items-center gap-4 md:gap-8 min-w-0">
        {leading}
        <Link to="/dashboard" className="shrink-0 pr-1">
          <img src={logoAsset.url} alt="VAULT.03" className="h-8 md:h-12 w-auto" />
        </Link>
        <div className="hidden lg:flex gap-6 whitespace-nowrap text-xs font-black uppercase tracking-widest text-white/70">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeProps={{ className: "text-accent-light" }}
              className="hover:text-white transition-colors"
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
    <div className="lg:hidden flex gap-px bg-black border border-black text-[10px] font-black uppercase tracking-widest">
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          activeProps={{ className: "bg-white/10 text-white" }}
          className="flex-1 bg-black py-2 text-center text-white/70 whitespace-nowrap hover:text-white hover:bg-white/5 transition-colors"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
