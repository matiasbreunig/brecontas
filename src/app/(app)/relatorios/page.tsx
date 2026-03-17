"use client";

import { trpc } from "@/lib/trpc";
import { useMonth } from "@/hooks/use-month";
import { formatBRL } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

const CHART_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
  "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#84cc16",
];

export default function RelatoriosPage() {
  const { month, dateFrom, dateTo } = useMonth();
  const monthLabel = format(month, "MMMM 'de' yyyy", { locale: ptBR });

  const { data: byCategory } = trpc.reports.byCategory.useQuery({ dateFrom, dateTo, type: "expense" });
  const { data: incomeByCategory } = trpc.reports.byCategory.useQuery({ dateFrom, dateTo, type: "income" });
  const { data: dailySpending } = trpc.reports.dailySpending.useQuery({ dateFrom, dateTo });
  const { data: monthComparison } = trpc.reports.monthComparison.useQuery({ months: 6 });

  const dailyData = dailySpending?.map((d) => ({
    date: d.date.slice(8), // DD
    income: d.income / 100,
    expense: d.expense / 100,
  }));

  const chartData = monthComparison?.map((m) => ({
    ...m,
    incomeDisplay: m.income / 100,
    expenseDisplay: m.expense / 100,
    netDisplay: (m.income - m.expense) / 100,
  }));

  const pieData = byCategory?.slice(0, 10).map((c, i) => ({
    name: c.categoryName || "Sem categoria",
    value: c.total / 100,
    icon: c.categoryIcon,
    color: c.categoryColor || CHART_COLORS[i % CHART_COLORS.length],
    percentage: c.percentage,
    total: c.total,
    count: c.count,
  }));

  const totalExpense = byCategory?.reduce((sum, c) => sum + c.total, 0) ?? 0;
  const totalIncome = incomeByCategory?.reduce((sum, c) => sum + c.total, 0) ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground text-sm mt-0.5 capitalize">{monthLabel}</p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="relative pt-6">
            <p className="text-sm text-muted-foreground">Total Receitas</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600">{formatBRL(totalIncome)}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="relative pt-6">
            <p className="text-sm text-muted-foreground">Total Despesas</p>
            <p className="text-2xl font-bold tabular-nums text-red-600">{formatBRL(totalExpense)}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
          <CardContent className="relative pt-6">
            <p className="text-sm text-muted-foreground">Saldo do Mês</p>
            <p className={`text-2xl font-bold tabular-nums ${totalIncome - totalExpense >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {formatBRL(totalIncome - totalExpense)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Daily Spending Line Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Gastos Diários</CardTitle>
          </CardHeader>
          <CardContent>
            {dailyData && dailyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value) => formatBRL(Math.round(Number(value) * 100))}
                    contentStyle={{ borderRadius: "12px", fontSize: "12px" }}
                  />
                  <Line type="monotone" dataKey="expense" name="Despesas" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="income" name="Receitas" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-sm py-12 text-center">Sem dados</p>
            )}
          </CardContent>
        </Card>

        {/* Month Comparison */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Comparativo Mensal</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
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
              <p className="text-muted-foreground text-sm py-12 text-center">Sem dados</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Despesas por Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData && pieData.length > 0 ? (
              <div className="flex items-start gap-6">
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
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
                <div className="flex-1 space-y-2">
                  {pieData.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="flex-1 text-sm truncate">{item.icon} {item.name}</span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{item.percentage}%</span>
                      <span className="font-mono text-xs tabular-nums font-medium">{formatBRL(item.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm py-12 text-center">Sem despesas neste mês</p>
            )}
          </CardContent>
        </Card>

        {/* Category Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Detalhamento</CardTitle>
          </CardHeader>
          <CardContent>
            {byCategory && byCategory.length > 0 ? (
              <div className="space-y-1">
                {byCategory.map((cat, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors">
                    <span className="text-base">{cat.categoryIcon || "·"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{cat.categoryName || "Sem categoria"}</p>
                      <p className="text-[11px] text-muted-foreground">{cat.count} transações</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-20 bg-muted rounded-full h-1.5">
                        <div
                          className="bg-primary h-1.5 rounded-full"
                          style={{ width: `${cat.percentage}%` }}
                        />
                      </div>
                      <span className="font-mono text-sm tabular-nums font-semibold w-28 text-right">
                        {formatBRL(cat.total)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm py-12 text-center">Sem dados</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
