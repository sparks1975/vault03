import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Camera, Loader2, LogOut, Pencil, Check, X } from "lucide-react";

import { scanCardPhoto, estimateCardValue } from "@/lib/ai.functions";
import { CardCropDialog } from "@/components/CardCropDialog";
import { searchMlbPlayer, getPlayerStats } from "@/lib/mlb.functions";
import {
  listCards,
  createCard,
  updateCardFields,
  deleteCard,
  replaceValuation,
  uploadCardPhoto,
} from "@/lib/cards.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  component: Dashboard,
});

function SignOutButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function handle() {
    setBusy(true);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <button
      onClick={handle}
      disabled={busy}
      title="Sign out"
      className="p-2 rounded-sm border border-border hover:bg-secondary transition-colors disabled:opacity-60"
    >
      <LogOut className="size-4" />
    </button>
  );
}

type Sale = {
  id: string;
  card_id: string;
  sold_at: string | null;
  grade: string | null;
  price: number;
  source: string | null;
  url: string | null;
};

type HistoryPoint = {
  id: string;
  card_id: string;
  recorded_at: string;
  value: number;
};

type Card = {
  id: string;
  player_name: string;
  team: string | null;
  position: string | null;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
  grade: string | null;
  grader: string | null;
  purchase_price: number | null;
  current_value: number | null;
  value_delta_pct: number | null;
  notes: string | null;
  photo_url: string | null;
  mlb_player_id: number | null;
  last_valued_at: string | null;
  created_at: string;
  sales: Sale[];
  history: HistoryPoint[];
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(n));
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return null;
  const v = Number(n);
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}
function gainDollars(card: { purchase_price: number | null; current_value: number | null }): number | null {
  const v = card.current_value == null ? null : Number(card.current_value);
  if (v == null) return null;
  const p = card.purchase_price == null ? 0 : Number(card.purchase_price);
  return v - p;
}
function gainPct(card: { purchase_price: number | null; current_value: number | null }): number | null {
  const v = card.current_value == null ? null : Number(card.current_value);
  if (v == null) return null;
  const p = card.purchase_price == null ? 0 : Number(card.purchase_price);
  if (p <= 0) return null; // undefined % when cost basis is 0
  return ((v - p) / p) * 100;
}

