# Invite-Only Access + Admin Console

Turn Vault.03 into an invite-only app: new people can only get in with a unique, single-use invite code, anyone else can request an invitation, and you get an admin screen to run it all.

## 1. Access gate

- New route `/access` (public): a single field for the invite code, plus a "Request an invitation" link.
- Flow: enter code → code is validated on the server → user signs in with Google → the code is consumed and permanently bound to that account.
- Anyone signed in but not approved lands on `/access` instead of the dashboard (they never see vault/showdown/dashboard data).
- Codes are single-use, randomly generated (short, readable, e.g. `V03-7K2M-QN4P`), optionally expiring after 14 days, and revocable.
- Existing accounts (yours and anyone already using the app) are grandfathered in as approved during setup so nobody gets locked out.

## 2. Request an invitation

- Public route `/request-access`: Name + Email, with validation and a simple confirmation state.
- Requests land in a queue the admin sees; duplicate emails are ignored gracefully.
- Rate-limited per email/IP so the form can't be spammed.

## 3. Admin console (`/admin`, admins only)

Four tabs:
- **Invites** — create invite (enter email → code generated and emailed), see status (pending / sent / used / revoked / expired), copy the invite link, resend, revoke.
- **Requests** — the request queue: approve (creates + emails an invite in one click) or dismiss.
- **Users** — list of accounts with name, email, joined date, card count, approved status; revoke access (blocks the account) or restore it.
- **Admins** — grant/revoke admin on an existing account.

## 4. Invite emails

Sending invite emails needs a verified sender domain for the app (you own vault03.app, so that works). This is a one-time setup step:

<presentation-actions>
<presentation-open-email-setup>Set up email domain</presentation-open-email-setup>
</presentation-actions>

Until the domain is verified, the admin screen still generates codes and gives you a copyable invite link, so you're never blocked. Once verified, invites and approvals send email automatically.

## Technical notes

Database (one migration, with GRANTs + RLS on every new table):
- `app_role` enum (`admin`, `member`) + `user_roles` table with a `has_role()` security-definer function — roles are never stored on `profiles`.
- `invites`: email, code_hash (codes stored hashed, never in plaintext), status, expires_at, invited_by, used_by, used_at.
- `access_requests`: name, email, status, created_at, notes.
- `profiles` gains `access_status` (`approved` | `revoked`) plus a backfill setting all existing users to approved.
- RLS: invites/requests/user_roles readable only via admin-verified server functions; `access_requests` insert allowed for anon under a narrow policy; a user may read their own `profiles.access_status`.

Server functions (`src/lib/access.functions.ts`, `src/lib/admin.functions.ts`):
- `redeemInvite` (authenticated): hashes the submitted code, matches an unused non-expired invite, marks it used, sets the caller approved — atomic, in a SQL function to avoid double redemption.
- `getMyAccess` (authenticated): returns approval state for the route gate.
- `submitAccessRequest` (public, zod-validated, rate-limited).
- Admin functions all re-verify `has_role(userId,'admin')` server-side before doing anything; privileged reads (auth emails, card counts) use the admin client loaded inside the handler.

Routing:
- `src/routes/_authenticated/route.tsx` stays the managed auth gate. Approval is enforced by a second pathless layout `_authenticated/_approved/route.tsx`; dashboard, vault and showdown move under it and redirect to `/access` when not approved.
- `/admin` lives under the approved layout with an additional admin check.
- Public share pages (`/s/$slug`) stay public and unaffected.
- Every server function keeps its own auth/role check — route gates are UX only.

Emails: invite + approval emails as React Email templates using your existing brand (black/violet, Bangers headings), sent from your verified domain.
