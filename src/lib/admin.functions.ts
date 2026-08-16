import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminInvite = {
  id: string;
  email: string;
  status: string;
  code_preview: string | null;
  expires_at: string | null;
  used_at: string | null;
  email_sent_at: string | null;
  created_at: string;
};

export type AdminRequest = {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
};

export type AdminUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  access_status: string;
  is_admin: boolean;
  card_count: number;
};

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Forbidden");
}

function origin(): string {
  try {
    const url = getRequestUrl();
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://vault03.app";
  }
}

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [invitesRes, requestsRes, profilesRes, rolesRes, cardsRes, usersRes] = await Promise.all([
      supabaseAdmin
        .from("invites")
        .select("id,email,status,code_preview,expires_at,used_at,email_sent_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("access_requests")
        .select("id,name,email,status,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("profiles").select("id,display_name,access_status"),
      supabaseAdmin.from("user_roles").select("user_id,role").eq("role", "admin"),
      supabaseAdmin.from("cards").select("user_id"),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const adminIds = new Set((rolesRes.data ?? []).map((r) => r.user_id));
    const cardCounts = new Map<string, number>();
    for (const c of cardsRes.data ?? []) {
      cardCounts.set(c.user_id, (cardCounts.get(c.user_id) ?? 0) + 1);
    }
    const profileMap = new Map(
      (profilesRes.data ?? []).map((p) => [p.id, p as { display_name: string | null; access_status: string }]),
    );

    const users: AdminUser[] = (usersRes.data?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? null,
      display_name: profileMap.get(u.id)?.display_name ?? null,
      created_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      access_status: profileMap.get(u.id)?.access_status ?? "pending",
      is_admin: adminIds.has(u.id),
      card_count: cardCounts.get(u.id) ?? 0,
    }));

    users.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    return {
      invites: (invitesRes.data ?? []) as AdminInvite[],
      requests: (requestsRes.data ?? []) as AdminRequest[],
      users,
    };
  });

async function createInviteFor(email: string, invitedBy: string) {
  const { generateInviteCode, hashInviteCode, inviteLink, sendInviteEmail } = await import(
    "./access.server"
  );
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const code = generateInviteCode();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("invites")
    .insert({
      email: email.toLowerCase(),
      code_hash: hashInviteCode(code),
      code_preview: code.slice(-4),
      expires_at: expires,
      invited_by: invitedBy,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not create invite");

  const link = inviteLink(origin(), code);
  const mail = await sendInviteEmail({ to: email, code, link });
  if (mail.sent) {
    await supabaseAdmin
      .from("invites")
      .update({ status: "sent", email_sent_at: new Date().toISOString() })
      .eq("id", data.id);
  }

  return { code, link, emailed: mail.sent, emailReason: mail.reason ?? null };
}

export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string }) =>
    z.object({ email: z.string().trim().email().max(255) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    return createInviteFor(data.email, context.userId);
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("invites")
      .update({ status: "revoked" })
      .eq("id", data.id)
      .in("status", ["pending", "sent"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invite } = await supabaseAdmin
      .from("invites")
      .select("email,status")
      .eq("id", data.id)
      .maybeSingle();
    if (!invite) throw new Error("Invite not found");
    // A code can never be shown twice, so resending issues a fresh code and
    // retires the old one.
    await supabaseAdmin.from("invites").update({ status: "revoked" }).eq("id", data.id);
    return createInviteFor(invite.email, context.userId);
  });

export const approveRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await supabaseAdmin
      .from("access_requests")
      .select("email")
      .eq("id", data.id)
      .maybeSingle();
    if (!req) throw new Error("Request not found");
    const result = await createInviteFor(req.email, context.userId);
    await supabaseAdmin.from("access_requests").update({ status: "invited" }).eq("id", data.id);
    return result;
  });

export const dismissRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("access_requests")
      .update({ status: "dismissed" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; status: "approved" | "revoked" }) =>
    z
      .object({ userId: z.string().uuid(), status: z.enum(["approved", "revoked"]) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("You cannot change your own access");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ access_status: data.status })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; admin: boolean }) =>
    z.object({ userId: z.string().uuid(), admin: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId && !data.admin) {
      throw new Error("You cannot remove your own admin access");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.admin) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
