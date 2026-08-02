# Revisão completa do projeto — 2026-08-01

Revisão multi-agente do commit `dd5c326`: seis revisores independentes por dimensão
(correção server-side, client-side, segurança, integridade de dados/dinheiro, parsers
de importação, convenções do CLAUDE.md), com deduplicação (57 → 40 achados) e
verificação adversarial dos 9 mais graves — um segundo agente instruído a refutar
cada um lendo o código citado. **Resultado: 9 confirmados, 0 refutados.**
`npx tsc --noEmit` passou limpo. Nenhuma correção foi aplicada nesta revisão.

---

## Confirmados por verificação adversarial

### 1. CRÍTICO — Fatura Itaú em CSV: dupla inversão de sinal transforma toda compra em receita

`src/server/services/parsers/parser-factory.ts:385` + `src/server/services/parsers/csv-parser.ts:116`

O template `itau_fatura` tem `amountIsNegativeForDebit: false`, então o csv-parser
força `amount = -Math.abs(amount)` em toda linha — e o parser-factory inverte de
novo, deixando tudo positivo. O import-handler (`isCredit = entry.amount >= 0`)
classifica cada compra como `income`: a fatura inteira importa como renda, e
`updateInvoiceTotal` (que soma só valores negativos) grava `totalAmount = 0`.
Reproduzido de ponta a ponta com CSV de exemplo.

**Correção:** eliminar uma das duas inversões (manter o sinal cru no csv-parser e
deixar o parser-factory fazer a única inversão); teste de regressão: compras
negativas, PAGAMENTO EFETUADO positivo.

### 2. ALTO — Desfazer uma conciliação é no-op silencioso

`src/hooks/use-undo-redo.tsx:80`

Cmd+Z após "Conciliar" roteia toda mudança de status não-descartada para
`transactions.restore`, que retorna cedo se o status atual não for `discarded`.
O servidor não faz nada, mas o cliente mostra "Ação desfeita" e move a ação para o
stack de redo (também no-op). O stack fica permanentemente dessincronizado do banco.

**Correção:** só rotear para delete/restore em transições de/para `discarded`;
demais transições vão por `transactions.update`.

### 3. ALTO — Router statement-entries não filtra por usuário

`src/server/trpc/routers/statement-entries.ts:19`

`list`, `getById`, `skip` e `stats` não têm condição de `userId` (o comentário
"Join with imports to filter by user" existe; o join não). Cada usuário vê e pode
marcar como "skipped" entradas bancárias do outro.

**Correção:** join com `imports` + `eq(imports.userId, ctx.userId)` em todos os
procedures, incluindo `skip`.

### 4. ALTO — deleteImport: limpeza de fatura órfã é código morto (findFirst sem await)

`src/server/trpc/routers/imports.ts:457`

Três `findFirst` sem `await` retornam thenables (sempre truthy), então o delete de
`cardInvoices` nunca roda. Ao reimportar fatura corrigida, a fatura órfã (dueDate
antigo) é reusada pelo cycle-matching, contaminando a data de caixa das novas
transações. A cascata multi-tabela também não está em `db.transaction()`.

**Correção:** `await` nas três consultas + envolver a cascata em transação.

### 5. ALTO — Undo envia sentinela "" ao servidor: trava o stack e grava "" no lugar de NULL

`src/hooks/use-auto-save.ts:117`

Campos anuláveis alimentam o hook com `serverValue ?? ""` e o undo grava o valor
cru em `oldValues`. Efeitos: (1) desfazer forma de pagamento envia
`paymentMethod: ""` → falha no zod → "Erro ao desfazer", e como a ação só sai do
stack em sucesso, o undo fica bloqueado para sempre; (2) `categoryId: ""` passa na
validação e grava string vazia em vez de NULL.

**Correção:** normalizar com `|| null` ao montar a ação de undo.

### 6. ALTO — Guard savingRef descarta saves: segunda edição rápida perdida com toast "Salvo"

`src/hooks/use-auto-save.ts:89`

`if (savingRef.current) return;` descarta em vez de enfileirar. Com
`debounceMs: 0` (categoria/beneficiário/tags): escolher B (save em voo) e logo C —
C nunca é enviado e a UI reverte silenciosamente para B com "Salvo". O flush de
unmount cai no mesmo guard, perdendo texto pendente ao fechar a linha.

