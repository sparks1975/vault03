import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const fetchCompPreviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ urls: z.array(z.string()).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { fetchCompPreviewsImpl } = await import("./comp-previews.server");
    const previews = await fetchCompPreviewsImpl(data.urls);
    return { previews };
  });
