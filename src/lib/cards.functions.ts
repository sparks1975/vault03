import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
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
  transform: { width: number; height: number; resize: "contain"; quality: number } = {
    width: 640,
    height: 896,
    resize: "contain",
    quality: 68,
  },
): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  const transformed = await supabase.storage.from("card-photos").createSignedUrl(path, SALE_TTL, {
    transform,
  });
  if (transformed.data?.signedUrl) return transformed.data.signedUrl;
  const { data } = await supabase.storage.from("card-photos").createSignedUrl(path, SALE_TTL);
  return data?.signedUrl ?? null;
}

async function signPhotoThumb(
  supabase: Awaited<ReturnType<typeof import("@supabase/supabase-js").createClient>>,
  path: string | null,
): Promise<string | null> {
  return signPhoto(supabase, path, { width: 160, height: 224, resize: "contain", quality: 52 });
}

async function signPhotoVariants(
  supabase: Awaited<ReturnType<typeof import("@supabase/supabase-js").createClient>>,
  path: string | null,
): Promise<{
  photo_url: string | null;
  photo_url_2x: string | null;
  photo_thumb_url: string | null;
  photo_thumb_url_2x: string | null;
}> {
  if (!path || path.startsWith("http") || path.startsWith("data:")) {
    const passthrough = path && (path.startsWith("http") || path.startsWith("data:")) ? path : null;
    return {
      photo_url: passthrough,
      photo_url_2x: passthrough,
      photo_thumb_url: passthrough,
      photo_thumb_url_2x: passthrough,
    };
  }
  const [photo_url, photo_url_2x, photo_thumb_url, photo_thumb_url_2x] = await Promise.all([
    signPhoto(supabase, path, { width: 640, height: 896, resize: "contain", quality: 68 }),
    signPhoto(supabase, path, { width: 1280, height: 1792, resize: "contain", quality: 62 }),
    signPhoto(supabase, path, { width: 160, height: 224, resize: "contain", quality: 52 }),
    signPhoto(supabase, path, { width: 320, height: 448, resize: "contain", quality: 55 }),
  ]);
  return { photo_url, photo_url_2x, photo_thumb_url, photo_thumb_url_2x };
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
      (cards ?? []).map(async (c) => {
        const variants = await signPhotoVariants(supabase as never, c.photo_url);
        return { ...c, ...variants };
      }),
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
      ...(await signPhotoVariants(supabase as never, row.photo_url)),
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
      "cardsight_lookup_failed_at",
      "last_valuation_failed_at",
    ];
    const clean: Record<string, unknown> = {};
    for (const k of allowed) {
      if (!(k in data.patch)) continue;
      clean[k] = k === "set_name" ? toApprovedCardSet(data.patch[k] as string | null | undefined) : data.patch[k];
    }

    // If the user corrected the card's identity (player / year / set / card #),
    // the CardSight ids resolved from the original scan are no longer valid.
    // Clear them and purge every stale comp so the next valuation re-resolves
    // from the corrected details.
    let identityReset = false;
    const identityKeys = ["player_name", "year", "set_name", "card_number"] as const;
    const touchesIdentity = identityKeys.some((k) => k in clean);
    const explicitIds = data.patch["cardsight_card_id"] != null;
    if (touchesIdentity && !explicitIds) {
      const { data: existing } = await supabase
        .from("cards")
        .select("player_name, year, set_name, card_number, cardsight_card_id")
        .eq("id", data.id)
        .maybeSingle();
      if (existing) {
        const norm = (v: unknown) => (v == null ? "" : String(v).trim().toLowerCase());
        const changed = identityKeys.some(
          (k) => k in clean && norm(clean[k]) !== norm((existing as Record<string, unknown>)[k]),
        );
        if (changed) {
          identityReset = true;
          clean["cardsight_card_id"] = null;
          clean["cardsight_parallel_id"] = null;
          clean["cardsight_grade_id"] = null;
          clean["current_value"] = null;
          clean["value_delta_pct"] = null;
          clean["last_valued_at"] = null;
          clean["cardsight_lookup_failed_at"] = null;
          clean["last_valuation_failed_at"] = null;
        }
      }
    }

    // The user linked (or changed) the catalog match by hand. That's a better
    // signal than any automatic resolution, so clear the lookup/valuation
    // failure cooldowns and drop the grade id + stale comps so the next
    // valuation re-resolves against the newly linked catalog card.
    let catalogRelinked = false;
    if (explicitIds && !identityReset) {
      const { data: existing } = await supabase
        .from("cards")
        .select("cardsight_card_id")
        .eq("id", data.id)
        .maybeSingle();
      if (existing && existing.cardsight_card_id !== clean["cardsight_card_id"]) {
        catalogRelinked = true;
        clean["cardsight_grade_id"] = null;
        clean["cardsight_lookup_failed_at"] = null;
        clean["last_valuation_failed_at"] = null;
      }
    }

    const { error } = await supabase.from("cards").update(clean as never).eq("id", data.id);
    if (error) throw error;

    if (identityReset || catalogRelinked) {
      await supabase.from("card_sales").delete().eq("card_id", data.id);
      await supabase.from("pt130_comps").delete().eq("card_id", data.id);
    }

    return { ok: true, identity_reset: identityReset };
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
  const { data: cardIdentity, error: cardIdentityError } = await supabase
    .from("cards")
    .select("player_name, year, set_name, card_number, is_autograph, serial_number, is_first_bowman")
    .eq("id", cardId)
    .eq("user_id", userId)
    .maybeSingle();
  if (cardIdentityError) throw cardIdentityError;
  if (!cardIdentity) throw new Error("Card not found");
  const { verifyCompTitle } = await import("./cardsight.server");
  const nonSingleCardRe = /\b(case\s*break|player\s*break|team\s*break|group\s*break|random\s*(team|player|division)|box\s*break|break\s*#?\d*|factory\s*sealed|sealed\s*(wax|box|case|pack|packs|product)|unopened|hobby\s*(box|case|pack|packs)|jumbo\s*(box|pack|packs)|blaster\s*(box|pack|packs)|retail\s*(box|pack|packs)|mega\s*box|hanger\s*(box|pack|packs)|value\s*box|cello\s*(box|pack|packs)|booster|wax\s*(box|pack|packs)|complete\s*set|factory\s*set|master\s*set|team\s*set|(\d+)\s*(box(es)?|case(s)?|pack(s)?|card\s*lot)|lot\s*of\s*\d+|card\s*lot|\d+\s*card\s*lot|repack|mixer)\b/i;
  const sealedWordsRe = /\b(factory|sealed|unopened|hobby|jumbo|blaster|retail|mega|hanger|value|cello|wax)\b/i;
  const containerWordsRe = /\b(box|boxes|case|cases|pack|packs|product|wax)\b/i;
  const singleCardSales = valuation.sales.filter((s) => {
    const title = String(s.title ?? "").trim();
    if (!title || nonSingleCardRe.test(title) || (sealedWordsRe.test(title) && containerWordsRe.test(title))) return false;
    return verifyCompTitle(title, cardIdentity).verified;
  });
  const validSalePrices = singleCardSales
    .map((s) => Number(s.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  // Merge any preserved manual comps into the median so user picks influence value.
  const { data: manualRows } = await supabase
    .from("card_sales")
    .select("id, price, title")
    .eq("card_id", cardId)
    .eq("is_manual", true);
  const nonSingleRe = /\b(case\s*break|player\s*break|team\s*break|group\s*break|random\s*(team|player|division)|box\s*break|break\s*#?\d*|factory\s*sealed|sealed\s*(wax|box|case|pack|packs|product)|unopened|hobby\s*(box|case|pack|packs)|jumbo\s*(box|pack|packs)|blaster\s*(box|pack|packs)|retail\s*(box|pack|packs)|mega\s*box|hanger\s*(box|pack|packs)|value\s*box|cello\s*(box|pack|packs)|booster|wax\s*(box|pack|packs)|complete\s*set|factory\s*set|master\s*set|team\s*set|(\d+)\s*(box(es)?|case(s)?|pack(s)?|card\s*lot)|lot\s*of\s*\d+|card\s*lot|\d+\s*card\s*lot|repack|mixer)\b/i;
  const invalidManualIds: string[] = [];
  for (const m of manualRows ?? []) {
    const p = Number(m.price);
    const title = String(m.title ?? "");
    if (Number.isFinite(p) && p > 0 && !nonSingleRe.test(title) && verifyCompTitle(title, cardIdentity).verified) {
      validSalePrices.push(p);
    } else {
      invalidManualIds.push(m.id);
    }
  }
  if (invalidManualIds.length > 0) {
    await supabase.from("card_sales").delete().in("id", invalidManualIds).eq("card_id", cardId);
  }
  validSalePrices.sort((a, b) => a - b);
  const medianSaleValue = (() => {
    if (validSalePrices.length === 0) return null;
    const mid = Math.floor(validSalePrices.length / 2);
    return validSalePrices.length % 2
      ? validSalePrices[mid]
      : (validSalePrices[mid - 1] + validSalePrices[mid]) / 2;
  })();
  const currentValue = medianSaleValue ?? valuation.current_value;
  // A value of 0 means every pricing source failed (the AI fallback's
  // last-resort failure value) — not a real $0 valuation. Treat it as a
  // failed attempt rather than a fresh, successful one: don't overwrite the
  // card's existing value/last_valued_at, so the UI keeps showing the last
  // known-good value (or "—" if there never was one) instead of masking the
  // failure as "$0.00, freshly valued" and suppressing retry for 30 days.
  const valuationSucceeded = Number.isFinite(currentValue) && currentValue > 0;

  await supabase.from("card_sales").delete().eq("card_id", cardId).eq("is_manual", false);
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
  if (valuationSucceeded) {
    await supabase.from("card_value_history").delete().eq("card_id", cardId);
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
        last_valuation_failed_at: null,
      })
      .eq("id", cardId);
  } else {
    await supabase
      .from("cards")
      .update({ last_valuation_failed_at: new Date().toISOString() })
      .eq("id", cardId);
  }
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
        if (original.byteLength <= 220_000) {
          bytesAfter += original.byteLength;
          skipped++;
          continue;
        }
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

// ---------- Manual comp override ----------

const NON_SINGLE_RE_LOCAL = /\b(case\s*break|player\s*break|team\s*break|group\s*break|random\s*(team|player|division)|box\s*break|break\s*#?\d*|factory\s*sealed|sealed\s*(wax|box|case|pack|packs|product)|unopened|hobby\s*(box|case|pack|packs)|jumbo\s*(box|pack|packs)|blaster\s*(box|pack|packs)|retail\s*(box|pack|packs)|mega\s*box|hanger\s*(box|pack|packs)|value\s*box|cello\s*(box|pack|packs)|booster|wax\s*(box|pack|packs)|complete\s*set|factory\s*set|master\s*set|team\s*set|(\d+)\s*(box(es)?|case(s)?|pack(s)?|card\s*lot)|lot\s*of\s*\d+|card\s*lot|\d+\s*card\s*lot|repack|mixer)\b/i;

async function recomputeCardValue(
  supabase: Awaited<ReturnType<typeof import("@supabase/supabase-js").createClient<Database>>>,
  cardId: string,
) {
  const { data: card } = await supabase
    .from("cards")
    .select("player_name, year, set_name, card_number, is_autograph, serial_number, is_first_bowman")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) throw new Error("Card not found");
  const { verifyCompTitle } = await import("./cardsight.server");
  const { data: rows } = await supabase
    .from("card_sales")
    .select("price, title")
    .eq("card_id", cardId);
  const prices = (rows ?? [])
    .filter((r) => {
      const title = String(r.title ?? "");
      return !NON_SINGLE_RE_LOCAL.test(title) && verifyCompTitle(title, card).verified;
    })
    .map((r) => Number(r.price))
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) {
    await supabase
      .from("cards")
      .update({ current_value: null, last_valued_at: new Date().toISOString() } as never)
      .eq("id", cardId);
    return;
  }
  const mid = Math.floor(prices.length / 2);
  const med = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  await supabase
    .from("cards")
    .update({ current_value: med, last_valued_at: new Date().toISOString() } as never)
    .eq("id", cardId);
}

// A card with no saved catalog id that failed resolution recently will very
// likely fail again — skip re-running the resolution cascade until this
// cooldown elapses (mirrors the same cooldown in ai.functions.ts).
const LOOKUP_RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export const fetchCompCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ card_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: card, error } = await supabase
      .from("cards")
      .select(
        "id, cardsight_card_id, cardsight_lookup_failed_at, player_name, year, set_name, card_number, is_autograph, serial_number, is_first_bowman",
      )
      .eq("id", data.card_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!card) throw new Error("Card not found");
    const { verifyCompTitle } = await import("./cardsight.server");

    const candidates: Array<{
      title: string | null;
      image_url: string | null;
      price: number;
      sold_at: string | null;
      source: string;
      url: string | null;
    }> = [];

    // Always resolve Manage Comps from the card's current editable identity.
    // A legacy/bad scan can leave a valid UUID pointing at a completely
    // different player, so merely checking that an id exists is not enough.
    // Exception: a card with no saved id that recently failed to resolve
    // skips straight to cached comps instead of re-paying the cascade.
    let cardsightId: string | null = null;
    const skipResolution = !!card && !card.cardsight_card_id && !!card.cardsight_lookup_failed_at &&
      Date.now() - new Date(card.cardsight_lookup_failed_at).getTime() < LOOKUP_RETRY_COOLDOWN_MS;
    if (card && !skipResolution) {
      try {
        const { findCatalogCard } = await import("./cardsight.server");
        const match = await findCatalogCard({
          player_name: card.player_name,
          year: card.year,
          set_name: card.set_name,
          card_number: card.card_number,
          is_autograph: card.is_autograph,
          is_first_bowman: card.is_first_bowman,
        });
        if (match?.id) {
          cardsightId = match.id;
          if (cardsightId !== card.cardsight_card_id) {
            await supabase
              .from("cards")
              .update({
                cardsight_card_id: cardsightId,
                cardsight_parallel_id: null,
                cardsight_grade_id: null,
                current_value: null,
                value_delta_pct: null,
                last_valued_at: null,
                cardsight_lookup_failed_at: null,
              } as never)
              .eq("id", card.id);
            await supabase.from("card_sales").delete().eq("card_id", card.id);
            await supabase.from("pt130_comps").delete().eq("card_id", card.id);
          }
        } else if (card.cardsight_card_id) {
          // Never fall back to a stored id that cannot be verified against the
          // corrected player/year/set/card number.
          await supabase
            .from("cards")
            .update({
              cardsight_card_id: null,
              cardsight_parallel_id: null,
              cardsight_grade_id: null,
              current_value: null,
              value_delta_pct: null,
              last_valued_at: null,
              cardsight_lookup_failed_at: new Date().toISOString(),
            } as never)
            .eq("id", card.id);
          await supabase.from("card_sales").delete().eq("card_id", card.id);
          await supabase.from("pt130_comps").delete().eq("card_id", card.id);
        } else {
          await supabase
            .from("cards")
            .update({ cardsight_lookup_failed_at: new Date().toISOString() } as never)
            .eq("id", card.id);
        }
      } catch (err) {
        console.error("fetchCompCandidates catalog resolve failed", err);
      }
    }

    if (cardsightId) {
      try {
        const { fetchAllCompCandidates } = await import("./cardsight.server");
        const rows = await fetchAllCompCandidates(cardsightId);

        for (const r of rows) {
          const price = Number(r.price);
          if (!Number.isFinite(price) || price <= 0 || !verifyCompTitle(r.title, card).verified) continue;
          candidates.push({
            title: r.title ?? null,
            image_url: null,
            price,
            sold_at: r.date ?? null,
            source: r.source || "eBay sold",
            url: r.url ?? null,
          });
        }
      } catch (err) {
        console.error("fetchCompCandidates cardsight failed", err);
      }
    }

    // Temporary discovery flag: when disabled, skip 130point entirely so only
    // CardSight comps surface here.
    const { PT130_ENABLED } = await import("./valuation-flags");
    if (PT130_ENABLED) {
      // Older cached 130point rows predate image storage. Refresh those rows once
      // from the same verified sold-results search so Manage Comps can display
      // the listing photo without relying on ended eBay pages or active listings.
      const { data: missingPhotoRows } = await supabase
        .from("pt130_comps")
        .select("id")
        .eq("card_id", data.card_id)
        .eq("user_id", userId)
        .is("image_url", null)
        .limit(1);
      if ((missingPhotoRows?.length ?? 0) > 0) {
        try {
          const { buildPt130Descriptors, refreshPt130ForCard } = await import("./pt130.server");
          await refreshPt130ForCard(supabase, {
            card_id: data.card_id,
            user_id: userId,
            descriptor: buildPt130Descriptors({
              year: card.year,
              set_name: card.set_name,
              player_name: card.player_name,
              card_number: card.card_number,
              is_autograph: card.is_autograph,
            }),
            card_number: card.card_number,
          });
        } catch (err) {
          console.error("fetchCompCandidates photo backfill failed", err);
        }
      }

      // Include cached 130point rows if any.
      const { data: pt } = await supabase
        .from("pt130_comps")
        .select("title, image_url, price, sold_at, url")
        .eq("card_id", data.card_id)
        .eq("user_id", userId);
      for (const r of pt ?? []) {
        const price = Number(r.price);
        if (!Number.isFinite(price) || price <= 0 || !verifyCompTitle(r.title, card).verified) continue;
        candidates.push({
          title: r.title ?? null,
          image_url: r.image_url ?? null,
          price,
          sold_at: r.sold_at ?? null,
          source: "eBay sold",
          url: r.url ?? null,
        });
      }
    }

    // Dedupe by url (or title|price|date), but preserve the 130point copy when
    // it carries a sold-listing photo that the CardSight copy does not.
    const dedupedByKey = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      const key = candidate.url || `${candidate.title ?? ""}|${candidate.price}|${candidate.sold_at ?? ""}`;
      const current = dedupedByKey.get(key);
      if (!current || (!current.image_url && candidate.image_url)) {
        dedupedByKey.set(key, candidate);
      }
    }
    const deduped = Array.from(dedupedByKey.values());
    deduped.sort((a, b) => {
      const ta = a.sold_at ? new Date(a.sold_at).getTime() : 0;
      const tb = b.sold_at ? new Date(b.sold_at).getTime() : 0;
      return tb - ta;
    });

    const { data: selected } = await supabase
      .from("card_sales")
      .select("id, url, title, price, sold_at, source, is_manual")
      .eq("card_id", data.card_id)
      .eq("user_id", userId);

    // card_sales predates image storage. Hydrate selected rows from the
    // matching candidate so checked comps use the same captured sold photo.
    const selectedWithImages = (selected ?? []).map((sale) => {
      const match = deduped.find((candidate) => {
        if (sale.url && candidate.url && sale.url === candidate.url) return true;
        return candidate.title === sale.title &&
          Number(candidate.price) === Number(sale.price) &&
          String(candidate.sold_at ?? "").slice(0, 10) === String(sale.sold_at ?? "").slice(0, 10);
      });
      return { ...sale, image_url: match?.image_url ?? null };
    });

    return { candidates: deduped, selected: selectedWithImages };
  });

