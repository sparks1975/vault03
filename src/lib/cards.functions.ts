import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CardInput = z.object({
  player_name: z.string().min(1).max(120),
  team: z.string().max(80).optional().nullable(),
  position: z.string().max(20).optional().nullable(),
  year: z.number().int().min(1850).max(2100).optional().nullable(),
  set_name: z.string().max(120).optional().nullable(),
  card_number: z.string().max(40).optional().nullable(),
  grade: z.string().max(20).optional().nullable(),
  grader: z.string().max(20).optional().nullable(),
  purchase_price: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  photo_url: z.string().max(500).optional().nullable(),
  mlb_player_id: z.number().int().optional().nullable(),
});

export const listCards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("cards")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getCard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [card, sales, history] = await Promise.all([
      context.supabase.from("cards").select("*").eq("id", data.id).maybeSingle(),
      context.supabase.from("card_sales").select("*").eq("card_id", data.id).order("sold_at", { ascending: false }).limit(20),
      context.supabase.from("card_value_history").select("*").eq("card_id", data.id).order("recorded_at", { ascending: true }).limit(60),
    ]);
    if (card.error) throw new Error(card.error.message);
    if (!card.data) throw new Error("Card not found");
    return { card: card.data, sales: sales.data ?? [], history: history.data ?? [] };
  });

export const createCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CardInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase
      .from("cards")
      .insert({ ...data, user_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const updateCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), patch: CardInput.partial() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("cards")
      .update(data.patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const deleteCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("cards").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveValuation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      card_id: z.string().uuid(),
      current_value: z.number().nonnegative(),
      value_delta_pct: z.number().optional().nullable(),
      sales: z
        .array(
          z.object({
            sold_at: z.string(),
            grade: z.string().optional().nullable(),
            price: z.number().nonnegative(),
            source: z.string().optional().nullable(),
            url: z.string().optional().nullable(),
          }),
        )
        .default([]),
      history: z
        .array(z.object({ recorded_at: z.string(), value: z.number().nonnegative() }))
        .default([]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error: upErr } = await context.supabase
      .from("cards")
      .update({
        current_value: data.current_value,
        value_delta_pct: data.value_delta_pct ?? null,
        last_valued_at: new Date().toISOString(),
      })
      .eq("id", data.card_id);
    if (upErr) throw new Error(upErr.message);

    // Replace sales cache
    await context.supabase.from("card_sales").delete().eq("card_id", data.card_id);
    if (data.sales.length) {
      const { error } = await context.supabase.from("card_sales").insert(
        data.sales.map((s) => ({ ...s, card_id: data.card_id, user_id: context.userId })),
      );
      if (error) throw new Error(error.message);
    }

    if (data.history.length) {
      await context.supabase.from("card_value_history").delete().eq("card_id", data.card_id);
      const { error } = await context.supabase.from("card_value_history").insert(
        data.history.map((h) => ({ ...h, card_id: data.card_id, user_id: context.userId })),
      );
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
