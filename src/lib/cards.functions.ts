import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  grade: z.string().nullable().optional(),
  grader: z.string().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  photo_path: z.string().nullable().optional(),
  mlb_player_id: z.number().int().nullable().optional(),
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

export const createCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => cardInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { photo_path, ...rest } = data;
    const { data: row, error } = await supabase
      .from("cards")
      .insert({ ...rest, photo_url: photo_path ?? null, user_id: userId })
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
      "grade",
      "grader",
      "purchase_price",
      "notes",
      "mlb_player_id",
      "current_value",
      "value_delta_pct",
      "last_valued_at",
    ];
    const clean: Record<string, unknown> = {};
    for (const k of allowed) if (k in data.patch) clean[k] = data.patch[k];
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
          }),
        ),
        history: z.array(z.object({ recorded_at: z.string(), value: z.number() })),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("card_sales").delete().eq("card_id", data.card_id);
    await supabase.from("card_value_history").delete().eq("card_id", data.card_id);
    if (data.sales.length) {
      const { error } = await supabase.from("card_sales").insert(
        data.sales.map((s) => ({
          card_id: data.card_id,
          user_id: userId,
          sold_at: s.sold_at ? s.sold_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
          grade: s.grade,
          price: s.price,
          source: s.source,
          url: s.url,
        })),
      );
      if (error) throw error;
    }
    if (data.history.length) {
      const { error } = await supabase.from("card_value_history").insert(
        data.history.map((h) => ({
          card_id: data.card_id,
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
        current_value: data.current_value,
        value_delta_pct: data.value_delta_pct,
        last_valued_at: new Date().toISOString(),
      })
      .eq("id", data.card_id);
    return { ok: true };
  });
