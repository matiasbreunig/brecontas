# Revisão completa do projeto — 2026-08-01/02

Duas revisões multi-agente independentes rodaram sobre o commit `dd5c326`, sem
conhecimento uma da outra, e foram unificadas aqui junto com o registro do que
já foi corrigido.

- **Revisão A** — segurança, dinheiro/datas, importação, performance, arquitetura
  e **infra**. 17 achados confirmados por verificação adversarial + 31 menores.
  Foi a única que consultou o host de produção.
- **Revisão B** — correção server-side e client-side, parsers e **convenções do
  CLAUDE.md**. 9 verificados adversarialmente + 31 não verificados. Foi a única
  que leu a camada de UI a fundo.

Sobrepõem-se em ~20 achados — confirmação mútua forte. Os 12 achados exclusivos
da revisão B foram verificados um a um contra o código: **todos confirmados**,
três deles com mais ocorrências do que a revisão apontava.

Uma imprecisão da revisão B fica registrada: o app **não** está exposto à
internet. O hostname resolve para um IP de tailnet (CGNAT do Tailscale); a
exposição real era à LAN, pela porta 3100 publicada em `0.0.0.0` — corrigida.

---

## Corrigido

Onze commits, de `63c4724` a `f193b42`. Cada um foi verificado no gwcasa antes
do seguinte: `tsc` limpo, testes verdes, container `healthy` e HTTPS em `307`.

### Infraestrutura

| Problema | Situação |
|---|---|
| **O app não gravava no banco desde 06/abr** — bind mount `root:root` contra container `uid 1001`; `transactions` zerada com o container de pé há 5 semanas | `chown` no volume e `adduser --ingroup nodejs` no Dockerfile, que criava o usuário fora do grupo usado pelo próprio `chown` da imagem |
| `.env.production` (AUTH_SECRET + chaves de API) e uma cópia do banco dentro das camadas da imagem, por `COPY . .` sem `.dockerignore` | `.dockerignore` criado; `docker run` sem volume já não acha nenhum dos dois |
| Porta 3100 publicada em `0.0.0.0`: qualquer aparelho da LAN chegava ao login em HTTP puro, contornando TLS e `secure_headers` do Caddy | Bind em `127.0.0.1` |
| Sem backup do banco | `backup.sh` diário às 3h45 no padrão do postgres, com `VACUUM INTO` (nunca `cp` de WAL aberto), retenção e teste de restauração |
| Sem healthcheck: um travamento ficava invisível | `healthcheck` via `node -e "fetch(...)"` — a imagem slim não tem curl nem wget |
| Imagem de produção com 778 MB carregando toolchain de build | 302 MB: o runner deixou de herdar do estágio `base` |
| 29 de 33 mutations falhavam em silêncio | `MutationCache` com `onError` global |

### Dinheiro

A causa raiz era a convenção de sinal sem dono: quatro implementações de parse de
valor e **quatro caudas quase idênticas** no `parseFile`, cada uma tratando o
sinal à sua maneira — foi assim que a inversão do CSV acabou aplicada duas vezes.
Agora os parsers são fiéis ao arquivo e um `finalizeEntries` aplica a convenção
uma única vez, descarta as linhas puladas e só então calcula o hash.

Isso corrigiu de uma vez: compras da fatura entrando como receita; `Math.abs` no
XLS e no PDF transformando estorno em despesa; "PAGAMENTO EFETUADO" virando
receita do valor total da fatura no caminho CSV; OFX com vírgula decimal
truncando `-49,90` em `-49`; e o total da fatura, que ficava zerado e ainda era
inflado por estornos (`SUM(-amount)` no lugar de `SUM(ABS)` só dos débitos).

### Datas

Eram 19 usos de `toISOString().split("T")[0]`, no servidor e no cliente — todos
bugs, porque `toISOString` é UTC também no navegador: um lançamento depois das
21h caía no dia seguinte, e na virada do mês, no mês seguinte.

Corrigido nas duas metades no mesmo commit, porque separadas o bug só mudaria de
lugar: `TZ=America/Sao_Paulo` no compose, e `parseISODate` no lugar de
`new Date(isoString)` — que é meia-noite UTC, ou seja, o dia anterior às 21h em
Brasília.

