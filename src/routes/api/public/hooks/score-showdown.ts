// Nightly Weekly Showdown scoring. Triggered by pg_cron via HTTP POST with the
// Supabase publishable key in the `apikey` header. Creates the current week's
// contest, locks past-deadline contests, rescores open/locked contests, and
// finalizes weeks that have ended (awarding badges).
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ensureCurrentContest, finalizeContest, scoreContest } from "@/lib/showdown.server";

export const Route = createFileRoute("/api/public/hooks/score-showdown")({
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

        try {
          await ensureCurrentContest(admin);

          const nowIso = new Date().toISOString();
          const today = nowIso.slice(0, 10);

          // Lock any open contest whose deadline has passed.
          await admin
            .from("contests")
            .update({ status: "locked" })
            .eq("status", "open")
            .lt("lock_at", nowIso);

          const { data: active, error } = await admin
            .from("contests")
            .select("*")
            .neq("status", "final");
          if (error) throw error;

          const results: Record<string, unknown>[] = [];
          for (const contest of active ?? []) {
            const scored = await scoreContest(admin, contest);
            let finalized: unknown = null;
            if (contest.week_end < today) {
              finalized = await finalizeContest(admin, contest);
            }
            results.push({ week_start: contest.week_start, ...scored, finalized });
          }

          return new Response(JSON.stringify({ success: true, results }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Scoring failed";
          console.error("[score-showdown]", message);
          return new Response(JSON.stringify({ success: false, error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
