"use client";

import { trpc } from "@/lib/trpc";
import { formatBRL } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertCircle,
} from "lucide-react";
import { ACCOUNT_TYPE_LABELS, TRANSACTION_STATUS_LABELS } from "@/lib/constants";

export default function DashboardPage() {
  const { data: accounts, isLoading: loadingAccounts } = trpc.accounts.getWithBalance.useQuery();
  const { data: stats } = trpc.transactions.stats.useQuery({});
  const { data: recentTx } = trpc.transactions.list.useQuery({ limit: 10 });

  const totalBalance = accounts?.reduce((sum, acc) => sum + acc.balance, 0) ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Saldo Total
            </CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalBalance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {loadingAccounts ? "..." : formatBRL(totalBalance)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Receitas
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              {formatBRL(stats?.totalIncome ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Despesas
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatBRL(stats?.totalExpense ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pendentes
            </CardTitle>
            <AlertCircle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">
              {stats?.pendingCount ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Accounts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contas</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingAccounts ? (
              <p className="text-muted-foreground text-sm">Carregando...</p>
            ) : accounts?.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhuma conta cadastrada. Vá em Contas para adicionar.
              </p>
            ) : (
              <div className="space-y-3">
                {accounts?.filter(a => a.isActive).map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{acc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ACCOUNT_TYPE_LABELS[acc.type as keyof typeof ACCOUNT_TYPE_LABELS]}
                        {acc.institution && ` · ${acc.institution}`}
                      </p>
                    </div>
                    <span className={`font-mono text-sm font-medium ${acc.balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatBRL(acc.balance)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Transações Recentes</CardTitle>
          </CardHeader>
          <CardContent>
            {!recentTx?.items.length ? (
              <p className="text-muted-foreground text-sm">
                Nenhuma transação registrada ainda.
              </p>
            ) : (
              <div className="space-y-3">
                {recentTx.items.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">
                        {tx.description || tx.beneficiary?.name || "Sem descrição"}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{tx.date}</span>
                        {tx.category && <span>· {tx.category.name}</span>}
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {TRANSACTION_STATUS_LABELS[tx.status as keyof typeof TRANSACTION_STATUS_LABELS]}
                        </Badge>
                      </div>
                    </div>
                    <span className={`font-mono text-sm font-medium ml-2 ${
                      tx.type === "income" || tx.type === "refund"
                        ? "text-emerald-600"
                        : "text-red-600"
                    }`}>
                      {tx.type === "income" || tx.type === "refund" ? "+" : "-"}
                      {formatBRL(tx.amount)}
                    </span>
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
