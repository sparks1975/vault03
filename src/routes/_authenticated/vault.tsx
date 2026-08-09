import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Camera, Loader2, Pencil, Check, X, ChevronLeft, ChevronRight, RefreshCw, GripVertical } from "lucide-react";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { scanCardPhoto, scanCardBack, estimateCardValue } from "@/lib/ai.functions";
import { listCardsightParallels, searchCardsightCards } from "@/lib/cardsight.functions";
import { APPROVED_CARD_SETS } from "@/lib/card-sets";
import { CardCropDialog } from "@/components/CardCropDialog";
import { searchMlbPlayer, getPlayerStats } from "@/lib/mlb.functions";
import {
  listCards,
  createCard,
  updateCardFields,
  deleteCard,
  replaceValuation,
  uploadCardPhoto,
  reorderCards,
  fetchCompCandidates,
  addManualComps,
  removeManualComp,
} from "@/lib/cards.functions";
import { fetchCompPreviews } from "@/lib/comp-previews.functions";
import { Button } from "@/components/ui/button";


import { ShareDialog } from "@/components/ShareDialog";
import { AppNav, MobileNavTabs } from "@/components/AppNav";
import vaultStatsAsset from "@/assets/vault_stats.svg.asset.json";

import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function CardRowSkeleton() {
  return (
    <div className="w-full p-4 flex gap-4 border border-border bg-background">
      <Skeleton className="w-16 h-24 shrink-0 rounded-none" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
      <div className="text-right space-y-2">
        <Skeleton className="h-4 w-16 ml-auto" />
        <Skeleton className="h-3 w-10 ml-auto" />
      </div>
    </div>
  );
}

function StatGridSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/vault")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "My Vault — Vault.03" },
      { name: "description", content: "Manage your Vault.03 sports card portfolio, values, and comparable sales." },
      { property: "og:title", content: "My Vault — Vault.03" },
      { property: "og:description", content: "Manage your Vault.03 sports card portfolio, values, and comparable sales." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VaultPage,
});


type Sale = {
  id: string;
  card_id: string;
  sold_at: string | null;
  grade: string | null;
  price: number;
  source: string | null;
  title: string | null;
  url: string | null;
  is_manual?: boolean | null;
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
  serial_number: string | null;
  is_autograph: boolean | null;
  is_first_bowman: boolean | null;
  is_rookie: boolean | null;
  grade: string | null;
  grader: string | null;
  purchase_price: number | null;
  current_value: number | null;
  value_delta_pct: number | null;
  notes: string | null;
  photo_url: string | null;
  mlb_player_id: number | null;
  last_valued_at: string | null;
  last_valuation_failed_at: string | null;
  cardsight_card_id: string | null;
  cardsight_parallel_id: string | null;
  cardsight_grade_id: string | null;
  cardsight_lookup_failed_at: string | null;
  created_at: string;
  sort_order: number | null;
  sales: Sale[];
  history: HistoryPoint[];
  photo_thumb_url?: string | null;
  photo_thumb_url_2x?: string | null;
  photo_url_2x?: string | null;
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(n));
}
function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return null;
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

