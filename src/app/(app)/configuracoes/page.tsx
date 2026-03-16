"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function ConfiguracoesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Configurações</h1>

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Categorias</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="beneficiaries">Favorecidos</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="mt-4">
          <CategoriesTab />
        </TabsContent>
        <TabsContent value="tags" className="mt-4">
          <TagsTab />
        </TabsContent>
        <TabsContent value="beneficiaries" className="mt-4">
          <BeneficiariesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CategoriesTab() {
  const { data: categories } = trpc.categories.listTree.useQuery();
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);

  const createCategory = trpc.categories.create.useMutation({
    onSuccess: () => {
      utils.categories.invalidate();
      toast.success("Categoria criada");
      setDialogOpen(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Categorias organizam suas transações para análise e orçamento.
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="mr-2 h-3 w-3" /> Nova
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Categoria</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                createCategory.mutate({
                  name: fd.get("name") as string,
                  icon: (fd.get("icon") as string) || undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input name="name" required placeholder="Ex: Alimentação" />
              </div>
              <div className="space-y-2">
                <Label>Ícone (emoji)</Label>
                <Input name="icon" placeholder="Ex: 🍽️" />
              </div>
              <Button type="submit" className="w-full" disabled={createCategory.isPending}>
                Criar
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {categories?.map((cat) => (
          <Card key={cat.id}>
            <CardContent className="py-3">
              <div className="font-medium text-sm">
                {cat.icon} {cat.name}
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {cat.type === "income" ? "Receita" : cat.type === "expense" ? "Despesa" : "Ambos"}
                </Badge>
              </div>
              {cat.children.length > 0 && (
                <div className="mt-2 ml-6 space-y-1">
                  {cat.children.map((child) => (
                    <div key={child.id} className="text-sm text-muted-foreground">
                      {child.icon} {child.name}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TagsTab() {
  const { data: tags } = trpc.tags.list.useQuery();
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);

  const createTag = trpc.tags.create.useMutation({
    onSuccess: () => {
      utils.tags.invalidate();
      toast.success("Tag criada");
      setDialogOpen(false);
    },
  });

  const deleteTag = trpc.tags.delete.useMutation({
    onSuccess: () => {
      utils.tags.invalidate();
      toast.success("Tag removida");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Tags são livres e transversais. Use para agrupar despesas por contexto.
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="mr-2 h-3 w-3" /> Nova
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Tag</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                createTag.mutate({
                  name: fd.get("name") as string,
                  color: (fd.get("color") as string) || undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input name="name" required placeholder="Ex: Férias 2026" />
              </div>
              <div className="space-y-2">
                <Label>Cor</Label>
                <Input name="color" type="color" defaultValue="#6366f1" />
              </div>
              <Button type="submit" className="w-full" disabled={createTag.isPending}>
                Criar
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-2">
        {tags?.map((tag) => (
          <Badge
            key={tag.id}
            variant="secondary"
            className="text-sm py-1 px-3 gap-2"
            style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
          >
            {tag.name}
            <button
              onClick={() => deleteTag.mutate({ id: tag.id })}
              className="hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {tags?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma tag criada.</p>
        )}
      </div>
    </div>
  );
}

function BeneficiariesTab() {
  const { data: beneficiaries } = trpc.beneficiaries.list.useQuery();
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);

  const createBeneficiary = trpc.beneficiaries.create.useMutation({
    onSuccess: () => {
      utils.beneficiaries.invalidate();
      toast.success("Favorecido criado");
      setDialogOpen(false);
    },
  });

  const deleteBeneficiary = trpc.beneficiaries.delete.useMutation({
    onSuccess: () => {
      utils.beneficiaries.invalidate();
      toast.success("Favorecido removido");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Favorecidos são quem recebe ou envia dinheiro. Aliases ajudam a identificar nomes truncados.
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="mr-2 h-3 w-3" /> Novo
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Favorecido</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const aliasStr = fd.get("aliases") as string;
                createBeneficiary.mutate({
                  name: fd.get("name") as string,
                  aliases: aliasStr
                    ? aliasStr.split(",").map((a) => a.trim()).filter(Boolean)
                    : undefined,
                  notes: (fd.get("notes") as string) || undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input name="name" required placeholder="Ex: Supermercado Extra" />
              </div>
              <div className="space-y-2">
                <Label>Aliases (separados por vírgula)</Label>
                <Input name="aliases" placeholder="Ex: SUP EXTRA, EXTRA HIP, PAG*Extra" />
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Textarea name="notes" rows={2} placeholder="Observações..." />
              </div>
              <Button type="submit" className="w-full" disabled={createBeneficiary.isPending}>
                Criar
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {beneficiaries?.map((b) => {
          const aliases: string[] = b.aliases ? JSON.parse(b.aliases) : [];
          return (
            <Card key={b.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{b.name}</p>
                  {aliases.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Aliases: {aliases.join(", ")}
                    </p>
                  )}
                  {b.defaultCategory && (
                    <p className="text-xs text-muted-foreground">
                      Categoria padrão: {b.defaultCategory.icon} {b.defaultCategory.name}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => deleteBeneficiary.mutate({ id: b.id })}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {beneficiaries?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum favorecido cadastrado.</p>
        )}
      </div>
    </div>
  );
}
