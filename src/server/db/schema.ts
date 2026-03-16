import { sqliteTable, text, integer, real, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ============================================================================
// USERS
// ============================================================================

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// ACCOUNTS
// ============================================================================

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type", { enum: ["checking", "savings", "investment", "wallet"] }).notNull(),
  institution: text("institution"),
  initialBalance: integer("initial_balance").notNull().default(0), // centavos
  currency: text("currency").notNull().default("BRL"),
  color: text("color"),
  icon: text("icon"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ============================================================================
// CARDS
// ============================================================================

export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  lastFour: text("last_four"),
  brand: text("brand", { enum: ["visa", "mastercard", "elo", "amex", "other"] }),
  closingDay: integer("closing_day"), // 1-31
  dueDay: integer("due_day"), // 1-31
  creditLimit: integer("credit_limit"), // centavos
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ============================================================================
// CARD INVOICES
// ============================================================================

export const cardInvoices = sqliteTable("card_invoices", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull().references(() => cards.id),
  userId: text("user_id").notNull().references(() => users.id),
  cycleStart: text("cycle_start").notNull(), // ISO date
  cycleEnd: text("cycle_end").notNull(),
  closingDate: text("closing_date").notNull(),
  dueDate: text("due_date").notNull(),
  totalAmount: integer("total_amount"), // centavos
  status: text("status", { enum: ["open", "closed", "paid", "overdue"] }).notNull().default("open"),
  paymentTransactionId: text("payment_transaction_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ============================================================================
// CATEGORIES
// ============================================================================

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  icon: text("icon"),
  color: text("color"),
  parentId: text("parent_id"),
  type: text("type", { enum: ["income", "expense", "both"] }).notNull().default("expense"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// TAGS
// ============================================================================

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  color: text("color"),
  icon: text("icon"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("tags_user_name_idx").on(table.userId, table.name),
]);

// ============================================================================
// BENEFICIARIES
// ============================================================================

export const beneficiaries = sqliteTable("beneficiaries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  aliases: text("aliases"), // JSON[]
  defaultCategoryId: text("default_category_id").references(() => categories.id),
  defaultTagIds: text("default_tag_ids"), // JSON[]
  notes: text("notes"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ============================================================================
// INBOX ITEMS
// ============================================================================

export const inboxItems = sqliteTable("inbox_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  rawContent: text("raw_content").notNull(),
  source: text("source", { enum: ["manual", "whatsapp", "mcp", "receipt", "email", "ai_chat"] }).notNull(),
  status: text("status", { enum: ["pending", "processing", "converted", "discarded"] }).notNull().default("pending"),
  transactionId: text("transaction_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// STATEMENT ENTRIES (immutable bank data)
// ============================================================================

export const statementEntries = sqliteTable("statement_entries", {
  id: text("id").primaryKey(),
  importId: text("import_id").notNull(),
  accountId: text("account_id").references(() => accounts.id),
  cardId: text("card_id").references(() => cards.id),
  cardInvoiceId: text("card_invoice_id").references(() => cardInvoices.id),
  entryDate: text("entry_date").notNull(), // ISO date
  amount: integer("amount").notNull(), // centavos, positive=credit, negative=debit
  rawDescription: text("raw_description").notNull(),
  balanceAfter: integer("balance_after"), // centavos
  rowNumber: integer("row_number").notNull(),
  rawData: text("raw_data"), // JSON
  hash: text("hash").notNull(),
  transactionId: text("transaction_id"),
  status: text("status", { enum: ["pending", "matched", "skipped", "duplicate"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// TRANSACTIONS
// ============================================================================

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  accountId: text("account_id").references(() => accounts.id),
  cardId: text("card_id").references(() => cards.id),
  cardInvoiceId: text("card_invoice_id").references(() => cardInvoices.id),
  beneficiaryId: text("beneficiary_id").references(() => beneficiaries.id),
  categoryId: text("category_id").references(() => categories.id),
  type: text("type", { enum: ["income", "expense", "transfer", "refund"] }).notNull(),
  amount: integer("amount").notNull(), // centavos, always positive
  date: text("date").notNull(), // ISO YYYY-MM-DD
  competenceDate: text("competence_date"), // billing cycle month
  description: text("description"),
  paymentMethod: text("payment_method", { enum: ["pix", "debit", "credit", "transfer", "boleto", "cash", "other"] }),
  status: text("status", { enum: ["draft", "unrecognized", "identified", "reconciled", "discarded"] }).notNull().default("draft"),
  source: text("source", { enum: ["manual", "import", "ai_chat", "mcp", "receipt", "inbox"] }).notNull(),
  statementEntryId: text("statement_entry_id"),
  inboxItemId: text("inbox_item_id"),
  importId: text("import_id"),
  confidence: real("confidence"),
  notes: text("notes"),
  isRecurring: integer("is_recurring", { mode: "boolean" }).notNull().default(false),
  isProjected: integer("is_projected", { mode: "boolean" }).notNull().default(false),
  projectedSourceId: text("projected_source_id"),
  installmentCurrent: integer("installment_current"),
  installmentTotal: integer("installment_total"),
  transferPairId: text("transfer_pair_id"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ============================================================================
// TRANSACTION TAGS
// ============================================================================

export const transactionTags = sqliteTable("transaction_tags", {
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.transactionId, table.tagId] }),
]);

// ============================================================================
// ATTACHMENTS
// ============================================================================

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  inboxItemId: text("inbox_item_id").references(() => inboxItems.id),
  transactionId: text("transaction_id").references(() => transactions.id),
  filename: text("filename").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storagePath: text("storage_path").notNull(),
  extractedText: text("extracted_text"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// IMPORTS
// ============================================================================

export const imports = sqliteTable("imports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  cardId: text("card_id").references(() => cards.id),
  cardInvoiceId: text("card_invoice_id").references(() => cardInvoices.id),
  importTemplateId: text("import_template_id"),
  filename: text("filename").notNull(),
  format: text("format", { enum: ["csv", "ofx", "pdf"] }).notNull(),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  totalRows: integer("total_rows"),
  processedRows: integer("processed_rows"),
  errorMessage: text("error_message"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// AI CLASSIFICATIONS
// ============================================================================

export const aiClassifications = sqliteTable("ai_classifications", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull().references(() => transactions.id),
  userId: text("user_id").notNull().references(() => users.id),
  suggestedBeneficiaryId: text("suggested_beneficiary_id"),
  suggestedCategoryId: text("suggested_category_id"),
  suggestedTagIds: text("suggested_tag_ids"), // JSON[]
  suggestedDescription: text("suggested_description"),
  confidence: real("confidence"),
  wasAccepted: integer("was_accepted"), // null=pending, 1=accepted, 0=rejected
  userCorrection: text("user_correction"), // JSON
  provider: text("provider"),
  model: text("model"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// RECURRING TEMPLATES
// ============================================================================

export const recurringTemplates = sqliteTable("recurring_templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  description: text("description").notNull(),
  accountId: text("account_id").references(() => accounts.id),
  cardId: text("card_id").references(() => cards.id),
  beneficiaryId: text("beneficiary_id").references(() => beneficiaries.id),
  categoryId: text("category_id").references(() => categories.id),
  tagIds: text("tag_ids"), // JSON[]
  type: text("type", { enum: ["income", "expense"] }).notNull(),
  estimatedAmount: integer("estimated_amount").notNull(), // centavos
  paymentMethod: text("payment_method", { enum: ["pix", "debit", "credit", "transfer", "boleto", "cash", "other"] }),
  frequency: text("frequency", { enum: ["monthly", "weekly", "biweekly", "quarterly", "yearly", "custom"] }).notNull(),
  customIntervalDays: integer("custom_interval_days"),
  dayOfMonth: integer("day_of_month"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastGeneratedDate: text("last_generated_date"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ============================================================================
// IMPORT TEMPLATES
// ============================================================================

export const importTemplates = sqliteTable("import_templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  format: text("format", { enum: ["csv", "ofx", "pdf"] }).notNull(),
  institution: text("institution"),
  config: text("config").notNull(), // JSON
  isAiGenerated: integer("is_ai_generated", { mode: "boolean" }).notNull().default(false),
  usageCount: integer("usage_count").notNull().default(0),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ============================================================================
// RECONCILIATION RULES
// ============================================================================

export const reconciliationRules = sqliteTable("reconciliation_rules", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  pattern: text("pattern").notNull(),
  matchType: text("match_type", { enum: ["exact", "contains", "regex"] }).notNull(),
  beneficiaryId: text("beneficiary_id").references(() => beneficiaries.id),
  categoryId: text("category_id").references(() => categories.id),
  tagIds: text("tag_ids"), // JSON[]
  paymentMethod: text("payment_method", { enum: ["pix", "debit", "credit", "transfer", "boleto", "cash", "other"] }),
  priority: integer("priority").notNull().default(0),
  hitCount: integer("hit_count").notNull().default(0),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// JOBS
// ============================================================================

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  type: text("type", { enum: ["import_parse", "ai_classify", "ai_classify_batch", "ocr_extract", "generate_projections", "reclassify"] }).notNull(),
  status: text("status", { enum: ["pending", "running", "completed", "failed", "cancelled"] }).notNull().default("pending"),
  payload: text("payload"), // JSON
  result: text("result"), // JSON
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// AUDIT LOG
// ============================================================================

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action", { enum: ["create", "update", "delete", "status_change", "ai_suggest", "ai_accept", "ai_reject", "reconcile"] }).notNull(),
  oldValues: text("old_values"), // JSON
  newValues: text("new_values"), // JSON
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  transactions: many(transactions),
  beneficiaries: many(beneficiaries),
  categories: many(categories),
  tags: many(tags),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
  cards: many(cards),
  transactions: many(transactions),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  account: one(accounts, { fields: [cards.accountId], references: [accounts.id] }),
  user: one(users, { fields: [cards.userId], references: [users.id] }),
  invoices: many(cardInvoices),
  transactions: many(transactions),
}));

export const cardInvoicesRelations = relations(cardInvoices, ({ one, many }) => ({
  card: one(cards, { fields: [cardInvoices.cardId], references: [cards.id] }),
  user: one(users, { fields: [cardInvoices.userId], references: [users.id] }),
  transactions: many(transactions),
  statementEntries: many(statementEntries),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(users, { fields: [categories.userId], references: [users.id] }),
  parent: one(categories, { fields: [categories.parentId], references: [categories.id] }),
  transactions: many(transactions),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  user: one(users, { fields: [tags.userId], references: [users.id] }),
  transactionTags: many(transactionTags),
}));

export const beneficiariesRelations = relations(beneficiaries, ({ one, many }) => ({
  user: one(users, { fields: [beneficiaries.userId], references: [users.id] }),
  defaultCategory: one(categories, { fields: [beneficiaries.defaultCategoryId], references: [categories.id] }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  card: one(cards, { fields: [transactions.cardId], references: [cards.id] }),
  cardInvoice: one(cardInvoices, { fields: [transactions.cardInvoiceId], references: [cardInvoices.id] }),
  beneficiary: one(beneficiaries, { fields: [transactions.beneficiaryId], references: [beneficiaries.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
  transactionTags: many(transactionTags),
  attachments: many(attachments),
  aiClassifications: many(aiClassifications),
}));

export const transactionTagsRelations = relations(transactionTags, ({ one }) => ({
  transaction: one(transactions, { fields: [transactionTags.transactionId], references: [transactions.id] }),
  tag: one(tags, { fields: [transactionTags.tagId], references: [tags.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  user: one(users, { fields: [attachments.userId], references: [users.id] }),
  inboxItem: one(inboxItems, { fields: [attachments.inboxItemId], references: [inboxItems.id] }),
  transaction: one(transactions, { fields: [attachments.transactionId], references: [transactions.id] }),
}));

export const statementEntriesRelations = relations(statementEntries, ({ one }) => ({
  account: one(accounts, { fields: [statementEntries.accountId], references: [accounts.id] }),
  card: one(cards, { fields: [statementEntries.cardId], references: [cards.id] }),
  cardInvoice: one(cardInvoices, { fields: [statementEntries.cardInvoiceId], references: [cardInvoices.id] }),
}));

export const inboxItemsRelations = relations(inboxItems, ({ one, many }) => ({
  user: one(users, { fields: [inboxItems.userId], references: [users.id] }),
  attachments: many(attachments),
}));

export const aiClassificationsRelations = relations(aiClassifications, ({ one }) => ({
  transaction: one(transactions, { fields: [aiClassifications.transactionId], references: [transactions.id] }),
  user: one(users, { fields: [aiClassifications.userId], references: [users.id] }),
}));

export const recurringTemplatesRelations = relations(recurringTemplates, ({ one }) => ({
  user: one(users, { fields: [recurringTemplates.userId], references: [users.id] }),
  account: one(accounts, { fields: [recurringTemplates.accountId], references: [accounts.id] }),
  card: one(cards, { fields: [recurringTemplates.cardId], references: [cards.id] }),
  beneficiary: one(beneficiaries, { fields: [recurringTemplates.beneficiaryId], references: [beneficiaries.id] }),
  category: one(categories, { fields: [recurringTemplates.categoryId], references: [categories.id] }),
}));

export const importsRelations = relations(imports, ({ one }) => ({
  user: one(users, { fields: [imports.userId], references: [users.id] }),
  account: one(accounts, { fields: [imports.accountId], references: [accounts.id] }),
}));

export const reconciliationRulesRelations = relations(reconciliationRules, ({ one }) => ({
  user: one(users, { fields: [reconciliationRules.userId], references: [users.id] }),
  beneficiary: one(beneficiaries, { fields: [reconciliationRules.beneficiaryId], references: [beneficiaries.id] }),
  category: one(categories, { fields: [reconciliationRules.categoryId], references: [categories.id] }),
}));
