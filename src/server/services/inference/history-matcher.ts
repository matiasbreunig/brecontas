/**
 * Stage 2: History-based inference using DB patterns.
 * Queries reconciliation rules, beneficiary aliases, past transactions,
 * and account/institution patterns to infer fields.
 */

import { db } from "@/server/db";
import {
  reconciliationRules,
  beneficiaries,
  transactions,
  accounts,
  categories,
} from "@/server/db/schema";
import { eq, and, desc, sql, like } from "drizzle-orm";
import type { ParsedField } from "./text-parser";

export interface HistoryMatchResult {
  beneficiaryId?: ParsedField<string>;
  beneficiaryName?: ParsedField<string>;
  categoryId?: ParsedField<string>;
  accountId?: ParsedField<string>;
  type?: ParsedField<string>;
  paymentMethod?: ParsedField<string>;
  tagIds?: ParsedField<string[]>;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ─── Reconciliation Rules Matching ──────────────────────────────────
function matchesRule(
  description: string,
  pattern: string,
  matchType: "exact" | "contains" | "regex"
): boolean {
  const normDesc = normalize(description);
  const normPattern = normalize(pattern);

  switch (matchType) {
    case "exact":
      return normDesc === normPattern;
    case "contains":
      return normDesc.includes(normPattern);
    case "regex":
      try {
        return new RegExp(pattern, "i").test(description);
      } catch {
        return false;
      }
    default:
      return false;
  }
}


// ── Loaders (memoised per import via MatchContext) ──

function loadRules(userId: string) {
  return db
    .select()
    .from(reconciliationRules)
    .where(eq(reconciliationRules.userId, userId))
    .orderBy(desc(reconciliationRules.priority), desc(reconciliationRules.hitCount))
    .all();
}

function loadBeneficiaries(userId: string) {
  return db.select().from(beneficiaries).where(eq(beneficiaries.userId, userId)).all();
}

function loadAccounts(userId: string) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.isActive, true)))
    .all();
}

async function matchReconciliationRules(
  text: string,
  userId: string,
  ctx: MatchContext
): Promise<HistoryMatchResult> {
  const rules = await ctx.rules();

  for (const rule of rules) {
    if (matchesRule(text, rule.pattern, rule.matchType as "exact" | "contains" | "regex")) {
      const result: HistoryMatchResult = {};
      // Higher hit count = higher confidence (capped at 0.95)
      const baseConfidence = Math.min(0.7 + rule.hitCount * 0.02, 0.95);

      if (rule.beneficiaryId) {
        result.beneficiaryId = { value: rule.beneficiaryId, confidence: baseConfidence, source: "history" };
        // Fetch the beneficiary name for display
        const ben = await db
          .select({ name: beneficiaries.name })
          .from(beneficiaries)
          .where(eq(beneficiaries.id, rule.beneficiaryId))
          .get();
        if (ben) {
          result.beneficiaryName = { value: ben.name, confidence: baseConfidence, source: "history" };
        }
      }

      if (rule.categoryId) {
        result.categoryId = { value: rule.categoryId, confidence: baseConfidence, source: "history" };
      }

      if (rule.paymentMethod) {
        result.paymentMethod = { value: rule.paymentMethod, confidence: baseConfidence, source: "history" };
      }

      if (rule.tagIds) {
        try {
          const tags = JSON.parse(rule.tagIds) as string[];
          if (tags.length > 0) {
            result.tagIds = { value: tags, confidence: baseConfidence, source: "history" };
          }
        } catch { /* ignore */ }
      }

      return result;
    }
  }

  return {};
}

// ─── Beneficiary Fuzzy Matching ─────────────────────────────────────
async function matchBeneficiary(
  text: string,
  userId: string,
  ctx: MatchContext
): Promise<Pick<HistoryMatchResult, "beneficiaryId" | "beneficiaryName" | "categoryId" | "tagIds"> | undefined> {
  const normText = normalize(text);
  const allBeneficiaries = await ctx.beneficiaries();

  type ScoredMatch = {
    id: string;
    name: string;
    defaultCategoryId: string | null;
    defaultTagIds: string | null;
    score: number;
  };

  const matches: ScoredMatch[] = [];

  for (const ben of allBeneficiaries) {
    const normName = normalize(ben.name);

    // Exact match in text
    if (normText.includes(normName) && normName.length >= 3) {
      matches.push({
        id: ben.id,
        name: ben.name,
        defaultCategoryId: ben.defaultCategoryId,
        defaultTagIds: ben.defaultTagIds,
        score: 0.85 + Math.min(normName.length / 30, 0.1), // longer name = more confident
      });
      continue;
    }

    // Check aliases
    if (ben.aliases) {
      try {
        const aliases = JSON.parse(ben.aliases) as string[];
        for (const alias of aliases) {
          const normAlias = normalize(alias);
          if (normText.includes(normAlias) && normAlias.length >= 3) {
            matches.push({
              id: ben.id,
              name: ben.name,
              defaultCategoryId: ben.defaultCategoryId,
              defaultTagIds: ben.defaultTagIds,
              score: 0.8 + Math.min(normAlias.length / 30, 0.1),
            });
            break;
          }
        }
      } catch { /* ignore */ }
    }
  }

  if (matches.length === 0) return undefined;

  // Pick best match
  const best = matches.sort((a, b) => b.score - a.score)[0];
  const result: Pick<HistoryMatchResult, "beneficiaryId" | "beneficiaryName" | "categoryId" | "tagIds"> = {
    beneficiaryId: { value: best.id, confidence: best.score, source: "history" },
    beneficiaryName: { value: best.name, confidence: best.score, source: "history" },
  };

  if (best.defaultCategoryId) {
    result.categoryId = { value: best.defaultCategoryId, confidence: best.score * 0.9, source: "history" };
  }

  if (best.defaultTagIds) {
    try {
      const tags = JSON.parse(best.defaultTagIds) as string[];
      if (tags.length > 0) {
        result.tagIds = { value: tags, confidence: best.score * 0.9, source: "history" };
      }
    } catch { /* ignore */ }
  }

  return result;
}

