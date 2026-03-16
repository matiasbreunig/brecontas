"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatBRL } from "@/lib/money";
import { formatDateBR } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Filter } from "lucide-react";
import {
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type TransactionStatus,
  type TransactionType,
} from "@/lib/constants";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  unrecognized: "bg-amber-100 text-amber-700",
  identified: "bg-blue-100 text-blue-700",
  reconciled: "bg-emerald-100 text-emerald-700",
  discarded: "bg-red-100 text-red-700",
};

export default function TransacoesPage() {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: accounts } = trpc.accounts.list.useQuery();
  const { data: cards } = trpc.cards.list.useQuery();
  const { data: categories } = trpc.categories.list.useQuery();
  const { data: beneficiaries } = trpc.beneficiaries.list.useQuery();
  const { data: tags } = trpc.tags.list.useQuery();

  const filters: Record<string, unknown> = {};
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

  const updateTx = trpc.transactions.update.useMutation({
    onSuccess: () => {
      utils.transactions.invalidate();
      utils.accounts.invalidate();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Transações</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="mr-2 h-4 w-4" /> Nova Transação
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Nova Transação</DialogTitle>
            </DialogHeader>
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
                  cardId: (fd.get("cardId") as string) || undefined,
                  categoryId: (fd.get("categoryId") as string) || undefined,
                  beneficiaryId: (fd.get("beneficiaryId") as string) || undefined,
                  paymentMethod: (fd.get("paymentMethod") as string as Parameters<typeof createTx.mutate>[0]["paymentMethod"]) || undefined,
                  notes: (fd.get("notes") as string) || undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select name="type" defaultValue="expense">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Valor (R$)</Label>
                  <Input name="amount" type="number" step="0.01" min="0.01" required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Data</Label>
                  <Input name="date" type="date" defaultValue={new Date().toISOString().split("T")[0]} required />
                </div>
                <div className="space-y-2">
                  <Label>Meio de Pagamento</Label>
                  <Select name="paymentMethod">
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
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
                <Input name="description" placeholder="Descrição da transação" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Conta</Label>
                  <Select name="accountId">
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
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
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
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
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
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

              <Button type="submit" className="w-full" disabled={createTx.isPending}>
                {createTx.isPending ? "Criando..." : "Criar Transação"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {Object.entries(TRANSACTION_STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {txData && (
          <span className="text-sm text-muted-foreground ml-auto">
            {txData.total} transações
          </span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Favorecido</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : !txData?.items.length ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Nenhuma transação encontrada.
                </TableCell>
              </TableRow>
            ) : (
              txData.items.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="text-sm">{formatDateBR(tx.date)}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {tx.description || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {tx.category ? (
                      <span>{tx.category.icon} {tx.category.name}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {tx.beneficiary?.name || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {tx.account?.name || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-xs ${statusColors[tx.status] || ""}`}>
                      {TRANSACTION_STATUS_LABELS[tx.status as TransactionStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-right font-mono text-sm font-medium ${
                    tx.type === "income" || tx.type === "refund"
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}>
                    {tx.type === "income" || tx.type === "refund" ? "+" : "-"}
                    {formatBRL(tx.amount)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
