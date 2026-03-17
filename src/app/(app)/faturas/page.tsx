"use client";

import { trpc } from "@/lib/trpc";
import { formatBRL } from "@/lib/money";
import { formatDateBR } from "@/lib/date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Calendar, AlertCircle } from "lucide-react";
import { INVOICE_STATUS_LABELS } from "@/lib/constants";

const invoiceStatusStyles: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  closed: "bg-amber-50 text-amber-700",
  paid: "bg-emerald-50 text-emerald-700",
  overdue: "bg-red-50 text-red-700",
};

export default function FaturasPage() {
  const { data: invoices } = trpc.reports.upcomingInvoices.useQuery();
  const { data: cards } = trpc.cards.list.useQuery();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Faturas</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Acompanhe as faturas dos seus cartões de crédito.
        </p>
      </div>

      {/* Cards Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        {cards?.map((card) => (
          <Card key={card.id} className="relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
            <CardContent className="relative pt-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{card.name}</p>
                  {card.lastFour && (
                    <p className="text-xs text-muted-foreground">•••• {card.lastFour}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Fechamento</p>
                  <p className="font-medium">Dia {card.closingDay || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vencimento</p>
                  <p className="font-medium">Dia {card.dueDay || "—"}</p>
                </div>
                {card.creditLimit && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Limite</p>
                    <p className="font-medium font-mono tabular-nums">{formatBRL(card.creditLimit)}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {(!cards || cards.length === 0) && (
          <p className="text-muted-foreground text-sm col-span-3 py-8 text-center">
            Nenhum cartão cadastrado. Adicione na página de Contas.
          </p>
        )}
      </div>

      {/* Invoice List */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Faturas</h2>
        {invoices && invoices.length > 0 ? (
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <Card key={invoice.id}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-muted p-2">
                      <CreditCard className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{invoice.card?.name || "Cartão"}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {formatDateBR(invoice.cycleStart)} — {formatDateBR(invoice.cycleEnd)}
                        </span>
                        <span>·</span>
                        <span>Vence: {formatDateBR(invoice.dueDate)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      {invoice.totalAmount !== null && (
                        <p className="font-mono text-sm font-semibold tabular-nums">
                          {formatBRL(invoice.totalAmount)}
                        </p>
                      )}
                      <Badge
                        variant="secondary"
                        className={`mt-1 text-[10px] ${invoiceStatusStyles[invoice.status]}`}
                      >
                        {INVOICE_STATUS_LABELS[invoice.status as keyof typeof INVOICE_STATUS_LABELS]}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma fatura encontrada.</p>
            <p className="text-sm mt-1">Faturas são criadas ao importar extratos de cartão.</p>
          </div>
        )}
      </div>
    </div>
  );
}