// ─── Account Inference from Keywords ────────────────────────────────
async function matchAccount(
  text: string,
  ctx: MatchContext
): Promise<ParsedField<string> | undefined> {
  const normText = normalize(text);
  const userAccounts = await ctx.accounts();

  for (const acc of userAccounts) {
    // Match by institution name
    if (acc.institution) {
      const normInst = normalize(acc.institution);
      if (normText.includes(normInst) && normInst.length >= 3) {
        return { value: acc.id, confidence: 0.8, source: "history" };
      }
    }

    // Match by account name
    const normName = normalize(acc.name);
    if (normText.includes(normName) && normName.length >= 3) {
      return { value: acc.id, confidence: 0.75, source: "history" };
    }
  }

  return undefined;
}

// ─── Most Frequent Defaults ─────────────────────────────────────────
async function loadFrequentDefaults(
  userId: string
): Promise<{
  accountId?: ParsedField<string>;
  type?: ParsedField<string>;
  paymentMethod?: ParsedField<string>;
}> {
  const result: {
    accountId?: ParsedField<string>;
    type?: ParsedField<string>;
    paymentMethod?: ParsedField<string>;
  } = {};

  // Most used account (last 90 days)
  const topAccount = await db
    .select({
      accountId: transactions.accountId,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        sql`${transactions.date} >= date('now', '-90 days')`,
        sql`${transactions.accountId} IS NOT NULL`
      )
    )
    .groupBy(transactions.accountId)
    .orderBy(sql`count DESC`)
    .limit(1)
    .get();

  if (topAccount?.accountId) {
    result.accountId = { value: topAccount.accountId, confidence: 0.3, source: "history" };
  }

  // Most common payment method (last 90 days)
  const topMethod = await db
    .select({
      paymentMethod: transactions.paymentMethod,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        sql`${transactions.date} >= date('now', '-90 days')`,
        sql`${transactions.paymentMethod} IS NOT NULL`
      )
    )
    .groupBy(transactions.paymentMethod)
    .orderBy(sql`count DESC`)
    .limit(1)
    .get();

  if (topMethod?.paymentMethod) {
    result.paymentMethod = { value: topMethod.paymentMethod, confidence: 0.25, source: "history" };
  }

  return result;
}

// ─── Similar Past Transactions ──────────────────────────────────────
async function matchSimilarTransactions(
  text: string,
  userId: string,
  amount?: number // in centavos
): Promise<HistoryMatchResult> {
  const normText = normalize(text);
  const result: HistoryMatchResult = {};

  // Search by keywords in description (take significant words)
  const words = normText
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 3);

  if (words.length === 0) return result;

  // Build a LIKE search for any of the significant words
  const likeConditions = words.map(
    (w) => sql`LOWER(${transactions.description}) LIKE ${"%" + w + "%"}`
  );

  const similarTx = await db
    .select({
      beneficiaryId: transactions.beneficiaryId,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      type: transactions.type,
      paymentMethod: transactions.paymentMethod,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        sql`(${sql.join(likeConditions, sql` OR `)})`,
        sql`${transactions.status} != 'discarded'`
      )
    )
    .orderBy(desc(transactions.createdAt))
    .limit(10)
    .all();

  if (similarTx.length === 0) return result;

  // Count occurrences of each value to find the most common
  function mostCommon<T>(values: (T | null | undefined)[]): { value: T; count: number } | undefined {
    const counts = new Map<string, { value: T; count: number }>();
    for (const v of values) {
      if (v == null) continue;
      const key = String(v);
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { value: v, count: 1 });
      }
    }
    let best: { value: T; count: number } | undefined;
    for (const entry of counts.values()) {
      if (!best || entry.count > best.count) best = entry;
    }
    return best;
  }

  const confidence = Math.min(0.5 + similarTx.length * 0.03, 0.75);

  const topBeneficiary = mostCommon(similarTx.map((t) => t.beneficiaryId));
  if (topBeneficiary && topBeneficiary.count >= 2) {
    result.beneficiaryId = { value: topBeneficiary.value, confidence, source: "history" };
    // Fetch name
    const ben = await db
      .select({ name: beneficiaries.name })
      .from(beneficiaries)
      .where(eq(beneficiaries.id, topBeneficiary.value))
      .get();
    if (ben) {
      result.beneficiaryName = { value: ben.name, confidence, source: "history" };
    }
  }

  const topCategory = mostCommon(similarTx.map((t) => t.categoryId));
  if (topCategory && topCategory.count >= 2) {
    result.categoryId = { value: topCategory.value, confidence, source: "history" };
  }

  const topAccount = mostCommon(similarTx.map((t) => t.accountId));
  if (topAccount && topAccount.count >= 2) {
    result.accountId = { value: topAccount.value, confidence, source: "history" };
  }

  const topType = mostCommon(similarTx.map((t) => t.type));
  if (topType) {
    result.type = { value: topType.value, confidence: confidence * 0.9, source: "history" };
  }

  const topMethod = mostCommon(similarTx.map((t) => t.paymentMethod));
  if (topMethod && topMethod.count >= 2) {
    result.paymentMethod = { value: topMethod.value, confidence: confidence * 0.9, source: "history" };
  }

  return result;
}