function VaultPage() {
  const listFn = useServerFn(listCards);
  const updateFn = useServerFn(updateCardFields);
  const deleteFn = useServerFn(deleteCard);
  const estimateFn = useServerFn(estimateCardValue);
  const replaceValFn = useServerFn(replaceValuation);
  const qc = useQueryClient();


  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"value" | "player" | "added" | "manual">("manual");
  const [addOpen, setAddOpen] = useState(false);
  const [revalueProgress, setRevalueProgress] = useState<{
    isRunning: boolean;
    processed: number;
    failed: number;
    total: number;
    currentName: string | null;
  }>({ isRunning: false, processed: 0, failed: 0, total: 0, currentName: null });

  const cardsQ = useQuery({
    queryKey: ["cards"],
    queryFn: () => listFn(),
  });
  const cardData = (cardsQ.data ?? []) as Card[];

  // Values are never refreshed automatically — the user triggers a refresh with
  // the "Re-value" button in the header. This keeps comp-scraping costs bounded.



  const updateMut = useMutation({
    mutationFn: (v: { id: string; patch: Partial<Card> }) =>
      updateFn({ data: { id: v.id, patch: v.patch as Record<string, unknown> } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["cards"] });
      if ((res as { identity_reset?: boolean } | undefined)?.identity_reset) {
        toast.warning("Card details changed — old comps cleared. Re-value to pull comps for the corrected card.");
      }
    },
  });


  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });

  async function runRevalueAll() {
    if (revalueProgress.isRunning || cardData.length === 0) return;
    setRevalueProgress({ isRunning: true, processed: 0, failed: 0, total: cardData.length, currentName: null });
    let processed = 0;
    let failed = 0;
    for (const c of cardData) {
      setRevalueProgress((prev) => ({ ...prev, currentName: c.player_name }));
      try {
        const est = await estimateFn({
          data: {
            player_name: c.player_name,
            year: c.year,
            set_name: c.set_name,
            card_number: c.card_number,
            grade: c.grade,
            grader: c.grader,
            is_autograph: c.is_autograph,
            is_first_bowman: c.is_first_bowman,
            serial_number: c.serial_number,
            cardsight_card_id: c.cardsight_card_id,
            cardsight_parallel_id: c.cardsight_parallel_id,
            cardsight_grade_id: c.cardsight_grade_id,
            cardsight_lookup_failed_at: c.cardsight_lookup_failed_at,
            card_id: c.id,
          },
        });
        await replaceValFn({
          data: {
            card_id: c.id,
            current_value: est.current_value,
            value_delta_pct: est.value_delta_pct,
            valuation_error: est.valuation_error ?? false,
            sales: est.sales,
            history: est.history,
          },
        });
        const idPatch: Partial<Card> = {};
        if (est.resolved_cardsight_card_id && est.resolved_cardsight_card_id !== c.cardsight_card_id) {
          idPatch.cardsight_card_id = est.resolved_cardsight_card_id;
          idPatch.cardsight_lookup_failed_at = null;
        }
        if (est.resolved_cardsight_grade_id && est.resolved_cardsight_grade_id !== c.cardsight_grade_id) {
          idPatch.cardsight_grade_id = est.resolved_cardsight_grade_id;
        }
        if (Object.keys(idPatch).length > 0) {
          await updateFn({
            data: { id: c.id, patch: idPatch },
          });
        }
        processed++;
      } catch (err) {
        console.error("Revalue failed for", c.player_name, err);
        failed++;
      }
      setRevalueProgress((prev) => ({ ...prev, processed, failed }));
    }
    await qc.invalidateQueries({ queryKey: ["cards"] });
    toast.success(`Re-valued ${processed} card${processed === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}`);
    setRevalueProgress({ isRunning: false, processed: 0, failed: 0, total: 0, currentName: null });
  }

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

  const sorted = useMemo(() => {
    const list = [...filtered];
    switch (sortBy) {
      case "value":
        return list.sort((a, b) => Number(b.current_value ?? 0) - Number(a.current_value ?? 0));
      case "player":
        return list.sort((a, b) => a.player_name.localeCompare(b.player_name));
      case "added":
        return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case "manual":
      default:
        return list.sort((a, b) => {
          const ao = a.sort_order;
          const bo = b.sort_order;
          if (ao == null && bo == null) {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          }
          if (ao == null) return 1;
          if (bo == null) return -1;
          return ao - bo;
        });
    }
  }, [filtered, sortBy]);

  const selected = selectedId ?? sorted[0]?.id ?? null;
  const selectedCard = selected ? cardData.find((card) => card.id === selected) ?? null : null;

  const totals = useMemo(() => {
    const list = cardData;
    const totalValue = list.reduce((sum, c) => sum + Number(c.current_value ?? 0), 0);
    const graded = list.filter((c) => c.grade).length;
    const withGain = list
      .map((c) => ({ card: c, dollars: gainDollars(c), pct: gainPct(c) }))
      .filter((x): x is { card: Card; dollars: number; pct: number | null } => x.dollars != null)
      .sort((a, b) => b.dollars - a.dollars);
    const top = withGain[0];
    return {
      totalValue,
      count: list.length,
      gradedPct: list.length ? Math.round((graded / list.length) * 100) : 0,
      topMover: top?.card ?? null,
      topMoverDollars: top?.dollars ?? null,
      topMoverPct: top?.pct ?? null,
    };
  }, [cardData]);

  const [mobileDetail, setMobileDetail] = useState(false);

  function goPrev() {
    if (sorted.length <= 1) return;
    const i = sorted.findIndex((c) => c.id === selected);
    const prev = sorted[(i - 1 + sorted.length) % sorted.length];
    if (prev) setSelectedId(prev.id);
  }
  function goNext() {
    if (sorted.length <= 1) return;
    const i = sorted.findIndex((c) => c.id === selected);
    const next = sorted[(i + 1 + sorted.length) % sorted.length];
    if (next) setSelectedId(next.id);
  }

  // Touch swipe for navigating between cards on mobile detail view.
  const detailTouch = useRef<{ x: number; y: number; t: number } | null>(null);
  function onDetailTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    detailTouch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }
  function onDetailTouchEnd(e: React.TouchEvent) {
    const start = detailTouch.current;
    detailTouch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Require a mostly-horizontal, sufficiently long swipe.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0) goPrev();
    else goNext();
  }

  const reorderFn = useServerFn(reorderCards);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const currentIds = sorted.map((c) => c.id);
    const oldIndex = currentIds.indexOf(String(active.id));
    const newIndex = currentIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrderIds = arrayMove(currentIds, oldIndex, newIndex);

    // Optimistic update: patch the cards query cache with new sort_order values,
    // and switch sort mode to manual so the drag result is visible.
    setSortBy("manual");
    qc.setQueryData(["cards"], (prev: Card[] | undefined) => {
      if (!prev) return prev;
      const orderMap = new Map(newOrderIds.map((id, i) => [id, i]));
      return prev.map((c) =>
        orderMap.has(c.id) ? { ...c, sort_order: orderMap.get(c.id) ?? c.sort_order } : c,
      );
    });

    reorderFn({ data: { orderedIds: newOrderIds } }).catch((err) => {
      console.error("Reorder failed", err);
      toast.error("Failed to save order");
      qc.invalidateQueries({ queryKey: ["cards"] });
    });
  }


  function selectCard(id: string) {
    setSelectedId(id);
    setMobileDetail(true);
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 overflow-x-clip">
      <AppNav
        leading={
          mobileDetail ? (
            <button
              onClick={() => setMobileDetail(false)}
              className="lg:hidden p-2 -ml-2 rounded-sm border border-white/20 hover:bg-white/10 text-white"
              aria-label="Back to list"
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null
        }
        actions={
          <>
            <button
              onClick={() => runRevalueAll()}
              disabled={revalueProgress.isRunning || cardData.length === 0}
              title="Refresh all card values"
              className="px-3 md:px-4 py-2 border border-white/20 text-white text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-white/10 transition-colors inline-flex items-center gap-2 disabled:opacity-50"
            >
              {revalueProgress.isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              <span className="hidden sm:inline">Refresh Values</span>
            </button>
            <ShareDialog />
            <button
              onClick={() => setAddOpen(true)}
              className="px-3 md:px-4 py-2 bg-foreground text-background text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-accent transition-colors inline-flex items-center gap-2"
            >
              <Plus className="size-3.5" /> <span className="hidden sm:inline">Add Card</span><span className="sm:hidden">Add</span>
            </button>
          </>
        }
      />

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-0 md:pt-12">
        <div className="sticky top-16 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-4 bg-black lg:hidden">
          <MobileNavTabs />
        </div>
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <img
              src={vaultStatsAsset.url}
              alt="Vault statistics illustration"
              className="w-[4.8rem] h-auto md:w-24 object-contain shrink-0"
            />
            <h1 className="text-2xl md:text-[50px] font-extrabold tracking-tight font-display uppercase leading-none">My Vault</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Every card you own, valued from real completed sales and sorted however you like.
          </p>
        </header>

        <div className="mt-8 md:mt-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
          <section className={`lg:col-span-7 animate-in-up [animation-delay:100ms] ${mobileDetail ? "hidden lg:block" : ""}`}>
            <div className="flex flex-wrap items-center justify-between mb-6 gap-3">
              <h3 className="text-sm font-mono uppercase tracking-widest">Holdings</h3>

              <div className="flex items-center gap-3">
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                  <SelectTrigger className="text-xs font-mono uppercase tracking-widest border-border bg-background rounded-sm focus:ring-accent focus:ring-1 px-3 py-1 w-32 sm:w-36 shadow-none">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-background rounded-sm text-xs font-mono uppercase tracking-widest shadow-none">
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="added">Date added</SelectItem>
                    <SelectItem value="value">Value</SelectItem>
                    <SelectItem value="player">Player</SelectItem>
                  </SelectContent>
                </Select>
                <input
                  type="text"
                  placeholder="Search cards…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 text-xs font-mono uppercase tracking-widest border border-border bg-background rounded-sm focus:ring-accent focus:ring-1 px-3 w-32 sm:w-48 shadow-none placeholder:font-mono placeholder:uppercase placeholder:tracking-widest"
                />
              </div>
            </div>

            {cardsQ.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <CardRowSkeleton key={i} />)}
              </div>
            ) : sorted.length === 0 ? (
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
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sorted.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {sorted.map((c) => (
                      <SortableCardRow key={c.id} card={c} active={c.id === selected} onClick={() => selectCard(c.id)} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </section>

          <aside className={`lg:col-span-5 animate-in-up [animation-delay:200ms] ${mobileDetail ? "" : "hidden lg:block"}`}>
            <div className="lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
              {selectedCard ? (
                <>
                  {sorted.length > 1 && (
                    <div className="lg:hidden flex items-center justify-between gap-2 mb-3">
                      <button
                        onClick={() => {
                          const i = sorted.findIndex((c) => c.id === selected);
                          const prev = sorted[(i - 1 + sorted.length) % sorted.length];
                          if (prev) setSelectedId(prev.id);
                        }}
                        className="flex-1 px-3 py-2 border border-border text-xs font-bold uppercase tracking-widest rounded-sm inline-flex items-center justify-center gap-1.5 hover:bg-secondary transition-colors"
                        aria-label="Previous card"
                      >
                        <ChevronLeft className="size-3.5" /> Prev
                      </button>
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground shrink-0">
                        {sorted.findIndex((c) => c.id === selected) + 1} / {sorted.length}
                      </span>
                      <button
                        onClick={() => {
                          const i = sorted.findIndex((c) => c.id === selected);
                          const next = sorted[(i + 1) % sorted.length];
                          if (next) setSelectedId(next.id);
                        }}
                        className="flex-1 px-3 py-2 border border-border text-xs font-bold uppercase tracking-widest rounded-sm inline-flex items-center justify-center gap-1.5 hover:bg-secondary transition-colors"
                        aria-label="Next card"
                      >
                        Next <ChevronRight className="size-3.5" />
                      </button>
                    </div>
                  )}
                  <CardDetail card={selectedCard} onDeleted={(id) => { removeCard(id); setMobileDetail(false); }} onUpdate={updateCard} />
                </>
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
            setMobileDetail(true);
            qc.invalidateQueries({ queryKey: ["cards"] });
          }}
        />
      )}

      {revalueProgress.isRunning && (
        <div className="fixed inset-0 z-50 bg-foreground/60 backdrop-blur-sm grid place-items-center p-4 fade-in">
          <div className="bg-background border border-border w-full max-w-md p-6 md:p-8 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Re-valuing vault</p>
                <h2 className="text-xl font-extrabold tracking-tight">Updating values…</h2>
              </div>
              <Loader2 className="size-5 animate-spin text-accent" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <span>{revalueProgress.processed + revalueProgress.failed} / {revalueProgress.total}</span>
                <span>{Math.round(((revalueProgress.processed + revalueProgress.failed) / Math.max(revalueProgress.total, 1)) * 100)}%</span>
              </div>
              <Progress value={((revalueProgress.processed + revalueProgress.failed) / Math.max(revalueProgress.total, 1)) * 100} />
            </div>
            {revalueProgress.currentName && (
              <p className="text-xs text-muted-foreground truncate">
                Current: <span className="font-medium text-foreground">{revalueProgress.currentName}</span>
              </p>
            )}
            <p className="text-[10px] font-mono text-muted-foreground">
              Please keep this tab open while values are refreshed.
            </p>
          </div>
        </div>
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
  const delta = gainPct(card);
  const imgSrc = card.photo_thumb_url ?? card.photo_url;
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    if (!imgSrc) { setImgLoaded(true); return; }
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setImgLoaded(true);
    else setImgLoaded(false);
  }, [imgSrc]);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 flex gap-4 transition-colors ${active ? "ring-1 ring-inset ring-accent bg-accent/[0.06]" : "border border-foreground bg-background hover:bg-secondary"}`}
    >
      <div className="w-16 h-24 bg-secondary shrink-0 border border-border overflow-hidden grid place-items-center relative">
        {card.photo_url ? (
          <>
            {!imgLoaded && <Skeleton className="absolute inset-0 rounded-none" />}
            <img
              ref={imgRef}
              src={imgSrc ?? undefined}
              srcSet={
                card.photo_thumb_url
                  ? `${card.photo_thumb_url} 1x${card.photo_thumb_url_2x ? `, ${card.photo_thumb_url_2x} 2x` : ""}`
                  : undefined
              }
              sizes="64px"
              alt={card.player_name}
              loading="lazy"
              decoding="async"
              width={64}
              height={96}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgLoaded(true)}
              className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            />
          </>
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
            <div className="flex flex-wrap gap-2 mt-1 items-center">
              {card.grade && (
                <span className="px-1.5 py-0.5 border border-accent text-accent text-[10px] font-mono font-bold">
                  {card.grader ?? ""} {card.grade}
                </span>
              )}
              {card.serial_number && (
                <span className="px-1.5 py-0.5 border border-accent text-accent text-[10px] font-mono font-bold uppercase">
                  {card.serial_number}
                </span>
              )}
              {card.is_autograph && (
                <span className="px-1.5 py-0.5 border border-accent text-accent text-[10px] font-mono font-bold uppercase">
                  Auto
                </span>
              )}
              {card.is_rookie && (
                <span className="px-1.5 py-0.5 border border-[color:var(--positive)] text-[color:var(--positive)] text-[10px] font-mono font-bold uppercase">
                  Rookie
                </span>
              )}
              {card.is_first_bowman && (
                <span className="px-1.5 py-0.5 border border-[color:var(--first-bowman)] text-[color:var(--first-bowman)] text-[10px] font-mono font-bold uppercase">
                  1st Bowman
                </span>
              )}
            </div>
            {(card.team || card.position) && (
              <div className="text-[10px] text-muted-foreground uppercase mt-1">
                {card.team ?? ""} {card.position ? `• ${card.position}` : ""}
              </div>
            )}
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

function SortableCardRow({ card, active, onClick }: { card: Card; active: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 20 : "auto",
  };
  return (
    <div ref={setNodeRef} style={style} className="relative group touch-manipulation">
      <div
        {...attributes}
        {...listeners}
        role="button"
        aria-label="Drag to reorder"
        className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground opacity-40 group-hover:opacity-100 touch-none"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="size-4" />
      </div>
      <div className="pl-11">
        <CardRow card={card} active={active} onClick={onClick} />
      </div>
    </div>
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
  const [imgLoaded, setImgLoaded] = useState(true);
  const [editingValue, setEditingValue] = useState(false);
  const [manualValue, setManualValue] = useState("");

  useEffect(() => {
    setEditingValue(false);
  }, [card.id]);

  function saveManualValue() {
    const n = Number(manualValue.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid dollar amount");
      return;
    }
    const patch: Partial<Card> = { current_value: n, last_valued_at: new Date().toISOString() };
    if (card.purchase_price != null && Number(card.purchase_price) > 0) {
      patch.value_delta_pct = ((n - Number(card.purchase_price)) / Number(card.purchase_price)) * 100;
    }
    onUpdate(card.id, patch);
    setEditingValue(false);
    toast.success("Value updated");
  }

  useEffect(() => {
    setImgLoaded(!card.photo_url);
  }, [card.id, card.photo_url]);

  const stats = useQuery({
    queryKey: ["stats", card.mlb_player_id],
    queryFn: () => getStatsFn({ data: { playerId: card.mlb_player_id! } }),
    enabled: !!card.mlb_player_id,
  });

  const contentReady = editing || imgLoaded;

  function startEdit() {
    setDraft({
      player_name: card.player_name,
      team: card.team,
      position: card.position,
      year: card.year,
      set_name: card.set_name,
      card_number: card.card_number,
      serial_number: card.serial_number,
      is_autograph: card.is_autograph ?? false,
      is_first_bowman: card.is_first_bowman ?? false,
      is_rookie: card.is_rookie ?? false,
      grade: card.grade,
      grader: card.grader,
      purchase_price: card.purchase_price,
      notes: card.notes,
      mlb_player_id: card.mlb_player_id,
      cardsight_parallel_id: card.cardsight_parallel_id,

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
          is_autograph: card.is_autograph,
          is_first_bowman: card.is_first_bowman,
          serial_number: card.serial_number,
          cardsight_card_id: card.cardsight_card_id,
          cardsight_parallel_id: card.cardsight_parallel_id,
          cardsight_grade_id: card.cardsight_grade_id,
          card_id: card.id,
          // Manual per-card refresh always re-scrapes: ignore the 24h comp
          // cache and the 7-day failed-lookup cooldown.
          force_refresh: true,
        },

      });
      await replaceValFn({
        data: {
          card_id: card.id,
          current_value: est.current_value,
          value_delta_pct: est.value_delta_pct,
          valuation_error: est.valuation_error ?? false,
          sales: est.sales,
          history: est.history,
        },
      });
      const idPatch: Partial<Card> = {};
      if (est.resolved_cardsight_card_id && est.resolved_cardsight_card_id !== card.cardsight_card_id) {
        idPatch.cardsight_card_id = est.resolved_cardsight_card_id;
        idPatch.cardsight_lookup_failed_at = null;
      }
      if (est.resolved_cardsight_grade_id && est.resolved_cardsight_grade_id !== card.cardsight_grade_id) {
        idPatch.cardsight_grade_id = est.resolved_cardsight_grade_id;
      }
      if (Object.keys(idPatch).length > 0) {
        onUpdate(card.id, idPatch);
      }
      qc.invalidateQueries({ queryKey: ["cards"] });
      if (est.note) toast.warning(est.note);
      const soldCount = est.sales.filter((s) => s.source.includes("eBay sold")).length;
      const valued = Number.isFinite(Number(est.current_value)) && Number(est.current_value) > 0;
      if (est.valuation_error) {
        toast.error("Valuation temporarily unavailable, try again in 10-20 min.");
      } else if (!valued) {
        toast.warning(est.note ?? "No matching sold comps found for this exact card.");
      } else {
        toast.success(
          soldCount > 0
            ? `Valuation refreshed — ${soldCount} sold comp${soldCount === 1 ? "" : "s"}`
            : "Valuation refreshed — AI estimate (no sold comps yet)",
        );
      }
    } catch {
      toast.error("Valuation temporarily unavailable, try again in 10-20 min.");
    } finally {
      setValuing(false);
    }
  }

  function deleteSelected() {
    onDeleted(card.id);
    toast.success("Card removed");
  }

  const sales = card.sales ?? [];
  const priceHistory = sales
    .filter((s) => s.sold_at && Number(s.price) > 0)
    .map((s) => ({ date: new Date(s.sold_at as string).getTime(), price: Number(s.price) }))
    .sort((a, b) => a.date - b.date);



  return (
    <div className="relative">
      {!contentReady && (
        <div className="absolute inset-0 z-10">
          <CardDetailSkeleton />
        </div>
      )}
      <div className={`bg-card border border-border p-6 shadow-sm ${contentReady ? "" : "invisible"}`}>
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
          <img
            src={card.photo_url}
            srcSet={
              card.photo_url_2x
                ? `${card.photo_url} 1x, ${card.photo_url_2x} 2x`
                : undefined
            }
            sizes="(min-width: 1024px) 40vw, 92vw"
            alt={card.player_name}
            decoding="async"
            fetchPriority="high"
            className="w-full h-full object-cover"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(true)}
          />
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
              <ApprovedSetSelect
                value={String(draft.set_name ?? "")}
                onChange={(setName) => setDraft({ ...draft, set_name: setName, cardsight_card_id: null, cardsight_parallel_id: null })}
              />
              <Field label="Card #" value={String(draft.card_number ?? "")} onChange={(v) => setDraft({ ...draft, card_number: v || null })} />
              <Field label="Position" value={String(draft.position ?? "")} onChange={(v) => setDraft({ ...draft, position: v || null })} />
              <Field label="Grader" value={String(draft.grader ?? "")} onChange={(v) => setDraft({ ...draft, grader: v || null })} />
              <Field label="Grade" value={String(draft.grade ?? "")} onChange={(v) => setDraft({ ...draft, grade: v || null })} />
              <Field label="Purchase price (USD)" type="number" value={draft.purchase_price == null ? "" : String(draft.purchase_price)} onChange={(v) => setDraft({ ...draft, purchase_price: v ? Number(v) : null })} />
              <label className="flex flex-col justify-end cursor-pointer">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground invisible">Autographed</span>
                <div className="mt-1 flex items-center gap-2 border border-border px-3 h-10 hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={!!draft.is_autograph}
                    onChange={(e) => setDraft({ ...draft, is_autograph: e.target.checked })}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Autographed</span>
                </div>
              </label>
              <label className="flex flex-col justify-end cursor-pointer">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground invisible">Rookie</span>
                <div className="mt-1 flex items-center gap-2 border border-border px-3 h-10 hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={!!draft.is_rookie}
                    onChange={(e) => setDraft({ ...draft, is_rookie: e.target.checked })}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Rookie card</span>
                </div>
              </label>
              <label className="flex flex-col justify-end cursor-pointer">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground invisible">1st Bowman</span>
                <div className="mt-1 flex items-center gap-2 border border-border px-3 h-10 hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={!!draft.is_first_bowman}
                    onChange={(e) => setDraft({ ...draft, is_first_bowman: e.target.checked })}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-widest">1st Bowman</span>
                </div>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="cursor-pointer">
                <div className="flex h-10 items-center gap-2 border border-border px-3 hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={!!draft.serial_number || draft.serial_number === ""}
                    onChange={(e) => setDraft({ ...draft, serial_number: e.target.checked ? (draft.serial_number ?? "") : null })}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Numbered card</span>
                </div>
              </label>
              {(draft.serial_number != null) && (
                <input
                  type="text"
                  placeholder='Serial (e.g. "1/50")'
                  value={String(draft.serial_number ?? "")}
                  onChange={(e) => setDraft({ ...draft, serial_number: e.target.value })}
                  className="h-10 w-full border border-border bg-background px-3 text-sm rounded-sm focus:outline-none focus:border-accent"
                />
              )}
            </div>
            <CatalogLinkPicker
              cardId={(draft.cardsight_card_id ?? card.cardsight_card_id) ?? null}
              lookup={{ ...card, ...draft }}
              onLink={(id) => setDraft({ ...draft, cardsight_card_id: id, cardsight_parallel_id: null })}
            />
            <ParallelSelect
              cardId={(draft.cardsight_card_id ?? card.cardsight_card_id) ?? null}
              lookup={{ ...card, ...draft }}
              value={draft.cardsight_parallel_id ?? null}
              onChange={(id) => setDraft({ ...draft, cardsight_parallel_id: id })}
            />

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
          <div className="flex flex-wrap gap-1.5 mt-2">
            {card.serial_number && (
              <span className="px-1.5 py-0.5 border border-accent text-accent text-[10px] font-mono font-bold uppercase">
                {card.serial_number}
              </span>
            )}
            {card.is_autograph && (
              <span className="px-1.5 py-0.5 border border-accent text-accent text-[10px] font-mono font-bold uppercase">
                Auto
              </span>
            )}
            {card.is_rookie && (
              <span className="px-1.5 py-0.5 border border-[color:var(--positive)] text-[color:var(--positive)] text-[10px] font-mono font-bold uppercase">
                Rookie
              </span>
            )}
            {card.is_first_bowman && (
              <span className="px-1.5 py-0.5 border border-[color:var(--first-bowman)] text-[color:var(--first-bowman)] text-[10px] font-mono font-bold uppercase">
                1st Bowman
              </span>
            )}
          </div>
          <div className="flex justify-between items-end mt-2">

            <div className="text-xs text-muted-foreground">
              {card.grader} {card.grade} {card.team ? `• ${card.team}` : ""}
            </div>
            <div className="text-right">
              {editingValue ? (
                <div className="flex items-center gap-1 justify-end">
                  <span className="text-sm font-mono text-muted-foreground">$</span>
                  <input
                    autoFocus
                    inputMode="decimal"
                    value={manualValue}
                    onChange={(e) => setManualValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveManualValue();
                      if (e.key === "Escape") setEditingValue(false);
                    }}
                    placeholder="0.00"
                    className="h-8 w-24 text-right font-mono bg-background border border-border px-2 text-sm"
                  />
                  <button
                    onClick={saveManualValue}
                    className="text-[10px] font-mono uppercase tracking-widest border border-accent text-accent px-2 py-1 hover:bg-accent hover:text-accent-foreground"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingValue(false)}
                    className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary"
                  >
                    Cancel
                  </button>
                </div>
              ) : card.current_value == null ? (
                <button
                  onClick={() => {
                    setManualValue("");
                    setEditingValue(true);
                  }}
                  className="text-[10px] font-mono uppercase tracking-widest border border-accent text-accent px-2 py-1 hover:bg-accent hover:text-accent-foreground"
                >
                  Enter value
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setManualValue(String(Number(card.current_value)));
                      setEditingValue(true);
                    }}
                    className="text-2xl font-extrabold tracking-tight hover:text-accent"
                    title="Edit value manually"
                  >
                    {fmt(card.current_value)}
                  </button>
                  {gainPct(card) != null && (
                    <p className={`text-[10px] font-mono ${Number(card.current_value) >= Number(card.purchase_price) ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}>
                      {fmtPct(gainPct(card))} vs purchase
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      )}

      {card.notes && !editing && (
        <div className="mb-8">
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2 border-b border-border pb-2">Notes</h3>
          <p className="text-sm whitespace-pre-wrap">{card.notes}</p>
        </div>
      )}

      <div className="space-y-8">
        {priceHistory.length >= 2 && (
          <div>
            <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 border-b border-border pb-2">
              Price Trend
            </h3>
            <SalesSparkline points={priceHistory} />
          </div>
        )}



        <div>
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 border-b border-border pb-2">
            {stats.data
              ? `${stats.data.season} ${stats.data.league ? stats.data.league + " " : ""}Player Stats`
              : "Player Stats"}
          </h3>
          {!card.mlb_player_id ? (
            <p className="text-xs text-muted-foreground">Link an MLB player to see current stats (edit card and search).</p>
          ) : stats.isLoading ? (
            <StatGridSkeleton />
          ) : stats.data?.stats ? (
            <StatGrid group={stats.data.group ?? "hitting"} s={stats.data.stats} />
          ) : (
            <p className="text-xs text-muted-foreground">No stats available for this season.</p>
          )}
        </div>

        <RecentComparables
          sales={sales}
          cardId={card.id}
          valuationFailed={Boolean(
            card.last_valuation_failed_at &&
              (!card.last_valued_at ||
                new Date(card.last_valuation_failed_at).getTime() > new Date(card.last_valued_at).getTime()),
          )}
        />
      </div>
      </div>
    </div>
  );
}

