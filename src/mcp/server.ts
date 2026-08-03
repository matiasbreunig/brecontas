#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { db } from "@/server/db";
import {
  transactions,
  accounts,
  inboxItems,
  categories,
  beneficiaries,
  statementEntries, users as usersTable } from "@/server/db/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";
import { formatBRL } from "@/lib/money";

const processedRequests = new Set<string>();

const server = new McpServer({
  name: "brecontas",
  version: "1.0.0",
});

// Helper: idempotency check
function checkIdempotency(requestId?: string): boolean {
  if (!requestId) return false;
  if (processedRequests.has(requestId)) return true;
  processedRequests.add(requestId);
  // Keep last 1000 requests
  if (processedRequests.size > 1000) {
    const first = processedRequests.values().next().value;
    if (first) processedRequests.delete(first);
  }
  return false;
}

/**
 * Which user this server acts as.
 *
 * It used to be "whichever row comes back first from `users`", which meant
 * every write landed on that account regardless of who the caller was — wrong
 * by construction in a two-person household, and no identity check at all.
 * Now it has to be stated, and the server refuses to start otherwise.
 */
function getUserId(): string {
  const configured = process.env.BRECONTAS_MCP_USER_ID?.trim();
  if (configured) {
    const found = db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, configured))
      .get();
    if (found) return found.id;
    throw new Error(
      `BRECONTAS_MCP_USER_ID="${configured}" não corresponde a nenhum usuário.`,
    );
  }

  const email = process.env.BRECONTAS_MCP_USER_EMAIL?.trim();
  if (email) {
    const found = db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .get();
    if (found) return found.id;
    throw new Error(
      `BRECONTAS_MCP_USER_EMAIL="${email}" não corresponde a nenhum usuário.`,
    );
  }

  throw new Error(
    "Defina BRECONTAS_MCP_USER_ID ou BRECONTAS_MCP_USER_EMAIL: o servidor MCP escreve no histórico financeiro e precisa saber de quem.",
  );
}

// ─── Tools ───

server.tool(
  "capture",
  "Capture texto livre no inbox financeiro",
  {
    text: z.string().describe("Texto para capturar (ex: 'paguei 50 reais de almoço')"),
    source: z.enum(["manual", "whatsapp", "mcp", "receipt", "email", "ai_chat"]).default("mcp"),
    request_id: z.string().optional(),
  },
  async ({ text, source, request_id }) => {
    if (checkIdempotency(request_id)) {
      return { content: [{ type: "text" as const, text: "Já processado (idempotente)" }] };
    }

    const userId = getUserId();
    const id = generateId();
    db.insert(inboxItems).values({
      id,
      userId,
      createdByUserId: userId,
      rawContent: text,
      source,
      status: "pending",
      createdAt: nowTimestamp(),
    }).run();

    return { content: [{ type: "text" as const, text: `Capturado no inbox (ID: ${id}). Use 'list_pending' para ver pendentes.` }] };
  }
);

server.tool(
  "add_transaction",
  "Criar transação financeira estruturada",
  {
    type: z.enum(["income", "expense", "transfer", "refund"]),
    amount: z.number().positive().describe("Valor em reais (ex: 49.90)"),
    date: z.string().describe("Data YYYY-MM-DD"),
    description: z.string().optional(),
    account_name: z.string().optional().describe("Nome da conta"),
    category_name: z.string().optional().describe("Nome da categoria"),
    payment_method: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).optional(),
    request_id: z.string().optional(),
  },
  async ({ type, amount, date, description, account_name, category_name, payment_method, request_id }) => {
    if (checkIdempotency(request_id)) {
      return { content: [{ type: "text" as const, text: "Já processado (idempotente)" }] };
    }

    const userId = getUserId();
    const id = generateId();
    const centavos = Math.round(amount * 100);

    // Find account and category by name
    let accountId: string | undefined;
    if (account_name) {
      const acc = db.select().from(accounts).where(
        and(eq(accounts.userId, userId), sql`LOWER(name) = LOWER(${account_name})`)
      ).get();
      accountId = acc?.id;
    }

    let categoryId: string | undefined;
    if (category_name) {
      const cat = db.select().from(categories).where(
        and(eq(categories.userId, userId), sql`LOWER(name) = LOWER(${category_name})`)
      ).get();
      categoryId = cat?.id;
    }

    db.insert(transactions).values({
      id,
      userId,
      accountId: accountId ?? null,
      categoryId: categoryId ?? null,
      type,
      amount: centavos,
      date,
      description: description ?? null,
      paymentMethod: payment_method ?? null,
      status: categoryId ? "identified" : "draft",
      source: "mcp",
      createdByUserId: userId,
      createdAt: nowTimestamp(),
      updatedByUserId: userId,
      updatedAt: nowTimestamp(),
    }).run();

    return { content: [{ type: "text" as const, text: `Transação criada: ${type} ${formatBRL(centavos)} em ${date}${description ? ` — ${description}` : ""} (ID: ${id})` }] };
  }
);