// ─── Main History Matcher ───────────────────────────────────────────

// ============================================================================
// PER-IMPORT CONTEXT
// ============================================================================

/**
 * Data that is the same for every line of a given import.
 *
 * matchFromHistory used to re-read the rules, the beneficiaries (parsing their
 * aliases JSON again each time), the accounts and the 90-day frequency
 * aggregates **once per imported line** — about seven queries a line, three of
 * them full scans. Loading them once per import turns that into a constant.
 *
 * The promises are memoised, not awaited, so nothing is fetched until the first
 * line actually needs it.
 */
export interface MatchContext {
  rules: () => ReturnType<typeof loadRules>;
  beneficiaries: () => ReturnType<typeof loadBeneficiaries>;
  accounts: () => ReturnType<typeof loadAccounts>;
  frequentDefaults: () => ReturnType<typeof loadFrequentDefaults>;
}

/**
 * Caches the first result. Works for both shapes here: the better-sqlite3
 * queries are synchronous and return arrays, while the aggregate loader is
 * async and returns a promise — caching the promise is equally correct.
 */
function memo<T>(load: () => T): () => T {
  let cached: T;
  let loaded = false;
  return () => {
    if (!loaded) {
      cached = load();
      loaded = true;
    }
    return cached;
  };
}

export function createMatchContext(userId: string): MatchContext {
  return {
    rules: memo(() => loadRules(userId)),
    beneficiaries: memo(() => loadBeneficiaries(userId)),
    accounts: memo(() => loadAccounts(userId)),
    frequentDefaults: memo(() => loadFrequentDefaults(userId)),
  };
}

export async function matchFromHistory(
  text: string,
  userId: string,
  amount?: number, // in centavos
  /** Reuse across the lines of one import — see createMatchContext. */
  context?: MatchContext,
): Promise<HistoryMatchResult> {
  const ctx = context ?? createMatchContext(userId);

  // Run all matchers in parallel
  const [ruleMatch, beneficiaryMatch, accountMatch, frequentDefaults, similarMatch] =
    await Promise.all([
      matchReconciliationRules(text, userId, ctx),
      matchBeneficiary(text, userId, ctx),
      matchAccount(text, ctx),
      ctx.frequentDefaults(),
      matchSimilarTransactions(text, userId, amount),
    ]);

  // Merge results: higher confidence wins per field
  const result: HistoryMatchResult = {};

  function pickBest<T>(
    ...sources: (ParsedField<T> | undefined)[]
  ): ParsedField<T> | undefined {
    let best: ParsedField<T> | undefined;
    for (const s of sources) {
      if (s && (!best || s.confidence > best.confidence)) {
        best = s;
      }
    }
    return best;
  }

  result.beneficiaryId = pickBest(
    ruleMatch.beneficiaryId,
    beneficiaryMatch?.beneficiaryId,
    similarMatch.beneficiaryId
  );

  result.beneficiaryName = pickBest(
    ruleMatch.beneficiaryName,
    beneficiaryMatch?.beneficiaryName,
    similarMatch.beneficiaryName
  );

  result.categoryId = pickBest(
    ruleMatch.categoryId,
    beneficiaryMatch?.categoryId,
    similarMatch.categoryId
  );

  result.accountId = pickBest(
    ruleMatch.accountId,
    accountMatch ? { ...accountMatch } : undefined,
    similarMatch.accountId,
    frequentDefaults.accountId
  );

  result.type = pickBest(ruleMatch.type, similarMatch.type);

  result.paymentMethod = pickBest(
    ruleMatch.paymentMethod,
    similarMatch.paymentMethod,
    frequentDefaults.paymentMethod
  );

  result.tagIds = pickBest(
    ruleMatch.tagIds,
    beneficiaryMatch?.tagIds
  );

  return result;
}
