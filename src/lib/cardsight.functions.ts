import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listCardsightParallels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      card_id: z.string().uuid().nullable().optional(),
      descriptor: z.string().nullable().optional(),
      player_name: z.string().nullable().optional(),
      year: z.union([z.string(), z.number()]).nullable().optional(),
      set_name: z.string().nullable().optional(),
      card_number: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { listParallelsForCard } = await import("./cardsight.server");
    try {
      // Never launch catalog searches from live form input. The picker only
      // loads against the exact card ID established by identification.
      if (!data.card_id) return [];
      return await listParallelsForCard(data.card_id);
    } catch (err) {
      console.error("listParallelsForCard failed:", err);
      return [];
    }
  });

// Manual "Find in catalog" picker: returns individual catalog cards matching
// the details currently in the form so the user can link the exact card by
// hand. This is user-initiated only — never called by background valuation.
export const searchCardsightCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      player_name: z.string().nullable().optional(),
      year: z.union([z.string(), z.number()]).nullable().optional(),
      set_name: z.string().nullable().optional(),
      card_number: z.string().nullable().optional(),
      descriptor: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    if (!data.player_name?.trim()) return [];
    const { listCatalogCardCandidates } = await import("./cardsight.server");
    try {
      return await listCatalogCardCandidates({
        player_name: data.player_name,
        year: data.year,
        set_name: data.set_name,
        card_number: data.card_number,
        descriptor: data.descriptor,
      });
    } catch (err) {
      console.error("listCatalogCardCandidates failed:", err);
      return [];
    }
  });


export const listCardsightSetCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      card_id: z.string().uuid().nullable().optional(),
      descriptor: z.string().nullable().optional(),
      player_name: z.string().nullable().optional(),
      year: z.union([z.string(), z.number()]).nullable().optional(),
      set_name: z.string().nullable().optional(),
      card_number: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { listSetCandidatesForCard } = await import("./cardsight.server");
    try {
      return await listSetCandidatesForCard({
        card_id: data.card_id,
        descriptor: data.descriptor,
        player_name: data.player_name,
        year: data.year,
        set_name: data.set_name,
        card_number: data.card_number,
      });
    } catch (err) {
      console.error("listSetCandidatesForCard failed:", err);
      return [];
    }
  });

// The catalog entry a card is currently linked to. The form uses this to show
// the authoritative set/release for the link and to avoid dropping the link
// when the user is only correcting the set to the catalog's own name.
export const getCardsightCardSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ card_id: z.string().uuid().nullable().optional() }).parse(d))
  .handler(async ({ data }) => {
    if (!data.card_id) return null;
    const { getCatalogCardSummary } = await import("./cardsight.server");
    try {
      return await getCatalogCardSummary(data.card_id);
    } catch (err) {
      console.error("getCatalogCardSummary failed:", err);
      return null;
    }
  });
