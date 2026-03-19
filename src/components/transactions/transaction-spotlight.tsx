"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { getTagStyle } from "@/components/tag-multi-select";
import {
  Search,
  Tag,
  Folder,
  User,
  Building2,
  CreditCard,
  X,
  Check,
  Wallet,
  FileText,
  Calendar,
  DollarSign,
} from "lucide-react";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { formatBRL } from "@/lib/money";

// ============================================================================
// TYPES
// ============================================================================

export interface TransactionFilters {
  search: string;
  categoryId?: string;
  beneficiaryId?: string;
  accountId?: string;
  cardId?: string;
  tagIds?: string[];
  type?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
}

// ============================================================================
// SMART PARSER — detects dates, amounts, and keywords from query text
// ============================================================================

interface SmartSuggestion {
  key: string;
  icon: React.ReactNode;
  label: string;
  sourceLabel: string;
  filter: Partial<TransactionFilters>;
}

const DATE_KEYWORDS: Record<string, () => { from: string; to: string; label: string }> = {
  hoje: () => {
    const d = new Date().toISOString().split("T")[0];
    return { from: d, to: d, label: `Hoje (${formatDateBR(d)})` };
  },
  ontem: () => {
    const d = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    return { from: d, to: d, label: `Ontem (${formatDateBR(d)})` };
  },
  semana: () => {
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
    const to = now.toISOString().split("T")[0];
    return { from, to, label: "Últimos 7 dias" };
  },
  "semana passada": () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const lastMonday = new Date(now.getTime() - (dayOfWeek + 6) * 86400000);
    const lastSunday = new Date(lastMonday.getTime() + 6 * 86400000);
    return { from: lastMonday.toISOString().split("T")[0], to: lastSunday.toISOString().split("T")[0], label: "Semana passada" };
  },
  "mês passado": () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0], label: "Mês passado" };
  },
  "mes passado": () => {
    // Alias without accent
    return DATE_KEYWORDS["mês passado"]();
  },
};

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const MONTHS_PT: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
  janeiro: 0, fevereiro: 1, "março": 2, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

function parseDate(text: string): string | null {
  // DD/MM or DD/MM/YYYY
  const m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const day = m[1].padStart(2, "0");
    const month = m[2].padStart(2, "0");
    let year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : new Date().getFullYear().toString();
    return `${year}-${month}-${day}`;
  }
  return null;
}

