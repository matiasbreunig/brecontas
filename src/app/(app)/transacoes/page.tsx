"use client";

import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useMonth } from "@/hooks/use-month";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { useAutoSave } from "@/hooks/use-auto-save";
import { formatBRL, formatBRLCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { ImportSheet } from "@/components/transactions/import-sheet";
import { TransactionSpotlight, type TransactionFilters } from "@/components/transactions/transaction-spotlight";
import { BeneficiaryCombobox } from "@/components/beneficiary-combobox";
import { CategoryCombobox } from "@/components/category-combobox";
import { TagMultiSelect, getTagStyle } from "@/components/tag-multi-select";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { todayISO } from "@/lib/date";
import {
  Plus,
  Upload,
  ChevronLeft,
  ChevronRight,
  Zap,
  Circle,
  CircleAlert,
  CircleDot,
  CircleCheck,
  Ban,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Undo2,
  Sparkles,
  Square,
  CheckSquare,
  X,
} from "lucide-react";
import {
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type TransactionStatus,
  type TransactionType,
  type PaymentMethod,
} from "@/lib/constants";

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

type Tab = "pendentes" | "todos" | "conciliados" | "excluidos";

const TAB_STATUS_MAP: Record<Tab, TransactionStatus[]> = {
  pendentes: ["draft", "unrecognized", "identified"],
  todos: ["draft", "unrecognized", "identified", "reconciled"],
  conciliados: ["reconciled"],
  excluidos: ["discarded"],
};

const TAB_CONFIG: { id: Tab; label: string; countKey: (counts: Record<string, number>) => number }[] = [
  {
    id: "pendentes",
    label: "Pendentes",
    countKey: (c) => (c.draft ?? 0) + (c.unrecognized ?? 0) + (c.identified ?? 0),
  },
  {
    id: "todos",
    label: "Todos",
    countKey: (c) => (c.draft ?? 0) + (c.unrecognized ?? 0) + (c.identified ?? 0) + (c.reconciled ?? 0),
  },
  {
    id: "conciliados",
    label: "Conciliados",
    countKey: (c) => c.reconciled ?? 0,
  },
  {
    id: "excluidos",
    label: "Excluídos",
    countKey: (c) => c.discarded ?? 0,
  },
];

const STATUS_ICON_MAP: Record<TransactionStatus, { icon: typeof Circle; color: string }> = {
  draft: { icon: Circle, color: "text-slate-400" },
  unrecognized: { icon: CircleAlert, color: "text-amber-500" },
  identified: { icon: CircleDot, color: "text-blue-500" },
  reconciled: { icon: CircleCheck, color: "text-emerald-500" },
  discarded: { icon: Ban, color: "text-red-400" },
};

const TYPE_ICON_MAP: Record<TransactionType, typeof ArrowUpRight> = {
  income: ArrowUpRight,
  expense: ArrowDownRight,
  transfer: ArrowLeftRight,
  refund: RotateCcw,
};

const DISCARD_REASONS = [
  { value: "duplicate", label: "Duplicata" },
  { value: "error", label: "Erro" },
  { value: "irrelevant", label: "Irrelevante" },
  { value: "merged", label: "Mesclado" },
] as const;

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function TransacoesPage() {
  // State
  const [tab, setTab] = useState<Tab>("pendentes");
  const [filters, setFilters] = useState<TransactionFilters>({ search: "" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [showNewTx, setShowNewTx] = useState(false);
  const [dateField, setDateField] = useState<"date" | "competenceDate">("date");

  // Month context
  const { month, dateFrom, dateTo, prevMonth, nextMonth, isCurrentMonth, goToToday } = useMonth();
  const monthLabel = format(month, "MMMM yyyy", { locale: ptBR });

  // Queries
  const utils = trpc.useUtils();

  const { data: txData, isLoading } = trpc.transactions.list.useQuery({
    dateFrom: filters.dateFrom ?? dateFrom,
    dateTo: filters.dateTo ?? dateTo,
    dateField,
    statusIn: TAB_STATUS_MAP[tab],
    categoryId: filters.categoryId,
    beneficiaryId: filters.beneficiaryId,
    accountId: filters.accountId,
    cardId: filters.cardId,
    type: filters.type as TransactionType | undefined,
    paymentMethod: filters.paymentMethod as "pix" | "debit" | "credit" | "transfer" | "boleto" | "cash" | "other" | undefined,
    amountMin: filters.amountMin,
    amountMax: filters.amountMax,
    limit: 200,
  });

  const { data: counts } = trpc.transactions.statusCounts.useQuery({ dateFrom, dateTo, dateField });

  const { data: accounts } = trpc.accounts.list.useQuery();
  const { data: categories } = trpc.categories.list.useQuery();
  const { data: beneficiaries } = trpc.beneficiaries.list.useQuery();
  const { data: tags } = trpc.tags.list.useQuery();
  const { data: cards } = trpc.cards.list.useQuery();

  // Mutations
  const invalidateAll = useCallback(() => {
    utils.transactions.list.invalidate();
    utils.transactions.statusCounts.invalidate();
    utils.transactions.stats.invalidate();
  }, [utils]);


  const { pushAction } = useUndoRedo();

  const deleteTx = trpc.transactions.delete.useMutation({
    onSuccess: () => {
      invalidateAll();
    },
  });

  const restoreTx = trpc.transactions.restore.useMutation({
    onSuccess: () => {
      invalidateAll();
    },
  });

  const reconcileSingle = trpc.reconciliation.reconcile.useMutation({
    onSuccess: () => {
      invalidateAll();
    },
  });

  const bulkReconcile = trpc.reconciliation.bulkReconcile.useMutation({
    onSuccess: (data) => {
      invalidateAll();
      setSelectedIds(new Set());
      toast.success(`${data.count} transações conciliadas`);
    },
  });

  // Action wrappers that push to undo stack
  const handleReconcile = useCallback(
    (tx: TransactionWithTags) => {
      const oldStatus = tx.status;
      reconcileSingle.mutate(
        { transactionId: tx.id, createRule: false },
        {
          onSuccess: () => {
            pushAction({
              type: "status_change",
              entityType: "transactions",
              entityId: tx.id,
              oldValues: { status: oldStatus },
              newValues: { status: "reconciled" },
              description: "Transação conciliada",
              timestamp: Date.now(),
            });
            toast.success("Conciliada", { id: "auto-save", duration: 1500 });
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleDiscard = useCallback(
    (tx: TransactionWithTags, reason: string) => {
      const oldStatus = tx.status;
      deleteTx.mutate(
        { id: tx.id, reason: reason as "duplicate" | "error" | "irrelevant" | "merged" },
        {
          onSuccess: () => {
            pushAction({
              type: "status_change",
              entityType: "transactions",
              entityId: tx.id,
              oldValues: { status: oldStatus },
              newValues: { status: "discarded", discardReason: reason },
              description: "Transação descartada",
              timestamp: Date.now(),
            });
            toast("Transação descartada", { id: "auto-save", duration: 3000 });
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleRestore = useCallback(
    (tx: TransactionWithTags) => {
      restoreTx.mutate(
        { id: tx.id },
        {
          onSuccess: () => {
            pushAction({
              type: "status_change",
              entityType: "transactions",
              entityId: tx.id,
              oldValues: { status: "discarded" },
              newValues: { status: tx.status === "discarded" ? "draft" : tx.status },
              description: "Transação restaurada",
              timestamp: Date.now(),
            });
            toast.success("Transação restaurada", { id: "auto-save", duration: 1500 });
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const applyRules = trpc.reconciliation.applyRules.useMutation({
    onSuccess: (data) => {
      invalidateAll();
      toast.success(`${data.matched} transações classificadas`);
    },
  });

  const createTx = trpc.transactions.create.useMutation({
    onSuccess: () => {
      invalidateAll();
      setShowNewTx(false);
      toast.success("Transação criada");
    },
  });

  const createBeneficiary = trpc.beneficiaries.create.useMutation({
    onSuccess: (data) => {
      utils.beneficiaries.list.invalidate();
      return data; // { id }
    },
  });

  const createTag = trpc.tags.create.useMutation({
    onSuccess: (data) => {
      utils.tags.list.invalidate();
      return data; // { id }
    },
  });

  // Async wrappers that return the new ID
  const handleCreateBeneficiary = useCallback(
    async (name: string) => {
      const result = await createBeneficiary.mutateAsync({ name });
      return result.id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleCreateTag = useCallback(
    async (name: string) => {
      const result = await createTag.mutateAsync({ name });
      return result.id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Computed
  const filteredItems = useMemo(() => {
    if (!txData?.items) return [];
    const s = filters.search.toLowerCase();
    let items = txData.items;

    // Client-side text search
    if (s) {
      items = items.filter(
        (tx) =>
          tx.description?.toLowerCase().includes(s) ||
          tx.beneficiary?.name?.toLowerCase().includes(s) ||
          tx.category?.name?.toLowerCase().includes(s),
      );
    }

    // Client-side tag filter (server doesn't support tag filtering)
    if (filters.tagIds?.length) {
      items = items.filter((tx) => {
        const txTagIds = (tx as TransactionWithTags).transactionTags?.map((tt: { tag: { id: string } }) => tt.tag.id) ?? [];
        return filters.tagIds!.every((tid) => txTagIds.includes(tid));
      });
    }

    return items;
  }, [txData?.items, filters.search, filters.tagIds]);

  const dateGroups = useMemo(() => {
    const groups = new Map<string, typeof filteredItems>();
    for (const tx of filteredItems) {
      const key = dateField === "competenceDate" ? (tx.competenceDate || tx.date) : tx.date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(tx);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredItems]);

  // Selection handlers
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const selectable = filteredItems.filter(
      (tx) => tx.status !== "reconciled" && tx.status !== "discarded",
    );
    if (selectedIds.size === selectable.length && selectable.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map((tx) => tx.id)));
    }
  }

  const pendingCount = counts
    ? (counts.draft ?? 0) + (counts.unrecognized ?? 0) + (counts.identified ?? 0)
    : 0;

  // High-confidence transactions that can be batch-confirmed
  const highConfidenceIds = useMemo(() => {
    if (!filteredItems || tab !== "pendentes") return [];
    return filteredItems
      .filter(
        (tx) =>
          tx.status !== "reconciled" &&
          tx.status !== "discarded" &&
          (tx as TransactionWithTags).confidence !== null &&
          (tx as TransactionWithTags).confidence !== undefined &&
          ((tx as TransactionWithTags).confidence ?? 0) >= 0.85 &&
          ((tx as TransactionWithTags).categoryId || (tx as TransactionWithTags).beneficiaryId),
      )
      .map((tx) => tx.id);
  }, [filteredItems, tab]);

  return (
    <div className="space-y-4">
      {/* ================================================================ */}
      {/* HEADER                                                           */}
      {/* ================================================================ */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Transações</h1>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => setShowImport(true)}
            className="min-h-[44px]"
          >
            <Upload className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Importar</span>
          </Button>
          <Button onClick={() => setShowNewTx(true)} className="min-h-[44px]">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Nova</span>
          </Button>
        </div>
      </div>

      {/* ================================================================ */}
      {/* MONTH NAVIGATION                                                 */}
      {/* ================================================================ */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={prevMonth} className="h-8 w-8">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium capitalize min-w-[140px] text-center">
          {monthLabel}
        </span>
        <Button variant="ghost" size="icon" onClick={nextMonth} className="h-8 w-8">
          <ChevronRight className="h-4 w-4" />
        </Button>
        {!isCurrentMonth && (
          <Button variant="ghost" size="sm" onClick={goToToday} className="text-xs h-7">
            Hoje
          </Button>
        )}
        {/* Caixa / Competência toggle */}
        <div className="ml-auto flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5">
          <button
            onClick={() => setDateField("date")}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
              dateField === "date"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Caixa
          </button>
          <button
            onClick={() => setDateField("competenceDate")}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
              dateField === "competenceDate"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Competência
          </button>
        </div>
      </div>

      {/* ================================================================ */}
      {/* TABS                                                              */}
      {/* ================================================================ */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 overflow-x-auto">
        {TAB_CONFIG.map((t) => {
          const count = counts ? t.countKey(counts) : undefined;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setSelectedIds(new Set());
                setExpandedId(null);
              }}
              className={cn(
                "flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    "ml-1.5 tabular-nums text-xs",
                    isActive ? "text-foreground/70" : "text-muted-foreground/70",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ================================================================ */}
      {/* SPOTLIGHT SEARCH + ACTIONS                                        */}
      {/* ================================================================ */}
      <div className="flex gap-2 items-start">
        <TransactionSpotlight
          filters={filters}
          onFiltersChange={setFilters}
          categories={categories?.filter((c) => c.isActive) ?? []}
          beneficiaries={beneficiaries ?? []}
          accounts={accounts?.filter((a) => a.isActive) ?? []}
          cards={cards?.filter((c) => c.isActive) ?? []}
          tags={tags ?? []}
          transactions={txData?.items ?? []}
        />
        {tab === "pendentes" && pendingCount > 0 && (
          <div className="flex gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="icon"
              onClick={() => applyRules.mutate({})}
              disabled={applyRules.isPending}
              title="Aplicar regras de classificação"
              className="min-h-[44px] min-w-[44px]"
            >
              <Zap className="h-4 w-4" />
            </Button>
            {highConfidenceIds.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkReconcile.mutate({ transactionIds: highConfidenceIds })}
                disabled={bulkReconcile.isPending}
                title={`Confirmar ${highConfidenceIds.length} transações com alta confiança (≥85%)`}
                className="min-h-[44px] text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-950/30"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                Confirmar ({highConfidenceIds.length})
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Bulk select bar */}
      {tab === "pendentes" && filteredItems.length > 0 && (
        <div className="flex items-center gap-2 justify-between">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {selectedIds.size > 0 &&
            selectedIds.size ===
              filteredItems.filter((tx) => tx.status !== "reconciled" && tx.status !== "discarded")
                .length ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            {selectedIds.size > 0
              ? `${selectedIds.size} selecionada${selectedIds.size > 1 ? "s" : ""}`
              : "Selecionar"}
          </button>
          {selectedIds.size > 0 && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedIds(new Set())}
                className="h-8 text-xs"
              >
                Limpar
              </Button>
              <Button
                size="sm"
                onClick={() => bulkReconcile.mutate({ transactionIds: [...selectedIds] })}
                disabled={bulkReconcile.isPending}
                className="h-8 text-xs"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Conciliar ({selectedIds.size})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TRANSACTION LIST                                                  */}
      {/* ================================================================ */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Carregando...</div>
      ) : dateGroups.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {filters.search || filters.categoryId || filters.beneficiaryId || filters.tagIds?.length
              ? "Nenhuma transação encontrada para estes filtros."
              : tab === "excluidos"
                ? "Nenhuma transação descartada neste mês."
                : tab === "pendentes"
                  ? "Nenhuma transação pendente. Tudo conciliado!"
                  : "Nenhuma transação neste mês."}
          </p>
          {!filters.search && !filters.categoryId && tab !== "excluidos" && (
            <div className="mt-4 flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Importar extrato
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowNewTx(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Nova transação
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {dateGroups.map(([dateKey, txs]) => {
            const dayTotal = txs.reduce((sum, tx) => {
              if (tx.type === "income" || tx.type === "refund") return sum + tx.amount;
              if (tx.type === "expense") return sum - tx.amount;
              return sum;
            }, 0);

            return (
              <div key={dateKey}>
                {/* Date header */}
                <div className="flex items-center justify-between px-1 py-2">
                  <span className="text-xs font-medium text-muted-foreground capitalize">
                    {format(parseISO(dateKey), "EEEE, d 'de' MMMM", { locale: ptBR })}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-mono tabular-nums",
                      dayTotal >= 0 ? "text-emerald-600" : "text-red-500",
                    )}
                  >
                    {dayTotal >= 0 ? "+" : "-"}
                    {formatBRLCompact(Math.abs(dayTotal))}
                  </span>
                </div>

                {/* Transactions */}
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border">
                      {txs.map((tx) => (
                        <TransactionRow
                          key={tx.id}
                          tx={tx as TransactionWithTags}
                          tab={tab}
                          expanded={expandedId === tx.id}
                          selected={selectedIds.has(tx.id)}
                          onToggleExpand={() =>
                            setExpandedId(expandedId === tx.id ? null : tx.id)
                          }
                          onToggleSelect={() => toggleSelect(tx.id)}
                          onReconcile={() => handleReconcile(tx as TransactionWithTags)}
                          onDiscard={(reason) => handleDiscard(tx as TransactionWithTags, reason)}
                          onRestore={() => handleRestore(tx as TransactionWithTags)}
                          categories={categories?.filter((c) => c.isActive) ?? []}
                          beneficiaries={beneficiaries ?? []}
                          accounts={accounts?.filter((a) => a.isActive) ?? []}
                          tags={tags ?? []}
                          onCreateBeneficiary={handleCreateBeneficiary}
                          onCreateTag={handleCreateTag}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {/* Result count */}
      {txData && !isLoading && dateGroups.length > 0 && (
        <p className="text-xs text-muted-foreground text-center tabular-nums">
          {filteredItems.length} transação{filteredItems.length !== 1 ? "ões" : ""} neste mês
        </p>
      )}

      {/* ================================================================ */}
      {/* FLOATING BULK BAR (mobile)                                        */}
      {/* ================================================================ */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-4 right-4 sm:hidden z-30">
          <div className="bg-primary text-primary-foreground rounded-2xl shadow-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium">{selectedIds.size} selecionadas</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSelectedIds(new Set())}
                className="min-h-[44px]"
              >
                Limpar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  bulkReconcile.mutate({ transactionIds: [...selectedIds] })
                }
                disabled={bulkReconcile.isPending}
                className="min-h-[44px]"
              >
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Conciliar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* IMPORT SHEET                                                      */}
      {/* ================================================================ */}
      <ImportSheet
        open={showImport}
        onOpenChange={setShowImport}
        onComplete={() => invalidateAll()}
      />

      {/* ================================================================ */}
      {/* NEW TRANSACTION DIALOG                                            */}
      {/* ================================================================ */}
      <NewTransactionDialog
        open={showNewTx}
        onOpenChange={setShowNewTx}
        accounts={accounts?.filter((a) => a.isActive) ?? []}
        categories={categories?.filter((c) => c.isActive) ?? []}
        beneficiaries={beneficiaries ?? []}
        tags={tags ?? []}
        onSubmit={(data) => createTx.mutate(data)}
        isPending={createTx.isPending}
        onCreateBeneficiary={handleCreateBeneficiary}
        onCreateTag={handleCreateTag}
      />
    </div>
  );
}

// ============================================================================
// TYPE for transaction with tags
// ============================================================================

interface TransactionWithTags {
  id: string;
  type: string;
  amount: number;
  date: string;
  description: string | null;
  status: string;
  source: string | null;
  paymentMethod: string | null;
  notes: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  accountId: string | null;
  transferAccountId: string | null;
  competenceDate: string | null;
  categoryId: string | null;
  beneficiaryId: string | null;
  confidence: number | null;
  account: { id: string; name: string } | null;
  transferAccount: { id: string; name: string } | null;
  card: { id: string; name: string } | null;
  beneficiary: { id: string; name: string } | null;
  category: { id: string; name: string; icon: string | null; color: string | null } | null;
  transactionTags?: { tag: { id: string; name: string; color: string | null; icon: string | null } }[];
}

// ============================================================================
// TRANSACTION ROW
// ============================================================================

interface TransactionRowProps {
  tx: TransactionWithTags;
  tab: Tab;
  expanded: boolean;
  selected: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onReconcile: () => void;
  onDiscard: (reason: string) => void;
  onRestore: () => void;
  categories: { id: string; name: string; icon: string | null }[];
  beneficiaries: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  tags: { id: string; name: string; color: string | null; icon: string | null }[];
  onCreateBeneficiary: (name: string) => Promise<string>;
  onCreateTag: (name: string) => Promise<string>;
}

function TransactionRow({
  tx,
  tab,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  onReconcile,
  onDiscard,
  onRestore,
  categories,
  beneficiaries,
  accounts,
  tags,
  onCreateBeneficiary,
  onCreateTag,
}: TransactionRowProps) {
  const status = tx.status as TransactionStatus;
  const type = tx.type as TransactionType;
  const isPositive = type === "income" || type === "refund";
  const isPending = status !== "reconciled" && status !== "discarded";
  const isDiscarded = status === "discarded";
  // Confidence-based inference display:
  // - High confidence (≥0.8): solid colored badge (system is confident)
  // - Medium confidence (0.4-0.8): dashed border + sparkle (suggestion)
  // - No confidence or reconciled: solid regular badge
  const hasConfidence = (tx.confidence ?? 0) > 0;
  const isInferred = status !== "reconciled" && status !== "discarded" && hasConfidence;
  const isHighConfidence = (tx.confidence ?? 0) >= 0.85;

  const StatusIconComp = STATUS_ICON_MAP[status]?.icon ?? Circle;
  const statusColor = STATUS_ICON_MAP[status]?.color ?? "text-slate-400";

  const txTags = tx.transactionTags?.map((tt) => tt.tag) ?? [];

  return (
    <div className={cn(selected && "bg-primary/5")}>
      {/* Main row */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2.5 transition-colors",
          !isDiscarded && "hover:bg-muted/50 cursor-pointer",
          isDiscarded && "opacity-60",
        )}
      >
        {/* Selection checkbox (pending tab only) */}
        {tab === "pendentes" && isPending && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            className="shrink-0 min-h-[44px] min-w-[36px] flex items-center justify-center -ml-1"
          >
            {selected ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        )}

        {/* Status icon */}
        <button
          onClick={onToggleExpand}
          className="shrink-0 flex items-center justify-center w-6"
          title={TRANSACTION_STATUS_LABELS[status]}
        >
          <StatusIconComp className={cn("h-4 w-4", statusColor)} />
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0" onClick={onToggleExpand}>
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm truncate">
              {tx.description || tx.beneficiary?.name || "Sem descrição"}
            </span>
            {tx.installmentCurrent && tx.installmentTotal && (
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {tx.installmentCurrent}/{tx.installmentTotal}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {/* Category badge with confidence styling */}
            {tx.category && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md",
                  isInferred && !isHighConfidence
                    ? "border border-dashed border-blue-300 text-blue-600 bg-blue-50/50 dark:border-blue-700 dark:text-blue-400 dark:bg-blue-950/30"
                    : isInferred && isHighConfidence
                      ? "border border-solid border-purple-300 text-purple-600 bg-purple-50/50 dark:border-purple-700 dark:text-purple-400 dark:bg-purple-950/30"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                )}
              >
                {isInferred && <Sparkles className="h-2.5 w-2.5" />}
                {tx.category.icon && <span>{tx.category.icon}</span>}
                {tx.category.name}
              </span>
            )}
            {/* Tags */}
            {txTags.map((tag) => {
              const style = getTagStyle(tag.color);
              return (
                <span
                  key={tag.id}
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border",
                    style.bg, style.text, style.border,
                  )}
                >
                  {tag.icon && <span>{tag.icon}</span>}
                  {tag.name}
                </span>
              );
            })}
            {/* Beneficiary */}
            {tx.beneficiary && (
              <span className={cn(
                "text-[10px] truncate max-w-[120px]",
                isInferred && !isHighConfidence
                  ? "text-muted-foreground/70 italic"
                  : "text-muted-foreground",
              )}>
                {isInferred && !isHighConfidence && <Sparkles className="h-2 w-2 inline mr-0.5" />}
                {tx.beneficiary.name}
              </span>
            )}
            {/* Account/card — transfers show origin → destination */}
            <span className="text-[10px] text-muted-foreground/60 hidden sm:inline">
              {tx.type === "transfer" && tx.transferAccount ? (
                <>{tx.account?.name} → {tx.transferAccount.name}</>
              ) : (
                tx.card?.name || tx.account?.name
              )}
            </span>
          </div>
        </div>

        {/* Amount */}
        <div className="text-right shrink-0" onClick={onToggleExpand}>
          <span
            className={cn(
              "font-mono text-sm font-semibold tabular-nums",
              isDiscarded
                ? "text-muted-foreground line-through"
                : isPositive
                  ? "text-emerald-600"
                  : "text-foreground",
            )}
          >
            {isPositive ? "+" : "-"}
            {formatBRLCompact(tx.amount)}
          </span>
        </div>

        {/* Quick action */}
        <div className="shrink-0 ml-1">
          {isPending && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReconcile();
              }}
              className="rounded-lg p-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors text-muted-foreground hover:text-emerald-600 min-h-[36px] min-w-[36px] flex items-center justify-center"
              title="Conciliar"
            >
              <CheckCircle2 className="h-4 w-4" />
            </button>
          )}
          {isDiscarded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRestore();
              }}
              className="rounded-lg p-2 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-muted-foreground hover:text-blue-600 min-h-[36px] min-w-[36px] flex items-center justify-center"
              title="Restaurar"
            >
              <Undo2 className="h-4 w-4" />
            </button>
          )}
          {status === "reconciled" && (
            <div className="min-h-[36px] min-w-[36px] flex items-center justify-center">
              <CircleCheck className="h-4 w-4 text-emerald-500/40" />
            </div>
          )}
        </div>
      </div>

      {/* Expanded edit panel */}
      {expanded && (
        <TransactionEditPanel
          tx={tx}
          categories={categories}
          beneficiaries={beneficiaries}
          accounts={accounts}
          tags={tags}
          onReconcile={onReconcile}
          onDiscard={onDiscard}
          onRestore={onRestore}
          onClose={onToggleExpand}
          isPending={isPending}
          isDiscarded={isDiscarded}
          onCreateBeneficiary={onCreateBeneficiary}
          onCreateTag={onCreateTag}
        />
      )}
    </div>
  );
}

// ============================================================================
// TRANSACTION EDIT PANEL (inline expansion)
// ============================================================================

interface TransactionEditPanelProps {
  tx: TransactionWithTags;
  categories: { id: string; name: string; icon: string | null }[];
  beneficiaries: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  tags: { id: string; name: string; color: string | null; icon: string | null }[];
  onReconcile: () => void;
  onDiscard: (reason: string) => void;
  onRestore: () => void;
  onClose: () => void;
  isPending: boolean;
  isDiscarded: boolean;
  onCreateBeneficiary: (name: string) => Promise<string>;
  onCreateTag: (name: string) => Promise<string>;
}

function TransactionEditPanel({
  tx,
  categories,
  beneficiaries,
  accounts,
  tags,
  onReconcile,
  onDiscard,
  onRestore,
  onClose,
  isPending,
  isDiscarded,
  onCreateBeneficiary,
  onCreateTag,
}: TransactionEditPanelProps) {
  const utils = trpc.useUtils();
  const updateTx = trpc.transactions.update.useMutation({
    onSuccess: () => {
      utils.transactions.invalidate();
    },
  });

  const saveTxField = useCallback(
    (field: string) =>
      async (value: unknown) => {
        const data: Record<string, unknown> = {
          id: tx.id,
          [field]: value || null,
        };
        // Auto-upgrade status when category or beneficiary is set on a pending transaction
        if (
          isPending &&
          (field === "categoryId" || field === "beneficiaryId") &&
          value &&
          tx.status !== "identified"
        ) {
          data.status = "identified";
        }
        await updateTx.mutateAsync(
          data as Parameters<typeof updateTx.mutateAsync>[0],
        );
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tx.id, tx.status, isPending],
  );

  const saveTagIds = useCallback(
    async (tagIds: string[]) => {
      await updateTx.mutateAsync({
        id: tx.id,
        tagIds,
      } as Parameters<typeof updateTx.mutateAsync>[0]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tx.id],
  );

  // Auto-save hooks per field
  const category = useAutoSave({
    entityType: "transactions",
    entityId: tx.id,
    field: "categoryId",
    serverValue: tx.categoryId ?? "",
    save: saveTxField("categoryId"),
    debounceMs: 0,
    description: "Categoria alterada",
    extraValues: (val) =>
      isPending && val && tx.status !== "identified"
        ? {
            oldExtra: { status: tx.status },
            newExtra: { status: "identified" },
          }
        : {},
  });

  const beneficiary = useAutoSave({
    entityType: "transactions",
    entityId: tx.id,
    field: "beneficiaryId",
    serverValue: tx.beneficiaryId ?? "",
    save: saveTxField("beneficiaryId"),
    debounceMs: 0,
    description: "Favorecido alterado",
    extraValues: (val) =>
      isPending && val && tx.status !== "identified"
        ? {
            oldExtra: { status: tx.status },
            newExtra: { status: "identified" },
          }
        : {},
  });

  const paymentMethod = useAutoSave({
    entityType: "transactions",
    entityId: tx.id,
    field: "paymentMethod",
    serverValue: tx.paymentMethod ?? "",
    save: saveTxField("paymentMethod"),
    debounceMs: 0,
    description: "Meio de pagamento alterado",
  });

  const accountId = useAutoSave({
    entityType: "transactions",
    entityId: tx.id,
    field: "accountId",
    serverValue: tx.accountId ?? "",
    save: saveTxField("accountId"),
    debounceMs: 0,
    description: "Conta alterada",
  });

  const transferAccountId = useAutoSave({
    entityType: "transactions",
    entityId: tx.id,
    field: "transferAccountId",
    serverValue: tx.transferAccountId ?? "",
    save: saveTxField("transferAccountId"),
    debounceMs: 0,
    description: "Conta destino alterada",
  });

  const isTransfer = tx.type === "transfer";

  const description = useAutoSave({
    entityType: "transactions",
    entityId: tx.id,
    field: "description",
    serverValue: tx.description ?? "",
    save: saveTxField("description"),
    debounceMs: 400,
    description: "Descrição alterada",
  });

  const notes = useAutoSave({
    entityType: "transactions",
    entityId: tx.id,
    field: "notes",
    serverValue: tx.notes ?? "",
    save: saveTxField("notes"),
    debounceMs: 400,
    description: "Observações alteradas",
  });

  const serverTagIds = useMemo(
    () => tx.transactionTags?.map((tt) => tt.tag.id) ?? [],
    [tx.transactionTags],
  );

  const tagIds = useAutoSave<string[]>({
    entityType: "transactions",
    entityId: tx.id,
    field: "tagIds",
    serverValue: serverTagIds,
    save: saveTagIds,
    debounceMs: 0,
    description: "Tags alteradas",
  });

  return (
    <div className="px-3 pb-3 pt-1 border-t border-border/50 bg-muted/30">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        {/* Description */}
        <div className="sm:col-span-2 space-y-1">
          <Label className="text-xs text-muted-foreground">Descrição</Label>
          <Input
            value={description.value}
            onChange={(e) => description.setValue(e.target.value)}
            placeholder="Descrição..."
            className="h-9 text-sm"
            disabled={isDiscarded}
          />
        </div>

        {/* Category */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Categoria</Label>
          <CategoryCombobox
            categories={categories}
            value={category.value || undefined}
            onSelect={(id) => category.setValue(id ?? "")}
            placeholder="Selecione..."
            disabled={isDiscarded}
            size="sm"
          />
        </div>

        {/* Beneficiary (combobox with search + create) */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Favorecido</Label>
          <BeneficiaryCombobox
            beneficiaries={beneficiaries}
            value={beneficiary.value || undefined}
            onSelect={(id) => beneficiary.setValue(id ?? "")}
            onCreate={async (name) => {
              const newId = await onCreateBeneficiary(name);
              beneficiary.setValue(newId);
            }}
            placeholder="Buscar favorecido..."
            disabled={isDiscarded}
            size="sm"
          />
        </div>

        {/* Payment method */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Meio de Pagamento</Label>
          <Select
            value={paymentMethod.value}
            onValueChange={(v) => paymentMethod.setValue(v ?? "")}
            disabled={isDiscarded}
          >
            <SelectTrigger className="h-9 text-sm">
              {paymentMethod.value ? (
                <span className="flex flex-1 text-left truncate">
                  {PAYMENT_METHOD_LABELS[paymentMethod.value as PaymentMethod] ?? "Selecione..."}
                </span>
              ) : (
                <SelectValue placeholder="Selecione..." />
              )}
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Account — editable, label changes for transfers */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {isTransfer ? "Conta origem" : "Conta"}
          </Label>
          <Select
            value={accountId.value}
            onValueChange={(v) => accountId.setValue(v ?? "")}
            disabled={isDiscarded}
          >
            <SelectTrigger className="h-9 text-sm">
              {accountId.value ? (
                <span className="flex flex-1 text-left truncate">
                  {accounts.find((a) => a.id === accountId.value)?.name ?? "Selecione..."}
                </span>
              ) : (
                <SelectValue placeholder="Selecione..." />
              )}
            </SelectTrigger>
            <SelectContent>
              {accounts.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Transfer destination account — only for transfers */}
        {isTransfer && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Conta destino</Label>
            <Select
              value={transferAccountId.value}
              onValueChange={(v) => transferAccountId.setValue(v ?? "")}
              disabled={isDiscarded}
            >
              <SelectTrigger className="h-9 text-sm">
                {transferAccountId.value ? (
                  <span className="flex flex-1 text-left truncate">
                    {accounts.find((a) => a.id === transferAccountId.value)?.name ?? "Selecione..."}
                  </span>
                ) : (
                  <SelectValue placeholder="Selecione..." />
                )}
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((a) => a.id !== accountId.value)
                  .map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Tags */}
        <div className="sm:col-span-2 space-y-1">
          <Label className="text-xs text-muted-foreground">Tags</Label>
          <TagMultiSelect
            tags={tags}
            selectedIds={tagIds.value}
            onChange={tagIds.setValue}
            onCreate={async (name) => {
              const newId = await onCreateTag(name);
              tagIds.setValue([...tagIds.value, newId]);
            }}
            placeholder="Adicionar tags..."
            disabled={isDiscarded}
            size="sm"
          />
        </div>

        {/* Notes */}
        <div className="sm:col-span-2 space-y-1">
          <Label className="text-xs text-muted-foreground">Observações</Label>
          <Textarea
            value={notes.value}
            onChange={(e) => notes.setValue(e.target.value)}
            placeholder="Notas..."
            rows={2}
            className="text-sm resize-none"
            disabled={isDiscarded}
          />
        </div>

        {/* Source info + dates */}
        <div className="sm:col-span-2 flex items-center gap-2 text-[10px] text-muted-foreground/70 flex-wrap">
          <span>
            Fonte: {tx.source === "import" ? "Importação" : tx.source === "manual" ? "Manual" : tx.source}
          </span>
          <span>·</span>
          <span>
            {TRANSACTION_TYPE_LABELS[tx.type as TransactionType]} · {formatBRL(tx.amount)}
          </span>
          <span>·</span>
          <span>{TRANSACTION_STATUS_LABELS[tx.status as TransactionStatus]}</span>
          {tx.confidence != null && tx.confidence > 0 && (
            <>
              <span>·</span>
              <span className={cn(
                "inline-flex items-center gap-0.5",
                tx.confidence >= 0.85 ? "text-purple-500" : tx.confidence >= 0.5 ? "text-blue-500" : "text-amber-500",
              )}>
                <Sparkles className="h-2.5 w-2.5" />
                {Math.round(tx.confidence * 100)}% confiança
              </span>
            </>
          )}
          {tx.competenceDate && tx.competenceDate !== tx.date && (
            <>
              <span>·</span>
              <span title="Data da compra (competência)">
                Compra: {format(parseISO(tx.competenceDate), "dd/MM/yyyy")}
              </span>
              <span>·</span>
              <span title="Data do pagamento (caixa)">
                Pagamento: {format(parseISO(tx.date), "dd/MM/yyyy")}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
        {isPending && (
          <Button
            size="sm"
            variant="outline"
            onClick={onReconcile}
            className="h-8 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            Conciliar
          </Button>
        )}
        {isPending && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="sm" variant="ghost" className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" />}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Descartar
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {DISCARD_REASONS.map((r) => (
                <DropdownMenuItem key={r.value} onClick={() => onDiscard(r.value)}>
                  {r.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {isDiscarded && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRestore}
            className="h-8 text-xs"
          >
            <Undo2 className="h-3.5 w-3.5 mr-1" />
            Restaurar
          </Button>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose} className="h-8 text-xs">
          Fechar
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// NEW TRANSACTION DIALOG
// ============================================================================

interface NewTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; icon: string | null }[];
  beneficiaries: { id: string; name: string }[];
  tags: { id: string; name: string; color: string | null; icon: string | null }[];
  onSubmit: (data: {
    type: TransactionType;
    amount: number;
    date: string;
    description?: string;
    accountId?: string;
    transferAccountId?: string;
    categoryId?: string;
    beneficiaryId?: string;
    paymentMethod?: PaymentMethod;
    notes?: string;
    tagIds?: string[];
  }) => void;
  isPending: boolean;
  onCreateBeneficiary: (name: string) => Promise<string>;
  onCreateTag: (name: string) => Promise<string>;
}

function NewTransactionDialog({
  open,
  onOpenChange,
  accounts,
  categories,
  beneficiaries,
  tags,
  onSubmit,
  isPending,
  onCreateBeneficiary,
  onCreateTag,
}: NewTransactionDialogProps) {
  const [newType, setNewType] = useState<TransactionType>("expense");
  const [newBeneficiaryId, setNewBeneficiaryId] = useState<string | undefined>(undefined);
  const [newCategoryId, setNewCategoryId] = useState<string | undefined>(undefined);
  const [newTagIds, setNewTagIds] = useState<string[]>([]);

  function handleClose(isOpen: boolean) {
    if (!isOpen) {
      setNewType("expense");
      setNewBeneficiaryId(undefined);
      setNewCategoryId(undefined);
      setNewTagIds([]);
    }
    onOpenChange(isOpen);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleClose}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Nova Transação</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            onSubmit({
              type: newType,
              amount: Math.round(parseFloat(fd.get("amount") as string) * 100),
              date: fd.get("date") as string,
              description: (fd.get("description") as string) || undefined,
              accountId: (fd.get("accountId") as string) || undefined,
              transferAccountId: newType === "transfer" ? ((fd.get("transferAccountId") as string) || undefined) : undefined,
              categoryId: newCategoryId || undefined,
              beneficiaryId: newBeneficiaryId || undefined,
              paymentMethod:
                (fd.get("paymentMethod") as PaymentMethod) || undefined,
              notes: (fd.get("notes") as string) || undefined,
              tagIds: newTagIds.length > 0 ? newTagIds : undefined,
            });
          }}
          className="space-y-4"
          key={open ? "open" : "closed"}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as TransactionType)}>
                <SelectTrigger className="min-h-[44px]">
                  <span className="flex flex-1 text-left truncate">
                    {TRANSACTION_TYPE_LABELS[newType]}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="min-h-[44px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                name="date"
                type="date"
                defaultValue={todayISO()}
                required
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Meio de Pagamento</Label>
              <Select name="paymentMethod">
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input
              name="description"
              placeholder="Descrição da transação"
              className="min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{newType === "transfer" ? "Conta origem" : "Conta"}</Label>
              <Select name="accountId">
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newType === "transfer" ? (
              <div className="space-y-2">
                <Label>Conta destino</Label>
                <Select name="transferAccountId">
                  <SelectTrigger className="min-h-[44px]">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Categoria</Label>
                <CategoryCombobox
                  categories={categories}
                  value={newCategoryId}
                  onSelect={(id) => setNewCategoryId(id)}
                  placeholder="Selecione..."
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Favorecido</Label>
            <BeneficiaryCombobox
              beneficiaries={beneficiaries}
              value={newBeneficiaryId}
              onSelect={(id) => setNewBeneficiaryId(id ?? undefined)}
              onCreate={async (name) => {
                const newId = await onCreateBeneficiary(name);
                setNewBeneficiaryId(newId);
              }}
              placeholder="Buscar ou criar favorecido..."
            />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagMultiSelect
              tags={tags}
              selectedIds={newTagIds}
              onChange={setNewTagIds}
              onCreate={async (name) => {
                const newId = await onCreateTag(name);
                setNewTagIds((prev) => [...prev, newId]);
              }}
              placeholder="Adicionar tags..."
            />
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea name="notes" placeholder="Notas adicionais..." rows={2} />
          </div>

          <Button type="submit" className="w-full min-h-[44px]" disabled={isPending}>
            {isPending ? "Criando..." : "Criar Transação"}
          </Button>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