server.tool(
  "list_transactions",
  "Listar transações com filtros",
  {
    month: z.string().optional().describe("Mês no formato YYYY-MM"),
    status: z.enum(["draft", "unrecognized", "identified", "reconciled", "discarded"]).optional(),
    type: z.enum(["income", "expense", "transfer", "refund"]).optional(),
    limit: z.number().default(20),
  },
  async ({ month, status, type, limit }) => {
    const userId = getUserId();
    const conditions = [eq(transactions.userId, userId)];

    if (month) {
      conditions.push(gte(transactions.date, `${month}-01`));
      conditions.push(lte(transactions.date, `${month}-31`));
    }
    if (status) conditions.push(eq(transactions.status, status));
    if (type) conditions.push(eq(transactions.type, type));

    const items = db.query.transactions.findMany({
      where: and(...conditions),
      with: { category: true, beneficiary: true, account: true },
      orderBy: [desc(transactions.date)],
      limit,
    });

    const result = await items;
    const text = result.map((tx) =>
      `${tx.date} | ${tx.type} | ${formatBRL(tx.amount)} | ${tx.description || "—"} | ${tx.category?.name || "—"} | ${tx.status}`
    ).join("\n");

    return { content: [{ type: "text" as const, text: text || "Nenhuma transação encontrada." }] };
  }
);

server.tool(
  "get_balance",
  "Consultar saldo de contas",
  {
    account_name: z.string().optional().describe("Nome da conta (ou todas se omitido)"),
  },
  async ({ account_name }) => {
    const userId = getUserId();
    const accs = await db.query.accounts.findMany({
      where: account_name
        ? and(eq(accounts.userId, userId), sql`LOWER(name) = LOWER(${account_name})`)
        : eq(accounts.userId, userId),
    });

    const results = [];
    for (const acc of accs) {
      const income = db
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
        .from(transactions)
        .where(and(
          eq(transactions.accountId, acc.id),
          eq(transactions.type, "income"),
          sql`status != 'discarded'`,
          eq(transactions.isProjected, false)
        ))
        .get();

      const expense = db
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
        .from(transactions)
        .where(and(
          eq(transactions.accountId, acc.id),
          eq(transactions.type, "expense"),
          sql`status != 'discarded'`,
          eq(transactions.isProjected, false)
        ))
        .get();

      const balance = (acc.initialBalance || 0) + (income?.total || 0) - (expense?.total || 0);
      results.push(`${acc.name}: ${formatBRL(balance)}`);
    }

    return { content: [{ type: "text" as const, text: results.join("\n") || "Nenhuma conta encontrada." }] };
  }
);