function parseSmartSuggestions(q: string): SmartSuggestion[] {
  const results: SmartSuggestion[] = [];
  const ql = q.toLowerCase().trim();

  // ── Date keywords ──
  if (DATE_KEYWORDS[ql]) {
    const { from, to, label } = DATE_KEYWORDS[ql]();
    results.push({
      key: "smart:date-kw",
      icon: <Calendar className="h-4 w-4 text-teal-600 shrink-0" />,
      label,
      sourceLabel: "Data",
      filter: { dateFrom: from, dateTo: to },
    });
  }

  // ── Nd shortcut (e.g. "7d", "30d", "90d") ──
  const daysMatch = ql.match(/^(\d{1,3})d$/);
  if (daysMatch) {
    const n = parseInt(daysMatch[1]);
    if (n > 0 && n <= 365) {
      const now = new Date();
      const from = new Date(now.getTime() - n * 86400000).toISOString().split("T")[0];
      const to = now.toISOString().split("T")[0];
      results.push({
        key: "smart:date-nd",
        icon: <Calendar className="h-4 w-4 text-teal-600 shrink-0" />,
        label: `Últimos ${n} dias`,
        sourceLabel: "Período",
        filter: { dateFrom: from, dateTo: to },
      });
    }
  }

  // ── Month name (e.g. "março", "mar", "fev") ──
  const monthIdx = MONTHS_PT[ql];
  if (monthIdx !== undefined) {
    const now = new Date();
    let year = now.getFullYear();
    // If the month is in the future, use previous year
    if (monthIdx > now.getMonth()) year--;
    const from = new Date(year, monthIdx, 1).toISOString().split("T")[0];
    const to = new Date(year, monthIdx + 1, 0).toISOString().split("T")[0];
    const monthName = new Date(year, monthIdx, 1).toLocaleDateString("pt-BR", { month: "long" });
    results.push({
      key: "smart:date-month",
      icon: <Calendar className="h-4 w-4 text-teal-600 shrink-0" />,
      label: `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`,
      sourceLabel: "Mês",
      filter: { dateFrom: from, dateTo: to },
    });
  }

  // ── Date range: DD/MM-DD/MM ──
  const rangeMatch = ql.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*[-–aà]\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/);
  if (rangeMatch) {
    const from = parseDate(rangeMatch[1]);
    const to = parseDate(rangeMatch[2]);
    if (from && to) {
      results.push({
        key: "smart:date-range",
        icon: <Calendar className="h-4 w-4 text-teal-600 shrink-0" />,
        label: `${formatDateBR(from)} → ${formatDateBR(to)}`,
        sourceLabel: "Período",
        filter: { dateFrom: from, dateTo: to },
      });
    }
  }

  // ── Single date: DD/MM or DD/MM/YYYY ──
  if (!rangeMatch) {
    const d = parseDate(ql);
    if (d) {
      results.push({
        key: "smart:date",
        icon: <Calendar className="h-4 w-4 text-teal-600 shrink-0" />,
        label: formatDateBR(d),
        sourceLabel: "Data",
        filter: { dateFrom: d, dateTo: d },
      });
    }
  }

  // ── Amount: exact, range, comparisons ──
  // Normalize BR format: 3.000,50 → 3000.50
  function parseBRAmount(s: string): number | null {
    const cleaned = s.replace(/^R\$\s*/, "").replace(/\./g, "").replace(",", ".").trim();
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : Math.round(n * 100); // centavos
  }

  // >NNN or <NNN
  const cmpMatch = ql.match(/^([><])\s*R?\$?\s*(.+)$/);
  if (cmpMatch) {
    const val = parseBRAmount(cmpMatch[2]);
    if (val !== null) {
      const op = cmpMatch[1];
      const display = formatBRL(val);
      if (op === ">") {
        results.push({
          key: "smart:amount-gt",
          icon: <DollarSign className="h-4 w-4 text-emerald-600 shrink-0" />,
          label: `Valor > ${display}`,
          sourceLabel: "Filtro",
          filter: { amountMin: val },
        });
      } else {
        results.push({
          key: "smart:amount-lt",
          icon: <DollarSign className="h-4 w-4 text-emerald-600 shrink-0" />,
          label: `Valor < ${display}`,
          sourceLabel: "Filtro",
          filter: { amountMax: val },
        });
      }
    }
  }

  // NNN-NNN (amount range) — but not if it looks like a date range
  if (!rangeMatch && !cmpMatch) {
    const amtRange = ql.match(/^R?\$?\s*(\d[\d.,]*)\s*[-–aà]\s*R?\$?\s*(\d[\d.,]*)$/);
    if (amtRange) {
      const min = parseBRAmount(amtRange[1]);
      const max = parseBRAmount(amtRange[2]);
      if (min !== null && max !== null && max > min) {
        results.push({
          key: "smart:amount-range",
          icon: <DollarSign className="h-4 w-4 text-emerald-600 shrink-0" />,
          label: `${formatBRL(min)} → ${formatBRL(max)}`,
          sourceLabel: "Faixa",
          filter: { amountMin: min, amountMax: max },
        });
      }
    }
  }

  // Exact amount (only digits, dots, commas)
  if (!cmpMatch && !rangeMatch) {
    const exactMatch = ql.match(/^R?\$?\s*(\d[\d.,]*)$/);
    if (exactMatch) {
      const val = parseBRAmount(exactMatch[1]);
      if (val !== null && val > 0) {
        const display = formatBRL(val);
        // Use ±2% tolerance for exact match
        const tolerance = Math.max(Math.round(val * 0.02), 100); // at least R$ 1.00
        results.push({
          key: "smart:amount-exact",
          icon: <DollarSign className="h-4 w-4 text-emerald-600 shrink-0" />,
          label: display,
          sourceLabel: "Valor",
          filter: { amountMin: val - tolerance, amountMax: val + tolerance },
        });
      }
    }
  }

  return results;
}

