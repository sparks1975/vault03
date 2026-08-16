import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Mail, Shield, ShieldOff, UserMinus, UserPlus, X } from "lucide-react";

import { getMyAccess } from "@/lib/access.functions";
import {
  approveRequest,
  createInvite,
  dismissRequest,
  getAdminOverview,
  resendInvite,
  revokeInvite,
  setAdminRole,
  setUserAccess,
} from "@/lib/admin.functions";
import { AppNav, MobileNavTabs } from "@/components/AppNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/_approved/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin — Vault.03" },
      { name: "description", content: "Manage Vault.03 invitations, access requests, members, and admins." },
      { property: "og:title", content: "Admin — Vault.03" },
      { property: "og:description", content: "Manage Vault.03 invitations, access requests, members, and admins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const access = await getMyAccess();
    if (!access.isAdmin) throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

function fmt(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function CodeResult({ code, link, emailed }: { code: string; link: string; emailed: boolean }) {
  return (
    <div className="rounded-sm border border-accent/40 bg-accent/5 p-3 text-xs">
      <p className="font-mono text-sm font-bold tracking-widest">{code}</p>
      <p className="mt-1 text-muted-foreground">
        {emailed ? "Invite email sent." : "Email sending isn't set up yet — copy this link and send it yourself."}
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(link);
            toast.success("Invite link copied");
          }}
        >
          <Copy className="size-3" /> Copy link
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(code);
            toast.success("Code copied");
          }}
        >
          <Copy className="size-3" /> Copy code
        </Button>
      </div>
    </div>
  );
}