**Correção:** enfileirar o valor (`queuedValueRef`) e reexecutar no `finally`.

### 7. MÉDIO — Cmd+Shift+Z (refazer) nunca dispara

`src/hooks/use-undo-redo.tsx:224`

Com Shift, `e.key` é `"Z"` maiúsculo e o guard `e.key !== "z"` sai antes do branch
de redo. Caps Lock quebra até o Cmd+Z simples.

**Correção:** `e.key.toLowerCase() !== "z"`.

### 8. MÉDIO — createTransfer usa modelo antigo de par: saldo do destino diminui

`src/server/trpc/routers/reconciliation.ts:326` *(endpoint sem chamadores na UI)*

Cria duas pernas `type='transfer'` ligadas só por `transferPairId` (deprecated) sem
`transferAccountId`. A fórmula de saldo subtrai toda linha transfer do `accountId`,
então a perna de entrada é subtraída do destino.

**Correção:** migrar para o modelo de linha única (`accountId` +
`transferAccountId`) ou remover o endpoint.

### 9. BAIXO — convertEntries sem idempotência nem verificação de dono

`src/server/trpc/routers/imports.ts:241` *(endpoint sem chamadores na UI)*

Busca a entrada só por id, sem checar dono nem `status === 'pending'` — reenvio
duplicaria transações.

**Correção:** guard de status + escopo por usuário, ou remover junto com
`quickConvert`/`getEntries`.

---

## Não verificados — achados de revisor único (31)

Vieram das mesmas revisões mas não passaram pela segunda checagem adversarial.
Severidades são estimativa do revisor.

### Altos

- **Path traversal em /api/files** — `src/app/api/files/[...path]/route.ts:31`:
  ownership check roda antes da normalização; `%2e%2e` permite um usuário
  autenticado ler recibos do outro. Normalizar primeiro, depois checar prefixo e
  conter o caminho resolvido em `uploadsRoot`.
- **Senhas com SHA-256 sem salt** — `src/server/auth.ts:8`: app exposto na
  internet; vazamento do .db entrega as senhas. Migrar para scrypt/bcrypt/argon2
  com salt por usuário. Comparação também não é timing-safe.
- **PDF de fatura data compras do início do mês um ano no passado** —
  `src/server/services/parsers/pdf-parser.ts:184`: heurística
  `month >= invoiceMonth` usa o mês do vencimento; compras entre fechamento e
  vencimento no mesmo mês recebem ano-1. Usar a data de fechamento como referência.
- **Select simples para categorias/beneficiários** —
  `src/app/(app)/recorrentes/page.tsx:198` e
  `src/app/(app)/configuracoes/page.tsx:874`: violam a convenção
  CategoryCombobox/BeneficiaryCombobox.

### Médios

- **transactions.update sem invariante de transferência** —
  `src/server/trpc/routers/transactions.ts:157`: mudar tipo para transfer via
  auto-save cria linha sem `transferAccountId`; dinheiro some do saldo.
- **Hash de dedupe descarta lançamentos idênticos legítimos** —
  `src/server/services/jobs/handlers/import-handler.ts:107`: dois lançamentos
  iguais no mesmo dia → o segundo é pulado como duplicata.
- **Delete de categoria/beneficiário em uso estoura FK crua** —
  `src/server/trpc/routers/categories.ts:80`, `beneficiaries.ts:74`: erro 500 sem
  mensagem PT-BR. Soft-delete ou desanexar referências em transação.
- **Campo pisca valor antigo entre save e refetch** — `src/hooks/use-auto-save.ts:70`.
- **Inbox: inferência não reaplica ao reabrir o diálogo** —
  `src/app/(app)/inbox/page.tsx:227`: cache retorna a mesma referência e o efeito
  não roda; formulário fica vazio.
- **Seleção em massa sobrevive à troca de mês** —
  `src/app/(app)/transacoes/page.tsx:135`: "Conciliar" atinge transações
  invisíveis; select-all compara só por tamanho.
- **payInvoice sem escopo de usuário** —
  `src/server/trpc/routers/reconciliation.ts:401`: marca fatura de outro usuário
  como paga.
- **Servidor MCP sem autenticação** — `src/mcp/server.ts:41`: personifica o
  primeiro usuário da tabela `users`; query morta em accounts sugere lógica
  inacabada. Exigir identidade explícita (env `BRECONTAS_MCP_USER_ID`).
