import { sql, type SQL } from "drizzle-orm";

/**
 * The accounting rules, in one place.
 *
 * They used to live in a comment in accounts.ts and be re-implemented — wrongly —
 * in the MCP server, while the three report endpoints each had their own idea of
 * what a refund is. Anything that adds up money should import from here.
 */

/**
 * **A refund reduces the expense it reverses; it is not income.**
 *
 * A card estorno gives back money already booked as a purchase. Counting it as
 * income inflated "receitas" with something that was never earned, and made the
 * daily chart disagree with the monthly comparison for the same month. So:
 * expense totals are net of refunds, and income means income.
 *
 * Only rows that are neither discarded nor projections count anywhere.
 */
export const isRealTransaction: SQL = sql`status != 'discarded' AND is_projected = 0`;

/** Income in the period. Refunds are excluded on purpose — see above. */
export const incomeSql = sql<number>`COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)`;

/** Expense net of refunds. */
export const expenseSql = sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount WHEN type = 'refund' THEN -amount ELSE 0 END), 0)`;

/**
 * How one account's balance moves, given the account being measured.
 *
 * A transfer leaves the origin (`account_id`) and arrives at the destination
 * (`transfer_account_id`) — the single-row model. The old pair model, which
 * wrote two rows joined by `transfer_pair_id`, made the incoming leg subtract
 * from the destination; the endpoint that produced it has been removed.
 */
export function balanceDeltaSql(accountId: string): SQL<number> {
  return sql<number>`COALESCE(SUM(
    CASE
      WHEN type = 'income'  AND account_id = ${accountId} THEN amount
      WHEN type = 'refund'  AND account_id = ${accountId} THEN amount
      WHEN type = 'expense' AND account_id = ${accountId} THEN -amount
      WHEN type = 'transfer' AND account_id = ${accountId} THEN -amount
      WHEN type = 'transfer' AND transfer_account_id = ${accountId} THEN amount
      ELSE 0
    END
  ), 0)`;
}
