import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { estimateCardValue } from "./ai.functions";
import { toApprovedCardSet } from "./card-sets";



const SALE_TTL = 60 * 60; // 1 hour signed URL

const cardInputSchema = z.object({
  player_name: z.string().min(1),
  team: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  set_name: z.string().nullable().optional(),
  card_number: z.string().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  is_autograph: z.boolean().optional(),
  is_first_bowman: z.boolean().optional(),
  is_rookie: z.boolean().optional(),
  grade: z.string().nullable().optional(),
  grader: z.string().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  photo_path: z.string().nullable().optional(),
  mlb_player_id: z.number().int().nullable().optional(),
  cardsight_card_id: z.string().uuid().nullable().optional(),
  cardsight_parallel_id: z.string().uuid().nullable().optional(),
  cardsight_grade_id: z.string().uuid().nullable().optional(),
});

function dataUrlToBytes(dataUrl: string) {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid image data URL");
  const contentType = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = contentType.split("/")[1]?.split("+")[0] || "jpg";
  return { bytes, contentType, ext };
}

async function signPhoto(
  supabase: Awaited<ReturnType<typeof import("@supabase/supabase-js").createClient>>,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  const { data } = await supabase.storage.from("card-photos").createSignedUrl(path, SALE_TTL);
  return data?.signedUrl ?? null;
}

