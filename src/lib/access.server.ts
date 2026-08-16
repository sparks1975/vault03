import { createHash } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateInviteCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `V03-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashInviteCode(raw: string): string {
  const pepper = process.env["INVITE_CODE_PEPPER"] ?? "";
  return createHash("sha256").update(`${pepper}:${normalizeCode(raw)}`, "utf8").digest("hex");
}

export function inviteLink(origin: string, code: string): string {
  return `${origin}/access?code=${encodeURIComponent(code)}`;
}

/**
 * Sends the invite email when the project has email sending configured.
 * Returns { sent: false } (never throws) so the admin flow always works and
 * can fall back to copying the invite link manually.
 */
export async function sendInviteEmail(params: {
  to: string;
  code: string;
  link: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  const senderDomain = process.env["EMAIL_SENDER_DOMAIN"];
  if (!apiKey || !senderDomain) {
    return { sent: false, reason: "email_not_configured" };
  }

  try {
    const res = await fetch("https://api.lovable.dev/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `Vault.03 <invites@${senderDomain}>`,
        to: [params.to],
        subject: "Your Vault.03 invitation",
        html: `<div style="font-family:Inter,Arial,sans-serif;background:#ffffff;padding:24px;color:#111">
          <h1 style="font-size:22px;margin:0 0 12px">You're invited to Vault.03</h1>
          <p style="margin:0 0 16px">Vault.03 is invite-only. Use the single-use code below to activate your account.</p>
          <p style="font-family:monospace;font-size:20px;letter-spacing:2px;margin:0 0 16px"><strong>${params.code}</strong></p>
          <p style="margin:0 0 24px"><a href="${params.link}" style="background:#6B21A8;color:#fff;padding:12px 18px;border-radius:4px;text-decoration:none">Activate my account</a></p>
          <p style="font-size:12px;color:#666;margin:0">This code works only once and is tied to this email invitation.</p>
        </div>`,
      }),
    });
    if (!res.ok) {
      console.error("[invite-email] send failed", res.status, await res.text());
      return { sent: false, reason: "send_failed" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[invite-email] send error", err);
    return { sent: false, reason: "send_failed" };
  }
}
