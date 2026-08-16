import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MyAccess = {
  accessStatus: "approved" | "pending" | "revoked";
  isAdmin: boolean;
};

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyAccess> => {
    const { supabase, userId } = context;

    const [{ data: profile }, { data: isAdmin }] = await Promise.all([
      supabase.from("profiles").select("access_status").eq("id", userId).maybeSingle(),
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    ]);

    const raw = profile?.access_status ?? "pending";
    const accessStatus =
      raw === "approved" || raw === "revoked" ? (raw as "approved" | "revoked") : "pending";

    return { accessStatus, isAdmin: isAdmin === true };
  });

export const redeemInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) =>
    z.object({ code: z.string().trim().min(4).max(40) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; reason?: string }> => {
    const { hashInviteCode } = await import("./access.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: result, error } = await supabaseAdmin.rpc("redeem_invite", {
      _user_id: context.userId,
      _code_hash: hashInviteCode(data.code),
    });

    if (error) {
      console.error("[redeemInvite]", error);
      return { ok: false, reason: "error" };
    }

    const payload = (result ?? {}) as { ok?: boolean; reason?: string };
    return { ok: payload.ok === true, reason: payload.reason };
  });

/**
 * Public pre-signup check: confirms an invite code is real and still
 * redeemable WITHOUT consuming it, so the sign-in options can stay hidden
 * from anyone without an invitation.
 */
export const verifyInviteCode = createServerFn({ method: "POST" })
  .inputValidator((data: { code: string }) =>
    z.object({ code: z.string().trim().min(4).max(40) }).parse(data),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { hashInviteCode } = await import("./access.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invite, error } = await supabaseAdmin
      .from("invites")
      .select("id,status,expires_at")
      .eq("code_hash", hashInviteCode(data.code))
      .in("status", ["pending", "sent"])
      .maybeSingle();

    if (error) {
      console.error("[verifyInviteCode]", error);
      return { ok: false };
    }
    if (!invite) return { ok: false };
    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
      return { ok: false };
    }
    return { ok: true };
  });

export const submitAccessRequest = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string; email: string }) =>
    z
      .object({
        name: z.string().trim().min(1).max(100),
        email: z.string().trim().email().max(255),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = data.email.toLowerCase();

    const { data: existing } = await supabaseAdmin
      .from("access_requests")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (!existing) {
      const { error } = await supabaseAdmin
        .from("access_requests")
        .insert({ name: data.name, email });
      // Unique-index races are fine — the request already exists.
      if (error && error.code !== "23505") console.error("[submitAccessRequest]", error);
    }

    return { ok: true };
  });
