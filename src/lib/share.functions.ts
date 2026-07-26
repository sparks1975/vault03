import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type PublicCard = {
  id: string;
  player_name: string;
  team: string | null;
  position: string | null;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
  parallel: string | null;
  serial_number: string | null;
  grade: string | null;
  grader: string | null;
  is_autograph: boolean;
  is_rookie: boolean;
  is_first_bowman: boolean;
  current_value: number | null;
  value_delta_pct: number | null;
  last_valued_at: string | null;
  photo_url: string | null;
  photo_url_2x: string | null;
  photo_thumb_url: string | null;
  photo_thumb_url_2x: string | null;
  created_at: string;
};

const SIGNED_URL_TTL = 60 * 60;

const SAFE_CARD_COLUMNS = [
  "id",
  "player_name",
  "team",
  "position",
  "year",
  "set_name",
  "card_number",
  "parallel",
  "serial_number",
  "grade",
  "grader",
  "is_autograph",
  "is_rookie",
  "is_first_bowman",
  "current_value",
  "value_delta_pct",
  "last_valued_at",
  "photo_url",
  "created_at",
].join(", ");

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export const getShareSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("share_slug, is_public, display_name")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return {
      share_slug: data?.share_slug ?? null,
      is_public: data?.is_public ?? false,
      display_name: data?.display_name ?? null,
    };
  });

export const updateShareSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        is_public: z.boolean(),
        share_slug: z.string().min(3).max(40).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const patch: Record<string, unknown> = { is_public: data.is_public };

    if (data.share_slug !== undefined && data.share_slug !== null) {
      const clean = slugify(data.share_slug);
      if (clean.length < 3) throw new Error("Slug must be at least 3 characters (letters, numbers, dashes).");

      // Ensure not taken by another user
      const { data: existing, error: exErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("share_slug", clean)
        .neq("id", userId)
        .maybeSingle();
      if (exErr) throw exErr;
      if (existing) throw new Error("That link name is already taken. Try another.");
      patch.share_slug = clean;
    }

    const { error } = await supabase.from("profiles").update(patch as never).eq("id", userId);
    if (error) throw error;

    const { data: fresh } = await supabase
      .from("profiles")
      .select("share_slug, is_public")
      .eq("id", userId)
      .maybeSingle();
    return {
      share_slug: fresh?.share_slug ?? null,
      is_public: fresh?.is_public ?? false,
    };
  });

export const getPublicCollection = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const slug = slugify(data.slug);

    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, share_slug, is_public")
      .eq("share_slug", slug)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!profile || !profile.is_public) {
      return { notFound: true as const };
    }

    const { data: cardsRaw, error: cErr } = await supabaseAdmin
      .from("cards")
      .select(SAFE_CARD_COLUMNS)
      .eq("user_id", profile.id)
      .order("current_value", { ascending: false, nullsFirst: false });
    if (cErr) throw cErr;
    const cards = (cardsRaw ?? []) as unknown as PublicCard[];

    const withSigned: PublicCard[] = await Promise.all(
      cards.map(async (c) => {
        const path = c.photo_url;
        let photo_url: string | null = null;
        if (path && !path.startsWith("http") && !path.startsWith("data:")) {
          const { data: signed } = await supabaseAdmin.storage
            .from("card-photos")
            .createSignedUrl(path, SIGNED_URL_TTL, {
              transform: { width: 640, height: 896, resize: "contain", quality: 68 },
            });
          if (signed?.signedUrl) {
            photo_url = signed.signedUrl;
          } else {
            const { data: fallback } = await supabaseAdmin.storage
              .from("card-photos")
              .createSignedUrl(path, SIGNED_URL_TTL);
            photo_url = fallback?.signedUrl ?? null;
          }
        } else if (typeof path === "string") {
          photo_url = path;
        }
        return { ...c, photo_url };
      }),
    );

    const totalValue = withSigned.reduce(
      (sum, c) => sum + (typeof c.current_value === "number" ? c.current_value : 0),
      0,
    );

    return {
      notFound: false as const,
      owner: {
        display_name: profile.display_name,
        share_slug: profile.share_slug,
      },
      total_value: totalValue,
      card_count: withSigned.length,
      cards: withSigned,
    };
  });
