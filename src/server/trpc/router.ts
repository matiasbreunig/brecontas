import { router } from "./init";
import { accountsRouter } from "./routers/accounts";
import { cardsRouter } from "./routers/cards";
import { transactionsRouter } from "./routers/transactions";
import { categoriesRouter } from "./routers/categories";
import { tagsRouter } from "./routers/tags";
import { beneficiariesRouter } from "./routers/beneficiaries";
import { inboxRouter } from "./routers/inbox";
import { importsRouter } from "./routers/imports";
import { statementEntriesRouter } from "./routers/statement-entries";
import { reconciliationRouter } from "./routers/reconciliation";
import { aiRouter } from "./routers/ai";
import { reportsRouter } from "./routers/reports";
import { recurringRouter } from "./routers/recurring";

export const appRouter = router({
  accounts: accountsRouter,
  cards: cardsRouter,
  transactions: transactionsRouter,
  categories: categoriesRouter,
  tags: tagsRouter,
  beneficiaries: beneficiariesRouter,
  inbox: inboxRouter,
  imports: importsRouter,
  statementEntries: statementEntriesRouter,
  reconciliation: reconciliationRouter,
  ai: aiRouter,
  reports: reportsRouter,
  recurring: recurringRouter,
});

export type AppRouter = typeof appRouter;
