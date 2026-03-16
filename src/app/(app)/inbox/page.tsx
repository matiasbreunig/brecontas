"use client";

import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateBR } from "@/lib/date";
import { formatBRL } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { FileUpload } from "@/components/file-upload";
import { InferredField, InferredBadge, type FieldSource } from "@/components/inferred-field";
import { BeneficiaryCombobox } from "@/components/beneficiary-combobox";
import { toast } from "sonner";
import {
  Inbox,
  ArrowRight,
  Trash2,
  MessageSquare,
  Mail,
  Camera,
  Bot,
  Send,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { TRANSACTION_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/constants";

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  manual: <MessageSquare className="h-4 w-4" />,
  whatsapp: <MessageSquare className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  receipt: <Camera className="h-4 w-4" />,
  mcp: <Bot className="h-4 w-4" />,
  ai_chat: <Bot className="h-4 w-4" />,
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  whatsapp: "WhatsApp",
  email: "E-mail",
  receipt: "Recibo",
  mcp: "MCP",
  ai_chat: "Chat IA",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  processing: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  converted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  discarded: "bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-500",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  converted: "Convertido",
  discarded: "Descartado",
};

// Per-field state tracking inference source and confirmation
interface FieldState {
  source: FieldSource;
  confidence: number;
  isConfirmed: boolean;
}

type FieldStates = {
  type: FieldState;
  amount: FieldState;
  date: FieldState;
  description: FieldState;
  accountId: FieldState;
  categoryId: FieldState;
  paymentMethod: FieldState;
  beneficiary: FieldState;
};

function defaultFieldStates(): FieldStates {
  const def = (): FieldState => ({ source: "user", confidence: 0, isConfirmed: false });
  return {
    type: def(),
    amount: def(),
    date: def(),
    description: def(),
    accountId: def(),
    categoryId: def(),
    paymentMethod: def(),
    beneficiary: def(),
  };
}

export default function InboxPage() {
  const [newContent, setNewContent] = useState("");
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [selectedRawContent, setSelectedRawContent] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"text" | "upload">("text");
  const [convertForm, setConvertForm] = useState({
    type: "expense" as string,
    amount: "",
    date: new Date().toISOString().split("T")[0],
    description: "",
    accountId: "",
    categoryId: "",
    paymentMethod: "",
    beneficiaryId: "",
    beneficiaryName: "",
  });
  const [fieldStates, setFieldStates] = useState<FieldStates>(defaultFieldStates());

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.inbox.list.useQuery({ status: undefined });
  const { data: accounts } = trpc.accounts.list.useQuery();
  const { data: categoriesTree } = trpc.categories.listTree.useQuery();
  const { data: beneficiariesList } = trpc.beneficiaries.list.useQuery();

  // Inference query — only fires when convert dialog opens with a selected item
  const { data: inferenceData, isFetching: isInferring } = trpc.inbox.infer.useQuery(
    { inboxItemId: selectedItem! },
    { enabled: !!selectedItem && convertDialogOpen }
  );

  // Apply inference results when they arrive
  useEffect(() => {
    if (!inferenceData || !convertDialogOpen) return;

    const newForm = { ...convertForm };
    const newStates = { ...fieldStates };

    if (inferenceData.type && inferenceData.type.confidence > 0.3) {
      newForm.type = inferenceData.type.value;
      newStates.type = {
        source: inferenceData.type.source as FieldSource,
        confidence: inferenceData.type.confidence,
        isConfirmed: false,
      };
    }

    if (inferenceData.amount && inferenceData.amount.confidence > 0.3) {
      // Amount is in centavos from inference, display as reais
      newForm.amount = (inferenceData.amount.value / 100).toFixed(2);
      newStates.amount = {
        source: inferenceData.amount.source as FieldSource,
        confidence: inferenceData.amount.confidence,
        isConfirmed: false,
      };
    }

    if (inferenceData.date && inferenceData.date.confidence > 0.3) {
      newForm.date = inferenceData.date.value;
      newStates.date = {
        source: inferenceData.date.source as FieldSource,
        confidence: inferenceData.date.confidence,
        isConfirmed: false,
      };
    }

    if (inferenceData.description && inferenceData.description.confidence > 0.3) {
      newForm.description = inferenceData.description.value;
      newStates.description = {
        source: inferenceData.description.source as FieldSource,
        confidence: inferenceData.description.confidence,
        isConfirmed: false,
      };
    }

    if (inferenceData.accountId && inferenceData.accountId.confidence > 0.3) {
      newForm.accountId = inferenceData.accountId.value;
      newStates.accountId = {
        source: inferenceData.accountId.source as FieldSource,
        confidence: inferenceData.accountId.confidence,
        isConfirmed: false,
      };
    }

    if (inferenceData.categoryId && inferenceData.categoryId.confidence > 0.3) {
      newForm.categoryId = inferenceData.categoryId.value;
      newStates.categoryId = {
        source: inferenceData.categoryId.source as FieldSource,
        confidence: inferenceData.categoryId.confidence,
        isConfirmed: false,
      };
    }

    if (inferenceData.paymentMethod && inferenceData.paymentMethod.confidence > 0.3) {
      newForm.paymentMethod = inferenceData.paymentMethod.value;
      newStates.paymentMethod = {
        source: inferenceData.paymentMethod.source as FieldSource,
        confidence: inferenceData.paymentMethod.confidence,
        isConfirmed: false,
      };
    }

    if (inferenceData.beneficiaryId && inferenceData.beneficiaryId.confidence > 0.3) {
      newForm.beneficiaryId = inferenceData.beneficiaryId.value;
      newStates.beneficiary = {
        source: inferenceData.beneficiaryId.source as FieldSource,
        confidence: inferenceData.beneficiaryId.confidence,
        isConfirmed: false,
      };
    } else if (inferenceData.beneficiaryName && inferenceData.beneficiaryName.confidence > 0.3) {
      newForm.beneficiaryName = inferenceData.beneficiaryName.value;
      newStates.beneficiary = {
        source: inferenceData.beneficiaryName.source as FieldSource,
        confidence: inferenceData.beneficiaryName.confidence,
        isConfirmed: false,
      };
    }

    setConvertForm(newForm);
    setFieldStates(newStates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inferenceData]);

  const createMutation = trpc.inbox.create.useMutation({
    onSuccess: () => {
      setNewContent("");
      utils.inbox.list.invalidate();
      toast.success("Item adicionado ao inbox");
    },
  });

  const discardMutation = trpc.inbox.discard.useMutation({
    onSuccess: () => {
      utils.inbox.list.invalidate();
      toast.success("Item descartado");
    },
  });

  const convertMutation = trpc.inbox.convertToTransaction.useMutation({
    onSuccess: () => {
      setConvertDialogOpen(false);
      setSelectedItem(null);
      utils.inbox.list.invalidate();
      utils.beneficiaries.list.invalidate();
      toast.success("Convertido em transação");
    },
  });

  const aiEnhanceMutation = trpc.inbox.inferAI.useMutation({
    onSuccess: (result) => {
      if (!result) return;

      setConvertForm((prev) => {
        const updated = { ...prev };
        if (result.beneficiaryId) updated.beneficiaryId = result.beneficiaryId.value;
        if (result.categoryId) updated.categoryId = result.categoryId.value;
        if (result.description) updated.description = result.description.value;
        return updated;
      });

      setFieldStates((prev) => {
        const updated = { ...prev };
        if (result.beneficiaryId) {
          updated.beneficiary = {
            source: "ai",
            confidence: result.beneficiaryId.confidence,
            isConfirmed: false,
          };
        }
        if (result.categoryId) {
          updated.categoryId = {
            source: "ai",
            confidence: result.categoryId.confidence,
            isConfirmed: false,
          };
        }
        if (result.description) {
          updated.description = {
            source: "ai",
            confidence: result.description.confidence,
            isConfirmed: false,
          };
        }
        return updated;
      });

      toast.success("Campos aprimorados com IA");
    },
    onError: () => {
      toast.error("Erro ao consultar IA. Tente novamente.");
    },
  });

  function handleSubmit() {
    if (!newContent.trim()) return;
    createMutation.mutate({ rawContent: newContent.trim(), source: "manual" });
  }

  const handleUpload = useCallback(
    async (file: File) => {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Erro no upload");
        }

        toast.success("Arquivo enviado! OCR em processamento...");
        utils.inbox.list.invalidate();

        // Poll for OCR completion
        const pollInterval = setInterval(() => {
          utils.inbox.list.invalidate();
        }, 3000);

        setTimeout(() => clearInterval(pollInterval), 30000);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro no upload");
      } finally {
        setIsUploading(false);
      }
    },
    [utils]
  );

  function handleConvert() {
    if (!selectedItem || !convertForm.amount) return;
    convertMutation.mutate({
      inboxItemId: selectedItem,
      type: convertForm.type as "income" | "expense" | "transfer" | "refund",
      amount: Math.round(parseFloat(convertForm.amount) * 100),
      date: convertForm.date,
      description: convertForm.description || undefined,
      accountId: convertForm.accountId || undefined,
      categoryId: convertForm.categoryId || undefined,
      beneficiaryId: convertForm.beneficiaryId || undefined,
      beneficiaryName: !convertForm.beneficiaryId && convertForm.beneficiaryName ? convertForm.beneficiaryName : undefined,
      paymentMethod: (convertForm.paymentMethod as "pix" | "debit" | "credit" | "transfer" | "boleto" | "cash" | "other") || undefined,
    });
  }

  function openConvertDialog(itemId: string, rawContent: string) {
    setSelectedItem(itemId);
    setSelectedRawContent(rawContent);

    // Reset form with minimal defaults — inference will fill the rest
    setConvertForm({
      type: "expense",
      amount: "",
      date: new Date().toISOString().split("T")[0],
      description: rawContent.slice(0, 200),
      accountId: accounts?.[0]?.id || "",
      categoryId: "",
      paymentMethod: "",
      beneficiaryId: "",
      beneficiaryName: "",
    });
    setFieldStates(defaultFieldStates());
    setConvertDialogOpen(true);
  }

  // Mark field as user-edited when user changes it
  function updateField(field: keyof FieldStates, value: string) {
    setConvertForm((prev) => ({ ...prev, [field]: value }));
    setFieldStates((prev) => ({
      ...prev,
      [field]: { source: "user" as FieldSource, confidence: 1, isConfirmed: true },
    }));
  }

  const allCategories = categoriesTree?.flatMap((parent) => [
    parent,
    ...(parent.children || []),
  ]) || [];

  const pendingItems = data?.items.filter((i) => i.status === "pending" || i.status === "processing") || [];
  const otherItems = data?.items.filter((i) => i.status !== "pending" && i.status !== "processing") || [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Inbox Financeiro</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Capture qualquer informação financeira. Converta depois.
        </p>
      </div>

      {/* Quick capture with tabs */}
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent" />
        <CardContent className="relative pt-5 pb-4">
          {/* Tabs */}
          <div className="flex gap-1 mb-3 bg-muted rounded-lg p-1 w-fit">
            <button
              onClick={() => setActiveTab("text")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors min-h-[36px] ${
                activeTab === "text" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 inline mr-1.5" />
              Texto
            </button>
            <button
              onClick={() => setActiveTab("upload")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors min-h-[36px] ${
                activeTab === "upload" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5 inline mr-1.5" />
              Imagem/PDF
            </button>
          </div>

          {activeTab === "text" ? (
            <>
              <div className="flex flex-col sm:flex-row gap-3">
                <Textarea
                  placeholder="Paguei R$ 45 no almoço... Recebi PIX de R$ 200..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="min-h-[80px] resize-none flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleSubmit();
                    }
                  }}
                />
                <Button
                  onClick={handleSubmit}
                  disabled={!newContent.trim() || createMutation.isPending}
                  className="self-stretch sm:self-end min-h-[44px]"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Capturar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Cmd+Enter para enviar · Texto livre — a estruturação vem depois
              </p>
            </>
          ) : (
            <FileUpload onUpload={handleUpload} isUploading={isUploading} />
          )}
        </CardContent>
      </Card>

      {/* Pending items */}
      {pendingItems.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Inbox className="h-5 w-5 text-amber-600" />
            Pendentes ({pendingItems.length})
          </h2>
          <div className="space-y-2">
            {pendingItems.map((item) => (
              <InboxCard
                key={item.id}
                item={item}
                onConvert={() => openConvertDialog(item.id, item.rawContent)}
                onDiscard={() => discardMutation.mutate({ id: item.id })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Processed items */}
      {otherItems.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-muted-foreground">
            Processados ({otherItems.length})
          </h2>
          <div className="space-y-2">
            {otherItems.map((item) => (
              <Card key={item.id} className="opacity-60">
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-muted p-2 shrink-0">
                      {SOURCE_ICONS[item.source] || <MessageSquare className="h-4 w-4" />}
                    </div>
                    <p className="text-sm flex-1 truncate">{item.rawContent}</p>
                    <Badge variant="secondary" className={STATUS_STYLES[item.status]}>
                      {STATUS_LABELS[item.status]}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!isLoading && !data?.items.length && (
        <div className="text-center py-12 text-muted-foreground">
          <Inbox className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Inbox vazio. Capture algo!</p>
        </div>
      )}

      {/* Convert Dialog with inference */}
      <ResponsiveDialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              Converter em Transação
              {isInferring && (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analisando...
                </span>
              )}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          {/* Raw content reference */}
          <div className="rounded-lg bg-muted/50 border px-3 py-2 text-xs text-muted-foreground max-h-20 overflow-y-auto">
            <span className="font-medium text-foreground/70">Original: </span>
            {selectedRawContent}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InferredField
                source={fieldStates.type.source}
                confidence={fieldStates.type.confidence}
                isConfirmed={fieldStates.type.isConfirmed}
              >
                <Label className="flex items-center gap-1">
                  Tipo
                  {fieldStates.type.source !== "user" && !fieldStates.type.isConfirmed && (
                    <InferredBadge source={fieldStates.type.source} confidence={fieldStates.type.confidence} />
                  )}
                </Label>
                <Select value={convertForm.type} onValueChange={(v) => updateField("type", v ?? "expense")}>
                  <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InferredField>

              <InferredField
                source={fieldStates.amount.source}
                confidence={fieldStates.amount.confidence}
                isConfirmed={fieldStates.amount.isConfirmed}
              >
                <Label className="flex items-center gap-1">
                  Valor (R$)
                  {fieldStates.amount.source !== "user" && !fieldStates.amount.isConfirmed && (
                    <InferredBadge source={fieldStates.amount.source} confidence={fieldStates.amount.confidence} />
                  )}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  value={convertForm.amount}
                  onChange={(e) => updateField("amount", e.target.value)}
                  className="min-h-[44px]"
                />
              </InferredField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InferredField
                source={fieldStates.date.source}
                confidence={fieldStates.date.confidence}
                isConfirmed={fieldStates.date.isConfirmed}
              >
                <Label className="flex items-center gap-1">
                  Data
                  {fieldStates.date.source !== "user" && !fieldStates.date.isConfirmed && (
                    <InferredBadge source={fieldStates.date.source} confidence={fieldStates.date.confidence} />
                  )}
                </Label>
                <Input
                  type="date"
                  value={convertForm.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className="min-h-[44px]"
                />
              </InferredField>

              <InferredField
                source={fieldStates.accountId.source}
                confidence={fieldStates.accountId.confidence}
                isConfirmed={fieldStates.accountId.isConfirmed}
              >
                <Label className="flex items-center gap-1">
                  Conta
                  {fieldStates.accountId.source !== "user" && !fieldStates.accountId.isConfirmed && (
                    <InferredBadge source={fieldStates.accountId.source} confidence={fieldStates.accountId.confidence} />
                  )}
                </Label>
                <Select value={convertForm.accountId} onValueChange={(v) => updateField("accountId", v ?? "")}>
                  <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {accounts?.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InferredField>
            </div>

            <InferredField
              source={fieldStates.beneficiary.source}
              confidence={fieldStates.beneficiary.confidence}
              isConfirmed={fieldStates.beneficiary.isConfirmed}
            >
              <Label className="flex items-center gap-1">
                Beneficiário
                {fieldStates.beneficiary.source !== "user" && !fieldStates.beneficiary.isConfirmed && (
                  <InferredBadge source={fieldStates.beneficiary.source} confidence={fieldStates.beneficiary.confidence} />
                )}
              </Label>
              <BeneficiaryCombobox
                beneficiaries={beneficiariesList?.map((b) => ({ id: b.id, name: b.name })) || []}
                value={convertForm.beneficiaryId}
                freeText={convertForm.beneficiaryName}
                onSelect={(id, freeText) => {
                  setConvertForm((prev) => ({
                    ...prev,
                    beneficiaryId: id || "",
                    beneficiaryName: freeText || "",
                  }));
                  setFieldStates((prev) => ({
                    ...prev,
                    beneficiary: { source: "user", confidence: 1, isConfirmed: true },
                  }));
                }}
              />
            </InferredField>

            <InferredField
              source={fieldStates.categoryId.source}
              confidence={fieldStates.categoryId.confidence}
              isConfirmed={fieldStates.categoryId.isConfirmed}
            >
              <Label className="flex items-center gap-1">
                Categoria
                {fieldStates.categoryId.source !== "user" && !fieldStates.categoryId.isConfirmed && (
                  <InferredBadge source={fieldStates.categoryId.source} confidence={fieldStates.categoryId.confidence} />
                )}
              </Label>
              <Select value={convertForm.categoryId} onValueChange={(v) => updateField("categoryId", v ?? "")}>
                <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {allCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.icon} {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InferredField>

            <InferredField
              source={fieldStates.description.source}
              confidence={fieldStates.description.confidence}
              isConfirmed={fieldStates.description.isConfirmed}
            >
              <Label className="flex items-center gap-1">
                Descrição
                {fieldStates.description.source !== "user" && !fieldStates.description.isConfirmed && (
                  <InferredBadge source={fieldStates.description.source} confidence={fieldStates.description.confidence} />
                )}
              </Label>
              <Input
                value={convertForm.description}
                onChange={(e) => updateField("description", e.target.value)}
                className="min-h-[44px]"
              />
            </InferredField>

            <InferredField
              source={fieldStates.paymentMethod.source}
              confidence={fieldStates.paymentMethod.confidence}
              isConfirmed={fieldStates.paymentMethod.isConfirmed}
            >
              <Label className="flex items-center gap-1">
                Meio de Pagamento
                {fieldStates.paymentMethod.source !== "user" && !fieldStates.paymentMethod.isConfirmed && (
                  <InferredBadge source={fieldStates.paymentMethod.source} confidence={fieldStates.paymentMethod.confidence} />
                )}
              </Label>
              <Select value={convertForm.paymentMethod} onValueChange={(v) => updateField("paymentMethod", v ?? "")}>
                <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InferredField>
          </div>

          <ResponsiveDialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => selectedItem && aiEnhanceMutation.mutate({ inboxItemId: selectedItem })}
              disabled={aiEnhanceMutation.isPending || !selectedItem}
              className="min-h-[44px] mr-auto text-purple-600 hover:text-purple-700 hover:bg-purple-50"
            >
              {aiEnhanceMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4 mr-2" />
              )}
              Melhorar com IA
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConvertDialogOpen(false)} className="min-h-[44px]">
                Cancelar
              </Button>
              <Button onClick={handleConvert} disabled={!convertForm.amount || convertMutation.isPending} className="min-h-[44px]">
                {convertMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-2" />
                )}
                Converter
              </Button>
            </div>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}

// Extracted data type
type ExtractedData = {
  amount: number | null;
  type: string;
  description: string;
  date: string | null;
  beneficiaryName: string | null;
  paymentMethod: string | null;
  documentType: string;
  confidence: number;
  rawText: string;
};

// Individual inbox card with attachment preview
function InboxCard({
  item,
  onConvert,
  onDiscard,
}: {
  item: {
    id: string;
    rawContent: string;
    source: string;
    status: string;
    createdAt: Date;
    attachments?: { id: string; storagePath: string; mimeType: string; originalFilename: string }[];
  };
  onConvert: () => void;
  onDiscard: () => void;
}) {
  const hasAttachment = item.attachments && item.attachments.length > 0;
  const attachment = hasAttachment ? item.attachments![0] : null;
  const isImage = attachment?.mimeType?.startsWith("image/");
  const isProcessing = item.status === "processing";

  // Fetch extracted data for items with attachments
  const { data: extractedData } = trpc.inbox.getExtractedData.useQuery(
    { inboxItemId: item.id },
    { enabled: hasAttachment && !isProcessing }
  );

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-muted p-2 mt-0.5 shrink-0">
            {SOURCE_ICONS[item.source] || <MessageSquare className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            {/* Attachment thumbnail */}
            {hasAttachment && isImage && (
              <div className="mb-2">
                <img
                  src={`/api/files/${attachment!.storagePath}`}
                  alt={attachment!.originalFilename}
                  className="h-24 w-auto rounded-lg object-cover border"
                />
              </div>
            )}
            {hasAttachment && !isImage && (
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2 w-fit">
                <ImageIcon className="h-3.5 w-3.5" />
                {attachment!.originalFilename}
              </div>
            )}

            <p className="text-sm whitespace-pre-wrap">{item.rawContent}</p>

            {/* OCR confidence indicator */}
            {extractedData && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[11px] text-primary font-medium">
                  OCR {Math.round(extractedData.confidence * 100)}% confiança
                </span>
                {extractedData.amount != null && (
                  <span className="text-[11px] text-muted-foreground">
                    · {formatBRL(Math.round(extractedData.amount * 100))}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
              <Badge variant="secondary" className={STATUS_STYLES[item.status]}>
                {isProcessing ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {STATUS_LABELS[item.status]}
                  </span>
                ) : (
                  STATUS_LABELS[item.status]
                )}
              </Badge>
              <span>{SOURCE_LABELS[item.source]}</span>
              <span>·</span>
              <span>{formatDateBR(item.createdAt)}</span>
            </div>
          </div>
          {!isProcessing && item.status === "pending" && (
            <div className="flex flex-col sm:flex-row items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={onConvert}
                title="Converter em transação"
                className="min-h-[44px] min-w-[44px]"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDiscard}
                className="text-muted-foreground hover:text-red-600 min-h-[44px] min-w-[44px]"
                title="Descartar"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
