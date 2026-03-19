# Brecontas — Claude Code Instructions

## What is this project

Personal finance management system (Brazilian Portuguese UI). Core concept: **financial inbox + reconciliation workbench** — capture chaotic financial data from bank extracts, progressively structure it via rules, AI inference, and manual reconciliation.

Used by Matias and his wife. Not in production — direct DB changes are fine, no migration scaffolding needed.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 (strict mode) |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`) |
| UI Library | **shadcn/ui with base-ui** (NOT radix) |
| API | tRPC v11 (end-to-end typed) |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Auth | NextAuth v5 (beta) |
| AI | Vercel AI SDK + Anthropic Claude |
| State | TanStack Query (via tRPC) |
| Validation | Zod v4 |

**Path alias:** `@/*` → `./src/*`

## Critical conventions

### base-ui, NOT radix
Components use `render` prop, NOT `asChild`. Example:
```tsx
// CORRECT
<DialogTrigger render={<Button size="sm" />}>Click me</DialogTrigger>

// WRONG — will not work
<DialogTrigger asChild><Button size="sm">Click me</Button></DialogTrigger>
```

**Select display bug:** Controlled Selects with pre-filled values show raw IDs because items render in a Portal. Always manually resolve display text in `SelectTrigger`:
```tsx
<SelectTrigger>
  {value ? (
    <span>{options.find(o => o.id === value)?.name ?? "Selecione..."}</span>
  ) : (
    <SelectValue placeholder="Selecione..." />
  )}
</SelectTrigger>
```

### Money in centavos
All amounts are integers (centavos). R$ 49.90 = `4990`. Use `formatBRL()` from `@/lib/money` for display.

### IDs with nanoid
All entity IDs generated via nanoid. See `@/lib/id`.

### UI language
All user-facing text in **Brazilian Portuguese**. Code (variables, comments) in English.

### No save buttons — auto-save everywhere
Every field auto-saves immediately. No save/discard buttons anywhere in the interface. Changes are tracked via undo/redo (Cmd+Z / Cmd+Shift+Z).

Use `useAutoSave` hook:
- Selects/toggles: `debounceMs: 0` (immediate)
- Text inputs: `debounceMs: 400`
- Aliases: `debounceMs: 600`

### Searchable selectors for large lists
- Categories → `CategoryCombobox` (searchable popover)
- Beneficiaries → `BeneficiaryCombobox` (searchable popover with create)
- Tags → `TagMultiSelect` (multi-select with search and create)

Never use a plain `<Select>` for categories or beneficiaries — the lists are too large.

## Architecture

### Data layers
```
inbox_items (raw)  →  statement_entries (immutable bank data)  →  transactions (curated)
```
`statement_entries` are NEVER edited after import. They are the canonical bank record.

### Transaction status machine
```
draft → unrecognized → identified → reconciled
                                  → discarded (soft delete)
```
Setting category or beneficiary on a pending tx auto-upgrades status to `identified`.

### Transfer model
Transfers have two accounts: `accountId` (origin) + `transferAccountId` (destination).
Virtual accounts (`type: "virtual"`) model loans/receivables. Transfers are excluded from income/expense reports.

### Auto-save + Undo/Redo (3 layers)
1. `UndoRedoProvider` (`src/hooks/use-undo-redo.tsx`) — context with past/future stacks, keyboard shortcuts, mutation execution
2. `useAutoSave` (`src/hooks/use-auto-save.ts`) — generic hook wrapping tRPC mutations with debounce + undo integration
3. Component refactors — each editable field has its own `useAutoSave` instance

Key implementation details:
- `savingRef` re-entry guard prevents concurrent saves
- `pastRef`/`futureRef` updated synchronously during render (not useEffect) to avoid stale closures
- On unmount: flushes pending debounced save (not dropped)
- `UndoableAction` stores `oldValues`/`newValues` for idempotent inverse operations

### Spotlight search
Command palette (Cmd+K) with smart parsing:
- **Dates:** `hoje`, `ontem`, `semana`, `março`, `7d`, `30d`, `DD/MM`, `DD/MM-DD/MM`
- **Amounts:** `3000`, `>500`, `<1000`, `100-500`
- **Text:** searches descriptions, notes, beneficiaries, categories, accounts, tags, payment methods
- Chips displayed inline in the search bar

### Import pipeline
Shared `ImportWizard` component (`src/components/transactions/import-wizard.tsx`) used in both:
- `/importar` page (full layout + import history)
- `ImportSheet` dialog (compact, triggered from transactions page)

Parsers: OFX, CSV (template-based), XLS (Itaú), PDF (Itaú credit card invoices with positional text extraction).
Import jobs processed async via job handler.

**Classification cascade on import (3 levels):**
1. **Rules + Aliases + History** (sync, free) — `matchFromHistory()` runs per transaction, applies beneficiary/category/tags if confidence ≥ 0.7 → status `identified`
2. **AI batch** (async, paid) — `classifyBatch()` fires after import for unclassified transactions (fire-and-forget)
3. **Human reconciliation** — user reviews, corrects; system auto-learns via alias expansion

**Auto-learning on reconcile:** when a transaction is reconciled with a beneficiary, `autoExpandBeneficiaryAliases()` extracts the significant part of the description and adds it as a beneficiary alias for future imports.

Reconciliation rules auto-classify by pattern matching (exact, contains, regex).

### Date semantics (caixa vs competência)
- `date` = **cash date** — when money moves (invoice due date for cards, transaction date for bank)
- `competenceDate` = **accrual date** — when the purchase happened (null for bank transactions)
- `COALESCE(competence_date, date)` for competência filtering
- UI toggle "Caixa" / "Competência" in the transactions page header

### Confidence indicators
- `transactions.confidence` field (0.0-1.0) stores inference confidence from import classification
- **High confidence (≥ 85%):** purple solid badge with ✨ sparkle — eligible for batch confirm
- **Medium confidence (< 85%):** blue dashed badge with ✨ sparkle — suggestion
- **No confidence / reconciled:** solid regular badge
- Batch "Confirmar" button auto-reconciles all transactions with confidence ≥ 85%

## Project structure

```
src/
├── app/(app)/              # Authenticated pages
│   ├── transacoes/         # Transactions (main page, ~1500 lines)
│   ├── configuracoes/      # Settings (categories, tags, beneficiaries, rules)
│   ├── contas/             # Accounts and cards
│   ├── importar/           # Import wizard
│   ├── inbox/              # Financial inbox
│   ├── faturas/            # Card invoices
│   ├── recorrentes/        # Recurring templates
│   └── relatorios/         # Reports
├── components/
│   ├── ui/                 # shadcn/ui components (base-ui based)
│   ├── transactions/       # import-wizard, import-sheet, transaction-spotlight
│   ├── beneficiary-combobox.tsx
│   ├── category-combobox.tsx
│   ├── tag-multi-select.tsx
│   └── providers.tsx       # TRPCProvider > MonthProvider > UndoRedoProvider
├── hooks/
│   ├── use-auto-save.ts
│   ├── use-undo-redo.tsx
│   └── use-month.tsx
├── lib/
│   ├── constants.ts        # Type definitions, labels, enums
│   ├── money.ts            # formatBRL, formatBRLCompact
│   ├── undo-redo-types.ts  # UndoableAction, invertAction
│   └── trpc.ts             # tRPC client setup
└── server/
    ├── db/
    │   ├── schema.ts       # Drizzle schema (19 tables)
    │   └── index.ts        # DB connection (data/brecontas.db)
    ├── trpc/
    │   └── routers/        # 13 routers, 80+ procedures
    └── services/
        ├── parsers/        # OFX, CSV, XLS, PDF parsers + factory
        ├── inference/      # history-matcher, text-parser, merger
        ├── ai/             # classifier (Claude structured output)
        └── jobs/           # Async job processing
```

## Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npx tsc --noEmit     # Type-check without emitting
```

## Database

SQLite at `data/brecontas.db`. Direct access:
```bash
sqlite3 data/brecontas.db "SELECT count(*) FROM transactions"
```

Key tables: `users`, `accounts`, `cards`, `categories`, `tags`, `beneficiaries`, `transactions`, `transaction_tags`, `statement_entries`, `imports`, `reconciliation_rules`, `recurring_templates`

## Environment variables (.env.local)

```
AUTH_SECRET=...
AUTH_TRUST_HOST=true
ANTHROPIC_API_KEY=...
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-4-20250514
```

## Design principles

1. **DB is canonical** — always source of truth, operations must be idempotent
2. **No save buttons** — auto-save everywhere, undo/redo for reversal
3. **Smart parsing over widgets** — search bar understands dates, amounts, entities
4. **Immutable bank data** — `statement_entries` never edited after import
5. **Progressive structuring** — raw data refined through rules, AI, manual reconciliation
6. **Brazilian Portuguese UI** — all labels, messages, toasts in PT-BR
