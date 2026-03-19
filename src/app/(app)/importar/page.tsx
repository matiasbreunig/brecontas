"use client";

import { trpc } from "@/lib/trpc";
import { formatDateBR } from "@/lib/date";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImportWizard } from "@/components/transactions/import-wizard";
import { toast } from "sonner";
import { FileText, Trash2 } from "lucide-react";

export default function ImportarPage() {
  const utils = trpc.useUtils();
  const { data: importHistory } = trpc.imports.list.useQuery();

  const deleteImport = trpc.imports.deleteImport.useMutation({
    onSuccess: (data) => {
      utils.imports.list.invalidate();
      utils.transactions.invalidate();
      toast.success(`Importação excluída (${data?.deleted ?? 0} transações removidas)`);
    },
    onError: (error) => {
      toast.error(`Erro ao excluir: ${error.message}`);
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Solte um arquivo e o sistema detecta tudo automaticamente.
        </p>
      </div>

      {/* Import wizard */}
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
        <CardContent className="relative pt-6">
          <ImportWizard
            onClose={() => window.location.href = "/transacoes"}
          />
        </CardContent>
      </Card>

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
                    <Badge
                      variant="secondary"
                      className={
                        imp.status === "completed" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" :
                        imp.status === "failed" ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400" :
                        "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                      }
                    >
                      {imp.status === "completed" ? "Concluída" :
                       imp.status === "failed" ? "Falha" :
                       imp.status === "processing" ? "Processando" : "Pendente"}
                    </Badge>
                    <button
                      onClick={() => {
                        if (confirm(`Excluir importação "${imp.filename}" e todos os lançamentos associados?`)) {
                          deleteImport.mutate({ id: imp.id });
                        }
                      }}
                      className="rounded-lg p-1.5 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors text-muted-foreground hover:text-red-600"
                      title="Excluir importação"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
