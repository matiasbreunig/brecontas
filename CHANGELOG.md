# Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e o versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [0.4.0] - 2026-03-16

### Adicionado
- **Smart Inference**: sistema de inferência inteligente ao converter itens do inbox em transações
  - Parser regex para texto financeiro em PT-BR (valores, datas, tipos, meios de pagamento, beneficiários)
  - Matching por histórico: regras de conciliação, beneficiários (nome + aliases), contas por instituição, transações similares, frequência de uso
  - Merge multi-source: combina inferências de texto, histórico e OCR por maior confiança
  - Indicadores visuais: bordas coloridas + badges por fonte (indigo=texto, emerald=histórico, amber=OCR, roxo=IA)
  - Tracking por campo: cada campo sabe se foi inferido ou editado pelo usuário
- **Beneficiário free-text**: campo combobox com busca + criação automática de novo beneficiário ao digitar nome livre
- **Melhorar com IA**: botão opcional no dialog de conversão que consulta IA para aprimorar beneficiário, categoria e descrição
- **AI Enhancer**: wrapper sobre o classificador existente com output em ParsedField

### Alterado
- Dialog de conversão do inbox agora exibe texto original como referência
- `convertToTransaction` aceita `beneficiaryName` para auto-criar beneficiários

## [0.3.0] - 2026-03-16

### Adicionado
- **Responsividade mobile**: hamburger drawer, bottom sheet dialogs, touch targets ≥44px
  - `ResponsiveDialog` component (Dialog no desktop, Sheet no mobile)
  - Sidebar reescrita com drawer mobile + navegação de mês
  - Inbox, transações e dashboard otimizados para mobile
  - Cards com scroll horizontal, filtros colapsáveis, floating action bar
  - Safe-area support para phones com notch
- **Upload de imagens/PDF com OCR**
  - Suporte a JPG, PNG, HEIC (iPhone), PDF até 10MB
  - Conversão HEIC→JPEG automática via heic-convert
  - OCR via Vision LLM (Claude/OpenAI) com extração estruturada
  - Drag-and-drop + captura de câmera no mobile
  - Servimento seguro de arquivos com autenticação
- **FileUpload component** com preview e progresso

## [0.2.0] - 2026-03-16

### Adicionado
- **Epic 2 - Importação**: templates de importação, parser CSV/OFX, mapeamento de colunas, preview
- **Epic 3 - Conciliação**: regras de matching, matching automático, conciliação manual, transferências
- **Epic 4 - Relatórios**: dashboard com gráficos (evolução, pizza categorias, top beneficiários), filtros por período
- **Epic 5 - Faturas**: gestão de cartões de crédito, faturas mensais, pagamento de fatura
- **Epic 6 - Recorrências e Projeções**: transações recorrentes, geração de projeções, saldo futuro
- **Classificação IA**: classificação de transações via Claude/OpenAI com categorias e beneficiários
- **Servidor MCP**: tools para listar contas, transações e criar transações via MCP

### Alterado
- Schema expandido com tabelas para statement_entries, imports, reconciliation_rules, cards, card_invoices, recurring_transactions, ai_classifications, jobs, attachments
- Router tRPC expandido com 7 novos módulos
- Dashboard com resumo mensal, gráficos e navegação por mês

## [0.1.0] - 2026-03-15

### Adicionado
- **Epic 1 - Fundação**: setup do projeto Next.js 16 + SQLite + Drizzle + tRPC + Auth
- Gestão de contas (CRUD)
- Gestão de categorias com árvore hierárquica
- Gestão de beneficiários com aliases
- Gestão de tags
- CRUD de transações com filtros
- Inbox financeiro (captura de texto livre)
- Configurações do usuário
- Autenticação com NextAuth + credentials
- Layout com sidebar e navegação