No PDF, o ano das compras passou a ser ancorado na data de **fechamento**, não na
de vencimento: o cartão "Azul" fecha dia 2 e vence dia 9 do mesmo mês, então uma
compra do dia 1º era datada um ano no passado. E sem fechamento nem vencimento
legíveis o parser falha, em vez de assumir a data de hoje.

### Integridade e segurança

- **Import atômico.** Não havia um único `db.transaction()` no projeto. Como o
  `better-sqlite3` é síncrono e não aceita `await` dentro da transação, o laço
  foi reestruturado em `parse → plan → commit`: a classificação roda antes, sem
  escrever, e a gravação inteira vai numa transação só.
- **`deleteImport`**: três `findFirst` sem `await` retornavam promises sempre
  truthy, então o delete da fatura órfã era código morto e um reimport a
  reaproveitava com o `dueDate` antigo.
- **Path traversal em `/api/files`**: a checagem de dono rodava sobre o caminho
  cru, antes do `normalize`. Um usuário lia os recibos do outro.
- **Escopo por usuário**: `statement_entries` não tinha coluna `user_id` — daí o
  comentário "join with imports to filter by user" e nenhum join. Com a coluna, o
  router ficou igual aos outros doze. Também escopados `payInvoice` e
  `ai.acceptSuggestion`/`rejectSuggestion`.
- **Senhas**: SHA-256 sem sal, com o literal `admin123` publicado no seed e ainda
  válido nas duas contas de produção. Agora scrypt com sal e `timingSafeEqual`,
  num módulo único compartilhado pelo auth e pelo seed; senhas trocadas.
- **IA**: só aplica com confiança ≥ 0,7, com guarda otimista por `updatedAt`, e
  nunca sobrescreve a descrição de transação importada — era assim que o
  auto-aprendizado passava a aprender prosa do modelo.

### Auto-save e undo

Os três defeitos do `useAutoSave` eram uma máquina de estados só: o guard de
reentrada **descartava** o save concorrente (a segunda edição rápida sumia
enquanto a UI dizia "Salvo"); a ação de undo guardava o valor de UI cru, e em
`paymentMethod` o zod recusa `""` — como a ação só sai da pilha em caso de
sucesso, o undo travava até recarregar a página; e o efeito de sync adotava o
valor antigo do servidor antes do refetch chegar, fazendo o campo piscar.

No undo/redo: `status_change` só vai para `delete`/`restore` em transições de/para
descartado — antes, desfazer uma conciliação caía em `restore`, que faz
early-return, e a UI anunciava "Ação desfeita" sem nada ter mudado. E
`e.key.toLowerCase()`, porque com Shift o `e.key` é `"Z"` maiúsculo e o
Cmd+Shift+Z nunca chegava ao branch de refazer.

### Convenções do CLAUDE.md

Dez Selects pré-preenchidos abriam mostrando o valor interno (`"expense"`,
`"__none__"`, `"checking"`) por causa do bug do Portal do base-ui, que o próprio
CLAUDE.md documenta. Resolvidos por um `OptionSelect` compartilhado. Mais: seis
strings de leitor de tela traduzidas, mensagem em português ao tentar apagar
categoria ou favorecido em uso, e o inbox voltando a preencher o formulário ao
reabrir o mesmo item.

### Rede de testes

Não havia framework de teste. Foram criados 31 testes (vitest), escritos **antes**
das correções de dinheiro e falhando de propósito, incluindo integração contra
SQLite temporário e um teste de atomicidade que injeta falha no meio do import
via trigger do SQLite.

---

## Fila de jobs

`queue.ts` tinha enqueue, claim atômico e retry desde sempre — e nenhum
consumidor. O worker foi construído (`worker.ts` + `instrumentation.ts`), e ao
escrevê-lo apareceram dois defeitos que nenhuma das revisões tinha visto, porque
o código nunca havia executado: o retry devolvia o job à fila sem adiar o
agendamento (queimando as três tentativas em segundos) e nada recuperava jobs
presos em `running` após um restart. Ambos corrigidos, com testes.

## Aberto

Nada de código. Restam decisões e dados que dependem de você:

- **Tornar o repositório privado** — depende de acesso ao GitHub.
- **Rotacionar o token `gho_`** que estava embutido no remote do infra-casa. O
  remote passou a usar SSH, mas o token já esteve em texto claro no disco.
- **Saldos iniciais das contas estão zerados** — conferir contra o extrato antes
  do primeiro import de verdade.
