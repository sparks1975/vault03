// Nightly refresh of the eBay sold-listings cache (via Apify caffein.dev actor) for every card in the app.
// Triggered by pg_cron via HTTP POST with the Supabase publishable key in the
// `apikey` header. The route validates that key against the environment before
// doing any work.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { buildPt130Descriptors, refreshPt130ForCard } from "@/lib/pt130.server";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/public/hooks/refresh-130point")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || provided !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const url = process.env.SUPABASE_URL;
        const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceRole) {
          return new Response(JSON.stringify({ error: "Cloud config missing" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const admin = createClient<Database>(url, serviceRole, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: cards, error } = await admin
          .from("cards")
          .select("id, user_id, player_name, year, set_name, card_number, is_autograph, grader, grade, parallel");
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let processed = 0;
        let stored = 0;
        let failed = 0;
        for (const c of cards ?? []) {
          const descriptors = buildPt130Descriptors({ ...c, selected_parallel_name: c.parallel });
          if (descriptors.length === 0) continue;
          try {
            const r = await refreshPt130ForCard(admin as never, {
              card_id: c.id,
              user_id: c.user_id,
              descriptor: descriptors,
              card_number: c.card_number,
            });
            processed++;
            stored += r.stored;
          } catch (err) {
            failed++;
            console.error("refresh-130point failed for card", c.id, err);
          }
          // Gentle pacing so we don't hammer the Apify actor.
          await new Promise((r) => setTimeout(r, 1500));
        }

        return new Response(
          JSON.stringify({ ok: true, processed, stored, failed }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
