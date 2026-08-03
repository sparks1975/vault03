import { createFileRoute, notFound } from "@tanstack/react-router";
import { getPublicCollection } from "@/lib/share.functions";
import { getPublicBadges } from "@/lib/showdown.functions";
import { badgeMeta, formatWeekLabel } from "@/lib/showdown-scoring";

export const Route = createFileRoute("/s/$slug")({
  loader: async ({ params }) => {
    const [result, badges] = await Promise.all([
      getPublicCollection({ data: { slug: params.slug } }),
      getPublicBadges({ data: { slug: params.slug } }).catch(() => []),
    ]);
    if (result.notFound) throw notFound();
    return { ...result, badges };
  },
  head: ({ loaderData, params }) => {
    const name = loaderData?.owner?.display_name || params.slug;
    const count = loaderData?.card_count ?? 0;
    const title = `${name}'s Card Collection — Vault.03`;
    const description = `Browse ${count} card${count === 1 ? "" : "s"} from ${name}'s collection on Vault.03.`;
    const ogImage = "https://vault03.app/og-image.png";
    const url = `https://vault03.app/s/${params.slug}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { property: "og:image", content: ogImage },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: ogImage },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },

  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center p-8 text-center">
      <div>
        <p className="text-sm text-muted-foreground uppercase tracking-widest mb-2">Error</p>
        <p className="text-lg">{error.message}</p>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center p-8 text-center">
      <div>
        <p className="text-sm text-muted-foreground uppercase tracking-widest mb-2">Not found</p>
        <p className="text-lg">This collection doesn't exist or is private.</p>
      </div>
    </div>
  ),
  component: SharedCollection,
});

const fmtMoney = (n: number | null | undefined) =>
  typeof n === "number" ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";


function SharedCollection() {
  const data = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 overflow-x-hidden">
      <nav className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-4 md:px-6 h-16 flex items-center justify-between gap-3">
        <span className="font-extrabold tracking-tighter text-lg md:text-xl italic">VAULT.03</span>
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Shared Collection</span>
      </nav>

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-8 md:pt-12">
        <header className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border">
          <div className="bg-background p-5">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Collector</p>
            <p className="text-xl font-bold leading-tight">{data.owner.display_name || data.owner.share_slug}</p>
          </div>
          <div className="bg-background p-5">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Cards</p>
            <p className="text-xl font-bold leading-tight">{data.card_count}</p>
          </div>
          <div className="bg-background p-5">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Total Value</p>
            <p className="text-xl font-bold leading-tight">{fmtMoney(data.total_value)}</p>
          </div>
        </header>

        {data.cards.length === 0 ? (
          <p className="text-center text-muted-foreground py-16">No cards yet.</p>
        ) : (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.cards.map((c: any) => (
              <article key={c.id} className="border border-border bg-background p-4 flex gap-4">
                {c.photo_url ? (
                  <img
                    src={c.photo_thumb_url ?? c.photo_url}
                    srcSet={
                      c.photo_thumb_url
                        ? `${c.photo_thumb_url} 1x${c.photo_thumb_url_2x ? `, ${c.photo_thumb_url_2x} 2x` : ""}`
                        : undefined
                    }
                    sizes="80px"
                    alt={c.player_name}
                    loading="lazy"
                    decoding="async"
                    width={80}
                    height={112}
                    className="w-20 h-28 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-20 h-28 bg-secondary shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground truncate">
                    {c.year} {c.set_name}
                  </p>
                  <h3 className="font-bold leading-tight truncate">{c.player_name}</h3>
                  <p className="text-xs text-muted-foreground truncate">
                    {[c.team, c.position].filter(Boolean).join(" · ")}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {c.card_number && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border">
                        #{c.card_number}
                      </span>
                    )}
                    {c.parallel && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border">
                        {c.parallel}
                      </span>
                    )}
                    {c.grade && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border">
                        {c.grader ? `${c.grader} ` : ""}{c.grade}
                      </span>
                    )}
                    {c.is_autograph && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-accent text-accent-foreground">Auto</span>
                    )}
                    {c.is_rookie && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-green-600 text-white">RC</span>
                    )}
                    {c.is_first_bowman && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-blue-600 text-white">1st Bowman</span>
                    )}
                    {c.serial_number && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border">
                        /{c.serial_number}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-lg font-bold">{fmtMoney(c.current_value)}</p>
                </div>
              </article>
            ))}
          </div>
        )}

        <footer className="mt-16 pt-8 border-t border-border text-center text-xs uppercase tracking-widest text-muted-foreground">
          Powered by <span className="font-bold italic text-foreground">Vault.03</span>
        </footer>
      </main>
    </div>
  );
}
