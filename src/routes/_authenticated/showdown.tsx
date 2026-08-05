import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listCards } from "@/lib/cards.functions";
import { AppNav, MobileNavTabs } from "@/components/AppNav";
import { ShowdownPanel, type ShowdownCard } from "@/components/ShowdownPanel";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/showdown")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Weekly Showdown — Vault.03" },
      { name: "description", content: "Play your baseball cards in the Vault.03 Weekly Showdown: set a 5-card lineup and compete on the global leaderboard." },
      { property: "og:title", content: "Weekly Showdown — Vault.03" },
      { property: "og:description", content: "Play your baseball cards in the Vault.03 Weekly Showdown: set a 5-card lineup and compete on the global leaderboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ShowdownPage,
});

function ShowdownPage() {
  const listFn = useServerFn(listCards);
  const cardsQ = useQuery({ queryKey: ["cards"], queryFn: () => listFn() });
  const cards = (cardsQ.data ?? []) as unknown as ShowdownCard[];

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 overflow-x-clip">
      <AppNav />

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-4 md:pt-12">
        <div className="sticky top-16 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-4 bg-background/90 backdrop-blur-md lg:hidden">
          <MobileNavTabs />
        </div>

        <header className="mb-6">
          <div className="flex items-center gap-3">
            <Trophy className="w-7 h-7 md:w-8 md:h-8 text-accent shrink-0" />
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Weekly Showdown</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Enter five cards from your vault. Real MLB stats plus your card multipliers decide the winner.
          </p>
        </header>


        {cardsQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <ShowdownPanel cards={cards} />
        )}
      </main>
    </div>
  );
}
