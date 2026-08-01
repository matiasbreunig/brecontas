#!/bin/bash
# Reset all transactional data (keeps structure: accounts, cards, categories, tags, beneficiaries, users)
# Usage: bash scripts/reset-transactions.sh
#
# Runs through the container: there is no sqlite3 CLI on gwcasa, and the native
# better-sqlite3 binding only exists inside the image.

set -euo pipefail

CONTAINER="${BRECONTAS_CONTAINER:-brecontas}"
DB="${BRECONTAS_DB:-/app/data/brecontas.db}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "❌ Container '$CONTAINER' não está rodando" >&2
  exit 1
fi

docker exec "$CONTAINER" node -e "
const Database = require('/app/node_modules/better-sqlite3');
const db = new Database('${DB}');
db.pragma('foreign_keys = ON');

const TRANSACTIONAL = [
  'ai_classifications',
  'transaction_tags',
  'transactions',
  'statement_entries',
  'imports',
  'card_invoices',
];
const KEPT = ['users', 'accounts', 'cards', 'categories', 'tags', 'beneficiaries'];
const count = (t) => db.prepare('SELECT count(*) c FROM ' + t).get().c;

console.log('📊 Antes:');
for (const t of TRANSACTIONAL) console.log('  ' + t + ': ' + count(t));

// Order respects FK constraints, so they stay enforced throughout.
db.transaction(() => {
  for (const t of TRANSACTIONAL) db.prepare('DELETE FROM ' + t).run();
})();

console.log('');
console.log('✅ Limpo. Mantidos:');
for (const t of KEPT) console.log('  ' + t + ': ' + count(t));
"
