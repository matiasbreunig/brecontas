"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { formatBRL } from "@/lib/money";
import { formatDateBR } from "@/lib/date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Upload,
  FileUp,
  Check,
  AlertCircle,
  ArrowRight,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

type ImportStep = "upload" | "preview" | "confirm" | "done";

interface PreviewData {
  format: string;
  detectedInstitution?: string;
  totalEntries: number;
  entries: Array<{
    entryDate: string;
    amount: number;
    rawDescription: string;
    rowNumber: number;
  }>;
}

const IMPORT_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  processing: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

const IMPORT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  completed: "Concluída",
  failed: "Falha",
};

export default function ImportarPage() {
  const [step, setStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    processedRows: number;
    duplicatesSkipped: number;
  } | null>(null);

  const utils = trpc.useUtils();
  const { data: accounts } = trpc.accounts.list.useQuery();
  const { data: cards } = trpc.cards.list.useQuery();
  const { data: importHistory } = trpc.imports.list.useQuery();

  const previewMutation = trpc.imports.preview.useMutation({
    onSuccess: (data) => {
      setPreview(data);
      setStep("preview");
    },
    onError: (error) => {
      toast.error(`Erro ao analisar arquivo: ${error.message}`);
    },
  });

  const uploadMutation = trpc.imports.upload.useMutation({
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        toast.error(data.error as string);
        return;
      }
      setImportResult({
        totalRows: data.totalRows,
        processedRows: data.processedRows,
        duplicatesSkipped: data.duplicatesSkipped,
      });
      setStep("done");
      utils.imports.list.invalidate();
      utils.statementEntries.list.invalidate();
      toast.success(`Importação concluída: ${data.processedRows} registros`);
    },
    onError: (error) => {
      toast.error(`Erro na importação: ${error.message}`);
    },
  });

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    const text = await selectedFile.text();
    setFileContent(text);
  }, []);

  function handlePreview() {
    if (!file || !fileContent) return;
    const format = file.name.toLowerCase().endsWith(".ofx") || file.name.toLowerCase().endsWith(".qfx")
      ? "ofx" as const
      : "csv" as const;
    previewMutation.mutate({ filename: file.name, content: fileContent, format });
  }

  function handleImport() {
    if (!file || !fileContent || !accountId) return;
    const format = file.name.toLowerCase().endsWith(".ofx") || file.name.toLowerCase().endsWith(".qfx")
      ? "ofx" as const
      : "csv" as const;
    uploadMutation.mutate({
      filename: file.name,
      content: fileContent,
      format,
      accountId,
      cardId: cardId || undefined,
    });
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setFileContent("");
    setPreview(null);
    setImportResult(null);
    setAccountId("");
    setCardId("");
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar Extrato</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Importe extratos bancários CSV ou OFX.
        </p>
      </div>

      {/* Wizard Steps */}
      <div className="flex items-center gap-2 text-sm">
        {["Upload", "Preview", "Confirmar", "Concluído"].map((label, i) => {
          const stepNames: ImportStep[] = ["upload", "preview", "confirm", "done"];
          const isActive = stepNames.indexOf(step) >= i;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <div className={`h-px w-8 ${isActive ? "bg-indigo-500" : "bg-muted"}`} />}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                isActive ? "bg-indigo-500/10 text-indigo-700" : "bg-muted text-muted-foreground"
              }`}>
                <span>{i + 1}</span>
                <span>{label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent" />
          <CardContent className="relative pt-6 space-y-6">
            <div className="space-y-2">
              <Label>Conta de destino</Label>
              <Select value={accountId} onValueChange={(v) => setAccountId(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                <SelectContent>
                  {accounts?.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cartão (opcional)</Label>
              <Select value={cardId} onValueChange={(v) => setCardId(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhum</SelectItem>
                  {cards?.map((card) => (
                    <SelectItem key={card.id} value={card.id}>{card.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors"
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".csv,.ofx,.qfx"
                onChange={handleFileSelect}
                className="hidden"
              />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="h-8 w-8 text-indigo-600" />
                  <div className="text-left">
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="font-medium">Clique ou arraste o arquivo</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Suporta CSV (Nubank, Itaú, Inter, Bradesco) e OFX
                  </p>
                </>
              )}
            </div>

            <Button
              onClick={handlePreview}
              disabled={!file || !accountId || previewMutation.isPending}
              className="w-full"
            >
              {previewMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4 mr-2" />
              )}
              Analisar Arquivo
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Preview */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-medium">Arquivo analisado</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <Badge variant="secondary">{preview.format.toUpperCase()}</Badge>
                    {preview.detectedInstitution && (
                      <Badge variant="outline" className="capitalize">
                        {preview.detectedInstitution}
                      </Badge>
                    )}
                    <span>{preview.totalEntries} lançamentos</span>
                  </div>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted px-4 py-2 text-xs font-medium grid grid-cols-12 gap-2">
                  <span className="col-span-1">#</span>
                  <span className="col-span-2">Data</span>
                  <span className="col-span-6">Descrição</span>
                  <span className="col-span-3 text-right">Valor</span>
                </div>
                {preview.entries.map((entry, i) => (
                  <div key={i} className="px-4 py-2 text-sm grid grid-cols-12 gap-2 border-t hover:bg-muted/30">
                    <span className="col-span-1 text-muted-foreground">{entry.rowNumber}</span>
                    <span className="col-span-2">{formatDateBR(entry.entryDate)}</span>
                    <span className="col-span-6 truncate">{entry.rawDescription}</span>
                    <span className={`col-span-3 text-right font-mono tabular-nums ${entry.amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatBRL(entry.amount)}
                    </span>
                  </div>
                ))}
                {preview.totalEntries > 10 && (
                  <div className="px-4 py-2 text-xs text-muted-foreground text-center border-t">
                    ... e mais {preview.totalEntries - 10} lançamentos
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="outline" onClick={reset}>Voltar</Button>
            <Button onClick={() => setStep("confirm")} className="flex-1">
              <ArrowRight className="h-4 w-4 mr-2" />
              Confirmar Importação
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === "confirm" && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-center gap-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">Confirmar importação</p>
                <p className="text-sm mt-0.5">
                  {preview?.totalEntries} lançamentos serão importados para{" "}
                  <strong>{accounts?.find((a) => a.id === accountId)?.name}</strong>.
                  Duplicatas serão detectadas e ignoradas automaticamente.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep("preview")}>Voltar</Button>
              <Button
                onClick={handleImport}
                disabled={uploadMutation.isPending}
                className="flex-1"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Importar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Done */}
      {step === "done" && importResult && (
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <CheckCircle2 className="h-16 w-16 mx-auto text-emerald-500 mb-4" />
            <h2 className="text-xl font-bold">Importação Concluída!</h2>
            <div className="mt-4 space-y-1 text-sm text-muted-foreground">
              <p>Total no arquivo: <strong className="text-foreground">{importResult.totalRows}</strong></p>
              <p>Importados: <strong className="text-emerald-600">{importResult.processedRows}</strong></p>
              {importResult.duplicatesSkipped > 0 && (
                <p>Duplicatas ignoradas: <strong className="text-amber-600">{importResult.duplicatesSkipped}</strong></p>
              )}
            </div>
            <div className="mt-6 flex gap-3 justify-center">
              <Button variant="outline" onClick={reset}>
                Importar outro
              </Button>
              <Button onClick={() => window.location.href = "/transacoes"}>
                Ver Transações
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import History */}
      {importHistory && importHistory.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Histórico de Importações</h2>
          <div className="space-y-2">
            {importHistory.map((imp) => (
              <Card key={imp.id}>
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-muted p-2">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{imp.filename}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">{imp.format.toUpperCase()}</Badge>
                        <span>{imp.processedRows ?? 0} de {imp.totalRows ?? 0} registros</span>
                        <span>·</span>
                        <span>{formatDateBR(imp.createdAt)}</span>
                      </div>
                    </div>
                    <Badge variant="secondary" className={IMPORT_STATUS_STYLES[imp.status]}>
                      {IMPORT_STATUS_LABELS[imp.status]}
                    </Badge>
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
