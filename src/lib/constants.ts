export const TRANSACTION_TYPES = ["income", "expense", "transfer", "refund"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ["draft", "unrecognized", "identified", "reconciled", "discarded"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const PAYMENT_METHODS = ["pix", "debit", "credit", "transfer", "boleto", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ACCOUNT_TYPES = ["checking", "savings", "investment", "wallet"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CARD_BRANDS = ["visa", "mastercard", "elo", "amex", "other"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const TRANSACTION_SOURCES = ["manual", "import", "ai_chat", "mcp", "receipt", "inbox"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const INVOICE_STATUSES = ["open", "closed", "paid", "overdue"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: "PIX",
  debit: "Débito",
  credit: "Crédito",
  transfer: "Transferência",
  boleto: "Boleto",
  cash: "Dinheiro",
  other: "Outro",
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
  refund: "Estorno",
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  draft: "Rascunho",
  unrecognized: "Não reconhecido",
  identified: "Identificado",
  reconciled: "Conciliado",
  discarded: "Descartado",
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Conta Corrente",
  savings: "Poupança",
  investment: "Investimento",
  wallet: "Carteira",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  open: "Aberta",
  closed: "Fechada",
  paid: "Paga",
  overdue: "Vencida",
};