function Dashboard() {
  const listFn = useServerFn(listCards);
  const updateFn = useServerFn(updateCardFields);
  const deleteFn = useServerFn(deleteCard);
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const cardsQ = useQuery({
    queryKey: ["cards"],
    queryFn: () => listFn(),
  });
  const cardData = (cardsQ.data ?? []) as Card[];

  const updateMut = useMutation({
    mutationFn: (v: { id: string; patch: Partial<Card> }) =>
      updateFn({ data: { id: v.id, patch: v.patch as Record<string, unknown> } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });

  function updateCard(cardId: string, patch: Partial<Card>) {
    updateMut.mutate({ id: cardId, patch });
  }
  function removeCard(cardId: string) {
    deleteMut.mutate(cardId);
    setSelectedId(null);
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return cardData;
    const q = query.toLowerCase();
    return cardData.filter(
      (c) =>
        c.player_name.toLowerCase().includes(q) ||
        c.set_name?.toLowerCase().includes(q) ||
        c.team?.toLowerCase().includes(q),
    );
  }, [cardData, query]);

  const selected = selectedId ?? filtered[0]?.id ?? null;
  const selectedCard = selected ? cardData.find((card) => card.id === selected) ?? null : null;

  const totals = useMemo(() => {
    const list = cardData;
    const totalValue = list.reduce((sum, c) => sum + Number(c.current_value ?? 0), 0);
    const graded = list.filter((c) => c.grade).length;
    const withGain = list
      .map((c) => ({ card: c, gain: gainPct(c) }))
      .filter((x): x is { card: Card; gain: number } => x.gain != null)
      .sort((a, b) => b.gain - a.gain);
    const top = withGain[0];
    return {
      totalValue,
      count: list.length,
      gradedPct: list.length ? Math.round((graded / list.length) * 100) : 0,
      topMover: top?.card ?? null,
      topMoverGain: top?.gain ?? null,
    };
  }, [cardData]);

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <nav className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-extrabold tracking-tighter text-xl italic">VAULT.03</span>
          <div className="hidden md:flex gap-6 text-sm font-medium text-muted-foreground">
            <span className="text-accent">Dashboard</span>
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <button
            onClick={() => setAddOpen(true)}
            className="px-4 py-2 bg-foreground text-background text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-accent transition-colors inline-flex items-center gap-2"
          >
            <Plus className="size-3.5" /> Add Card
          </button>
          <SignOutButton />
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 pt-12">
        <header className="grid grid-cols-1 md:grid-cols-4 gap-px bg-border border border-border animate-in-up">
          <StatCell label="Total Value" value={fmt(totals.totalValue)} sub={totals.count ? "Live" : "Add your first card"} subAccent={totals.count > 0} />
          <StatCell label="Assets" value={String(totals.count)} sub={totals.count ? `Graded: ${totals.gradedPct}%` : "—"} />
          <div className="bg-background p-8 md:col-span-2">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Top Mover</p>
            {totals.topMover ? (
              <div className="flex justify-between items-end">
                <div>
                  <h3 className="font-bold">
                    {totals.topMover.year ?? ""} {totals.topMover.set_name ?? ""} {totals.topMover.player_name}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {totals.topMover.grader ?? ""} {totals.topMover.grade ?? ""}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`font-mono font-bold ${(totals.topMoverGain ?? 0) >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}>
                    {fmtPct(totals.topMoverGain)}
                  </span>
                  <p className="text-[9px] font-mono text-muted-foreground uppercase">vs. purchase</p>
                </div>
              </div>
            ) : cardData.length > 0 ? (
              <p className="text-sm text-muted-foreground">Add a purchase price to your cards to see gains vs. current value.</p>
            ) : (
              <p className="text-sm text-muted-foreground">No valuations yet — add a card to see market movement.</p>
            )}
          </div>
        </header>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
          <section className="lg:col-span-7 animate-in-up [animation-delay:100ms]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-mono uppercase tracking-widest">Portfolio Holdings</h3>
              <input
                type="text"
                placeholder="Search cards…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="text-xs border border-border px-3 py-1 w-48 focus:outline-none focus:border-accent bg-background rounded-sm"
              />
            </div>

            {cardsQ.isLoading ? (
              <div className="p-12 border border-border text-center text-sm text-muted-foreground">Loading your vault…</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 border border-border text-center">
                <p className="text-sm text-muted-foreground mb-4">Your vault is empty.</p>
                <button
                  onClick={() => setAddOpen(true)}
                  className="px-4 py-2 bg-foreground text-background text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-accent transition-colors"
                >
                  Add your first card
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((c) => (
                  <CardRow key={c.id} card={c} active={c.id === selected} onClick={() => setSelectedId(c.id)} />
                ))}
              </div>
            )}
          </section>

          <aside className="lg:col-span-5 animate-in-up [animation-delay:200ms]">
            <div className="sticky top-28">
              {selectedCard ? (
                <CardDetail card={selectedCard} onDeleted={removeCard} onUpdate={updateCard} />
              ) : (
                <div className="bg-card border border-border p-6 text-sm text-muted-foreground">
                  Select a card to see market data and player stats.
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      {addOpen && (
        <AddCardDialog
          onClose={() => setAddOpen(false)}
          onCreated={(id) => {
            setSelectedId(id);
            qc.invalidateQueries({ queryKey: ["cards"] });
          }}
        />
      )}
    </div>
  );
}

function StatCell({ label, value, sub, subAccent }: { label: string; value: string; sub?: string; subAccent?: boolean }) {
  return (
    <div className="bg-background p-8">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">{label}</p>
      <h2 className="text-4xl font-extrabold tracking-tight">{value}</h2>
      {sub && <p className={`text-xs font-mono mt-2 ${subAccent ? "text-accent" : "text-muted-foreground"}`}>{sub}</p>}
    </div>
  );
}

function CardRow({ card, active, onClick }: { card: Card; active: boolean; onClick: () => void }) {
  const delta = card.value_delta_pct == null ? null : Number(card.value_delta_pct);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 flex gap-4 transition-colors ${active ? "ring-1 ring-inset ring-accent bg-accent/[0.06]" : "border border-foreground bg-background hover:bg-secondary"}`}
    >
      <div className="w-16 h-24 bg-secondary shrink-0 border border-border overflow-hidden grid place-items-center">
        {card.photo_url ? (
          <img src={card.photo_url} alt={card.player_name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-[8px] uppercase tracking-tighter text-muted-foreground">Asset</span>
        )}
      </div>
      <div className="flex-1">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase">
              {card.year ?? "—"} {card.set_name ?? ""} {card.card_number ? `#${card.card_number}` : ""}
            </p>
            <h4 className="font-extrabold text-lg leading-tight tracking-tight">{card.player_name}</h4>
            <div className="flex gap-2 mt-1 items-center">
              {card.grade && (
                <span className="px-1.5 py-0.5 border border-accent text-accent text-[10px] font-mono font-bold">
                  {card.grader ?? ""} {card.grade}
                </span>
              )}
              {(card.team || card.position) && (
                <span className="text-[10px] text-muted-foreground uppercase">
                  {card.team ?? ""} {card.position ? `• ${card.position}` : ""}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono font-bold text-sm">{fmt(card.current_value)}</p>
            {delta != null && (
              <p className={`text-[10px] font-mono ${delta >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}>
                {fmtPct(delta)}
              </p>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function CardDetail({
  card,
  onDeleted,
  onUpdate,
}: {
  card: Card;
  onDeleted: (cardId: string) => void;
  onUpdate: (cardId: string, patch: Partial<Card>) => void;
}) {
  const getStatsFn = useServerFn(getPlayerStats);
  const estimateFn = useServerFn(estimateCardValue);
  const replaceValFn = useServerFn(replaceValuation);
  const searchPlayerFn = useServerFn(searchMlbPlayer);
  const qc = useQueryClient();
  const [valuing, setValuing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Card>>({});
  const [playerResults, setPlayerResults] = useState<Awaited<ReturnType<typeof searchMlbPlayer>>>([]);

  const stats = useQuery({
    queryKey: ["stats", card.mlb_player_id],
    queryFn: () => getStatsFn({ data: { playerId: card.mlb_player_id! } }),
    enabled: !!card.mlb_player_id,
  });

  function startEdit() {
    setDraft({
      player_name: card.player_name,
      team: card.team,
      position: card.position,
      year: card.year,
      set_name: card.set_name,
      card_number: card.card_number,
      grade: card.grade,
      grader: card.grader,
      purchase_price: card.purchase_price,
      notes: card.notes,
      mlb_player_id: card.mlb_player_id,
    });
    setPlayerResults([]);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft({});
    setPlayerResults([]);
  }

  function saveEdit() {
    if (!draft.player_name || !String(draft.player_name).trim()) {
      toast.error("Player name is required");
      return;
    }
    onUpdate(card.id, draft);
    setEditing(false);
    toast.success("Card updated");
  }

  async function searchPlayer() {
    const q = (draft.player_name ?? "").toString().trim();
    if (!q) return;
    try {
      const r = await searchPlayerFn({ data: { query: q } });
      setPlayerResults(r);
      if (r.length === 0) toast.info("No MLB player found.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    }
  }

  async function refreshValue() {
    setValuing(true);
    try {
      const est = await estimateFn({
        data: {
          player_name: card.player_name,
          year: card.year,
          set_name: card.set_name,
          card_number: card.card_number,
          grade: card.grade,
          grader: card.grader,
        },
      });
      await replaceValFn({
        data: {
          card_id: card.id,
          current_value: est.current_value,
          value_delta_pct: est.value_delta_pct,
          sales: est.sales,
          history: est.history,
        },
      });
      qc.invalidateQueries({ queryKey: ["cards"] });
      if (est.note) toast.warning(est.note);
      const soldCount = est.sales.filter((s) => s.source.startsWith("Cardsight")).length;
      toast.success(
        soldCount > 0
          ? `Valuation refreshed — ${soldCount} sold comps from Cardsight`
          : "Valuation refreshed — AI estimate (no Cardsight comps yet)",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setValuing(false);
    }
  }

  function deleteSelected() {
    onDeleted(card.id);
    toast.success("Card removed");
  }

  const sales = card.sales ?? [];
  const history = [...(card.history ?? [])].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );
  const max = Math.max(...history.map((h) => Number(h.value)), 1);

  return (
    <div className="bg-card border border-border p-6 shadow-sm">
      <div className="flex justify-between mb-8">
        <span className="text-[10px] font-mono bg-accent text-accent-foreground px-2 h-5 inline-flex items-center">ASSET DETAIL</span>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={saveEdit}
                className="text-[10px] font-mono uppercase tracking-widest border border-accent text-accent px-2 py-1 hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-1"
              >
                <Check className="size-3" /> Save
              </button>
              <button
                onClick={cancelEdit}
                className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary inline-flex items-center gap-1"
              >
                <X className="size-3" /> Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startEdit}
                className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary inline-flex items-center gap-1"
              >
                <Pencil className="size-3" /> Edit
              </button>
              <button
                onClick={refreshValue}
                disabled={valuing}
                className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary disabled:opacity-50 inline-flex items-center gap-1"
              >
                {valuing ? <Loader2 className="size-3 animate-spin" /> : null}
                {valuing ? "Valuing" : "Refresh value"}
              </button>
              <button
                onClick={() => confirm("Remove this card?") && deleteSelected()}
                className="size-6 border border-border grid place-items-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
                aria-label="Delete card"
              >
                <Trash2 className="size-3" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="w-full aspect-[2/3] bg-secondary mb-8 border border-border overflow-hidden grid place-items-center">
        {card.photo_url ? (
          <img src={card.photo_url} alt={card.player_name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">No photo</span>
        )}
      </div>

      {editing ? (
        <div className="mb-8 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Player name*" value={String(draft.player_name ?? "")} onChange={(v) => setDraft({ ...draft, player_name: v })} />
            <Field label="Team" value={String(draft.team ?? "")} onChange={(v) => setDraft({ ...draft, team: v || null })} />
            <Field label="Year" type="number" value={draft.year == null ? "" : String(draft.year)} onChange={(v) => setDraft({ ...draft, year: v ? Number(v) : null })} />
            <Field label="Set" value={String(draft.set_name ?? "")} onChange={(v) => setDraft({ ...draft, set_name: v || null })} />
            <Field label="Card #" value={String(draft.card_number ?? "")} onChange={(v) => setDraft({ ...draft, card_number: v || null })} />
            <Field label="Position" value={String(draft.position ?? "")} onChange={(v) => setDraft({ ...draft, position: v || null })} />
            <Field label="Grader" value={String(draft.grader ?? "")} onChange={(v) => setDraft({ ...draft, grader: v || null })} />
            <Field label="Grade" value={String(draft.grade ?? "")} onChange={(v) => setDraft({ ...draft, grade: v || null })} />
            <Field label="Purchase price (USD)" type="number" value={draft.purchase_price == null ? "" : String(draft.purchase_price)} onChange={(v) => setDraft({ ...draft, purchase_price: v ? Number(v) : null })} />
          </div>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Notes</span>
            <textarea
              value={String(draft.notes ?? "")}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
              rows={3}
              className="mt-1 w-full px-3 py-2 border border-border rounded-sm text-sm bg-background focus:outline-none focus:border-accent"
            />
          </label>
          <div className="border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Link MLB player (for live stats)</p>
              <button onClick={searchPlayer} className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary">
                Search MLB
              </button>
            </div>
            {playerResults.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {playerResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setDraft({ ...draft, mlb_player_id: p.id, team: draft.team || p.team || null, position: draft.position || p.position || null })}
                    className={`w-full text-left px-2 py-1.5 text-xs hover:bg-secondary border border-transparent ${draft.mlb_player_id === p.id ? "border-accent bg-accent/10" : ""}`}
                  >
                    <span className="font-bold">{p.name}</span>{" "}
                    <span className="text-muted-foreground">
                      {p.team ?? "—"} {p.position ? `• ${p.position}` : ""} {p.active ? "" : "• retired"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {draft.mlb_player_id && (
              <div className="flex items-center justify-between mt-2">
                <p className="text-[10px] font-mono text-accent">Linked · id {draft.mlb_player_id}</p>
                <button
                  onClick={() => setDraft({ ...draft, mlb_player_id: null })}
                  className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
                >
                  Unlink
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-8">
          <p className="text-[10px] font-mono text-muted-foreground uppercase">
            {card.year ?? "—"} {card.set_name ?? ""} {card.card_number ? `#${card.card_number}` : ""}
          </p>
          <h2 className="text-2xl font-extrabold tracking-tight">{card.player_name}</h2>
          <div className="flex justify-between items-end mt-2">
            <div className="text-xs text-muted-foreground">
              {card.grader} {card.grade} {card.team ? `• ${card.team}` : ""}
            </div>
            <div className="text-right">
              <p className="text-2xl font-extrabold tracking-tight">{fmt(card.current_value)}</p>
              {card.value_delta_pct != null && (
                <p className={`text-[10px] font-mono ${Number(card.value_delta_pct) >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}>
                  {fmtPct(Number(card.value_delta_pct))} / 30d
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-8">
        <div>
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 border-b border-border pb-2">Market History</h3>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No history yet — refresh value to build the chart.</p>
          ) : (
            <>
              <div className="h-16 w-full flex items-end gap-1 mb-2 px-1">
                {history.map((h, i) => (
                  <div
                    key={h.id}
                    className={`flex-1 ${i === history.length - 1 ? "bg-accent" : "bg-secondary"}`}
                    style={{ height: `${(Number(h.value) / max) * 100}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[9px] font-mono text-muted-foreground">
                <span>{new Date(history[0].recorded_at).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</span>
                <span>TODAY</span>
              </div>
            </>
          )}
        </div>

        <div>
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 border-b border-border pb-2">
            {stats.data ? `${stats.data.season} Player Stats` : "Player Stats"}
          </h3>
          {!card.mlb_player_id ? (
            <p className="text-xs text-muted-foreground">Link an MLB player to see current stats (edit card and search).</p>
          ) : stats.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading MLB Stats API…</p>
          ) : stats.data?.stats ? (
            <StatGrid group={stats.data.group ?? "hitting"} s={stats.data.stats} />
          ) : (
            <p className="text-xs text-muted-foreground">No stats available for this season.</p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 border-b border-border pb-2">Recent Comparables</h3>
          {sales.length === 0 ? (
            <p className="text-xs text-muted-foreground">No comparable sales yet. Refresh value to fetch estimates.</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-mono text-muted-foreground uppercase">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Grade</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="text-xs border-b border-border/50">
                    <td className="py-2">{s.sold_at ? new Date(s.sold_at).toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "2-digit" }) : "Active"}</td>
                    <td className="py-2">{s.grade ?? "—"}</td>
                    <td className="py-2 text-muted-foreground">{s.source ?? "—"}</td>
                    <td className="py-2 text-right font-mono">{fmt(Number(s.price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
            Values reflect recent sold comps from Cardsight when available.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatGrid({ group, s }: { group: "hitting" | "pitching"; s: Record<string, string | number> }) {
  const items =
    group === "pitching"
      ? [
          { k: "W", v: s.wins },
          { k: "ERA", v: s.era },
          { k: "K", v: s.strikeOuts },
          { k: "WHIP", v: s.whip },
        ]
      : [
          { k: "AVG", v: s.avg },
          { k: "HR", v: s.homeRuns },
          { k: "RBI", v: s.rbi },
          { k: "OPS", v: s.ops },
        ];
  return (
    <div className="grid grid-cols-4 gap-4">
      {items.map((i) => (
        <div key={i.k} className="text-center">
          <p className="text-lg font-extrabold">{i.v ?? "—"}</p>
          <p className="text-[9px] font-mono text-muted-foreground">{i.k}</p>
        </div>
      ))}
    </div>
  );
}

// ---------- Add Card Dialog ----------
function AddCardDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (cardId: string) => void;
}) {
  const scanFn = useServerFn(scanCardPhoto);
  const searchPlayerFn = useServerFn(searchMlbPlayer);
  const estimateFn = useServerFn(estimateCardValue);
  const createFn = useServerFn(createCard);
  const uploadFn = useServerFn(uploadCardPhoto);
  const replaceValFn = useServerFn(replaceValuation);
  const updateFn = useServerFn(updateCardFields);

  const [step, setStep] = useState<"choose" | "form">("choose");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [form, setForm] = useState({
    player_name: "",
    team: "",
    position: "",
    year: "",
    set_name: "",
    card_number: "",
    grade: "",
    grader: "",
    purchase_price: "",
    notes: "",
    mlb_player_id: null as number | null,
  });
  const [playerResults, setPlayerResults] = useState<Awaited<ReturnType<typeof searchMlbPlayer>>>([]);

  async function handlePhoto(file: File) {
    try {
      let workingFile: Blob = file;
      const isHeic =
        /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
      if (isHeic) {
        try {
          const { default: heic2any } = await import("heic2any");
          const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
          workingFile = Array.isArray(converted) ? converted[0] : converted;
        } catch {
          toast.error("Couldn't convert HEIC image. Try a JPG or PNG.");
          return;
        }
      }
      const rawDataUrl = await fileToDataUrl(workingFile as File);
      setCropSource(rawDataUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read image");
    }
  }

  async function handleCropConfirm(croppedDataUrl: string) {
    setCropSource(null);
    setImageDataUrl(croppedDataUrl);
    setScanning(true);
    try {
      const result = await scanFn({ data: { imageDataUrl: croppedDataUrl } });
      setForm((f) => ({
        ...f,
        player_name: result.player_name ?? f.player_name,
        team: result.team ?? f.team,
        position: result.position ?? f.position,
        year: result.year?.toString() ?? f.year,
        set_name: result.set_name ?? f.set_name,
        card_number: result.card_number ?? f.card_number,
        grade: result.grade ?? f.grade,
        grader: result.grader ?? f.grader,
      }));
      toast.success(`Card identified (${result.confidence} confidence). Verify the details.`);
      setStep("form");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
      setStep("form");
    } finally {
      setScanning(false);
    }
  }

  async function fileToDataUrl(file: Blob): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function searchPlayer() {
    if (!form.player_name.trim()) return;
    try {
      const r = await searchPlayerFn({ data: { query: form.player_name.trim() } });
      setPlayerResults(r);
      if (r.length === 0) toast.info("No MLB player found — stats will be unavailable.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    }
  }

  async function handleSubmit() {
    if (!form.player_name.trim()) {
      toast.error("Player name is required");
      return;
    }
    setSaving(true);
    try {
      // Upload photo to storage first (if provided)
      let photoPath: string | null = null;
      if (imageDataUrl) {
        try {
          const up = await uploadFn({ data: { imageDataUrl } });
          photoPath = up.path;
        } catch (e) {
          console.error("Photo upload failed", e);
          toast.warning("Photo couldn't be saved — card will save without it.");
        }
      }

      const created = await createFn({
        data: {
          player_name: form.player_name.trim(),
          team: form.team || null,
          position: form.position || null,
          year: form.year ? Number(form.year) : null,
          set_name: form.set_name || null,
          card_number: form.card_number || null,
          grade: form.grade || null,
          grader: form.grader || null,
          purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
          notes: form.notes || null,
          photo_path: photoPath,
          mlb_player_id: form.mlb_player_id,
        },
      });

      onCreated(created.id);
      toast.success("Card added. Fetching valuation…");

      // Async valuation
      try {
        const est = await estimateFn({
          data: {
            player_name: created.player_name,
            year: created.year,
            set_name: created.set_name,
            card_number: created.card_number,
            grade: created.grade,
            grader: created.grader,
          },
        });
        await replaceValFn({
          data: {
            card_id: created.id,
            current_value: est.current_value,
            value_delta_pct: est.value_delta_pct,
            sales: est.sales,
            history: est.history,
          },
        });
        onCreated(created.id);
      } catch (e) {
        console.error("Valuation failed", e);
      }
      void updateFn;
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {cropSource && (
        <CardCropDialog
          image={cropSource}
          onCancel={() => setCropSource(null)}
          onConfirm={handleCropConfirm}
          confirmLabel="Scan card"
        />
      )}
    <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm grid place-items-center p-4 fade-in" onClick={onClose}>
      <div
        className="bg-background border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">New Asset</p>
            <h2 className="text-2xl font-extrabold tracking-tight">Add a card</h2>
          </div>
          <button onClick={onClose} className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>

        {step === "choose" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border border border-border">
            <label className="bg-background p-8 cursor-pointer hover:bg-secondary transition-colors">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0])}
              />
              <Camera className="size-6 mb-4" />
              <h3 className="font-extrabold text-lg tracking-tight mb-1">Scan photo</h3>
              <p className="text-xs text-muted-foreground">Upload a photo — AI extracts player, year, set, grade.</p>
            </label>
            <button onClick={() => setStep("form")} className="bg-background p-8 text-left hover:bg-secondary transition-colors">
              <Plus className="size-6 mb-4" />
              <h3 className="font-extrabold text-lg tracking-tight mb-1">Enter manually</h3>
              <p className="text-xs text-muted-foreground">Type in the details yourself.</p>
            </button>
          </div>
        )}

        {scanning && (
          <div className="mt-6 p-4 border border-border text-sm inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Identifying card…
          </div>
        )}

        {step === "form" && (
          <div className="space-y-4">
            {imageDataUrl && (
              <img src={imageDataUrl} alt="Uploaded card" className="w-32 aspect-[2/3] object-cover border border-border" />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Player name*" value={form.player_name} onChange={(v) => setForm({ ...form, player_name: v })} />
              <Field label="Team" value={form.team} onChange={(v) => setForm({ ...form, team: v })} />
              <Field label="Year" type="number" value={form.year} onChange={(v) => setForm({ ...form, year: v })} />
              <Field label="Set" value={form.set_name} onChange={(v) => setForm({ ...form, set_name: v })} />
              <Field label="Card #" value={form.card_number} onChange={(v) => setForm({ ...form, card_number: v })} />
              <Field label="Position" value={form.position} onChange={(v) => setForm({ ...form, position: v })} />
              <Field label="Grader (PSA/BGS/SGC)" value={form.grader} onChange={(v) => setForm({ ...form, grader: v })} />
              <Field label="Grade" value={form.grade} onChange={(v) => setForm({ ...form, grade: v })} />
              <Field label="Purchase price (USD)" type="number" value={form.purchase_price} onChange={(v) => setForm({ ...form, purchase_price: v })} />
            </div>

            <div className="border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Link MLB player (for live stats)</p>
                <button onClick={searchPlayer} className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary">
                  Search MLB
                </button>
              </div>
              {playerResults.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {playerResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setForm({ ...form, mlb_player_id: p.id, team: form.team || p.team || "", position: form.position || p.position || "" })}
                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-secondary border border-transparent ${form.mlb_player_id === p.id ? "border-accent bg-accent/10" : ""}`}
                    >
                      <span className="font-bold">{p.name}</span>{" "}
                      <span className="text-muted-foreground">
                        {p.team ?? "—"} {p.position ? `• ${p.position}` : ""} {p.active ? "" : "• retired"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {form.mlb_player_id && (
                <p className="text-[10px] font-mono text-accent mt-2">Linked · id {form.mlb_player_id}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={onClose} className="px-4 py-2 border border-border text-xs font-bold uppercase tracking-widest hover:bg-secondary">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-5 py-2 bg-foreground text-background text-xs font-bold uppercase tracking-widest hover:bg-accent disabled:opacity-50 inline-flex items-center gap-2"
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />} Save card
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-10 px-3 border border-border rounded-sm text-sm bg-background focus:outline-none focus:border-accent"
      />
    </label>
  );
}
