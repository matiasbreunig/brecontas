#!/bin/bash
# Reset all transactional data (keeps structure: accounts, cards, categories, tags, beneficiaries, users)
# Usage: bash scripts/reset-transactions.sh

DB="data/brecontas.db"

if [ ! -f "$DB" ]; then
  echo "❌ DB not found at $DB"
  exit 1
fi

echo "📊 Antes:"
sqlite3 "$DB" "
  SELECT '  transactions: ' || COUNT(*) FROM transactions;
  SELECT '  statement_entries: ' || COUNT(*) FROM statement_entries;
  SELECT '  imports: ' || COUNT(*) FROM imports;
  SELECT '  card_invoices: ' || COUNT(*) FROM card_invoices;
  SELECT '  transaction_tags: ' || COUNT(*) FROM transaction_tags;
"

sqlite3 "$DB" "
  DELETE FROM transaction_tags;
  DELETE FROM transactions;
  DELETE FROM statement_entries;
  DELETE FROM imports;
  DELETE FROM card_invoices;
"

echo ""
echo "✅ Limpo. Mantidos:"
sqlite3 "$DB" "
  SELECT '  accounts: ' || COUNT(*) FROM accounts;
  SELECT '  cards: ' || COUNT(*) FROM cards;
  SELECT '  categories: ' || COUNT(*) FROM categories;
  SELECT '  tags: ' || COUNT(*) FROM tags;
  SELECT '  beneficiaries: ' || COUNT(*) FROM beneficiaries;
"
