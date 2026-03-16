import { router } from "./init";
import { accountsRouter } from "./routers/accounts";
import { cardsRouter } from "./routers/cards";
import { transactionsRouter } from "./routers/transactions";
import { categoriesRouter } from "./routers/categories";
import { tagsRouter } from "./routers/tags";
import { beneficiariesRouter } from "./routers/beneficiaries";

export const appRouter = router({
  accounts: accountsRouter,
  cards: cardsRouter,
  transactions: transactionsRouter,
  categories: categoriesRouter,
  tags: tagsRouter,
  beneficiaries: beneficiariesRouter,
});

export type AppRouter = typeof appRouter;