- **Seed com senha 'admin123' para os dois usuários** — `src/server/db/seed.ts:38`:
  confirmar rotação em produção; sem rate limiting no login.
- **XLS/PDF forçam tudo negativo: estornos viram despesa** —
  `src/server/services/parsers/xls-parser.ts:62`, `pdf-parser.ts:458`: preservar o
  sinal de ponta a ponta.
- **OFX/CSV latin-1 decodificados como UTF-8** —
  `src/components/transactions/import-wizard.tsx:142`: acentos viram U+FFFD em
  dados imutáveis e mudam o hash de dedupe. Detectar charset e usar
  `TextDecoder('windows-1252')`.
- **OFX de cartão conforme a spec detectado como extrato bancário** —
  `src/server/services/parsers/parser-factory.ts:96`: CCACCTFROM não tem ACCTTYPE.
  Detectar por `<CCACCTFROM>`/`<CCSTMTRS>`/`<CREDITCARDMSGSRSV1>`.
- **Linha de rodapé no CSV derruba o import inteiro** —
  `src/server/services/parsers/csv-parser.ts:35`: `m.padStart` sem validar o split
  lança TypeError; anos de 2 dígitos viram "25-03-05". Validar e pular a linha.
- **Detecção de banco por substring** —
  `src/server/services/parsers/parser-factory.ts:81`: "INTERNET"/"INTERNACIONAL"
  seleciona o template do Inter e o import termina "com sucesso" com 0 linhas.
  Restringir ao cabeçalho, word boundaries, fallback quando 0 linhas.
- **Selects pré-preenchidos mostram valores crus** ("expense", "\_\_none\_\_",
  "checking") — `configuracoes/page.tsx:125+`, `recorrentes/page.tsx:151`,
  `contas/page.tsx:98`: bug do Portal do base-ui documentado no CLAUDE.md; resolver
  o rótulo manualmente no SelectTrigger.

### Baixos

- **reconcile/bulk ressuscitam descartadas** sem limpar
  `discardedAt`/`discardReason` — `reconciliation.ts:267`; bulkReconcile reporta
  count de entrada, não de linhas atualizadas.
- **ai.acceptSuggestion/rejectSuggestion sem escopo nem validação de vínculo** —
  `src/server/trpc/routers/ai.ts:72` e `:96`: sugestão de qualquer transação pode
  ser aplicada a outra; feedback de terceiros pode ser adulterado.
- **Par descartar/restaurar não é inverso fiel** — `use-undo-redo.tsx:84`: motivo
  original perdido (vira "error"); status anterior não é restaurado ("draft" volta
  como "unrecognized").
- **Estornos inconsistentes nos relatórios** — `src/server/trpc/routers/reports.ts:75`:
  dailySpending conta refund como receita; monthComparison/stats não; byCategory
  ignora.
- **"hoje"/"ontem" resolvidos em UTC** —
  `src/server/services/inference/text-parser.ts:113`: após ~21h (BRT) o dia
  inferido é amanhã. Usar `toISODate()` de `src/lib/date.ts`.
- **classifyBatch sobrescreve descrição em qualquer confiança** —
  `src/server/services/ai/classifier.ts:159`: aliases aprendem prosa da IA que
  nunca casa com descrições cruas. Limiar de confiança + aprender do
  `rawDescription`.
- **parseOfxAmount trunca decimais com vírgula** —
  `src/server/services/parsers/ofx-parser.ts:44`: `parseFloat('-49,90')` → -49.
  Reusar a detecção de separador BR/US do csv-parser.
- **Texto de leitor de tela em inglês** — `src/components/ui/dialog.tsx:75`,
  `sheet.tsx:75`, `sidebar.tsx:275`: "Close"/"Toggle Sidebar" → "Fechar"/"Alternar
  barra lateral".

---

## Ordem de ataque sugerida

1. Fatura Itaú CSV (crítico — corrompe dados a cada import)
2. Trio undo/auto-save (`use-undo-redo.tsx:80` + `use-auto-save.ts:117` + `:89`)
3. `deleteImport` await + transação
4. Escopo de usuário: statement-entries, payInvoice, /api/files, ai.ts
5. Senhas (scrypt + verificação do seed em produção)
6. Parsers: sinais XLS/PDF, encoding, detecção OFX de cartão, robustez do CSV
