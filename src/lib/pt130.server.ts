// Sold-comp source: thecardapi.com market API (Builder tier).
// Apify / eBay scraping has been removed entirely — this module now only builds
// the search descriptors and caches sold rows into pt130_comps (table name kept
// for backward compatibility).
//
// SERVER-ONLY module — never import from client code.
import { cardSetBrand, isUncataloguedBrand, toApprovedCardSet } from "./card-sets";
import { searchTheCardApiSales, type SoldSale } from "./thecardapi.server";

export type Pt130Sale = SoldSale;

export function buildPt130Descriptor(fields: {
  year?: string | number | null;
  set_name?: string | null;
  team?: string | null;
  player_name?: string | null;
  card_number?: string | null;
  is_autograph?: boolean | null;
  selected_parallel_name?: string | null;
  serial_number?: string | null;
  grader?: string | null;
  grade?: string | null;
}, opts: { includeCardNumber?: boolean; setLabel?: "brand" | "set"; includeTraits?: boolean; includeTeam?: boolean } = {}): string {
  const includeCardNumber = opts.includeCardNumber ?? true;
  const includeTraits = opts.includeTraits ?? true;
  // Grades are intentionally left out: the verifier never checks them and
  // graders/grades are written inconsistently.
  void fields.grader;
  void fields.grade;
  const parallel = (fields.selected_parallel_name ?? "")
    .replace(/\/\s*\d+/g, " ")
    .replace(/\b(parallel|card|cards)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const serialDenominator =
    (fields.serial_number ?? "").match(/\/\s*(\d+)/)?.[1] ??
    (fields.selected_parallel_name ?? "").match(/\/\s*(\d+)/)?.[1] ??
    null;
  const setLabel =
    opts.setLabel === "set"
      ? (toApprovedCardSet(fields.set_name) ??
          ((fields.set_name ?? "").replace(/\s+/g, " ").trim() || cardSetBrand(fields.set_name)))
      : cardSetBrand(fields.set_name);
  const normalizedSet = String(fields.set_name ?? "").toLowerCase();
  const team = String(fields.team ?? "").replace(/\s+/g, " ").trim();
  // Japanese team-set cards may only have the generic product saved as "BBM
  // Team Sets" while the club is stored separately. Add the club to the sold
  // search when it is not already part of the set name; matching still relies
  // on year/product/card number/player and never requires the team wording.
  const searchTeam =
    opts.includeTeam !== false && team && isUncataloguedBrand(fields.set_name) && !normalizedSet.includes(team.toLowerCase())
      ? team
      : null;
  const parts = [
    fields.year ? String(fields.year) : null,
    setLabel,
    searchTeam,
    includeCardNumber && fields.card_number
      ? `#${String(fields.card_number).replace(/^#/, "").replace(/[-/]+/g, " ").replace(/\s+/g, " ").trim()}`
      : null,
    fields.player_name,
    includeTraits ? parallel || null : null,
    includeTraits && serialDenominator ? `/${serialDenominator}` : null,
    includeTraits && fields.is_autograph ? "auto" : null,
  ].filter(Boolean) as string[];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Search tiers. Identity ONLY (year + product + card number + player): adding
// parallel/finish words makes the search return other players' parallels. Those
// traits stay in verification (scoreCompTitle) where they belong.
//  1. primary  — year + product + card number + player
//  2. brand    — year + parent brand + card number + player   (broaden only)
//  3. noNumber — year + product + player, no card number      (broaden only)
export function buildPt130SearchTiers(
  fields: Parameters<typeof buildPt130Descriptor>[0],
): { primary: string; brand: string | null; noNumber: string | null } {
  const identity = { includeTraits: false } as const;
  const primary = buildPt130Descriptor(fields, { ...identity, includeCardNumber: true, setLabel: "set", includeTeam: true });
  // Japanese listings often omit the translated club name even when the card
  // comes from a team set. Broader tiers omit team wording while retaining the
  // year, manufacturer/set, card number and player identity.
  const omitTeamWhenUncatalogued = isUncataloguedBrand(fields.set_name);
  const brand = buildPt130Descriptor(fields, {
    ...identity,
    includeCardNumber: true,
    setLabel: "brand",
    includeTeam: !omitTeamWhenUncatalogued,
  });
  const noNumber = buildPt130Descriptor(fields, {
    ...identity,
    includeCardNumber: false,
    setLabel: "set",
    includeTeam: !omitTeamWhenUncatalogued,
  });
  return {
    primary,
    brand: brand && brand !== primary ? brand : null,
    noNumber: noNumber && noNumber !== primary ? noNumber : null,
  };
}

export function buildPt130Descriptors(fields: Parameters<typeof buildPt130Descriptor>[0]): string[] {
  const tiers = buildPt130SearchTiers(fields);
  return [tiers.primary, tiers.brand].filter((d): d is string => Boolean(d));
}

// Fetch sold sales for one or more search descriptors from thecardapi.
export async function fetchSoldComps(descriptor: string | string[]): Promise<Pt130Sale[]> {
  const keywords = (Array.isArray(descriptor) ? descriptor : [descriptor])
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (keywords.length === 0) return [];
  const results = await Promise.all(
    keywords.map(async (keyword) => {
      try {
        return (await searchTheCardApiSales(keyword)).sales;
      } catch (err) {
        console.error(`[sold-comps] search failed for "${keyword}":`, err);
        return [] as Pt130Sale[];
      }
    }),
  );
  return results.flat();
}

// Replace this card's cached comps with a fresh pull. Returns rows stored.
export async function refreshPt130ForCard(
  supabase: {
    from: (t: string) => {
      delete: () => { eq: (c: string, v: string) => PromiseLike<{ error: unknown }> };
      insert: (rows: unknown[]) => PromiseLike<{ error: unknown }>;
    };
  },
  args: {
    card_id: string;
    user_id: string;
    descriptor: string | string[];
    card_number?: string | null;
    append?: boolean;
  },
): Promise<{ stored: number; scraped: number }> {
  const descriptors = (Array.isArray(args.descriptor) ? args.descriptor : [args.descriptor])
    .map((d) => d.trim())
    .filter(Boolean);
  const scrapedSales = await fetchSoldComps(descriptors);

  const seen = new Set<string>();
  const sales: Pt130Sale[] = [];
  for (const sale of scrapedSales) {
    const key = [sale.url, sale.title, sale.sold_at, sale.price].map((v) => String(v ?? "")).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    sales.push(sale);
  }

  // Never wipe the cache on an empty pull.
  if (sales.length === 0) return { stored: 0, scraped: scrapedSales.length };
  if (!args.append) {
    const del = await supabase.from("pt130_comps").delete().eq("card_id", args.card_id);
    if (del.error) throw del.error;
  }
  const rows = sales.map((s) => ({
    card_id: args.card_id,
    user_id: args.user_id,
    sold_at: s.sold_at,
    price: s.price,
    title: s.title,
    image_url: s.image_url,
    url: s.url,
    listing_type: s.listing_type,
  }));
  const ins = await supabase.from("pt130_comps").insert(rows);
  if (ins.error) throw ins.error;
  return { stored: rows.length, scraped: scrapedSales.length };
}
