"use client";

import { trpc } from "@/lib/trpc";
import { useMonth } from "@/hooks/use-month";
import { formatBRL } from "@/lib/money";
import { formatDateBR } from "@/lib/date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  Inbox,
  BarChart3,
} from "lucide-react";
import { ACCOUNT_TYPE_LABELS, TRANSACTION_STATUS_LABELS } from "@/lib/constants";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";

const CHART_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
  "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#84cc16",
];

export default function DashboardPage() {
  const { month, dateFrom, dateTo } = useMonth();
  const { data: accounts, isLoading: loadingAccounts } = trpc.accounts.getWithBalance.useQuery();
  const { data: stats } = trpc.transactions.stats.useQuery({ dateFrom, dateTo });
  const { data: recentTx } = trpc.transactions.list.useQuery({ dateFrom, dateTo, limit: 8 });
  const { data: byCategory } = trpc.reports.byCategory.useQuery({ dateFrom, dateTo, type: "expense" });
  const { data: monthComparison } = trpc.reports.monthComparison.useQuery({ months: 6 });
  const { data: inboxCount } = trpc.inbox.pendingCount.useQuery();

  const totalBalance = accounts?.reduce((sum, acc) => sum + acc.balance, 0) ?? 0;
  const monthLabel = format(month, "MMMM 'de' yyyy", { locale: ptBR });
  const netBalance = (stats?.totalIncome ?? 0) - (stats?.totalExpense ?? 0) + (stats?.totalRefund ?? 0);

  const chartData = monthComparison?.map((m) => ({
    ...m,
    incomeDisplay: m.income / 100,
    expenseDisplay: m.expense / 100,
  }));

  const pieData = byCategory?.slice(0, 8).map((c, i) => ({
    name: c.categoryName || "Sem categoria",
    value: c.total / 100,
    icon: c.categoryIcon,
    color: c.categoryColor || CHART_COLORS[i % CHART_COLORS.length],
    percentage: c.percentage,
  }));

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5 capitalize">{monthLabel}</p>
      </div>

      {/* Summary Cards — horizontal scroll on mobile */}
      <div className="flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-5 sm:gap-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        <Card className="relative overflow-hidden min-w-[160px] shrink-0 sm:min-w-0 sm:shrink">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
            <CardTitle className="text-sm font-medium text-muted-foreground">Patrimônio</CardTitle>
            <div className="rounded-lg bg-indigo-500/10 p-2">
              <Wallet className="h-4 w-4 text-indigo-600" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className={`text-2xl font-bold tabular-nums ${totalBalance >= 0 ? "text-foreground" : "text-red-600"}`}>
              {loadingAccounts ? "..." : formatBRL(totalBalance)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Saldo consolidado</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
            <CardTitle className="text-sm font-medium text-muted-foreground">Receitas</CardTitle>
            <div className="rounded-lg bg-emerald-500/10 p-2">
              <ArrowUpRight className="h-4 w-4 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums text-emerald-600">
              {formatBRL(stats?.totalIncome ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
            <CardTitle className="text-sm font-medium text-muted-foreground">Despesas</CardTitle>
            <div className="rounded-lg bg-red-500/10 p-2">
              <ArrowDownRight className="h-4 w-4 text-red-600" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums text-red-600">
              {formatBRL(stats?.totalExpense ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Saldo: <span className={netBalance >= 0 ? "text-emerald-600" : "text-red-600"}>{formatBRL(netBalance)}</span>
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pendentes</CardTitle>
            <div className="rounded-lg bg-amber-500/10 p-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums text-amber-600">{stats?.pendingCount ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Aguardando conciliação</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
            <CardTitle className="text-sm font-medium text-muted-foreground">Inbox</CardTitle>
            <div className="rounded-lg bg-purple-500/10 p-2">
              <Inbox className="h-4 w-4 text-purple-600" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums text-purple-600">{inboxCount ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Itens para processar</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Month Comparison Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Receitas vs Despesas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barGap={2}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value) => formatBRL(Math.round(Number(value) * 100))}
                    contentStyle={{ borderRadius: "12px", fontSize: "12px" }}
                  />
                  <Bar dataKey="incomeDisplay" name="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenseDisplay" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-sm py-12 text-center">Sem dados para exibir</p>
            )}
          </CardContent>
        </Card>

        {/* Category Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Despesas por Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData && pieData.length > 0 ? (
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <ResponsiveContainer width={180} height={180} className="shrink-0">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatBRL(Math.round(Number(value) * 100))}
                      contentStyle={{ borderRadius: "12px", fontSize: "12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {pieData.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="flex-1 truncate text-muted-foreground">
                        {item.icon} {item.name}
                      </span>
                      <span className="font-mono text-xs tabular-nums font-medium">{item.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm py-12 text-center">Sem despesas neste mês</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Accounts — 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Contas</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingAccounts ? (
              <p className="text-muted-foreground text-sm">Carregando...</p>
            ) : accounts?.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nenhuma conta cadastrada.</p>
            ) : (
              <div className="space-y-1">
                {accounts?.filter(a => a.isActive).map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-8 w-8 rounded-lg flex items-center justify-center text-sm font-semibold"
                        style={{ backgroundColor: acc.color ? `${acc.color}15` : undefined, color: acc.color || undefined }}
                      >
                        {acc.icon || acc.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{acc.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {ACCOUNT_TYPE_LABELS[acc.type as keyof typeof ACCOUNT_TYPE_LABELS]}
                          {acc.institution && ` · ${acc.institution}`}
                        </p>
                      </div>
                    </div>
                    <span className={`font-mono text-sm font-semibold tabular-nums ${acc.balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatBRL(acc.balance)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions — 3 cols */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Últimas Transações</CardTitle>
          </CardHeader>
          <CardContent>
            {!recentTx?.items.length ? (
              <p className="text-muted-foreground text-sm">Nenhuma transação neste mês.</p>
            ) : (
              <div className="space-y-1">
                {recentTx.items.map((tx) => (
                  <div key={tx.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-sm">
                      {tx.category?.icon || "·"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {tx.description || tx.beneficiary?.name || "Sem descrição"}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{formatDateBR(tx.date)}</span>
                        {tx.category && <span>· {tx.category.name}</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`font-mono text-sm font-semibold tabular-nums ${
                        tx.type === "income" || tx.type === "refund" ? "text-emerald-600" : "text-red-600"
                      }`}>
                        {tx.type === "income" || tx.type === "refund" ? "+" : "-"}
                        {formatBRL(tx.amount)}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`block mt-0.5 text-[9px] px-1.5 py-0 h-4 w-fit ml-auto ${
                          tx.status === "reconciled" ? "bg-emerald-50 text-emerald-700" :
                          tx.status === "identified" ? "bg-blue-50 text-blue-700" :
                          tx.status === "unrecognized" ? "bg-amber-50 text-amber-700" :
                          "bg-slate-50 text-slate-600"
                        }`}
                      >
                        {TRANSACTION_STATUS_LABELS[tx.status as keyof typeof TRANSACTION_STATUS_LABELS]}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
