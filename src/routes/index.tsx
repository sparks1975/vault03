import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <nav className="border-b border-border h-16 px-6 flex items-center justify-between">
        <span className="font-extrabold tracking-tighter text-xl italic">VAULT.03</span>
        <Link
          to="/auth"
          className="px-4 py-2 bg-foreground text-background text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-accent transition-colors"
        >
          Sign in
        </Link>
      </nav>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 pt-24 pb-20">
        <div className="max-w-3xl animate-in-up">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-4">
            Precision portfolio for baseball collectors
          </p>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter leading-[0.95]">
            Your card collection,<br/>priced like an asset.
          </h1>
          <p className="mt-8 text-lg text-muted-foreground max-w-xl leading-relaxed">
            Catalogue every card, track live market values and recent comparable sales,
            and see the current MLB statistics for the player on the front of the card —
            all in one collector-grade portfolio.
          </p>
          <div className="mt-10 flex gap-3">
            <Link
              to="/auth"
              className="px-5 py-3 bg-foreground text-background text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-accent transition-colors"
            >
              Open your vault
            </Link>
          </div>

          <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border">
            {[
              { k: "Catalogue", v: "Scan or enter cards. Grade, set, condition — all tracked." },
              { k: "Value", v: "Live market value with 30-day movement and recent comparables." },
              { k: "Player Stats", v: "Current-season MLB stats pulled fresh for every player." },
            ].map((f) => (
              <div key={f.k} className="bg-background p-8">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
                  {f.k}
                </p>
                <p className="text-sm leading-relaxed">{f.v}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