server.tool(
  "get_summary",
  "Resumo mensal por categoria",
  {
    month: z.string().describe("Mês no formato YYYY-MM"),
  },
  async ({ month }) => {
    const userId = getUserId();
    const dateFrom = `${month}-01`;
    const dateTo = `${month}-31`;

    const result = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        gte(transactions.date, dateFrom),
        lte(transactions.date, dateTo),
        sql`status != 'discarded'`,
        eq(transactions.isProjected, false)
      ),
      with: { category: true },
    });

    const byCategory: Record<string, { income: number; expense: number }> = {};
    let totalIncome = 0;
    let totalExpense = 0;

    for (const tx of result) {
      const catName = tx.category?.name || "Sem categoria";
      if (!byCategory[catName]) byCategory[catName] = { income: 0, expense: 0 };

      if (tx.type === "income" || tx.type === "refund") {
        byCategory[catName].income += tx.amount;
        totalIncome += tx.amount;
      } else if (tx.type === "expense") {
        byCategory[catName].expense += tx.amount;
        totalExpense += tx.amount;
      }
    }

    const lines = [
      `Resumo de ${month}:`,
      `Receitas: ${formatBRL(totalIncome)}`,
      `Despesas: ${formatBRL(totalExpense)}`,
      `Saldo: ${formatBRL(totalIncome - totalExpense)}`,
      "",
      "Por categoria:",
      ...Object.entries(byCategory)
        .sort((a, b) => b[1].expense - a[1].expense)
        .map(([cat, { income, expense }]) => {
          const parts = [];
          if (expense > 0) parts.push(`-${formatBRL(expense)}`);
          if (income > 0) parts.push(`+${formatBRL(income)}`);
          return `  ${cat}: ${parts.join(" / ")}`;
        }),
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "list_pending",
  "Listar itens pendentes (inbox + transações)",
  {},
  async () => {
    const userId = getUserId();

    const pendingInbox = await db.query.inboxItems.findMany({
      where: and(eq(inboxItems.userId, userId), eq(inboxItems.status, "pending")),
      orderBy: [desc(inboxItems.createdAt)],
      limit: 20,
    });

    const pendingTx = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        sql`status IN ('draft', 'unrecognized')`
      ),
      orderBy: [desc(transactions.date)],
      limit: 20,
    });

    const lines = [];

    if (pendingInbox.length > 0) {
      lines.push(`📥 Inbox (${pendingInbox.length} pendentes):`);
      pendingInbox.forEach((item) => {
        lines.push(`  - [${item.id.slice(0, 8)}] ${item.rawContent.slice(0, 80)}`);
      });
    }

    if (pendingTx.length > 0) {
      lines.push(`\n📊 Transações pendentes (${pendingTx.length}):`);
      pendingTx.forEach((tx) => {
        lines.push(`  - [${tx.id.slice(0, 8)}] ${tx.date} ${formatBRL(tx.amount)} ${tx.description || "—"} (${tx.status})`);
      });
    }

    if (lines.length === 0) {
      lines.push("Nenhum item pendente! 🎉");
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "reconcile",
  "Conciliar uma transação (marcar como revisada)",
  {
    transaction_id: z.string().describe("ID da transação"),
    category_name: z.string().optional(),
    description: z.string().optional(),
    request_id: z.string().optional(),
  },
  async ({ transaction_id, category_name, description, request_id }) => {
    if (checkIdempotency(request_id)) {
      return { content: [{ type: "text" as const, text: "Já processado (idempotente)" }] };
    }

    const userId = getUserId();
    const updateData: Record<string, unknown> = {
      status: "reconciled",
      updatedByUserId: userId,
      updatedAt: nowTimestamp(),
    };

    if (description) updateData.description = description;
    if (category_name) {
      const cat = db.select().from(categories).where(
        and(eq(categories.userId, userId), sql`LOWER(name) = LOWER(${category_name})`)
      ).get();
      if (cat) updateData.categoryId = cat.id;
    }

    db.update(transactions)
      .set(updateData)
      .where(and(eq(transactions.id, transaction_id), eq(transactions.userId, userId)))
      .run();

    return { content: [{ type: "text" as const, text: `Transação ${transaction_id.slice(0, 8)} conciliada.` }] };
  }
);

server.tool(
  "search",
  "Busca full-text em transações e inbox",
  {
    query: z.string().describe("Termo de busca"),
    limit: z.number().default(10),
  },
  async ({ query, limit }) => {
    const userId = getUserId();

    const txResults = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        sql`(description LIKE ${'%' + query + '%'} OR notes LIKE ${'%' + query + '%'})`
      ),
      with: { category: true, beneficiary: true },
      orderBy: [desc(transactions.date)],
      limit,
    });

    const lines = txResults.map((tx) =>
      `${tx.date} | ${tx.type} | ${formatBRL(tx.amount)} | ${tx.description || "—"} | ${tx.category?.name || "—"}`
    );

    return { content: [{ type: "text" as const, text: lines.join("\n") || "Nenhum resultado." }] };
  }
);

// ─── Resources ───

server.resource(
  "accounts://list",
  "accounts://list",
  async () => {
    const userId = getUserId();
    const accs = await db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
    });

    return {
      contents: [{
        uri: "accounts://list",
        mimeType: "application/json",
        text: JSON.stringify(accs, null, 2),
      }],
    };
  }
);

server.resource(
  "inbox://pending",
  "inbox://pending",
  async () => {
    const userId = getUserId();
    const items = await db.query.inboxItems.findMany({
      where: and(eq(inboxItems.userId, userId), eq(inboxItems.status, "pending")),
    });

    return {
      contents: [{
        uri: "inbox://pending",
        mimeType: "application/json",
        text: JSON.stringify(items, null, 2),
      }],
    };
  }
);

// ─── Start ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
