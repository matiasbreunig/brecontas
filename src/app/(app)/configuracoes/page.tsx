"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAutoSave } from "@/hooks/use-auto-save";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, ChevronRight, Zap, TestTube } from "lucide-react";
import { CategoryCombobox } from "@/components/category-combobox";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { toast } from "sonner";

export default function ConfiguracoesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Categorias, tags e favorecidos</p>
      </div>

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Categorias</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="beneficiaries">Favorecidos</TabsTrigger>
          <TabsTrigger value="rules">Regras</TabsTrigger>
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
        <TabsContent value="rules" className="mt-4">
          <RulesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ──────────────────────────── Categories ──────────────────────────── */

function CategoriesTab() {
  const { data: categories } = trpc.categories.listTree.useQuery();
  const { data: allCategories } = trpc.categories.list.useQuery();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const createCategory = trpc.categories.create.useMutation({
    onSuccess: () => {
      utils.categories.invalidate();
      toast.success("Categoria criada");
      setCreateOpen(false);
    },
  });

  const deleteCategory = trpc.categories.delete.useMutation({
    onSuccess: () => {
      utils.categories.invalidate();
      toast.success("Categoria removida");
    },
  });

  const parentOptions = allCategories?.filter(c => !c.parentId && c.isActive) ?? [];

  function startEdit(cat: { id: string }) {
    setEditingId(cat.id);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Categorias organizam suas transações para análise e orçamento.
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                const parentId = fd.get("parentId") as string;
                createCategory.mutate({
                  name: fd.get("name") as string,
                  icon: (fd.get("icon") as string) || undefined,
                  type: fd.get("type") as "income" | "expense" | "both",
                  parentId: parentId && parentId !== "__none__" ? parentId : undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-[1fr_80px] gap-3">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input name="name" required placeholder="Ex: Alimentação" />
                </div>
                <div className="space-y-2">
                  <Label>Ícone</Label>
                  <Input name="icon" placeholder="🍽️" className="text-center" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select name="type" defaultValue="expense">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Despesa</SelectItem>
                      <SelectItem value="income">Receita</SelectItem>
                      <SelectItem value="both">Ambos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Grupo pai</Label>
                  <Select name="parentId" defaultValue="__none__">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum (raiz)</SelectItem>
                      {parentOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.icon} {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createCategory.isPending}>
                Criar Categoria
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog — auto-save per field */}
      <Dialog open={!!editingId} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Categoria</DialogTitle>
          </DialogHeader>
          {editingId && (
            <CategoryEditFields
              categoryId={editingId}
              category={allCategories?.find((c) => c.id === editingId) ?? null}
              parentOptions={parentOptions.filter((p) => p.id !== editingId)}
              onClose={() => setEditingId(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Category Tree */}
      <div className="space-y-2">
        {categories?.map((cat) => (
          <Card key={cat.id} className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex items-center gap-2 px-4 py-3 hover:bg-muted/50 transition-colors">
                <span className="text-base">{cat.icon}</span>
                <span className="font-medium text-sm flex-1">{cat.name}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {cat.type === "income" ? "Receita" : cat.type === "expense" ? "Despesa" : "Ambos"}
                </Badge>
                {cat.children.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">{cat.children.length} sub</span>
                )}
                <button
                  onClick={() => startEdit(cat)}
                  className="rounded-lg p-1.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Excluir "${cat.name}"? Subcategorias serão movidas para raiz.`)) {
                      deleteCategory.mutate({ id: cat.id });
                    }
                  }}
                  className="rounded-lg p-1.5 hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {cat.children.length > 0 && (
                <div className="border-t border-border/50">
                  {cat.children.map((child) => (
                    <div
                      key={child.id}
                      className="flex items-center gap-2 pl-10 pr-4 py-2.5 hover:bg-muted/30 transition-colors"
                    >
                      <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                      <span className="text-sm">{child.icon}</span>
                      <span className="text-sm text-muted-foreground flex-1">{child.name}</span>
                      <button
                        onClick={() => startEdit(child)}
                        className="rounded-lg p-1 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Excluir "${child.name}"?`)) {
                            deleteCategory.mutate({ id: child.id });
                          }
                        }}
                        className="rounded-lg p-1 hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {categories?.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">Nenhuma categoria cadastrada.</p>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── Category Edit Fields ──────────────────────────── */

interface CategoryEditFieldsProps {
  categoryId: string;
  category: { id: string; name: string; icon: string | null; type: string; parentId: string | null } | null;
  parentOptions: { id: string; name: string; icon: string | null }[];
  onClose: () => void;
}

function CategoryEditFields({ categoryId, category, parentOptions, onClose }: CategoryEditFieldsProps) {
  const utils = trpc.useUtils();
  const updateCategory = trpc.categories.update.useMutation({
    onSuccess: () => utils.categories.invalidate(),
  });

  const saveCatField = useCallback(
    (field: string) => async (value: unknown) => {
      await updateCategory.mutateAsync({
        id: categoryId,
        [field]: field === "parentId" ? (value === "__none__" ? null : value) : (value || undefined),
      } as Parameters<typeof updateCategory.mutateAsync>[0]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoryId],
  );

  const name = useAutoSave({
    entityType: "categories",
    entityId: categoryId,
    field: "name",
    serverValue: category?.name ?? "",
    save: saveCatField("name"),
    debounceMs: 400,
    description: "Nome da categoria alterado",
  });

  const icon = useAutoSave({
    entityType: "categories",
    entityId: categoryId,
    field: "icon",
    serverValue: category?.icon ?? "",
    save: saveCatField("icon"),
    debounceMs: 400,
    description: "Ícone da categoria alterado",
  });

  const type = useAutoSave({
    entityType: "categories",
    entityId: categoryId,
    field: "type",
    serverValue: category?.type ?? "expense",
    save: saveCatField("type"),
    debounceMs: 0,
    description: "Tipo da categoria alterado",
  });

  const parentId = useAutoSave({
    entityType: "categories",
    entityId: categoryId,
    field: "parentId",
    serverValue: category?.parentId ?? "__none__",
    save: saveCatField("parentId"),
    debounceMs: 0,
    description: "Grupo pai alterado",
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_80px] gap-3">
        <div className="space-y-2">
          <Label>Nome</Label>
          <Input
            value={name.value}
            onChange={(e) => name.setValue(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Ícone</Label>
          <Input
            value={icon.value}
            onChange={(e) => icon.setValue(e.target.value)}
            className="text-center"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={type.value} onValueChange={(v) => type.setValue(v ?? "expense")}>
            <SelectTrigger>
              {type.value ? (
                <span className="flex flex-1 text-left truncate">
                  {{ expense: "Despesa", income: "Receita", both: "Ambos" }[type.value] ?? type.value}
                </span>
              ) : (
                <SelectValue />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Despesa</SelectItem>
              <SelectItem value="income">Receita</SelectItem>
              <SelectItem value="both">Ambos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Grupo pai</Label>
          <CategoryCombobox
            categories={parentOptions}
            value={parentId.value !== "__none__" ? parentId.value : undefined}
            onSelect={(id) => parentId.setValue(id ?? "__none__")}
            placeholder="Nenhum (raiz)"
            emptyLabel="Nenhum (raiz)"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

/* ──────────────────────────── Tags ──────────────────────────── */

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
                Criar Tag
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
            className="text-sm py-1.5 px-3 gap-2 rounded-xl"
            style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
          >
            {tag.name}
            <button
              onClick={() => deleteTag.mutate({ id: tag.id })}
              className="hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {tags?.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">Nenhuma tag criada.</p>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── Beneficiaries ──────────────────────────── */

function BeneficiariesTab() {
  const { data: beneficiaries } = trpc.beneficiaries.list.useQuery();
  const { data: categories } = trpc.categories.list.useQuery();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const createBeneficiary = trpc.beneficiaries.create.useMutation({
    onSuccess: () => {
      utils.beneficiaries.invalidate();
      toast.success("Favorecido criado");
      setCreateOpen(false);
    },
  });

  const deleteBeneficiary = trpc.beneficiaries.delete.useMutation({
    onSuccess: () => {
      utils.beneficiaries.invalidate();
      toast.success("Favorecido removido");
    },
  });

  function startEdit(b: { id: string }) {
    setEditingId(b.id);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Favorecidos identificam quem recebe/envia. Prefixe aliases com <code className="text-xs bg-muted px-1 py-0.5 rounded">regex:</code> para padrões avançados.
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                const categoryId = fd.get("defaultCategoryId") as string;
                createBeneficiary.mutate({
                  name: fd.get("name") as string,
                  aliases: aliasStr
                    ? aliasStr.split(",").map((a) => a.trim()).filter(Boolean)
                    : undefined,
                  defaultCategoryId: categoryId && categoryId !== "__none__" ? categoryId : undefined,
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
                <Input name="aliases" placeholder="Ex: SUP EXTRA, EXTRA HIP, regex:PAG\*EXTRA.*" />
                <p className="text-[11px] text-muted-foreground">
                  Prefixe com <code className="bg-muted px-1 rounded">regex:</code> para usar expressões regulares.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Categoria padrão</Label>
                <Select name="defaultCategoryId" defaultValue="__none__">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhuma</SelectItem>
                    {categories?.filter(c => c.isActive).map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.icon} {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Textarea name="notes" rows={2} placeholder="Observações..." />
              </div>
              <Button type="submit" className="w-full" disabled={createBeneficiary.isPending}>
                Criar Favorecido
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog — auto-save per field */}
      <Dialog open={!!editingId} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Favorecido</DialogTitle>
          </DialogHeader>
          {editingId && (
            <BeneficiaryEditFields
              beneficiaryId={editingId}
              beneficiary={beneficiaries?.find((b) => b.id === editingId) ?? null}
              categories={categories?.filter((c) => c.isActive) ?? []}
              onClose={() => setEditingId(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Beneficiary List */}
      <div className="space-y-2">
        {beneficiaries?.map((b) => {
          const aliases: string[] = b.aliases ? JSON.parse(b.aliases) : [];
          return (
            <Card key={b.id}>
              <CardContent className="py-3 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground">
                  {b.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{b.name}</p>
                  {aliases.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {aliases.map((a, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {b.defaultCategory && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {b.defaultCategory.icon} {b.defaultCategory.name}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => startEdit(b)}
                  className="rounded-lg p-1.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Excluir "${b.name}"?`)) {
                      deleteBeneficiary.mutate({ id: b.id });
                    }
                  }}
                  className="rounded-lg p-1.5 hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </CardContent>
            </Card>
          );
        })}
        {beneficiaries?.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">Nenhum favorecido cadastrado.</p>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── Beneficiary Edit Fields ──────────────────────────── */

interface BeneficiaryEditFieldsProps {
  beneficiaryId: string;
  beneficiary: { id: string; name: string; aliases: string | null; notes: string | null; defaultCategoryId: string | null } | null;
  categories: { id: string; name: string; icon: string | null }[];
  onClose: () => void;
}

function BeneficiaryEditFields({ beneficiaryId, beneficiary, categories, onClose }: BeneficiaryEditFieldsProps) {
  const utils = trpc.useUtils();
  const updateBeneficiary = trpc.beneficiaries.update.useMutation({
    onSuccess: () => utils.beneficiaries.invalidate(),
  });

  const saveBenField = useCallback(
    (field: string) => async (value: unknown) => {
      const data: Record<string, unknown> = { id: beneficiaryId };
      if (field === "defaultCategoryId") {
        data.defaultCategoryId = value === "__none__" ? null : value;
      } else {
        data[field] = value || undefined;
      }
      await updateBeneficiary.mutateAsync(
        data as Parameters<typeof updateBeneficiary.mutateAsync>[0],
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beneficiaryId],
  );

  const serverAliases = useMemo<string[]>(() => {
    if (!beneficiary?.aliases) return [];
    return JSON.parse(beneficiary.aliases) as string[];
  }, [beneficiary?.aliases]);

  const name = useAutoSave({
    entityType: "beneficiaries",
    entityId: beneficiaryId,
    field: "name",
    serverValue: beneficiary?.name ?? "",
    save: saveBenField("name"),
    debounceMs: 400,
    description: "Nome do favorecido alterado",
  });

  const aliases = useAutoSave<string[]>({
    entityType: "beneficiaries",
    entityId: beneficiaryId,
    field: "aliases",
    serverValue: serverAliases,
    save: async (value: string[]) => {
      await updateBeneficiary.mutateAsync({
        id: beneficiaryId,
        aliases: value,
      } as Parameters<typeof updateBeneficiary.mutateAsync>[0]);
    },
    debounceMs: 600,
    description: "Aliases alterados",
  });

  // Local display string for the aliases input
  const [aliasesDisplay, setAliasesDisplay] = useState(() => serverAliases.join(", "));
  // Sync display from auto-save value (e.g. after undo)
  useEffect(() => {
    setAliasesDisplay(aliases.value.join(", "));
  }, [aliases.value]);

  const defaultCategoryId = useAutoSave({
    entityType: "beneficiaries",
    entityId: beneficiaryId,
    field: "defaultCategoryId",
    serverValue: beneficiary?.defaultCategoryId ?? "__none__",
    save: saveBenField("defaultCategoryId"),
    debounceMs: 0,
    description: "Categoria padrão alterada",
  });

  const notes = useAutoSave({
    entityType: "beneficiaries",
    entityId: beneficiaryId,
    field: "notes",
    serverValue: beneficiary?.notes ?? "",
    save: saveBenField("notes"),
    debounceMs: 400,
    description: "Notas do favorecido alteradas",
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input value={name.value} onChange={(e) => name.setValue(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Aliases (separados por vírgula)</Label>
        <Input
          value={aliasesDisplay}
          onChange={(e) => {
            setAliasesDisplay(e.target.value);
            const arr = e.target.value.split(",").map((a) => a.trim()).filter(Boolean);
            aliases.setValue(arr);
          }}
        />
        <p className="text-[11px] text-muted-foreground">
          Prefixe com <code className="bg-muted px-1 rounded">regex:</code> para padrões.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Categoria padrão</Label>
        <CategoryCombobox
          categories={categories}
          value={defaultCategoryId.value !== "__none__" ? defaultCategoryId.value : undefined}
          onSelect={(id) => defaultCategoryId.setValue(id ?? "__none__")}
          placeholder="Nenhuma"
          emptyLabel="Nenhuma"
        />
      </div>
      <div className="space-y-2">
        <Label>Notas</Label>
        <Textarea value={notes.value} onChange={(e) => notes.setValue(e.target.value)} rows={2} />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

/* ──────────────────────────── Rules ──────────────────────────── */

function RulesTab() {
  const { data: rules } = trpc.reconciliation.listRules.useQuery();
  const { data: beneficiariesData } = trpc.beneficiaries.list.useQuery();
  const { data: categoriesData } = trpc.categories.list.useQuery();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ matchCount: number; totalTested: number } | null>(null);

  const createRule = trpc.reconciliation.createRule.useMutation({
    onSuccess: () => {
      utils.reconciliation.listRules.invalidate();
      toast.success("Regra criada");
      setCreateOpen(false);
    },
  });

  const deleteRule = trpc.reconciliation.deleteRule.useMutation({
    onSuccess: () => {
      utils.reconciliation.listRules.invalidate();
      toast.success("Regra removida");
    },
  });

  const testRule = trpc.reconciliation.testRule.useMutation({
    onSuccess: (data) => {
      setTestResult({ matchCount: data.matchCount, totalTested: data.totalTested });
    },
  });

  const applyRules = trpc.reconciliation.applyRules.useMutation({
    onSuccess: (data) => {
      utils.transactions.invalidate();
      toast.success(`${data.matched} transações classificadas`);
    },
  });

  const matchTypeLabels: Record<string, string> = {
    exact: "Exato",
    contains: "Contém",
    regex: "Regex",
  };

  const matchTypeStyles: Record<string, string> = {
    exact: "bg-blue-50 text-blue-700",
    contains: "bg-purple-50 text-purple-700",
    regex: "bg-amber-50 text-amber-700",
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Regras classificam transações automaticamente por padrão de descrição.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => applyRules.mutate({})}
            disabled={applyRules.isPending}
          >
            <Zap className="mr-2 h-3 w-3" />
            Aplicar Regras
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="mr-2 h-3 w-3" /> Nova
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova Regra de Conciliação</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const beneficiaryId = fd.get("beneficiaryId") as string;
                  const categoryId = fd.get("categoryId") as string;
                  const paymentMethod = fd.get("paymentMethod") as string;
                  createRule.mutate({
                    pattern: fd.get("pattern") as string,
                    matchType: fd.get("matchType") as "exact" | "contains" | "regex",
                    beneficiaryId: beneficiaryId && beneficiaryId !== "__none__" ? beneficiaryId : undefined,
                    categoryId: categoryId && categoryId !== "__none__" ? categoryId : undefined,
                    paymentMethod: paymentMethod && paymentMethod !== "__none__"
                      ? paymentMethod as "pix" | "debit" | "credit" | "transfer" | "boleto" | "cash" | "other"
                      : undefined,
                    priority: parseInt(fd.get("priority") as string) || 0,
                  });
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>Padrão</Label>
                  <Input name="pattern" required placeholder="Ex: MERCADO LIVRE, PIX.*JOAO, ^UBER.*" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Tipo de match</Label>
                    <Select name="matchType" defaultValue="contains">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exact">Exato</SelectItem>
                        <SelectItem value="contains">Contém</SelectItem>
                        <SelectItem value="regex">Regex</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Prioridade</Label>
                    <Input name="priority" type="number" defaultValue="0" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Favorecido</Label>
                  <Select name="beneficiaryId" defaultValue="__none__">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {beneficiariesData?.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <Select name="categoryId" defaultValue="__none__">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Nenhuma</SelectItem>
                        {categoriesData?.filter(c => c.isActive).map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.icon} {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Pagamento</Label>
                    <Select name="paymentMethod" defaultValue="__none__">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Nenhum</SelectItem>
                        {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={createRule.isPending}>
                  Criar Regra
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Rule List */}
      <div className="space-y-2">
        {rules?.map((rule) => {
          const beneficiary = beneficiariesData?.find(b => b.id === rule.beneficiaryId);
          const category = categoriesData?.find(c => c.id === rule.categoryId);

          return (
            <Card key={rule.id}>
              <CardContent className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{rule.pattern}</code>
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 h-4 ${matchTypeStyles[rule.matchType]}`}>
                      {matchTypeLabels[rule.matchType]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                    {beneficiary && <span>→ {beneficiary.name}</span>}
                    {category && <span>· {category.icon} {category.name}</span>}
                    {rule.paymentMethod && <span>· {PAYMENT_METHOD_LABELS[rule.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS]}</span>}
                    <span>· {rule.hitCount} matches</span>
                    <span>· prioridade {rule.priority}</span>
                  </div>
                </div>
                <button
                  onClick={() => testRule.mutate({ pattern: rule.pattern, matchType: rule.matchType as "exact" | "contains" | "regex" })}
                  className="rounded-lg p-1.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  title="Testar regra"
                >
                  <TestTube className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Excluir regra "${rule.pattern}"?`)) {
                      deleteRule.mutate({ id: rule.id });
                    }
                  }}
                  className="rounded-lg p-1.5 hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </CardContent>
            </Card>
          );
        })}
        {rules?.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">
            Nenhuma regra criada. Regras classificam transações automaticamente ao importar.
          </p>
        )}
      </div>

      {testResult && (
        <div className="p-3 rounded-lg bg-muted text-sm">
          Teste: <strong>{testResult.matchCount}</strong> de {testResult.totalTested} transações recentes correspondem à regra.
          <button onClick={() => setTestResult(null)} className="ml-2 text-muted-foreground hover:text-foreground">✕</button>
        </div>
      )}
    </div>
  );
}