export const addManualComps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        card_id: z.string().uuid(),
        comps: z
          .array(
            z.object({
              title: z.string().nullable(),
              price: z.number().positive(),
              sold_at: z.string().nullable(),
              source: z.string(),
              url: z.string().nullable(),
            }),
          )
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: card, error: cardError } = await supabase
      .from("cards")
      .select("player_name, year, set_name, card_number, is_autograph, serial_number, is_first_bowman")
      .eq("id", data.card_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (cardError) throw cardError;
    if (!card) throw new Error("Card not found");
    const { verifyCompTitle } = await import("./cardsight.server");
    const verifiedComps = data.comps.filter((comp) => verifyCompTitle(comp.title, card).verified);
    if (verifiedComps.length !== data.comps.length) {
      throw new Error("A selected sale does not show this card's exact full card number.");
    }
    if (verifiedComps.length > 0) {
      const { error } = await supabase.from("card_sales").insert(
        verifiedComps.map((c) => ({
          card_id: data.card_id,
          user_id: userId,
          sold_at: c.sold_at ? c.sold_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
          grade: null,
          price: c.price,
          source: c.source || "eBay sold",
          url: c.url,
          title: c.title,
          is_manual: true,
        })) as never,
      );
      if (error) throw error;
    }
    await recomputeCardValue(supabase as never, data.card_id);
    return { ok: true };
  });

export const removeManualComp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), card_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("card_sales")
      .delete()
      .eq("id", data.id)
      .eq("card_id", data.card_id)
      .eq("user_id", userId);
    await recomputeCardValue(supabase as never, data.card_id);
    return { ok: true };
  });

