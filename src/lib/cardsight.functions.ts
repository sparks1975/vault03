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
