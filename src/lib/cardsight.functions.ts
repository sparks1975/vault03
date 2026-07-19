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
    const { listParallelsForCard, searchCatalogCardByFields } = await import("./cardsight.server");
    try {
      const cardId = data.card_id ?? await searchCatalogCardByFields({
        player_name: data.player_name,
        year: data.year,
        set_name: data.set_name,
        card_number: data.card_number,
        descriptor: data.descriptor,
      });
      if (!cardId) return [];
      return await listParallelsForCard(cardId);
    } catch (err) {
      console.error("listParallelsForCard failed:", err);
      return [];
    }
  });