function CardDetailSkeleton() {
  return (
    <div className="bg-card border border-border p-6 shadow-sm">
      <div className="flex justify-between mb-8">
        <Skeleton className="h-5 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-6" />
        </div>
      </div>
      <Skeleton className="w-full aspect-[2/3] mb-8 rounded-none" />
      <div className="mb-8 space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" />
        </div>
        <div className="flex justify-between items-end pt-2">
          <Skeleton className="h-4 w-32" />
          <div className="text-right space-y-2">
            <Skeleton className="h-7 w-24 ml-auto" />
            <Skeleton className="h-3 w-20 ml-auto" />
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <StatGridSkeleton />
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

function SalesSparkline({ points }: { points: { date: number; price: number }[] }) {
  const W = 600;
  const H = 120;
  const PAD = 8;
  const xs = points.map((p) => p.date);
  const ys = points.map((p) => p.price);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const coords = points.map((p) => {
    const x = PAD + ((p.date - minX) / spanX) * (W - PAD * 2);
    const y = H - PAD - ((p.price - minY) / spanY) * (H - PAD * 2);
    return { x, y, ...p };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const area = `${path} L ${coords[coords.length - 1].x.toFixed(1)} ${H - PAD} L ${coords[0].x.toFixed(1)} ${H - PAD} Z`;
  const first = points[0];
  const last = points[points.length - 1];
  const changePct = first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0;
  const up = last.price >= first.price;
  const stroke = up ? "var(--positive)" : "var(--negative)";
  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-[10px] font-mono text-muted-foreground uppercase">
          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(minY)}
          {" – "}
          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(maxY)}
        </span>
        <span className="text-[10px] font-mono" style={{ color: stroke }}>
          {up ? "+" : ""}{changePct.toFixed(1)}% across window
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none">
        <path d={area} fill={stroke} opacity="0.12" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" />
        {coords.length <= 40 && coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="2" fill={stroke} />
        ))}
      </svg>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-1">
        <span>{new Date(minX).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}</span>
        <span>{new Date(maxX).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}</span>
      </div>
    </div>
  );
}