export const uploadCardPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { imageDataUrl: string }) =>
    z.object({ imageDataUrl: z.string().startsWith("data:image/") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const src = dataUrlToBytes(data.imageDataUrl);
    const { compressBytes } = await import("./tinypng.server");
    const { bytes, contentType } = await compressBytes(src.bytes, src.contentType);
    const ext = contentType.split("/")[1]?.split("+")[0] || src.ext;
    const path = `${userId}/cards/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("card-photos")
      .upload(path, bytes, { contentType, upsert: false });
    if (error) throw error;
    const signed = await signPhoto(supabase as never, path);
    return { path, url: signed };
  });

export const listCards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: cards, error } = await supabase
      .from("cards")
      .select("*, sales:card_sales(*), history:card_value_history(*)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const withUrls = await Promise.all(
      (cards ?? []).map(async (c) => ({
        ...c,
        photo_url: await signPhoto(supabase as never, c.photo_url),
      })),
    );
    return withUrls;
  });

export const reorderCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ orderedIds: z.array(z.string().uuid()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Update each card's sort_order to its index in the array.
    await Promise.all(
      data.orderedIds.map((id, index) =>
        supabase
          .from("cards")
          .update({ sort_order: index } as never)
          .eq("id", id)
          .eq("user_id", userId),
      ),
    );
    return { ok: true };
  });

export const createCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => cardInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { photo_path, ...rest } = data;
    const { data: row, error } = await supabase
      .from("cards")
      .insert({ ...rest, set_name: toApprovedCardSet(rest.set_name), photo_url: photo_path ?? null, user_id: userId })
      .select("*")
      .single();
    if (error) throw error;
    return {
      ...row,
      photo_url: await signPhoto(supabase as never, row.photo_url),
      sales: [],
      history: [],
    };
  });

export const updateCardFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        patch: z.record(z.string(), z.unknown()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
const allowed = [
      "player_name",
      "team",
      "position",
      "year",
      "set_name",
      "card_number",
      "serial_number",
      "is_autograph",
      "is_first_bowman",
      "is_rookie",
      "grade",
      "grader",
      "purchase_price",
      "notes",
      "mlb_player_id",
      "current_value",
      "value_delta_pct",
      "last_valued_at",
      "cardsight_card_id",
      "cardsight_parallel_id",
      "cardsight_grade_id",
    ];
    const clean: Record<string, unknown> = {};
    for (const k of allowed) {
      if (!(k in data.patch)) continue;
      clean[k] = k === "set_name" ? toApprovedCardSet(data.patch[k] as string | null | undefined) : data.patch[k];
    }
    const { error } = await supabase.from("cards").update(clean as never).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Remove photo from storage best-effort
    const { data: card } = await supabase
      .from("cards")
      .select("photo_url")
      .eq("id", data.id)
      .maybeSingle();
    if (card?.photo_url && !card.photo_url.startsWith("http")) {
      await supabase.storage.from("card-photos").remove([card.photo_url]);
    }
    await supabase.from("card_sales").delete().eq("card_id", data.id);
    await supabase.from("card_value_history").delete().eq("card_id", data.id);
    const { error } = await supabase.from("cards").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

async function applyValuation(
  supabase: Awaited<ReturnType<typeof import("@supabase/supabase-js").createClient<Database>>>,
  userId: string,
  cardId: string,
  valuation: {

    current_value: number;
    value_delta_pct: number;
    sales: Array<{ sold_at: string | null; grade: string | null; price: number; source: string; url: string | null; title?: string | null }>;
    history: Array<{ recorded_at: string; value: number }>;
  },
) {
  const nonSingleCardRe = /\b(case\s*break|player\s*break|team\s*break|group\s*break|random\s*(team|player|division)|box\s*break|break\s*#?\d*|factory\s*sealed|sealed\s*(wax|box|case|pack|packs|product)|unopened|hobby\s*(box|case|pack|packs)|jumbo\s*(box|pack|packs)|blaster\s*(box|pack|packs)|retail\s*(box|pack|packs)|mega\s*box|hanger\s*(box|pack|packs)|value\s*box|cello\s*(box|pack|packs)|booster|wax\s*(box|pack|packs)|complete\s*set|factory\s*set|master\s*set|team\s*set|(\d+)\s*(box(es)?|case(s)?|pack(s)?|card\s*lot)|lot\s*of\s*\d+|card\s*lot|\d+\s*card\s*lot|repack|mixer)\b/i;
  const sealedWordsRe = /\b(factory|sealed|unopened|hobby|jumbo|blaster|retail|mega|hanger|value|cello|wax)\b/i;
  const containerWordsRe = /\b(box|boxes|case|cases|pack|packs|product|wax)\b/i;
  const singleCardSales = valuation.sales.filter((s) => {
    const title = String(s.title ?? "").trim();
    if (!title) return true;
    return !(nonSingleCardRe.test(title) || (sealedWordsRe.test(title) && containerWordsRe.test(title)));
  });
  const validSalePrices = singleCardSales
    .map((s) => Number(s.price))
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  const medianSaleValue = (() => {
    if (validSalePrices.length === 0) return null;
    const mid = Math.floor(validSalePrices.length / 2);
    return validSalePrices.length % 2
      ? validSalePrices[mid]
      : (validSalePrices[mid - 1] + validSalePrices[mid]) / 2;
  })();
  const currentValue = medianSaleValue ?? valuation.current_value;

  await supabase.from("card_sales").delete().eq("card_id", cardId).eq("is_manual", false);
  await supabase.from("card_value_history").delete().eq("card_id", cardId);
  if (singleCardSales.length) {
    const { error } = await supabase.from("card_sales").insert(
      singleCardSales.map((s) => ({
        card_id: cardId,
        user_id: userId,
        sold_at: s.sold_at ? s.sold_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
        grade: s.grade,
        price: s.price,
        source: s.source,
        url: s.url,
        title: s.title ?? null,
      })),
    );
    if (error) throw error;
  }
  if (valuation.history.length) {
    const { error } = await supabase.from("card_value_history").insert(
      valuation.history.map((h) => ({
        card_id: cardId,
        user_id: userId,
        recorded_at: h.recorded_at,
        value: h.value,
      })),
    );
    if (error) throw error;
  }
  await supabase
    .from("cards")
    .update({
      current_value: currentValue,
      value_delta_pct: valuation.value_delta_pct,
      last_valued_at: new Date().toISOString(),
    })
    .eq("id", cardId);
}




export const replaceValuation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        card_id: z.string().uuid(),
        current_value: z.number(),
        value_delta_pct: z.number(),
        sales: z.array(
          z.object({
            sold_at: z.string().nullable(),
            grade: z.string().nullable(),
            price: z.number(),
            source: z.string(),
            url: z.string().nullable(),
            title: z.string().nullable().optional(),
          }),
        ),
        history: z.array(z.object({ recorded_at: z.string(), value: z.number() })),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await applyValuation(supabase as never, userId, data.card_id, {
      current_value: data.current_value,
      value_delta_pct: data.value_delta_pct,
      sales: data.sales,
      history: data.history,
    });
    return { ok: true };
  });

export const revalueAllCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: cards, error } = await supabase
      .from("cards")
      .select("id, player_name, year, set_name, card_number, grade, grader, is_autograph, is_first_bowman, serial_number, cardsight_card_id, cardsight_parallel_id, cardsight_grade_id, last_valued_at")
      .eq("user_id", userId);
    if (error) throw error;

    let processed = 0;
    let failed = 0;
    for (const c of cards ?? []) {
      try {
        const est = await estimateCardValue({
          data: {
            player_name: c.player_name,
            year: c.year,
            set_name: c.set_name,
            card_number: c.card_number,
            grade: c.grade,
            grader: c.grader,
            is_autograph: c.is_autograph,
            is_first_bowman: c.is_first_bowman,
            serial_number: c.serial_number,
            cardsight_card_id: c.cardsight_card_id,
            cardsight_parallel_id: c.cardsight_parallel_id,
            cardsight_grade_id: c.cardsight_grade_id,
            card_id: c.id,
          },
        });
        await applyValuation(supabase as never, userId, c.id, {
          current_value: est.current_value,
          value_delta_pct: est.value_delta_pct,
          sales: est.sales,
          history: est.history,
        });
        const idPatch: Record<string, string> = {};
        if (!c.cardsight_card_id && est.resolved_cardsight_card_id) {
          idPatch.cardsight_card_id = est.resolved_cardsight_card_id;
        }
        if (!c.cardsight_grade_id && est.resolved_cardsight_grade_id) {
          idPatch.cardsight_grade_id = est.resolved_cardsight_grade_id;
        }
        if (Object.keys(idPatch).length > 0) {
          await supabase.from("cards").update(idPatch as never).eq("id", c.id);
        }


        processed++;
      } catch (err) {
        console.error("Revalue failed for", c.player_name, err);
        failed++;
      }
    }
    return { processed, failed, total: cards?.length ?? 0 };
  });


// ---------- Compress existing stored images via TinyPNG ----------
export const compressExistingPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: cards, error } = await supabase
      .from("cards")
      .select("id, photo_url")
      .eq("user_id", userId);
    if (error) throw error;
    const { compressBytes } = await import("./tinypng.server");

    let processed = 0;
    let bytesBefore = 0;
    let bytesAfter = 0;
    let skipped = 0;
    let failed = 0;

    for (const card of cards ?? []) {
      const path = card.photo_url as string | null;
      if (!path || path.startsWith("http") || path.startsWith("data:")) {
        skipped++;
        continue;
      }
      try {
        const { data: file, error: dlErr } = await supabase.storage
          .from("card-photos")
          .download(path);
        if (dlErr || !file) {
          failed++;
          continue;
        }
        const type = file.type || "image/jpeg";
        if (!/^image\/(png|jpe?g|webp)$/i.test(type)) {
          skipped++;
          continue;
        }
        const original = new Uint8Array(await file.arrayBuffer());
        bytesBefore += original.byteLength;
        const { bytes, contentType } = await compressBytes(original, type);
        if (bytes.byteLength >= original.byteLength) {
          bytesAfter += original.byteLength;
          skipped++;
          continue;
        }
        const { error: upErr } = await supabase.storage
          .from("card-photos")
          .upload(path, bytes, { contentType, upsert: true });
        if (upErr) {
          failed++;
          bytesAfter += original.byteLength;
          continue;
        }
        bytesAfter += bytes.byteLength;
        processed++;
      } catch (err) {
        console.error("compressExistingPhotos error for", path, err);
        failed++;
      }
    }
    return { processed, skipped, failed, bytesBefore, bytesAfter };
  });
