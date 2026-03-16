"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatBRL } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, CreditCard, Pencil } from "lucide-react";
import { ACCOUNT_TYPE_LABELS } from "@/lib/constants";
import { toast } from "sonner";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contas e Cartões</h1>
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
                    type: fd.get("type") as "checking" | "savings" | "investment" | "wallet",
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

      {/* Accounts List */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <p className="text-muted-foreground col-span-full">Carregando...</p>
        ) : accounts?.length === 0 ? (
          <p className="text-muted-foreground col-span-full">Nenhuma conta cadastrada.</p>
        ) : (
          accounts?.filter(a => a.isActive).map((acc) => (
            <Card key={acc.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base">{acc.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {ACCOUNT_TYPE_LABELS[acc.type as keyof typeof ACCOUNT_TYPE_LABELS]}
                    {acc.institution && ` · ${acc.institution}`}
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                <p className={`text-xl font-bold font-mono ${acc.balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {formatBRL(acc.balance)}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Cards List */}
      {cards && cards.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mt-8">Cartões de Crédito</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cards.filter(c => c.isActive).map((card) => (
              <Card key={card.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      {card.name}
                    </CardTitle>
                    {card.brand && (
                      <Badge variant="outline" className="text-xs">
                        {card.brand.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                  {card.lastFour && <p>Final {card.lastFour}</p>}
                  {card.closingDay && <p>Fecha dia {card.closingDay} · Vence dia {card.dueDay}</p>}
                  {card.creditLimit && <p>Limite: {formatBRL(card.creditLimit)}</p>}
                  <p className="text-xs">Conta: {card.account.name}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