type SaleRow = {
  sold_at: string | null;
  grade: string | null;
  price: number | string;
  source: string | null;
  title?: string | null;
  url?: string | null;
};

function isNonSingleSaleTitle(title: string | null | undefined) {
  const raw = String(title ?? "").trim();
  if (!raw) return false;
  const nonSingle = /\b(case\s*break|player\s*break|team\s*break|group\s*break|random\s*(team|player|division)|box\s*break|break\s*#?\d*|factory\s*sealed|sealed\s*(wax|box|case|pack|packs|product)|unopened|hobby\s*(box|case|pack|packs)|jumbo\s*(box|pack|packs)|blaster\s*(box|pack|packs)|retail\s*(box|pack|packs)|mega\s*box|hanger\s*(box|pack|packs)|value\s*box|cello\s*(box|pack|packs)|booster|wax\s*(box|pack|packs)|complete\s*set|factory\s*set|master\s*set|team\s*set|(\d+)\s*(box(es)?|case(s)?|pack(s)?|card\s*lot)|lot\s*of\s*\d+|card\s*lot|\d+\s*card\s*lot|repack|mixer)\b/i;
  const sealedWords = /\b(factory|sealed|unopened|hobby|jumbo|blaster|retail|mega|hanger|value|cello|wax)\b/i;
  const containers = /\b(box|boxes|case|cases|pack|packs|product|wax)\b/i;
  return nonSingle.test(raw) || (sealedWords.test(raw) && containers.test(raw));
}

function RecentComparables({ sales, cardId, valuationFailed }: { sales: SaleRow[]; cardId: string; valuationFailed?: boolean }) {
  const [manageOpen, setManageOpen] = useState(false);
  const valid = (sales ?? []).filter((s) => Number.isFinite(Number(s.price)) && Number(s.price) > 0 && !isNonSingleSaleTitle(s.title));
  const headerBtn = (
    <button
      onClick={() => setManageOpen(true)}
      className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground border border-border px-2 py-1"
    >
      Manage comps
    </button>
  );
  if (valid.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4 border-b border-border pb-2">
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Recent Comparables</h3>
          {headerBtn}
        </div>
        <p className="text-xs text-muted-foreground">
          {valuationFailed
            ? "Valuation temporarily unavailable, try again in 10-20 min."
            : "No comparable sales found. The card value shown is an AI market estimate."}
        </p>
        {manageOpen && <ManageCompsDialog cardId={cardId} onClose={() => setManageOpen(false)} />}
      </div>
    );
  }

  const byDateDesc = [...valid].sort((a, b) => {
    const ta = a.sold_at ? new Date(a.sold_at).getTime() : 0;
    const tb = b.sold_at ? new Date(b.sold_at).getTime() : 0;
    return tb - ta;
  });
  const byPriceAsc = [...valid].sort((a, b) => Number(a.price) - Number(b.price));
  const latest = byDateDesc[0];
  const oldest = byDateDesc[byDateDesc.length - 1];
  const low = byPriceAsc[0];
  const high = byPriceAsc[byPriceAsc.length - 1];
  const medianSale = byPriceAsc[Math.floor((byPriceAsc.length - 1) / 2)];
  const rows = [
    { key: "latest", label: "Latest", sale: latest },
    { key: "median", label: `Median (${valid.length})`, sale: medianSale },
    { key: "low", label: "Low", sale: low },
    { key: "high", label: "High", sale: high },
    { key: "oldest", label: "Oldest", sale: oldest },
  ];
  const fmtUsd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  return (
    <div>
      <div className="flex items-center justify-between mb-4 border-b border-border pb-2">
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Recent Comparables</h3>
        {headerBtn}
      </div>
      <div className="overflow-x-auto -mx-6 px-6">
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
            {rows.map(({ key, label, sale }) => {
              const url = sale.url ?? null;
              const dateStr = sale.sold_at
                ? new Date(sale.sold_at).toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "2-digit" })
                : "—";
              const rawSource = sale.source ?? "eBay sold";
              const cleaned = rawSource
                .replace(/130\s?point/gi, "eBay sold")
                .replace(/Cardsight \(eBay sold/gi, "eBay sold")
                .replace(/Cardsight \(/gi, "eBay sold · ")
                .replace(/\)/g, "")
                .split("·")[0]
                .trim() || "eBay sold";
              const displaySource = `${cleaned} · ${label}`;
              return (
                <tr key={key} className="text-xs border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="py-2 whitespace-nowrap">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-foreground">{dateStr}</a>
                    ) : dateStr}
                  </td>
                  <td className="py-2 whitespace-nowrap">{sale.grade ?? "overall"}</td>
                  <td className="py-2 text-muted-foreground whitespace-nowrap">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-foreground inline-flex items-center gap-1">
                        {displaySource}<span aria-hidden>↗</span>
                      </a>
                    ) : displaySource}
                  </td>
                  <td className="py-2 text-right font-mono whitespace-nowrap">{fmtUsd(Number(sale.price))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
        Values reflect sold comps from eBay across all available history.
      </p>
      {manageOpen && <ManageCompsDialog cardId={cardId} onClose={() => setManageOpen(false)} />}
    </div>
  );
}

