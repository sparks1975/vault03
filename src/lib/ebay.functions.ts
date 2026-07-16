import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CardInput = z.object({
  player_name: z.string().min(1),
  year: z.number().int().optional().nullable(),
  set_name: z.string().optional().nullable(),
  card_number: z.string().optional().nullable(),
  grade: z.string().optional().nullable(),
  grader: z.string().optional().nullable(),
});

// Active listings via eBay Browse API.
export const searchActiveListings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CardInput.parse(d))
  .handler(async ({ data }) => {
    const { searchCardListings } = await import("./ebay.server");
    try {
      const { query, items } = await searchCardListings(data, { limit: 10 });
      return {
        query,
        listings: items.map((it) => ({
          item_id: it.itemId,
          title: it.title,
          price: it.price ? Number(it.price.value) : null,
          currency: it.price?.currency ?? "USD",
          condition: it.condition ?? null,
          image_url: it.image?.imageUrl ?? null,
          url: it.itemWebUrl ?? null,
        })),
      };
    } catch (err) {
      return { query: "", listings: [], error: err instanceof Error ? err.message : "eBay error" };
    }
  });

// Sold comps. NOTE: real sold data requires eBay Marketplace Insights approval.
// Until then this returns active-listing prices as a proxy.
export const searchSoldComps = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CardInput.parse(d))
  .handler(async ({ data }) => {
    const { searchCardListings } = await import("./ebay.server");
    try {
      const { query, items } = await searchCardListings(data, { limit: 10, sort: "price" });
      const sales = items
        .filter((it) => it.price)
        .map((it) => ({
          sold_at: null as string | null,
          grade: null as string | null,
          price: Number(it.price!.value),
          source: "eBay" as const,
          url: it.itemWebUrl ?? null,
          title: it.title,
        }));
      const prices = sales.map((s) => s.price).sort((a, b) => a - b);
      const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
      return { query, sales, median_price: median };
    } catch (err) {
      return {
        query: "",
        sales: [],
        median_price: 0,
        error: err instanceof Error ? err.message : "eBay error",
      };
    }
  });

// Identify a card from a photo via eBay image search.
export const identifyByImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ imageDataUrl: z.string().startsWith("data:image/") }).parse(d),
  )
  .handler(async ({ data }) => {
    const { browseByImage } = await import("./ebay.server");
    const base64 = data.imageDataUrl.split(",")[1] ?? "";
    try {
      const items = await browseByImage(base64);
      return {
        matches: items.map((it) => ({
          item_id: it.itemId,
          title: it.title,
          price: it.price ? Number(it.price.value) : null,
          image_url: it.image?.imageUrl ?? null,
          url: it.itemWebUrl ?? null,
        })),
      };
    } catch (err) {
      return { matches: [], error: err instanceof Error ? err.message : "eBay error" };
    }
  });
