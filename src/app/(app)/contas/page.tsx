"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatBRL } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  CreditCard,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
  Link2,
} from "lucide-react";
import { ACCOUNT_TYPE_LABELS } from "@/lib/constants";
import { toast } from "sonner";

const accountTypeIcons: Record<string, typeof Landmark> = {
  checking: Landmark,
  savings: PiggyBank,
  investment: TrendingUp,
  wallet: Wallet,
  virtual: Link2,
};

export default function ContasPage() {
  const utils = trpc.useUtils();
  const { data: accounts, isLoading } = trpc.accounts.getWithBalance.useQuery();
  const { data: cards } = trpc.cards.list.useQuery();

  const createAccount = trpc.accounts.create.useMutation({
    onSuccess: () => {
      utils.accounts.invalidate();
      toast.success("Conta criada com sucesso");
      setAccountDialogOpen(false);
    },
  });

  const createCard = trpc.cards.create.useMutation({
    onSuccess: () => {
      utils.cards.invalidate();
      toast.success("Cartão criado com sucesso");
      setCardDialogOpen(false);
    },
  });

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);

  const totalBalance = accounts?.reduce((sum, acc) => sum + acc.balance, 0) ?? 0;
  const activeAccounts = accounts?.filter(a => a.isActive) ?? [];
  const activeCards = cards?.filter(c => c.isActive) ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contas e Cartões</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Patrimônio consolidado: <span className={`font-semibold font-mono tabular-nums ${totalBalance >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatBRL(totalBalance)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
            <DialogTrigger render={<Button />}>
              <Plus className="mr-2 h-4 w-4" /> Nova Conta
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova Conta</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  createAccount.mutate({
                    name: fd.get("name") as string,
                    type: fd.get("type") as "checking" | "savings" | "investment" | "wallet" | "virtual",
                    institution: (fd.get("institution") as string) || undefined,
                    initialBalance: Math.round(parseFloat(fd.get("initialBalance") as string || "0") * 100),
                  });
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" name="name" placeholder="Ex: Nubank Corrente" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Tipo</Label>
                  <Select name="type" defaultValue="checking">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ACCOUNT_TYPE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="institution">Instituição</Label>
                  <Input id="institution" name="institution" placeholder="Ex: Nubank" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="initialBalance">Saldo Inicial (R$)</Label>
                  <Input id="initialBalance" name="initialBalance" type="number" step="0.01" defaultValue="0" />
                </div>
                <Button type="submit" className="w-full" disabled={createAccount.isPending}>
                  {createAccount.isPending ? "Criando..." : "Criar Conta"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={cardDialogOpen} onOpenChange={setCardDialogOpen}>
            <DialogTrigger render={<Button variant="outline" />}>
              <CreditCard className="mr-2 h-4 w-4" /> Novo Cartão
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo Cartão</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  createCard.mutate({
                    accountId: fd.get("accountId") as string,
                    name: fd.get("name") as string,
                    lastFour: (fd.get("lastFour") as string) || undefined,
                    brand: (fd.get("brand") as "visa" | "mastercard" | "elo" | "amex" | "other") || undefined,
                    closingDay: fd.get("closingDay") ? parseInt(fd.get("closingDay") as string) : undefined,
                    dueDay: fd.get("dueDay") ? parseInt(fd.get("dueDay") as string) : undefined,
                    creditLimit: fd.get("creditLimit") ? Math.round(parseFloat(fd.get("creditLimit") as string) * 100) : undefined,
                  });
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="accountId">Conta Vinculada</Label>
                  <Select name="accountId" required>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {accounts?.filter(a => a.isActive).map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cardName">Nome</Label>
                  <Input id="cardName" name="name" placeholder="Ex: Nubank Platinum" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="lastFour">Últimos 4 dígitos</Label>
                    <Input id="lastFour" name="lastFour" maxLength={4} placeholder="1234" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand">Bandeira</Label>
                    <Select name="brand">
                      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="visa">Visa</SelectItem>
                        <SelectItem value="mastercard">Mastercard</SelectItem>
                        <SelectItem value="elo">Elo</SelectItem>
                        <SelectItem value="amex">Amex</SelectItem>
                        <SelectItem value="other">Outra</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="closingDay">Dia Fechamento</Label>
                    <Input id="closingDay" name="closingDay" type="number" min={1} max={31} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dueDay">Dia Vencimento</Label>
                    <Input id="dueDay" name="dueDay" type="number" min={1} max={31} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creditLimit">Limite (R$)</Label>
                  <Input id="creditLimit" name="creditLimit" type="number" step="0.01" />
                </div>
                <Button type="submit" className="w-full" disabled={createCard.isPending}>
                  {createCard.isPending ? "Criando..." : "Criar Cartão"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Accounts */}
      <div>
        <h2 className="text-base font-semibold mb-3">Contas Bancárias</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <p className="text-muted-foreground text-sm col-span-full">Carregando...</p>
          ) : activeAccounts.length === 0 ? (
            <p className="text-muted-foreground text-sm col-span-full">Nenhuma conta cadastrada.</p>
          ) : (
            activeAccounts.map((acc) => {
              const Icon = accountTypeIcons[acc.type] || Landmark;
              return (
                <Card key={acc.id} className="relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
                  <CardContent className="relative py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold"
                        style={{
                          backgroundColor: acc.color ? `${acc.color}15` : undefined,
                          color: acc.color || undefined,
                        }}
                      >
                        {acc.icon || <Icon className="h-5 w-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{acc.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {ACCOUNT_TYPE_LABELS[acc.type as keyof typeof ACCOUNT_TYPE_LABELS]}
                          {acc.institution && ` · ${acc.institution}`}
                        </p>
                      </div>
                      <span className={`font-mono text-base font-bold tabular-nums ${acc.balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {formatBRL(acc.balance)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* Cards */}
      {activeCards.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3">Cartões de Crédito</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {activeCards.map((card) => (
              <Card key={card.id} className="relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
                <CardContent className="relative py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600">
                      <CreditCard className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{card.name}</p>
                        {card.brand && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 uppercase">
                            {card.brand}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground space-y-0.5 mt-1">
                        {card.lastFour && <p>Final {card.lastFour}</p>}
                        {card.closingDay && (
                          <p>Fecha dia {card.closingDay} · Vence dia {card.dueDay}</p>
                        )}
                        {card.creditLimit && (
                          <p>Limite: <span className="font-mono">{formatBRL(card.creditLimit)}</span></p>
                        )}
                        <p>Conta: {card.account.name}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