interface FilterChip {
  key: string;
  label: string;
  icon?: React.ReactNode;
  color?: string;
}

interface SpotlightTransaction {
  id: string;
  description: string | null;
  notes: string | null;
  type: string;
  amount: number;
  beneficiary?: { name: string } | null;
  category?: { name: string; icon: string | null } | null;
  account?: { name: string } | null;
  paymentMethod: string | null;
}

interface TransactionSpotlightProps {
  filters: TransactionFilters;
  onFiltersChange: (filters: TransactionFilters) => void;
  categories: { id: string; name: string; icon: string | null }[];
  beneficiaries: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  cards: { id: string; name: string }[];
  tags: { id: string; name: string; color: string | null; icon: string | null }[];
  transactions?: SpotlightTransaction[];
}

// ============================================================================
// HELPERS
// ============================================================================

function substringFilter(value: string, search: string): number {
  if (!search) return 1;
  return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
}

const TYPE_OPTIONS = [
  { id: "income",   label: "Receita",        emoji: "⬆" },
  { id: "expense",  label: "Despesa",         emoji: "⬇" },
  { id: "transfer", label: "Transferência",   emoji: "⇄" },
  { id: "refund",   label: "Estorno",         emoji: "↺" },
];

// ============================================================================
// SPOTLIGHT COMPONENT
// ============================================================================