type CompCandidate = {
  title: string | null;
  image_url?: string | null;
  price: number;
  sold_at: string | null;
  source: string;
  url: string | null;
};

type ExistingComp = {
  id: string;
  url: string | null;
  title: string | null;
  image_url?: string | null;
  price: number | string;
  sold_at: string | null;
  source: string | null;
  is_manual?: boolean | null;
};

function normalizeCompUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const itemMatch = parsed.pathname.match(/\/itm\/(\d+)/i);
    return itemMatch?.[1] ? `ebay:${itemMatch[1]}` : parsed.origin + parsed.pathname;
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeCompText(text: string | null | undefined) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeCompDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function normalizeCompPrice(value: number | string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function candidateKey(c: { url: string | null; title: string | null; price: number | string; sold_at: string | null }) {
  const urlKey = normalizeCompUrl(c.url);
  if (urlKey) return urlKey;
  return `${normalizeCompText(c.title)}|${normalizeCompPrice(c.price)}|${normalizeCompDate(c.sold_at)}`;
}

function candidateMatchesExisting(candidate: CompCandidate, existing: ExistingComp) {
  const candidateUrl = normalizeCompUrl(candidate.url);
  const existingUrl = normalizeCompUrl(existing.url);
  if (candidateUrl && existingUrl && candidateUrl === existingUrl) return true;
  return (
    normalizeCompText(candidate.title) === normalizeCompText(existing.title) &&
    normalizeCompPrice(candidate.price) === normalizeCompPrice(existing.price) &&
    normalizeCompDate(candidate.sold_at) === normalizeCompDate(existing.sold_at)
  );
}

function ManageCompsDialog({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const fetchFn = useServerFn(fetchCompCandidates);
  const previewFn = useServerFn(fetchCompPreviews);
  const addFn = useServerFn(addManualComps);
  const removeFn = useServerFn(removeManualComp);
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<CompCandidate[]>([]);
  const [existing, setExisting] = useState<ExistingComp[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [previews, setPreviews] = useState<Record<string, { image: string | null; title: string | null; description: string | null }>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchFn({ data: { card_id: cardId } });
        if (!alive) return;
        setCandidates(r.candidates as CompCandidate[]);
        setExisting(r.selected);
        setSelectedKeys(new Set((r.selected as ExistingComp[]).map((s) => candidateKey(s))));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load candidates");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  // Fetch OG image/description previews for each unique URL, in batches.
  useEffect(() => {
    const allUrls = new Set<string>();
    for (const c of candidates) if (c.url) allUrls.add(c.url);
    for (const e of existing) if (e.url) allUrls.add(e.url);
    const need = Array.from(allUrls).filter((u) => !(u in previews));
    if (need.length === 0) return;
    let alive = true;
    (async () => {
      const BATCH = 20;
      for (let i = 0; i < need.length; i += BATCH) {
        const slice = need.slice(i, i + BATCH);
        try {
          const r = await previewFn({ data: { urls: slice } });
          if (!alive) return;
          setPreviews((prev) => {
            const next = { ...prev };
            for (const p of r.previews) next[p.url] = { image: p.image, title: p.title, description: p.description };
            return next;
          });
        } catch {
          // ignore preview failures; UI degrades gracefully
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, existing]);


  // Merge currently selected comps into displayable list so users can toggle them off.
  const merged: CompCandidate[] = useMemo(() => {
    const known = new Set(candidates.map(candidateKey));
    const extras: CompCandidate[] = existing
      .filter((e) => !known.has(candidateKey(e)))
      .map((e) => ({ title: e.title, image_url: e.image_url ?? null, price: Number(e.price), sold_at: e.sold_at, source: e.source ?? "eBay sold", url: e.url }));
    const all = [...candidates, ...extras];
    const q = filter.trim().toLowerCase();
    return q ? all.filter((c) => (c.title ?? "").toLowerCase().includes(q)) : all;
  }, [candidates, existing, filter]);

  function toggle(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const existingByKey = new Map(existing.map((e) => [candidateKey({ url: e.url, title: e.title, price: Number(e.price), sold_at: e.sold_at }), e]));
      // Remove any currently selected comps that are no longer selected.
      const toRemove = existing.filter((e) => !selectedKeys.has(candidateKey(e)));
      for (const r of toRemove) {
        await removeFn({ data: { id: r.id, card_id: cardId } });
      }
      // Add newly selected candidates that aren't already stored.
      const candidateByKey = new Map(merged.map((c) => [candidateKey(c), c]));
      const toAdd: CompCandidate[] = [];
      for (const k of selectedKeys) {
        if (existingByKey.has(k)) continue;
        const c = candidateByKey.get(k);
        if (c) toAdd.push(c);
      }
      if (toAdd.length > 0) {
        await addFn({ data: { card_id: cardId, comps: toAdd } });
      }
      await qc.invalidateQueries({ queryKey: ["cards"] });
      toast.success("Comps updated");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const fmtUsd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border shadow-lg w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-mono uppercase tracking-widest">Manage comps</h3>
            <p className="text-[10px] text-muted-foreground mt-1">
              Current comps are checked. Deselect bad matches and select replacements to set the card value.
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-3 border-b border-border">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by title..."
            className="w-full bg-background border border-border px-3 py-2 text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading candidates…
            </div>
          ) : merged.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No candidates returned. Try a manual re-value first, or check the source APIs.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {merged.map((c) => {
                const key = candidateKey(c);
                const checked = selectedKeys.has(key);
                const dateStr = c.sold_at
                  ? new Date(c.sold_at).toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "2-digit" })
                  : "—";
                const preview = c.url ? previews[c.url] : undefined;
                const displayTitle = preview?.title || c.title || "(no title)";
                const displayDesc = preview?.description || null;
                return (
                  <li key={key} className="flex items-start gap-3 p-3 hover:bg-muted/30">
                    <button
                      type="button"
                      aria-label={checked ? "Deselect comp" : "Select comp"}
                      aria-pressed={checked}
                      onClick={() => toggle(key)}
                      className={`mt-1 flex size-5 shrink-0 items-center justify-center border transition-colors ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-transparent hover:border-primary"}`}
                    >
                      <Check className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="shrink-0 size-16 bg-muted border border-border overflow-hidden flex items-center justify-center"
                      aria-label="Toggle comp"
                    >
                      {c.image_url || preview?.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.image_url || preview?.image || ""}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[9px] font-mono text-muted-foreground">—</span>
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className="text-xs leading-snug break-words">{displayTitle}</p>
                        {existing.some((e) => candidateMatchesExisting(c, e) && !e.is_manual) && (
                          <span className="shrink-0 border border-border px-1.5 py-0.5 text-[9px] font-mono uppercase text-muted-foreground">Current</span>
                        )}
                        {existing.some((e) => candidateMatchesExisting(c, e) && e.is_manual) && (
                          <span className="shrink-0 border border-primary/40 px-1.5 py-0.5 text-[9px] font-mono uppercase text-primary">Manual</span>
                        )}
                      </div>
                      {displayDesc && (
                        <p className="mt-1 text-[11px] leading-snug text-muted-foreground line-clamp-2">
                          {displayDesc}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted-foreground uppercase">
                        <span>{dateStr}</span>
                        <span>·</span>
                        <span className="truncate">{c.source}</span>
                        {c.url && (
                          <>
                            <span>·</span>
                            <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-foreground">
                              view ↗
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-xs font-mono whitespace-nowrap pt-0.5">{fmtUsd(Number(c.price))}</div>
                  </li>
                );
              })}

            </ul>
          )}
        </div>
        <div className="p-3 border-t border-border flex items-center justify-between gap-3">
          <span className="text-[10px] font-mono text-muted-foreground uppercase">
            {selectedKeys.size} selected
          </span>
          <div className="flex gap-2">
             <Button
              variant="outline"
              onClick={onClose}
              className="h-9 rounded-none text-xs font-mono uppercase"
            >
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="h-9 rounded-none text-xs font-mono uppercase"
            >
              {saving && <Loader2 className="size-3 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </div>
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
  const scanBackFn = useServerFn(scanCardBack);
  const searchPlayerFn = useServerFn(searchMlbPlayer);
  const estimateFn = useServerFn(estimateCardValue);
  const createFn = useServerFn(createCard);
  const uploadFn = useServerFn(uploadCardPhoto);
  const replaceValFn = useServerFn(replaceValuation);
  const updateFn = useServerFn(updateCardFields);
  const qc = useQueryClient();

  const [step, setStep] = useState<"choose" | "back" | "form">("choose");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [frontIdentifyUrl, setFrontIdentifyUrl] = useState<string | null>(null);
  const [backPreviewUrl, setBackPreviewUrl] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<"front" | "back">("front");
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [scanSource, setScanSource] = useState<"catalog" | "ai" | null>(null);
  type ScanCandidate = Awaited<ReturnType<typeof scanCardPhoto>>["candidates"][number];
  const [candidates, setCandidates] = useState<ScanCandidate[]>([]);
  const [chosenSource, setChosenSource] = useState<"catalog" | "ai" | null>(null);
  const [backScanning, setBackScanning] = useState(false);
  const [backNote, setBackNote] = useState<string | null>(null);

  const [form, setForm] = useState({
    player_name: "",
    team: "",
    position: "",
    year: "",
    set_name: "",
    card_number: "",
    serial_number: "",
    is_numbered: false,
    is_autograph: false,
    is_first_bowman: false,
    is_rookie: false,
    grade: "",
    grader: "",
    purchase_price: "",
    notes: "",
    mlb_player_id: null as number | null,
    cardsight_card_id: null as string | null,
    cardsight_parallel_id: null as string | null,
  });
  const [playerResults, setPlayerResults] = useState<Awaited<ReturnType<typeof searchMlbPlayer>>>([]);

  async function handlePhoto(file: File, target: "front" | "back" = "front") {
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
      setCropTarget(target);
      setCropSource(rawDataUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read image");
    }
  }

  async function handleCropConfirm(displayDataUrl: string, identifyDataUrl: string) {
    setCropSource(null);
    if (cropTarget === "back") {
      // Back photo captured as part of the normal flow: identify front + back
      // together. From the form (a re-scan of the back) just merge corrections.
      if (step === "back") {
        setBackPreviewUrl(displayDataUrl);
        await runScan(frontIdentifyUrl!, identifyDataUrl);
      } else {
        await runBackScan(identifyDataUrl);
      }
      return;
    }
    // Front captured — ask for the back before spending the identify call.
    setImageDataUrl(displayDataUrl);
    setFrontIdentifyUrl(identifyDataUrl);
    setBackPreviewUrl(null);
    setStep("back");
  }

  async function runScan(frontUrl: string, backUrl: string | null) {
    setScanning(true);
    try {
      const result = await scanFn({ data: { imageDataUrl: frontUrl, backImageDataUrl: backUrl } });
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
        serial_number: result.serial_number ?? f.serial_number,
        is_numbered: result.serial_number ? true : f.is_numbered,
        is_rookie: result.is_rookie === true ? true : f.is_rookie,
        cardsight_card_id: result.cardsight_card_id ?? f.cardsight_card_id,
        cardsight_parallel_id: null,
      }));
      setConfidence(result.confidence ?? null);
      setScanSource(result.source ?? null);
      setCandidates(result.disagreement ? result.candidates : []);
      setChosenSource(null);
      setBackNote(
        !result.back_read
          ? null
          : result.back_corrections.length > 0
            ? `Back scan corrected: ${result.back_corrections.join(", ")}.`
            : "Back scan matched the front read — nothing to correct.",
      );
      if (result.disagreement) {
        toast.warning("Two reads disagree on this card — pick the correct match.");
      } else {
        toast.success(`Card identified (${result.confidence} confidence). Verify the details.`);
      }
      if (result.parallel_hint) {
        toast.info(`Parallel read off the card: ${result.parallel_hint}`);
      }
      setStep("form");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed";
      // Baseball-only rejection: discard the photo so the user re-uploads.
      if (/only accepts baseball cards/i.test(msg)) {
        setImageDataUrl(null);
        setFrontIdentifyUrl(null);
        toast.error(msg);
        setStep("choose");
      } else {
        toast.error(msg);
        setStep("form");
      }
    } finally {
      setScanning(false);
    }
  }


  // The back of the card carries the printed card number, year, set line and
  // serial numbering — the fields the front scan most often gets wrong. Values
  // read off the back win over the front read.
  async function runBackScan(identifyDataUrl: string) {
    setBackScanning(true);
    try {
      const back = await scanBackFn({ data: { imageDataUrl: identifyDataUrl } });
      const filled: string[] = [];
      setForm((f) => {
        const next = { ...f };
        if (back.card_number && back.card_number !== f.card_number) {
          next.card_number = back.card_number;
          filled.push("card #");
        }
        if (back.year && String(back.year) !== f.year) {
          next.year = String(back.year);
          filled.push("year");
        }
        if (back.set_name && back.set_name !== f.set_name) {
          next.set_name = back.set_name;
          filled.push("set");
        }
        if (back.serial_number) {
          next.is_numbered = true;
          next.serial_number = back.serial_number;
          filled.push("serial");
        }
        if (back.is_rookie === true && !f.is_rookie) {
          next.is_rookie = true;
          filled.push("rookie");
        }
        // Identity fields changed — the catalog link no longer applies.
        if (filled.some((x) => x === "card #" || x === "year" || x === "set")) {
          next.cardsight_card_id = null;
          next.cardsight_parallel_id = null;
        }
        return next;
      });
      if (back.card_number || back.year || back.set_name) {
        setConfidence("high");
      }
      setBackNote(
        filled.length > 0
          ? `Back scan corrected: ${filled.join(", ")}.`
          : "Back scan matched the front read — nothing to correct.",
      );
      toast.success("Back of card read.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Back scan failed");
    } finally {
      setBackScanning(false);
    }
  }

  // The user resolves a disagreement between the two reads: the chosen
  // candidate's fields overwrite the form and become the catalog link.
  function applyCandidate(c: ScanCandidate) {
    setForm((f) => ({
      ...f,
      player_name: c.player_name ?? f.player_name,
      team: c.team ?? "",
      position: c.position ?? "",
      year: c.year != null ? String(c.year) : "",
      set_name: c.set_name ?? "",
      card_number: c.card_number ?? "",
      grade: c.grade ?? "",
      grader: c.grader ?? "",
      cardsight_card_id: c.cardsight_card_id ?? null,
      cardsight_parallel_id: null,
    }));
    setChosenSource(c.source);
    setScanSource(c.source);
    setConfidence("medium");
    toast.success(`Using the ${c.source_label.toLowerCase()}.`);
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
          serial_number: form.is_numbered ? (form.serial_number || null) : null,
          is_autograph: form.is_autograph,
          is_first_bowman: form.is_first_bowman,
          is_rookie: form.is_rookie,
          grade: form.grade || null,
          grader: form.grader || null,
          purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
          notes: form.notes || null,
          photo_path: photoPath,
          mlb_player_id: form.mlb_player_id,
          cardsight_card_id: form.cardsight_card_id,
          cardsight_parallel_id: form.cardsight_parallel_id,
        },
      });

      qc.setQueryData(["cards"], (prev: Card[] | undefined) => {
        const existing = prev ?? [];
        return [created as Card, ...existing.filter((card) => card.id !== created.id)];
      });
      toast.success("Card added. Fetching valuation…");

      // Keep this dialog mounted until valuation and comp persistence finish.
      // Closing here used to unmount the component while its authenticated
      // server-function request was still running, so new cards could appear
      // without comps even though the identical Refresh value action worked.
      try {
        const est = await estimateFn({
          data: {
            player_name: created.player_name,
            year: created.year,
            set_name: created.set_name,
            card_number: created.card_number,
            grade: created.grade,
            grader: created.grader,
            is_autograph: created.is_autograph,
            is_first_bowman: created.is_first_bowman,
            serial_number: created.serial_number,
            cardsight_card_id: created.cardsight_card_id,
            cardsight_parallel_id: created.cardsight_parallel_id,
            cardsight_grade_id: created.cardsight_grade_id,
            card_id: created.id,
            // Match the per-card "Refresh value" path exactly: a brand-new card
            // must never inherit a stale comp cache or failed-lookup cooldown.
            force_refresh: true,
          },
        });
        await replaceValFn({
          data: {
            card_id: created.id,
            current_value: est.current_value,
            value_delta_pct: est.value_delta_pct,
            valuation_error: est.valuation_error ?? false,
            sales: est.sales,
            history: est.history,
          },
        });
        const idPatch: Partial<Card> = {};
        if (!created.cardsight_card_id && est.resolved_cardsight_card_id) {
          idPatch.cardsight_card_id = est.resolved_cardsight_card_id;
        }
        if (!created.cardsight_grade_id && est.resolved_cardsight_grade_id) {
          idPatch.cardsight_grade_id = est.resolved_cardsight_grade_id;
        }
        if (Object.keys(idPatch).length > 0) {
          await updateFn({ data: { id: created.id, patch: idPatch } });
        }
        // Pull the freshly written value + comps into the list/detail views the
        // same way the per-card refresh does.
        await qc.invalidateQueries({ queryKey: ["cards"] });
        onCreated(created.id);
        onClose();
        const soldCount = est.sales.filter((s) => s.source.includes("eBay sold")).length;
        const valued = Number.isFinite(Number(est.current_value)) && Number(est.current_value) > 0;
        if (soldCount > 0) {
          toast.success(`Valued — ${soldCount} sold comp${soldCount === 1 ? "" : "s"}`);
        } else if (est.valuation_error) {
          toast.error("Valuation temporarily unavailable, try again in 10-20 min.");
        } else if (!valued) {
          toast.warning(est.note ?? "No matching sold comps found for this exact card.");
        } else {
          toast.warning("No verified sold comps found — enter a value manually.");
        }
      } catch (e) {
        console.error("Valuation failed", e);
        await qc.invalidateQueries({ queryKey: ["cards"] });
        onCreated(created.id);
        onClose();
        toast.error("Valuation temporarily unavailable, try again in 10-20 min.");
      }
      void updateFn;
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

        {step === "back" && !scanning && (
          <div className="border border-border">
            <div className="p-6 border-b border-border">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Step 2 of 2</p>
              <h3 className="font-extrabold text-lg tracking-tight mb-1">Photo of the back</h3>
              <p className="text-xs text-muted-foreground">
                The back carries the printed card number, year, set line and serial numbering — it's what keeps two
                near-identical parallels apart. Reading both faces together makes identification far more consistent.
              </p>
            </div>
            <div className="p-6 flex flex-col sm:flex-row gap-4 items-start">
              {imageDataUrl && (
                <img
                  src={imageDataUrl}
                  alt="Front of card"
                  className="w-24 border border-border shrink-0"
                />
              )}
              {backPreviewUrl && (
                <img src={backPreviewUrl} alt="Back of card" className="w-24 border border-border shrink-0" />
              )}

              <div className="flex flex-wrap gap-2">
                <label className="text-xs font-mono uppercase tracking-widest bg-foreground text-background px-4 py-2 hover:bg-accent cursor-pointer inline-flex items-center gap-2">
                  <Camera className="size-3" />
                  Add back photo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0], "back")}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => frontIdentifyUrl && runScan(frontIdentifyUrl, null)}
                  className="text-xs font-mono uppercase tracking-widest border border-border px-4 py-2 hover:bg-secondary"
                >
                  Skip — front only
                </button>
              </div>
            </div>
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

            {confidence && (
              <div
                className={`border p-3 space-y-2 ${
                  confidence === "high"
                    ? "border-border"
                    : "border-accent bg-accent/5"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest">
                    Identification confidence
                  </p>
                  <span
                    className={`text-[10px] font-mono font-black uppercase tracking-widest px-2 py-0.5 border ${
                      confidence === "high"
                        ? "border-border text-muted-foreground"
                        : "border-accent text-accent"
                    }`}
                  >
                    {confidence}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {candidates.length > 0 && !chosenSource
                    ? "Two independent reads of this photo disagree on the player. Pick the correct match below — nothing is saved until you do."
                    : confidence === "high"
                      ? "Matched to the catalog. Give the details a quick look before saving."
                      : "Some details couldn't be read reliably. Scan the back of the card or correct the fields below — the card number, year and set drive comp accuracy."}
                </p>
                {scanSource && candidates.length === 0 && (
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Source · {scanSource === "catalog" ? "Catalog match" : "AI photo read"}
                  </p>
                )}

                {candidates.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border border border-border">
                    {candidates.map((c) => {
                      const selected = chosenSource === c.source;
                      return (
                        <button
                          key={c.source}
                          type="button"
                          onClick={() => applyCandidate(c)}
                          className={`bg-background p-3 text-left hover:bg-secondary transition-colors ${
                            selected ? "ring-1 ring-inset ring-accent" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] font-mono font-black uppercase tracking-widest">
                              {c.source_label}
                            </span>
                            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                              {selected ? "Selected" : "Use this"}
                            </span>
                          </div>
                          <p className="text-sm font-extrabold tracking-tight">{c.player_name || "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {[c.year, c.set_name, c.card_number ? `#${c.card_number}` : null]
                              .filter(Boolean)
                              .join(" · ") || "No set details read"}
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground mt-1">
                            {[c.team, c.position].filter(Boolean).join(" · ") || "Team unknown"}
                            {c.cardsight_card_id ? " · catalog linked" : " · no catalog link"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary inline-flex items-center gap-1">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={backScanning}
                      onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0], "back")}
                    />
                    {backScanning ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
                    {backScanning ? "Reading back…" : "Scan back of card"}
                  </label>
                  {candidates.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCandidates([]);
                        setChosenSource(null);
                      }}
                      className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary"
                    >
                      Neither — I'll enter it
                    </button>
                  )}
                  {backNote && <span className="text-[10px] font-mono text-muted-foreground">{backNote}</span>}
                </div>
              </div>
            )}


            <div className="grid grid-cols-2 gap-3">
              <Field label="Player name*" value={form.player_name} onChange={(v) => setForm({ ...form, player_name: v })} />
              <Field label="Team" value={form.team} onChange={(v) => setForm({ ...form, team: v })} />
              <Field label="Year" type="number" value={form.year} onChange={(v) => setForm({ ...form, year: v })} />
              <ApprovedSetSelect
                value={form.set_name}
                onChange={(setName) => setForm({ ...form, set_name: setName ?? "", cardsight_card_id: null, cardsight_parallel_id: null })}
              />
              <Field label="Card #" value={form.card_number} onChange={(v) => setForm({ ...form, card_number: v })} />
              <Field label="Position" value={form.position} onChange={(v) => setForm({ ...form, position: v })} />
              <Field label="Grader (PSA/BGS/SGC)" value={form.grader} onChange={(v) => setForm({ ...form, grader: v })} />
              <Field label="Grade" value={form.grade} onChange={(v) => setForm({ ...form, grade: v })} />
              <Field label="Purchase price (USD)" type="number" value={form.purchase_price} onChange={(v) => setForm({ ...form, purchase_price: v })} />
              <label className="flex flex-col justify-end cursor-pointer">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground invisible">Autographed</span>
                <div className="mt-1 flex items-center gap-2 border border-border px-3 h-10 hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={form.is_autograph}
                    onChange={(e) => setForm({ ...form, is_autograph: e.target.checked })}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Autographed</span>
                </div>
              </label>
              <label className="flex flex-col justify-end cursor-pointer">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground invisible">Rookie</span>
                <div className="mt-1 flex items-center gap-2 border border-border px-3 h-10 hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={form.is_rookie}
                    onChange={(e) => setForm({ ...form, is_rookie: e.target.checked })}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Rookie card</span>
                </div>
              </label>
              <label className="flex flex-col justify-end cursor-pointer">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground invisible">1st Bowman</span>
                <div className="mt-1 flex items-center gap-2 border border-border px-3 h-10 hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={form.is_first_bowman}
                    onChange={(e) => setForm({ ...form, is_first_bowman: e.target.checked })}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-widest">1st Bowman</span>
                </div>
              </label>
            </div>


            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="cursor-pointer">
                <div className="flex h-10 items-center gap-2 border border-border px-3 hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={form.is_numbered}
                    onChange={(e) => setForm({ ...form, is_numbered: e.target.checked })}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Numbered card</span>
                </div>
              </label>
              {form.is_numbered && (
                <input
                  type="text"
                  placeholder='Serial (e.g. "1/50")'
                  value={form.serial_number}
                  onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  className="h-10 w-full border border-border bg-background px-3 text-sm rounded-sm focus:outline-none focus:border-accent"
                />
              )}
            </div>

            <CatalogLinkPicker
              cardId={form.cardsight_card_id}
              lookup={form}
              onLink={(id) => setForm({ ...form, cardsight_card_id: id, cardsight_parallel_id: null })}
            />

            <ParallelSelect
              cardId={form.cardsight_card_id}
              lookup={form}
              value={form.cardsight_parallel_id}
              onChange={(id) => setForm({ ...form, cardsight_parallel_id: id })}
            />




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
                disabled={saving || (candidates.length > 0 && !chosenSource)}
                title={candidates.length > 0 && !chosenSource ? "Pick the correct match first" : undefined}
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-10 px-3 border border-border rounded-sm text-sm bg-background focus:outline-none focus:border-accent"
      />
    </label>
  );
}