function AdminPage() {
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(getAdminOverview);
  const create = useServerFn(createInvite);
  const revoke = useServerFn(revokeInvite);
  const resend = useServerFn(resendInvite);
  const approve = useServerFn(approveRequest);
  const dismiss = useServerFn(dismissRequest);
  const changeAccess = useServerFn(setUserAccess);
  const changeAdmin = useServerFn(setAdminRole);

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: string; link: string; emailed: boolean } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => fetchOverview(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-overview"] });

  async function run(fn: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      const result = (await fn()) as { code?: string; link?: string; emailed?: boolean } | undefined;
      if (result?.code && result.link) {
        setIssued({ code: result.code, link: result.link, emailed: result.emailed === true });
      }
      toast.success(successMessage);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const pendingRequests = (data?.requests ?? []).filter((r) => r.status === "pending");

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <MobileNavTabs />
      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-0 lg:pt-12 pb-16">
        <h1 className="mt-6 lg:mt-0 font-display text-3xl md:text-[50px] font-extrabold italic leading-none tracking-tighter">
          Admin
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Invite collectors, work the request queue, and manage who has access.
        </p>

        {isLoading ? (
          <div className="mt-8 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <Tabs defaultValue="invites" className="mt-8">
            <TabsList className="flex-wrap">
              <TabsTrigger value="invites">Invites</TabsTrigger>
              <TabsTrigger value="requests">Requests ({pendingRequests.length})</TabsTrigger>
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="admins">Admins</TabsTrigger>
            </TabsList>

            <TabsContent value="invites" className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-4">
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!email.trim()) return;
                    const target = email.trim();
                    setEmail("");
                    run(() => create({ data: { email: target } }), "Invite created");
                  }}
                >
                  <Input
                    type="email"
                    placeholder="collector@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="sm:max-w-sm"
                  />
                  <Button type="submit" disabled={busy}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                    Create invite
                  </Button>
                </form>
                {issued && (
                  <div className="mt-3">
                    <CodeResult {...issued} />
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="p-3 text-left">Email</th>
                      <th className="p-3 text-left">Status</th>
                      <th className="p-3 text-left">Code</th>
                      <th className="p-3 text-left">Created</th>
                      <th className="p-3 text-left">Expires</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.invites ?? []).map((inv) => (
                      <tr key={inv.id} className="border-b border-border/60 last:border-0">
                        <td className="p-3">{inv.email}</td>
                        <td className="p-3 uppercase text-xs font-bold">{inv.status}</td>
                        <td className="p-3 font-mono text-xs">
                          {inv.code_preview ? `••••-${inv.code_preview}` : "—"}
                        </td>
                        <td className="p-3">{fmt(inv.created_at)}</td>
                        <td className="p-3">{fmt(inv.expires_at)}</td>
                        <td className="p-3 whitespace-nowrap text-right">
                          {(inv.status === "pending" || inv.status === "sent") && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => run(() => resend({ data: { id: inv.id } }), "New code issued")}
                              >
                                New code
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => run(() => revoke({ data: { id: inv.id } }), "Invite revoked")}
                              >
                                <X className="size-3" /> Revoke
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(data?.invites ?? []).length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-muted-foreground">
                          No invites yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="requests">
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="p-3 text-left">Name</th>
                      <th className="p-3 text-left">Email</th>
                      <th className="p-3 text-left">Status</th>
                      <th className="p-3 text-left">Requested</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.requests ?? []).map((req) => (
                      <tr key={req.id} className="border-b border-border/60 last:border-0">
                        <td className="p-3">{req.name}</td>
                        <td className="p-3">{req.email}</td>
                        <td className="p-3 uppercase text-xs font-bold">{req.status}</td>
                        <td className="p-3">{fmt(req.created_at)}</td>
                        <td className="p-3 whitespace-nowrap text-right">
                          {req.status === "pending" && (
                            <>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => run(() => approve({ data: { id: req.id } }), "Invite created")}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => run(() => dismiss({ data: { id: req.id } }), "Request dismissed")}
                              >
                                Dismiss
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(data?.requests ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-muted-foreground">
                          No requests yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {issued && (
                <div className="mt-3">
                  <CodeResult {...issued} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="users">
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="p-3 text-left">Member</th>
                      <th className="p-3 text-left">Joined</th>
                      <th className="p-3 text-left">Last active</th>
                      <th className="p-3 text-left">Cards</th>
                      <th className="p-3 text-left">Access</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.users ?? []).map((u) => (
                      <tr key={u.id} className="border-b border-border/60 last:border-0">
                        <td className="p-3">
                          <p className="font-semibold">{u.display_name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{u.email ?? "—"}</p>
                        </td>
                        <td className="p-3">{fmt(u.created_at)}</td>
                        <td className="p-3">{fmt(u.last_sign_in_at)}</td>
                        <td className="p-3">{u.card_count}</td>
                        <td className="p-3 uppercase text-xs font-bold">{u.access_status}</td>
                        <td className="p-3 whitespace-nowrap text-right">
                          {u.access_status === "revoked" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => changeAccess({ data: { userId: u.id, status: "approved" } }),
                                  "Access restored",
                                )
                              }
                            >
                              <UserPlus className="size-3" /> Restore
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => changeAccess({ data: { userId: u.id, status: "revoked" } }),
                                  "Access revoked",
                                )
                              }
                            >
                              <UserMinus className="size-3" /> Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="admins">
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="p-3 text-left">Member</th>
                      <th className="p-3 text-left">Admin</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.users ?? []).map((u) => (
                      <tr key={u.id} className="border-b border-border/60 last:border-0">
                        <td className="p-3">
                          <p className="font-semibold">{u.display_name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{u.email ?? "—"}</p>
                        </td>
                        <td className="p-3 uppercase text-xs font-bold">{u.is_admin ? "Yes" : "No"}</td>
                        <td className="p-3 whitespace-nowrap text-right">
                          {u.is_admin ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                run(() => changeAdmin({ data: { userId: u.id, admin: false } }), "Admin removed")
                              }
                            >
                              <ShieldOff className="size-3" /> Remove admin
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                run(() => changeAdmin({ data: { userId: u.id, admin: true } }), "Admin granted")
                              }
                            >
                              <Shield className="size-3" /> Make admin
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