export function TransactionSpotlight({
  filters,
  onFiltersChange,
  categories,
  beneficiaries,
  accounts,
  cards,
  tags,
  transactions = [],
}: TransactionSpotlightProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) setQuery(filters.search);
      else setQuery("");
      setOpen(nextOpen);
    },
    [filters.search],
  );

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => {
          const next = !prev;
          if (next) setQuery(filters.search);
          return next;
        });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [filters.search]);

  // ── Chips ──────────────────────────────────────────────────────────────────
  const chips: FilterChip[] = React.useMemo(() => {
    const result: FilterChip[] = [];
    if (filters.categoryId) {
      const cat = categories.find((c) => c.id === filters.categoryId);
      if (cat) result.push({ key: "category", label: `${cat.icon ?? ""} ${cat.name}`.trim(), icon: <Folder className="h-2.5 w-2.5" /> });
    }
    if (filters.beneficiaryId) {
      const ben = beneficiaries.find((b) => b.id === filters.beneficiaryId);
      if (ben) result.push({ key: "beneficiary", label: ben.name, icon: <User className="h-2.5 w-2.5" /> });
    }
    if (filters.accountId) {
      const acc = accounts.find((a) => a.id === filters.accountId);
      if (acc) result.push({ key: "account", label: acc.name, icon: <Building2 className="h-2.5 w-2.5" /> });
    }
    if (filters.cardId) {
      const card = cards.find((c) => c.id === filters.cardId);
      if (card) result.push({ key: "card", label: card.name, icon: <CreditCard className="h-2.5 w-2.5" /> });
    }
    if (filters.tagIds?.length) {
      for (const tagId of filters.tagIds) {
        const tag = tags.find((t) => t.id === tagId);
        if (tag) result.push({ key: `tag:${tagId}`, label: tag.name, icon: <Tag className="h-2.5 w-2.5" />, color: tag.color ?? undefined });
      }
    }
    if (filters.type) {
      const t = TYPE_OPTIONS.find((o) => o.id === filters.type);
      if (t) result.push({ key: "type", label: `${t.emoji} ${t.label}` });
    }
    if (filters.paymentMethod) {
      const label = PAYMENT_METHOD_LABELS[filters.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS];
      if (label) result.push({ key: "paymentMethod", label, icon: <Wallet className="h-2.5 w-2.5" /> });
    }
    if (filters.dateFrom || filters.dateTo) {
      const from = filters.dateFrom ? formatDateBR(filters.dateFrom) : "";
      const to = filters.dateTo ? formatDateBR(filters.dateTo) : "";
      const label = from === to ? from : `${from} → ${to}`;
      result.push({ key: "date", label, icon: <Calendar className="h-2.5 w-2.5" /> });
    }
    if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
      let label: string;
      if (filters.amountMin && filters.amountMax) {
        label = `${formatBRL(filters.amountMin)} → ${formatBRL(filters.amountMax)}`;
      } else if (filters.amountMin) {
        label = `> ${formatBRL(filters.amountMin)}`;
      } else {
        label = `< ${formatBRL(filters.amountMax!)}`;
      }
      result.push({ key: "amount", label, icon: <DollarSign className="h-2.5 w-2.5" /> });
    }
    if (filters.search) {
      result.push({ key: "search", label: `"${filters.search}"`, icon: <Search className="h-2.5 w-2.5" /> });
    }
    return result;
  }, [filters, categories, beneficiaries, accounts, cards, tags]);

  function removeChip(chipKey: string) {
    const next = { ...filters };
    if (chipKey === "search") next.search = "";
    else if (chipKey === "category") next.categoryId = undefined;
    else if (chipKey === "beneficiary") next.beneficiaryId = undefined;
    else if (chipKey === "account") next.accountId = undefined;
    else if (chipKey === "card") next.cardId = undefined;
    else if (chipKey === "type") next.type = undefined;
    else if (chipKey === "paymentMethod") next.paymentMethod = undefined;
    else if (chipKey === "date") { next.dateFrom = undefined; next.dateTo = undefined; }
    else if (chipKey === "amount") { next.amountMin = undefined; next.amountMax = undefined; }
    else if (chipKey.startsWith("tag:")) {
      const tagId = chipKey.replace("tag:", "");
      next.tagIds = (next.tagIds ?? []).filter((id) => id !== tagId);
      if (!next.tagIds.length) next.tagIds = undefined;
    }
    onFiltersChange(next);
  }

  function clearAllFilters() {
    onFiltersChange({ search: "" });
  }

  function applyFilter(type: string, id: string) {
    const next = { ...filters, search: "" };
    if (type === "category") next.categoryId = id;
    else if (type === "beneficiary") next.beneficiaryId = id;
    else if (type === "account") next.accountId = id;
    else if (type === "card") next.cardId = id;
    else if (type === "paymentMethod") next.paymentMethod = next.paymentMethod === id ? undefined : id;
    else if (type === "tag") {
      const current = next.tagIds ?? [];
      next.tagIds = current.includes(id) ? current.filter((t) => t !== id) : [...current, id];
      if (!next.tagIds.length) next.tagIds = undefined;
    } else if (type === "type") {
      next.type = next.type === id ? undefined : id;
    }
    onFiltersChange(next);
    setQuery("");
    setOpen(false);
  }

  function commitSearch(text: string) {
    onFiltersChange({ ...filters, search: text });
    setQuery("");
    setOpen(false);
  }

  function applySmartFilter(partial: Partial<TransactionFilters>) {
    onFiltersChange({ ...filters, search: "", ...partial });
    setQuery("");
    setOpen(false);
  }

  const hasFilters = chips.length > 0;
  const q = query.trim();

  // ── Smart suggestions (dates, amounts) ─────────────────────────────────────
  const smartSuggestions = React.useMemo(() => (q ? parseSmartSuggestions(q) : []), [q]);

  // ── Unified search results (when query is typed) ───────────────────────────
  interface SearchResult {
    key: string;
    icon: React.ReactNode;
    label: string;
    sourceLabel: string;
    active: boolean;
    onSelect: () => void;
  }

  const unifiedResults: SearchResult[] = React.useMemo(() => {
    if (!q) return [];
    const ql = q.toLowerCase();
    const results: SearchResult[] = [];

    categories
      .filter((c) => c.name.toLowerCase().includes(ql))
      .forEach((c) => results.push({
        key: `cat:${c.id}`,
        icon: <Folder className="h-4 w-4 text-blue-500 shrink-0" />,
        label: `${c.icon ? c.icon + " " : ""}${c.name}`,
        sourceLabel: "Categoria",
        active: filters.categoryId === c.id,
        onSelect: () => applyFilter("category", c.id),
      }));

    beneficiaries
      .filter((b) => b.name.toLowerCase().includes(ql))
      .forEach((b) => results.push({
        key: `ben:${b.id}`,
        icon: <User className="h-4 w-4 text-violet-500 shrink-0" />,
        label: b.name,
        sourceLabel: "Favorecido",
        active: filters.beneficiaryId === b.id,
        onSelect: () => applyFilter("beneficiary", b.id),
      }));

    accounts
      .filter((a) => a.name.toLowerCase().includes(ql))
      .forEach((a) => results.push({
        key: `acc:${a.id}`,
        icon: <Building2 className="h-4 w-4 text-slate-500 shrink-0" />,
        label: a.name,
        sourceLabel: "Conta",
        active: filters.accountId === a.id,
        onSelect: () => applyFilter("account", a.id),
      }));

    tags
      .filter((t) => t.name.toLowerCase().includes(ql))
      .forEach((t) => {
        const style = getTagStyle(t.color);
        results.push({
          key: `tag:${t.id}`,
          icon: (
            <span className={cn("inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border shrink-0", style.bg, style.text, style.border)}>
              {t.icon && <span>{t.icon}</span>}
              {t.name}
            </span>
          ),
          label: t.name,
          sourceLabel: "Tag",
          active: !!filters.tagIds?.includes(t.id),
          onSelect: () => applyFilter("tag", t.id),
        });
      });

    Object.entries(PAYMENT_METHOD_LABELS)
      .filter(([, label]) => label.toLowerCase().includes(ql))
      .forEach(([id, label]) => results.push({
        key: `pm:${id}`,
        icon: <Wallet className="h-4 w-4 text-amber-500 shrink-0" />,
        label,
        sourceLabel: "Meio de pag.",
        active: filters.paymentMethod === id,
        onSelect: () => applyFilter("paymentMethod", id),
      }));

    cards
      .filter((c) => c.name.toLowerCase().includes(ql))
      .forEach((c) => results.push({
        key: `card:${c.id}`,
        icon: <CreditCard className="h-4 w-4 text-orange-500 shrink-0" />,
        label: c.name,
        sourceLabel: "Cartão",
        active: filters.cardId === c.id,
        onSelect: () => applyFilter("card", c.id),
      }));

    TYPE_OPTIONS
      .filter((t) => t.label.toLowerCase().includes(ql))
      .forEach((t) => results.push({
        key: `type:${t.id}`,
        icon: <span className="text-base shrink-0">{t.emoji}</span>,
        label: t.label,
        sourceLabel: "Tipo",
        active: filters.type === t.id,
        onSelect: () => applyFilter("type", t.id),
      }));

    // ── Transaction descriptions (deduplicated, max 5) ─────────────────────
    const seenDescriptions = new Set<string>();
    transactions
      .filter((tx) => {
        const desc = tx.description?.toLowerCase() ?? "";
        const notes = tx.notes?.toLowerCase() ?? "";
        return desc.includes(ql) || notes.includes(ql);
      })
      .forEach((tx) => {
        const text = tx.description ?? tx.notes ?? "";
        const key = text.toLowerCase().trim();
        if (seenDescriptions.has(key) || seenDescriptions.size >= 5) return;
        seenDescriptions.add(key);
        const matchedIn = tx.description?.toLowerCase().includes(ql) ? "Descrição" : "Observação";
        results.push({
          key: `desc:${tx.id}`,
          icon: <FileText className="h-4 w-4 text-muted-foreground shrink-0" />,
          label: text.length > 50 ? text.substring(0, 50) + "…" : text,
          sourceLabel: matchedIn,
          active: filters.search === text,
          onSelect: () => commitSearch(text),
        });
      });

    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, categories, beneficiaries, accounts, tags, cards, filters, transactions]);

  return (
    <>
      {/* ── Inline search bar with chips ── */}
      <div className="flex-1">
        <div
          role="button"
          tabIndex={0}
          onClick={() => handleOpenChange(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenChange(true); }
          }}
          className={cn(
            "w-full flex items-center gap-1.5 min-h-[40px] rounded-lg border bg-background px-2.5 text-sm transition-colors cursor-text",
            "hover:border-primary/40 hover:bg-muted/30",
            hasFilters ? "border-primary/20" : "border-input",
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

          <div className="flex items-center gap-1 flex-1 min-w-0 flex-wrap py-1">
            {chips.map((chip) => {
              const tagColor = chip.color ? getTagStyle(chip.color) : null;
              return (
                <span
                  key={chip.key}
                  className={cn(
                    "inline-flex items-center gap-1 text-[11px] leading-tight pl-1.5 pr-0.5 py-0.5 rounded-md border shrink-0 max-w-[160px]",
                    tagColor
                      ? `${tagColor.bg} ${tagColor.text} ${tagColor.border}`
                      : "bg-muted/60 text-foreground/80 border-border/60",
                  )}
                >
                  {chip.icon}
                  <span className="truncate">{chip.label}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeChip(chip.key); }}
                    className="rounded-sm p-0.5 hover:bg-foreground/10 transition-colors"
                    aria-label={`Remover filtro ${chip.label}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
            {!hasFilters && (
              <span className="text-muted-foreground select-none">Buscar ou filtrar...</span>
            )}
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); clearAllFilters(); }}
              className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Limpar todos os filtros"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <kbd className="hidden sm:inline-flex h-5 items-center rounded border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground shrink-0">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* ── Command palette dialog ── */}
      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Buscar transações"
        description="Busque ou filtre por categoria, favorecido, conta, tag, meio de pagamento ou texto"
      >
        <Command shouldFilter={q.length === 0} filter={substringFilter}>
          <CommandInput
            ref={inputRef}
            placeholder="Buscar transações..."
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q) {
                const root = (e.currentTarget as HTMLElement).closest("[cmdk-root]");
                const selected = root?.querySelector("[cmdk-item][data-selected=true], [cmdk-item][aria-selected=true]");
                if (!selected) { e.preventDefault(); commitSearch(q); }
              }
              if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); }
            }}
          />

          <CommandList className="max-h-[360px]">
            <CommandEmpty>
              {q ? (
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted rounded-md transition-colors"
                  onClick={() => commitSearch(q)}
                >
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <span>Buscar <strong>&quot;{q}&quot;</strong> nas transações</span>
                </button>
              ) : "Nenhum resultado."}
            </CommandEmpty>

            {/* ── UNIFIED RESULTS when query is typed ── */}
            {q && (smartSuggestions.length > 0 || unifiedResults.length > 0) && (
              <CommandGroup heading="Sugestões">
                {/* Smart suggestions (dates, amounts) first */}
                {smartSuggestions.map((s) => (
                  <CommandItem
                    key={s.key}
                    value={s.key}
                    onSelect={() => applySmartFilter(s.filter)}
                    className="flex items-center gap-2"
                  >
                    {s.icon}
                    <span className="flex-1 truncate">{s.label}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">· {s.sourceLabel}</span>
                  </CommandItem>
                ))}
                {/* Entity matches */}
                {unifiedResults.map((r) => (
                  <CommandItem
                    key={r.key}
                    value={r.key}
                    onSelect={r.onSelect}
                    className="flex items-center gap-2"
                  >
                    {r.icon}
                    <span className="flex-1 truncate">{r.label}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">· {r.sourceLabel}</span>
                    {r.active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </CommandItem>
                ))}
                {/* Fallback text search */}
                <CommandItem
                  key="__search__"
                  value={`__search__${q}`}
                  onSelect={() => commitSearch(q)}
                  className="flex items-center gap-2 text-muted-foreground"
                >
                  <Search className="h-4 w-4 shrink-0" />
                  <span className="flex-1">Buscar <strong className="text-foreground">&quot;{q}&quot;</strong> nas transações</span>
                </CommandItem>
              </CommandGroup>
            )}

            {/* ── DISCOVERY MODE when no query ── */}
            {!q && (
              <>
                {/* Date presets */}
                <CommandGroup heading="Período">
                  {([
                    { key: "hoje", label: "Hoje" },
                    { key: "ontem", label: "Ontem" },
                    { key: "semana", label: "Últimos 7 dias" },
                    { key: "semana passada", label: "Semana passada" },
                    { key: "mês passado", label: "Mês passado" },
                  ] as const).map((preset) => (
                    <CommandItem
                      key={preset.key}
                      value={`date-preset:${preset.key}`}
                      onSelect={() => {
                        const { from, to } = DATE_KEYWORDS[preset.key]();
                        applySmartFilter({ dateFrom: from, dateTo: to });
                      }}
                    >
                      <Calendar className="h-4 w-4 text-teal-600" />
                      <span className="flex-1">{preset.label}</span>
                      {(() => {
                        const { from, to } = DATE_KEYWORDS[preset.key]();
                        return filters.dateFrom === from && filters.dateTo === to
                          ? <Check className="h-3.5 w-3.5 text-primary" />
                          : null;
                      })()}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />

                {categories.length > 0 && (
                  <CommandGroup heading="Categorias">
                    {categories.map((cat) => (
                      <CommandItem key={cat.id} value={cat.name} onSelect={() => applyFilter("category", cat.id)}>
                        <Folder className="h-4 w-4 text-blue-500" />
                        <span className="flex items-center gap-1.5 flex-1">
                          {cat.icon && <span>{cat.icon}</span>}
                          {cat.name}
                        </span>
                        {filters.categoryId === cat.id && <Check className="h-3.5 w-3.5 text-primary" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {beneficiaries.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Favorecidos">
                      {beneficiaries.map((b) => (
                        <CommandItem key={b.id} value={b.name} onSelect={() => applyFilter("beneficiary", b.id)}>
                          <User className="h-4 w-4 text-violet-500" />
                          <span className="flex-1">{b.name}</span>
                          {filters.beneficiaryId === b.id && <Check className="h-3.5 w-3.5 text-primary" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {tags.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Tags">
                      {tags.map((tag) => {
                        const style = getTagStyle(tag.color);
                        return (
                          <CommandItem key={tag.id} value={tag.name} onSelect={() => applyFilter("tag", tag.id)}>
                            <span className={cn("inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border", style.bg, style.text, style.border)}>
                              {tag.icon && <span>{tag.icon}</span>}
                              {tag.name}
                            </span>
                            <span className="flex-1" />
                            {filters.tagIds?.includes(tag.id) && <Check className="h-3.5 w-3.5 text-primary" />}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </>
                )}

                {accounts.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Contas">
                      {accounts.map((acc) => (
                        <CommandItem key={acc.id} value={acc.name} onSelect={() => applyFilter("account", acc.id)}>
                          <Building2 className="h-4 w-4 text-slate-500" />
                          <span className="flex-1">{acc.name}</span>
                          {filters.accountId === acc.id && <Check className="h-3.5 w-3.5 text-primary" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {cards.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Cartões">
                      {cards.map((card) => (
                        <CommandItem key={card.id} value={card.name} onSelect={() => applyFilter("card", card.id)}>
                          <CreditCard className="h-4 w-4 text-orange-500" />
                          <span className="flex-1">{card.name}</span>
                          {filters.cardId === card.id && <Check className="h-3.5 w-3.5 text-primary" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                <CommandSeparator />
                <CommandGroup heading="Meio de Pagamento">
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([id, label]) => (
                    <CommandItem key={id} value={label} onSelect={() => applyFilter("paymentMethod", id)}>
                      <Wallet className="h-4 w-4 text-amber-500" />
                      <span className="flex-1">{label}</span>
                      {filters.paymentMethod === id && <Check className="h-3.5 w-3.5 text-primary" />}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />
                <CommandGroup heading="Tipo">
                  {TYPE_OPTIONS.map((t) => (
                    <CommandItem key={t.id} value={t.label} onSelect={() => applyFilter("type", t.id)}>
                      <span className="text-sm">{t.emoji}</span>
                      <span className="flex-1">{t.label}</span>
                      {filters.type === t.id && <Check className="h-3.5 w-3.5 text-primary" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