function cardDescriptor(card: {
  player_name?: string | null;
  year?: string | number | null;
  set_name?: string | null;
  card_number?: string | null;
}) {
  return [card.year, card.set_name, card.player_name, card.card_number ? `#${card.card_number}` : null]
    .filter(Boolean)
    .join(" ");
}

function ApprovedSetSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (setName: string | null) => void;
}) {
  const approvedValue = APPROVED_CARD_SETS.includes(value as (typeof APPROVED_CARD_SETS)[number]) ? value : "";
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Set</span>
      <select
        value={approvedValue}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 w-full h-10 px-3 border border-border rounded-sm text-sm bg-background focus:outline-none focus:border-accent"
      >
        <option value="">Select set</option>
        {APPROVED_CARD_SETS.map((setName) => (
          <option key={setName} value={setName}>
            {setName}
          </option>
        ))}
      </select>
      {value && !approvedValue && (
        <span className="text-[9px] font-mono text-muted-foreground">
          Current set is not approved. Choose one from the list before saving.
        </span>
      )}
    </label>
  );
}

function ParallelSelect({
  cardId,
  lookup,
  value,
  onChange,
}: {
  cardId: string | null;
  lookup: {
    player_name?: string | null;
    year?: string | number | null;
    set_name?: string | null;
    card_number?: string | null;
  };
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const listFn = useServerFn(listCardsightParallels);
  const descriptor = cardDescriptor(lookup);
  const canLookup = !!cardId;
  const q = useQuery({
    queryKey: ["cardsight-parallels-v3", cardId],
    queryFn: () => listFn({
      data: {
        card_id: cardId,
        descriptor,
        player_name: lookup.player_name ?? null,
        year: lookup.year ?? null,
        set_name: lookup.set_name ?? null,
        card_number: lookup.card_number ?? null,
      },
    }),
    enabled: canLookup,
    staleTime: 60 * 60 * 1000,
  });
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        Parallel / Refractor
      </span>
      <select
        value={value ?? ""}
        disabled={!canLookup || q.isLoading}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 w-full h-10 px-3 border border-border rounded-sm text-sm bg-background focus:outline-none focus:border-accent"
      >
        <option value="">Base card</option>
        {(q.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {q.isLoading && (
        <span className="text-[9px] font-mono text-muted-foreground">Loading scoped parallel/refractor options…</span>
      )}
      {!canLookup && (
        <span className="text-[9px] font-mono text-muted-foreground">
          Link this card to the catalog above to choose a parallel/refractor.
        </span>
      )}

      {canLookup && !q.isLoading && (q.data?.length ?? 0) === 0 && (
        <span className="text-[9px] font-mono text-muted-foreground">
          No scoped parallel/refractor options found for this set.
        </span>
      )}
    </label>
  );
}

type CatalogCandidate = Awaited<ReturnType<typeof searchCardsightCards>>[number];

// Manual catalog link. When automatic identification misses (or was never
// resolved), the user searches the catalog with whatever details are in the
// form and picks the exact card. Linking sets the catalog id, which is what
// the parallel/refractor picker and verified comps depend on.
function CatalogLinkPicker({
  cardId,
  lookup,
  onLink,
}: {
  cardId: string | null;
  lookup: {
    player_name?: string | null;
    year?: string | number | null;
    set_name?: string | null;
    card_number?: string | null;
    serial_number?: string | null;
  };
  onLink: (id: string | null) => void;
}) {
  const searchFn = useServerFn(searchCardsightCards);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CatalogCandidate[] | null>(null);

  async function run() {
    if (!String(lookup.player_name ?? "").trim()) {
      toast.error("Enter a player name first");
      return;
    }
    setOpen(true);
    setBusy(true);
    try {
      const r = await searchFn({
        data: {
          player_name: lookup.player_name ?? null,
          year: lookup.year ?? null,
          set_name: lookup.set_name ?? null,
          card_number: lookup.card_number ?? null,
          descriptor: cardDescriptor(lookup),
        },
      });
      setResults(r);
    } catch {
      toast.error("Catalog search failed");
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Catalog match {cardId ? "· linked" : "· not linked"}
        </p>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary disabled:opacity-50 inline-flex items-center gap-1"
        >
          {busy && <Loader2 className="size-3 animate-spin" />}
          Find in catalog
        </button>
      </div>
      <p className="mt-1 text-[9px] font-mono text-muted-foreground">
        {cardId
          ? "This card is linked to the catalog — parallels and verified comps are available."
          : "Not linked yet. Search and pick the exact card to enable parallels and verified comps."}
      </p>
      {open && (
        <div className="mt-3 space-y-1 max-h-56 overflow-y-auto">
          {busy && <p className="text-[10px] font-mono text-muted-foreground">Searching catalog…</p>}
          {!busy && results?.length === 0 && (
            <p className="text-[10px] font-mono text-muted-foreground">
              No catalog matches. Try adjusting the year, set or card number.
            </p>
          )}
          {!busy &&
            (results ?? []).map((r) => {
              const active = r.card_id === cardId;
              return (
                <button
                  key={r.card_id}
                  type="button"
                  onClick={() => {
                    onLink(r.card_id);
                    setOpen(false);
                  }}
                  className={`w-full text-left border px-2 py-1.5 text-xs hover:bg-secondary ${
                    active ? "border-accent" : "border-border"
                  }`}
                >
                  <span className="font-bold">{r.player_name ?? "Unknown player"}</span>
                  <span className="block text-[10px] font-mono text-muted-foreground">
                    {[r.year, r.set_name, r.subset_name && r.subset_name !== r.set_name ? r.subset_name : null, r.card_number ? `#${r.card_number}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                    {r.parallel_count > 0 ? ` · ${r.parallel_count} parallels` : ""}
                  </span>
                </button>
              );
            })}
          {cardId && (
            <button
              type="button"
              onClick={() => {
                onLink(null);
                setOpen(false);
              }}
              className="w-full text-left border border-border px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest hover:bg-secondary"
            >
              Unlink catalog match
            </button>
          )}
        </div>
      )}
    </div>
  );
}


