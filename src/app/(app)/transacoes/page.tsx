"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useMonth } from "@/hooks/use-month";
import { formatBRL } from "@/lib/money";
import { formatDateBR } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import {
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  RotateCcw,
  Search,
  CheckCircle2,
  Zap,
  Square,
  CheckSquare,
  Filter,
  X,
} from "lucide-react";
import {
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type TransactionStatus,
  type TransactionType,
} from "@/lib/constants";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const statusStyles: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  unrecognized: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  identified: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  reconciled: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  discarded: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

const typeIcons: Record<string, typeof ArrowUpRight> = {
  income: ArrowUpRight,
  expense: ArrowDownRight,
  transfer: ArrowLeftRight,
  refund: RotateCcw,
};

export default function TransacoesPage() {
  const utils = trpc.useUtils();
  const { month, dateFrom, dateTo } = useMonth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  const monthLabel = format(month, "MMMM 'de' yyyy", { locale: ptBR });

  const { data: accounts } = trpc.accounts.list.useQuery();
  const { data: categories } = trpc.categories.list.useQuery();
  const { data: beneficiaries } = trpc.beneficiaries.list.useQuery();

  const filters: Record<string, unknown> = { dateFrom, dateTo };
  if (statusFilter !== "all") filters.status = statusFilter;
  if (typeFilter !== "all") filters.type = typeFilter;

  const { data: txData, isLoading } = trpc.transactions.list.useQuery({
    ...filters,
    limit: 100,
  } as Parameters<typeof trpc.transactions.list.useQuery>[0]);

  const createTx = trpc.transactions.create.useMutation({
    onSuccess: () => {
      utils.transactions.invalidate();
      utils.accounts.invalidate();
      toast.success("Transação criada");
      setDialogOpen(false);
    },
  });

  const bulkReconcile = trpc.reconciliation.bulkReconcile.useMutation({
    onSuccess: (data) => {
      utils.transactions.invalidate();
      setSelectedIds(new Set());
      toast.success(`${data.count} transações conciliadas`);
    },
  });

  const applyRules = trpc.reconciliation.applyRules.useMutation({
    onSuccess: (data) => {
      utils.transactions.invalidate();
      toast.success(`${data.matched} transações classificadas por regras`);
    },
  });

  const reconcileSingle = trpc.reconciliation.reconcile.useMutation({
    onSuccess: () => {
      utils.transactions.invalidate();
      toast.success("Transação conciliada");
    },
  });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!filteredItems) return;
    const pendingItems = filteredItems.filter((tx) => tx.status !== "reconciled" && tx.status !== "discarded");
    if (selectedIds.size === pendingItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingItems.map((tx) => tx.id)));
    }
  }

  const filteredItems = txData?.items.filter((tx) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      tx.description?.toLowerCase().includes(s) ||
      tx.beneficiary?.name?.toLowerCase().includes(s) ||
      tx.category?.name?.toLowerCase().includes(s)
    );
  });

  const hasActiveFilters = statusFilter !== "all" || typeFilter !== "all";

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Transações</h1>
          <p className="text-muted-foreground text-sm mt-0.5 capitalize">{monthLabel}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="min-h-[44px] shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Nova Transação</span>
          <span className="sm:hidden">Nova</span>
        </Button>
      </div>

      {/* Search + Filter toggle */}
      <div className="space-y-3">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar transações..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 min-h-[44px]"
            />
          </div>
          <Button
            variant={hasActiveFilters ? "default" : "outline"}
            size="icon"
            onClick={() => setShowFilters(!showFilters)}
            className="min-h-[44px] min-w-[44px] shrink-0"
          >
            <Filter className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => applyRules.mutate({})}
            disabled={applyRules.isPending}
            title="Aplicar regras"
            className="min-h-[44px] min-w-[44px] shrink-0"
          >
            <Zap className="h-4 w-4" />
          </Button>
        </div>

        {/* Collapsible filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-2 items-center bg-muted/50 rounded-xl p-3">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
              <SelectTrigger className="w-full sm:w-40 min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {Object.entries(TRANSACTION_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
              <SelectTrigger className="w-full sm:w-40 min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setStatusFilter("all"); setTypeFilter("all"); }}
                className="min-h-[44px]"
              >
                <X className="h-3.5 w-3.5 mr-1" /> Limpar
              </Button>
            )}
          </div>
        )}

        {/* Count + actions */}
        <div className="flex items-center gap-2 justify-between">
          {txData && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {txData.total} transações
            </span>
          )}
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              onClick={() => bulkReconcile.mutate({ transactionIds: [...selectedIds] })}
              disabled={bulkReconcile.isPending}
              className="min-h-[44px]"
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Conciliar ({selectedIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* Transaction List */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>
          ) : !filteredItems?.length ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              Nenhuma transação encontrada neste mês.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredItems.map((tx) => {
                const TypeIcon = typeIcons[tx.type] || ArrowDownRight;
                const isPositive = tx.type === "income" || tx.type === "refund";
                const isPending = tx.status !== "reconciled" && tx.status !== "discarded";
                const isSelected = selectedIds.has(tx.id);

                return (
                  <div
                    key={tx.id}
                    className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-muted/50 transition-colors ${isSelected ? "bg-indigo-50/50 dark:bg-indigo-950/20" : ""}`}
                  >
                    {isPending && (
                      <button
                        onClick={() => toggleSelect(tx.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-5 w-5 text-indigo-600" />
                        ) : (
                          <Square className="h-5 w-5" />
                        )}
                      </button>
                    )}
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm shrink-0 ${
                      isPositive
                        ? "bg-emerald-500/10 text-emerald-600"
                        : tx.type === "transfer"
                        ? "bg-blue-500/10 text-blue-600"
                        : "bg-red-500/10 text-red-600"
                    }`}>
                      {tx.category?.icon || <TypeIcon className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {tx.description || tx.beneficiary?.name || "Sem descrição"}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                        <span>{formatDateBR(tx.date)}</span>
                        {tx.category && <span className="hidden sm:inline">· {tx.category.name}</span>}
                        {tx.account && <span className="hidden sm:inline">· {tx.account.name}</span>}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1 shrink-0">
                      <span className={`font-mono text-sm font-semibold tabular-nums ${
                        isPositive ? "text-emerald-600" : "text-red-600"
                      }`}>
                        {isPositive ? "+" : "-"}{formatBRL(tx.amount)}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-[9px] px-1.5 py-0 h-4 ${statusStyles[tx.status] || ""}`}
                      >
                        {TRANSACTION_STATUS_LABELS[tx.status as TransactionStatus]}
                      </Badge>
                    </div>
                    {isPending && (
                      <button
                        onClick={() => reconcileSingle.mutate({ transactionId: tx.id, createRule: false })}
                        className="shrink-0 rounded-lg p-2 hover:bg-emerald-50 transition-colors text-muted-foreground hover:text-emerald-600 min-h-[44px] min-w-[44px] flex items-center justify-center -mr-1"
                        title="Conciliar"
                      >
                        <CheckCircle2 className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Floating bulk action bar on mobile when items selected */}
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
                onClick={() => bulkReconcile.mutate({ transactionIds: [...selectedIds] })}
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

      {/* New Transaction Dialog (responsive) */}
      <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Nova Transação</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              createTx.mutate({
                type: fd.get("type") as TransactionType,
                amount: Math.round(parseFloat(fd.get("amount") as string) * 100),
                date: fd.get("date") as string,
                description: (fd.get("description") as string) || undefined,
                accountId: (fd.get("accountId") as string) || undefined,
                categoryId: (fd.get("categoryId") as string) || undefined,
                beneficiaryId: (fd.get("beneficiaryId") as string) || undefined,
                paymentMethod: (fd.get("paymentMethod") as string as Parameters<typeof createTx.mutate>[0]["paymentMethod"]) || undefined,
                notes: (fd.get("notes") as string) || undefined,
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select name="type" defaultValue="expense">
                  <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Valor (R$)</Label>
                <Input name="amount" type="number" step="0.01" min="0.01" required className="min-h-[44px]" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Data</Label>
                <Input name="date" type="date" defaultValue={new Date().toISOString().split("T")[0]} required className="min-h-[44px]" />
              </div>
              <div className="space-y-2">
                <Label>Meio de Pagamento</Label>
                <Select name="paymentMethod">
                  <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input name="description" placeholder="Descrição da transação" className="min-h-[44px]" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Conta</Label>
                <Select name="accountId">
                  <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {accounts?.filter(a => a.isActive).map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select name="categoryId">
                  <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {categories?.filter(c => c.isActive).map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.icon} {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Favorecido</Label>
              <Select name="beneficiaryId">
                <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {beneficiaries?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea name="notes" placeholder="Notas adicionais..." rows={2} />
            </div>

            <Button type="submit" className="w-full min-h-[44px]" disabled={createTx.isPending}>
              {createTx.isPending ? "Criando..." : "Criar Transação"}
            </Button>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
