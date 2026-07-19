import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listCardsightParallels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ card_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { listParallelsForCard } = await import("./cardsight.server");
    try {
      return await listParallelsForCard(data.card_id);
    } catch (err) {
      console.error("listParallelsForCard failed:", err);
      return [];
    }
  });
