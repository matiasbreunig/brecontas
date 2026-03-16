"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatBRL } from "@/lib/money";
import { formatDateBR } from "@/lib/date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus,
  Repeat,
  Pencil,
  Trash2,
  Zap,
  TrendingUp,
  TrendingDown,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { TRANSACTION_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/constants";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

const FREQUENCY_LABELS: Record<string, string> = {
  monthly: "Mensal",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  quarterly: "Trimestral",
  yearly: "Anual",
  custom: "Personalizado",
};

export default function RecorrentesPage() {
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: templates } = trpc.recurring.list.useQuery();
  const { data: accounts } = trpc.accounts.list.useQuery();
  const { data: categories } = trpc.categories.list.useQuery();
  const { data: beneficiariesData } = trpc.beneficiaries.list.useQuery();
  const { data: futureBalance } = trpc.recurring.futureBalance.useQuery({ monthsAhead: 6 });

  const createTemplate = trpc.recurring.create.useMutation({
    onSuccess: () => {
      utils.recurring.list.invalidate();
      toast.success("Recorrência criada");
      setCreateOpen(false);
    },
  });

  const deleteTemplate = trpc.recurring.delete.useMutation({
    onSuccess: () => {
      utils.recurring.list.invalidate();
      toast.success("Recorrência removida");
    },
  });

  const generateProjections = trpc.recurring.generateProjections.useMutation({
    onSuccess: (data) => {
      utils.transactions.invalidate();
      utils.recurring.futureBalance.invalidate();
      toast.success(`${data.created} projeções geradas a partir de ${data.templates} templates`);
    },
  });

  const chartData = futureBalance?.map((m) => ({
    ...m,
    realizedNet: (m.realizedIncome - m.realizedExpense) / 100,
    projectedNet: (m.projectedIncome - m.projectedExpense) / 100,
    totalIncome: (m.realizedIncome + m.projectedIncome) / 100,
    totalExpense: (m.realizedExpense + m.projectedExpense) / 100,
  }));

  const activeTemplates = templates?.filter((t) => t.isActive) || [];
  const totalMonthlyExpense = activeTemplates
    .filter((t) => t.type === "expense" && t.frequency === "monthly")
    .reduce((sum, t) => sum + t.estimatedAmount, 0);
  const totalMonthlyIncome = activeTemplates
    .filter((t) => t.type === "income" && t.frequency === "monthly")
    .reduce((sum, t) => sum + t.estimatedAmount, 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recorrentes</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Gerencie despesas e receitas recorrentes e gere projeções.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => generateProjections.mutate({ monthsAhead: 3 })}
            disabled={generateProjections.isPending}
          >
            <Zap className="mr-2 h-4 w-4" />
            Gerar Projeções
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button />}>
              <Plus className="mr-2 h-4 w-4" /> Nova Recorrência
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Nova Recorrência</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  createTemplate.mutate({
                    description: fd.get("description") as string,
                    type: fd.get("type") as "income" | "expense",
                    estimatedAmount: Math.round(parseFloat(fd.get("amount") as string) * 100),
                    frequency: fd.get("frequency") as "monthly" | "weekly" | "biweekly" | "quarterly" | "yearly" | "custom",
                    dayOfMonth: fd.get("dayOfMonth") ? parseInt(fd.get("dayOfMonth") as string) : undefined,
                    startDate: fd.get("startDate") as string,
                    accountId: (fd.get("accountId") as string) || undefined,
                    categoryId: (fd.get("categoryId") as string) || undefined,
                    beneficiaryId: (fd.get("beneficiaryId") as string) || undefined,
                    paymentMethod: (fd.get("paymentMethod") as string as "pix" | "debit" | "credit" | "transfer" | "boleto" | "cash" | "other") || undefined,
                  });
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Input name="description" required placeholder="Ex: Conta de Energia CPFL" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select name="type" defaultValue="expense">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expense">Despesa</SelectItem>
                        <SelectItem value="income">Receita</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Valor estimado (R$)</Label>
                    <Input name="amount" type="number" step="0.01" min="0.01" required />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Frequência</Label>
                    <Select name="frequency" defaultValue="monthly">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Dia do mês</Label>
                    <Input name="dayOfMonth" type="number" min="1" max="31" placeholder="Ex: 15" />
                  </div>
                  <div className="space-y-2">
                    <Label>Início</Label>
                    <Input name="startDate" type="date" defaultValue={new Date().toISOString().split("T")[0]} required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Conta</Label>
                    <Select name="accountId">
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {accounts?.map((acc) => (
                          <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <Select name="categoryId">
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Favorecido</Label>
                    <Select name="beneficiaryId">
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {beneficiariesData?.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Pagamento</Label>
                    <Select name="paymentMethod">
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={createTemplate.isPending}>
                  Criar Recorrência
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="relative pt-6">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownRight className="h-4 w-4 text-red-600" />
              <p className="text-sm text-muted-foreground">Despesas fixas/mês</p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-red-600">{formatBRL(totalMonthlyExpense)}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="relative pt-6">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="h-4 w-4 text-emerald-600" />
              <p className="text-sm text-muted-foreground">Receitas fixas/mês</p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-emerald-600">{formatBRL(totalMonthlyIncome)}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent" />
          <CardContent className="relative pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Repeat className="h-4 w-4 text-indigo-600" />
              <p className="text-sm text-muted-foreground">Templates ativos</p>
            </div>
            <p className="text-2xl font-bold tabular-nums">{activeTemplates.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Future Balance Chart */}
      {chartData && chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Visão Futura (Realizado + Projetado)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value) => formatBRL(Math.round(Number(value) * 100))}
                  contentStyle={{ borderRadius: "12px", fontSize: "12px" }}
                />
                <Bar dataKey="totalIncome" name="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalExpense" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Templates List */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Recorrências</h2>
        {activeTemplates.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Repeat className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma recorrência cadastrada.</p>
            <p className="text-sm mt-1">Crie templates para gerar projeções automáticas.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates?.map((template) => (
              <Card key={template.id} className={!template.isActive ? "opacity-50" : ""}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-4">
                    <div className={`rounded-xl p-2.5 ${
                      template.type === "expense" ? "bg-red-500/10" : "bg-emerald-500/10"
                    }`}>
                      {template.type === "expense" ? (
                        <ArrowDownRight className="h-5 w-5 text-red-600" />
                      ) : (
                        <ArrowUpRight className="h-5 w-5 text-emerald-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{template.description}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {FREQUENCY_LABELS[template.frequency]}
                        </Badge>
                        {template.dayOfMonth && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Dia {template.dayOfMonth}
                          </span>
                        )}
                        {template.category && (
                          <span>{template.category.icon} {template.category.name}</span>
                        )}
                        {template.account && <span>· {template.account.name}</span>}
                      </div>
                    </div>
                    <span className={`font-mono text-base font-semibold tabular-nums ${
                      template.type === "expense" ? "text-red-600" : "text-emerald-600"
                    }`}>
                      {template.type === "expense" ? "-" : "+"}{formatBRL(template.estimatedAmount)}
                    </span>
                    <button
                      onClick={() => {
                        if (confirm(`Excluir "${template.description}"?`)) {
                          deleteTemplate.mutate({ id: template.id });
                        }
                      }}
                      className="rounded-lg p-1.5 hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
