"use client";

import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { formatBRL } from "@/lib/money";
import { formatDateBR } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Upload,
  Check,
  FileText,
  CheckCircle2,
  Loader2,
  CreditCard,
  Building2,
  CalendarRange,
  AlertTriangle,
} from "lucide-react";

// ============================================================================
// TYPES
// ============================================================================

export interface ImportResult {
  totalRows: number;
  processedRows: number;
  duplicatesSkipped: number;
  transactionsCreated: number;
  classifiedByRules?: number;
  pendingAIClassification?: number;
  mode?: string;
  totalExpense?: number;
  totalIncome?: number;
  dateFrom?: string;
  dateTo?: string;
  invoiceDueDate?: string;
}

export interface ImportWizardProps {
  /** Called after import completes successfully */
  onComplete?: (result: ImportResult) => void;
  /** Called when user clicks "Ver Transações" or "Fechar" after success */
  onClose?: () => void;
  /** Whether to show a compact layout (for dialogs) */
  compact?: boolean;
}

type ImportStep = "idle" | "detected" | "importing" | "done";

// ============================================================================
// COMPONENT
// ============================================================================

export function ImportWizard({ onComplete, onClose, compact = false }: ImportWizardProps) {
  const [step, setStep] = useState<ImportStep>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: accounts } = trpc.accounts.list.useQuery();
  const { data: cards } = trpc.cards.list.useQuery();

  const detectMutation = trpc.imports.detect.useMutation({
    onSuccess: (data) => {
      if (data.suggestedAccountId) setAccountId(data.suggestedAccountId);
      if (data.suggestedCardId) setCardId(data.suggestedCardId);
      setStep("detected");
    },
    onError: (error) => {
      toast.error(`Erro ao analisar arquivo: ${error.message}`);
    },
  });

  const smartUploadMutation = trpc.imports.smartUpload.useMutation({
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        toast.error(data.error as string);
        setStep("detected");
        return;
      }
      const d = data as typeof data & {
        totalExpense?: number;
        totalIncome?: number;
        dateFrom?: string;
        dateTo?: string;
        invoiceDueDate?: string;
        classifiedByRules?: number;
        pendingAIClassification?: number;
      };
      const result: ImportResult = {
        totalRows: d.totalRows,
        processedRows: d.processedRows,
        duplicatesSkipped: d.duplicatesSkipped,
        transactionsCreated: d.transactionsCreated,
        classifiedByRules: d.classifiedByRules,
        pendingAIClassification: d.pendingAIClassification,
        mode: d.mode,
        totalExpense: d.totalExpense,
        totalIncome: d.totalIncome,
        dateFrom: d.dateFrom,
        dateTo: d.dateTo,
        invoiceDueDate: d.invoiceDueDate,
      };
      setImportResult(result);
      setStep("done");
      utils.imports.list.invalidate();
      utils.transactions.list.invalidate();
      utils.transactions.stats.invalidate();
      utils.transactions.statusCounts.invalidate();
      toast.success(`${d.transactionsCreated} transações importadas`);
      onComplete?.(result);
    },
    onError: (error) => {
      toast.error(`Erro na importação: ${error.message}`);
      setStep("detected");
    },
  });

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);

    // Binary formats → base64; text formats → read as text
    const ext = selectedFile.name.toLowerCase().split(".").pop();
    let content: string;
    if (ext === "xls" || ext === "xlsx" || ext === "pdf") {
      const buffer = await selectedFile.arrayBuffer();
      content = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
      );
    } else {
      content = await selectedFile.text();
    }
    setFileContent(content);
    detectMutation.mutate({ filename: selectedFile.name, content });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleImport() {
    if (!file || !fileContent || !accountId) return;
    setStep("importing");
    smartUploadMutation.mutate({
      filename: file.name,
      content: fileContent,
      accountId,
      cardId: cardId || undefined,
    });
  }

  function reset() {
    setStep("idle");
    setFile(null);
    setFileContent("");
    setImportResult(null);
    setAccountId("");
    setCardId("");
    // Clear file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const detection = detectMutation.data;
  const isCardInvoice = detection?.mode === "card_invoice";
  const needsCardSelection = isCardInvoice && !cardId;

  // ── Idle + Detection + Importing ──
  if (step !== "done") {
    return (
      <div className="space-y-4">
        {/* File upload area */}
        <div
          className={`border-2 border-dashed rounded-xl text-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors ${compact ? "p-6" : "p-8"}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.ofx,.qfx,.xls,.xlsx,.pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileText className={compact ? "h-6 w-6 text-primary" : "h-8 w-8 text-primary"} />
              <div className="text-left">
                <p className="font-medium text-sm">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
          ) : (
            <>
              <Upload className={`mx-auto mb-2 text-muted-foreground ${compact ? "h-8 w-8" : "h-10 w-10 mb-3"}`} />
              <p className="font-medium text-sm">Clique ou arraste o arquivo</p>
              <p className="text-xs text-muted-foreground mt-1">
                PDF, CSV, OFX ou XLS (faturas e extratos)
              </p>
            </>
          )}
        </div>

        {/* Detection loading */}
        {detectMutation.isPending && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analisando arquivo...
          </div>
        )}

        {/* Detection results */}
        {step === "detected" && detection && (
          <div className="space-y-4">
            {/* Summary badges */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="gap-1 text-xs">
                {isCardInvoice ? <CreditCard className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
                {isCardInvoice ? "Fatura de Cartão" : "Extrato Bancário"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {detection.format.toUpperCase()}
              </Badge>
              {detection.institution && (
                <Badge variant="outline" className="capitalize text-xs">
                  {detection.institution}
                </Badge>
              )}
              <Badge variant="outline" className="gap-1 text-xs">
                <CalendarRange className="h-3 w-3" />
                {detection.dateRange
                  ? `${formatDateBR(detection.dateRange.start)} — ${formatDateBR(detection.dateRange.end)}`
                  : "—"}
              </Badge>
              <Badge variant="outline" className="font-mono tabular-nums text-xs">
                {detection.totalEntries} lançamentos
              </Badge>
              {detection.balance != null && (
                <Badge variant="outline" className="font-mono tabular-nums text-xs">
                  Saldo: {formatBRL(detection.balance)}
                </Badge>
              )}
            </div>

            {/* Account/Card selection */}
            <div className={compact ? "space-y-3" : "grid grid-cols-1 sm:grid-cols-2 gap-4"}>
              {!isCardInvoice && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Conta</Label>
                  <Select value={accountId} onValueChange={(v) => setAccountId(v ?? "")}>
                    <SelectTrigger className="min-h-[44px]">
                      {accountId ? (
                        <span className="flex flex-1 text-left truncate">
                          {accounts?.find(a => a.id === accountId)?.name ?? "Selecione a conta"}
                        </span>
                      ) : (
                        <SelectValue placeholder="Selecione a conta" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {accounts?.filter(a => a.isActive).map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isCardInvoice && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cartão</Label>
                    <Select value={cardId} onValueChange={(v) => {
                      setCardId(v ?? "");
                      const card = cards?.find(c => c.id === v);
                      if (card) setAccountId(card.accountId);
                    }}>
                      <SelectTrigger className="min-h-[44px]">
                        {cardId ? (
                          <span className="flex flex-1 text-left truncate">
                            {cards?.find(c => c.id === cardId)?.name ?? "Selecione o cartão"}
                          </span>
                        ) : (
                          <SelectValue placeholder="Selecione o cartão" />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        {cards?.filter(c => c.isActive).map((card) => (
                          <SelectItem key={card.id} value={card.id}>{card.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {needsCardSelection && (
                    <div className="flex items-center gap-2 text-amber-600 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Selecione o cartão para importar a fatura.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Import button */}
            <Button
              onClick={handleImport}
              disabled={!accountId || (isCardInvoice && !cardId) || smartUploadMutation.isPending}
              className="w-full min-h-[44px]"
            >
              {smartUploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Importar {detection.totalEntries} lançamentos
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── Done ──
  return (
    <div className={compact ? "text-center py-4" : "text-center py-8"}>
      <CheckCircle2 className={compact ? "h-12 w-12 mx-auto text-emerald-500 mb-3" : "h-16 w-16 mx-auto text-emerald-500 mb-4"} />
      <h3 className={compact ? "text-lg font-bold" : "text-xl font-bold"}>Importação Concluída!</h3>

      {importResult && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-md mx-auto text-sm">
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-muted-foreground text-xs">Transações</p>
            <p className="font-bold text-lg">{importResult.transactionsCreated}</p>
          </div>
          {importResult.totalExpense ? (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3 text-center">
              <p className="text-muted-foreground text-xs">Despesas</p>
              <p className="font-bold text-lg text-red-600 dark:text-red-400">{formatBRL(importResult.totalExpense)}</p>
            </div>
          ) : null}
          {importResult.totalIncome ? (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3 text-center">
              <p className="text-muted-foreground text-xs">Créditos</p>
              <p className="font-bold text-lg text-emerald-600 dark:text-emerald-400">{formatBRL(importResult.totalIncome)}</p>
            </div>
          ) : null}
          {importResult.dateFrom && importResult.dateTo && (
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-muted-foreground text-xs">Período</p>
              <p className="font-semibold text-xs mt-1">
                {formatDateBR(importResult.dateFrom)} — {formatDateBR(importResult.dateTo)}
              </p>
            </div>
          )}
          {importResult.invoiceDueDate && (
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-center">
              <p className="text-muted-foreground text-xs">Vencimento</p>
              <p className="font-semibold text-xs mt-1">{formatDateBR(importResult.invoiceDueDate)}</p>
            </div>
          )}
          {(importResult.classifiedByRules ?? 0) > 0 && (
            <div className="rounded-lg bg-purple-50 dark:bg-purple-950/30 p-3 text-center">
              <p className="text-muted-foreground text-xs">Classificadas</p>
              <p className="font-bold text-lg text-purple-600 dark:text-purple-400">{importResult.classifiedByRules}</p>
            </div>
          )}
          {(importResult.pendingAIClassification ?? 0) > 0 && (
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-center">
              <p className="text-muted-foreground text-xs">Para revisão</p>
              <p className="font-bold text-lg text-blue-600 dark:text-blue-400">{importResult.pendingAIClassification}</p>
            </div>
          )}
          {importResult.duplicatesSkipped > 0 && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-center">
              <p className="text-muted-foreground text-xs">Duplicatas</p>
              <p className="font-bold text-lg text-amber-600 dark:text-amber-400">{importResult.duplicatesSkipped}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex gap-2 justify-center">
        <Button variant="outline" onClick={reset}>
          Importar outro
        </Button>
        <Button onClick={onClose}>
          {compact ? "Fechar" : "Ver Transações"}
        </Button>
      </div>
    </div>
  );
}
