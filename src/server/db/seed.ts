import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { nanoid } from "nanoid";
import * as schema from "./schema";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { hashPassword } from "../password";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "brecontas.db");

// Ensure data directory exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite, { schema });

/**
 * Seed passwords are generated, never literals: this repository is readable by
 * anyone who can clone it, and the previous hard-coded "admin123" stayed the
 * live password of both production accounts for months.
 * Set SEED_PASSWORD to choose them yourself.
 */
function seedPassword(): string {
  return process.env.SEED_PASSWORD || crypto.randomBytes(12).toString("base64url");
}

function id(): string {
  return nanoid(16);
}

const now = new Date();

async function seed() {
  console.log("🌱 Seeding database...");

  // Users
  const matiasId = id();
  const esposaId = id();

  const matiasPassword = seedPassword();
  const esposaPassword = seedPassword();

  db.insert(schema.users).values([
    { id: matiasId, name: "Matias", email: "matias@brecontas.local", passwordHash: hashPassword(matiasPassword), createdAt: now },
    { id: esposaId, name: "Esposa", email: "esposa@brecontas.local", passwordHash: hashPassword(esposaPassword), createdAt: now },
  ]).run();

  console.log("✓ Users created — anote as senhas, elas não voltam a aparecer:");
  console.log(`    matias@brecontas.local  ${matiasPassword}`);
  console.log(`    esposa@brecontas.local  ${esposaPassword}`);

  // Categories - Brazilian defaults
  const catData: Array<{ name: string; icon: string; type: "expense" | "income" | "both"; children?: Array<{ name: string; icon: string }> }> = [
    { name: "Alimentação", icon: "🍽️", type: "expense", children: [
      { name: "Restaurante", icon: "🍴" },
      { name: "Supermercado", icon: "🛒" },
      { name: "Delivery", icon: "📦" },
      { name: "Padaria/Café", icon: "☕" },
    ]},
    { name: "Moradia", icon: "🏠", type: "expense", children: [
      { name: "Aluguel", icon: "🔑" },
      { name: "Condomínio", icon: "🏢" },
      { name: "Energia", icon: "⚡" },
      { name: "Água", icon: "💧" },
      { name: "Gás", icon: "🔥" },
      { name: "Internet/TV", icon: "📡" },
      { name: "Manutenção", icon: "🔧" },
    ]},
    { name: "Transporte", icon: "🚗", type: "expense", children: [
      { name: "Combustível", icon: "⛽" },
      { name: "Estacionamento", icon: "🅿️" },
      { name: "Uber/99", icon: "🚕" },
      { name: "Transporte Público", icon: "🚌" },
      { name: "Manutenção Veículo", icon: "🔧" },
      { name: "Seguro Veículo", icon: "🛡️" },
      { name: "IPVA/Licenciamento", icon: "📋" },
    ]},
    { name: "Saúde", icon: "🏥", type: "expense", children: [
      { name: "Plano de Saúde", icon: "💊" },
      { name: "Farmácia", icon: "💉" },
      { name: "Consultas", icon: "👨‍⚕️" },
      { name: "Exames", icon: "🔬" },
      { name: "Academia", icon: "🏋️" },
    ]},
    { name: "Educação", icon: "📚", type: "expense", children: [
      { name: "Escola/Faculdade", icon: "🎓" },
      { name: "Cursos", icon: "💻" },
      { name: "Livros", icon: "📖" },
    ]},
    { name: "Lazer", icon: "🎉", type: "expense", children: [
      { name: "Viagem", icon: "✈️" },
      { name: "Cinema/Teatro", icon: "🎬" },
      { name: "Streaming", icon: "📺" },
      { name: "Hobby", icon: "🎮" },
    ]},
    { name: "Vestuário", icon: "👔", type: "expense" },
    { name: "Pets", icon: "🐾", type: "expense" },
    { name: "Impostos/Taxas", icon: "📋", type: "expense" },
    { name: "Seguros", icon: "🛡️", type: "expense" },
    { name: "Assinaturas", icon: "📱", type: "expense" },
    { name: "Presentes/Doações", icon: "🎁", type: "expense" },
    { name: "Outros (Despesa)", icon: "📌", type: "expense" },
    { name: "Salário", icon: "💰", type: "income" },
    { name: "Freelance", icon: "💼", type: "income" },
    { name: "Investimentos", icon: "📈", type: "income" },
    { name: "Outros (Receita)", icon: "💵", type: "income" },
  ];

  for (const cat of catData) {
    const parentId = id();
    db.insert(schema.categories).values({
      id: parentId,
      userId: matiasId,
      name: cat.name,
      icon: cat.icon,
      type: cat.type,
      createdByUserId: matiasId,
      createdAt: now,
    }).run();

    if (cat.children) {
      for (const child of cat.children) {
        db.insert(schema.categories).values({
          id: id(),
          userId: matiasId,
          name: child.name,
          icon: child.icon,
          parentId: parentId,
          type: cat.type,
          createdByUserId: matiasId,
          createdAt: now,
        }).run();
      }
    }
  }

  console.log("✓ Categories created");

  // Create FTS5 virtual table
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      entity_type,
      entity_id,
      content,
      tokenize='unicode61'
    );
  `);

  console.log("✓ FTS5 search index created");
  console.log("🎉 Seed completed!");

  sqlite.close();
}

seed().catch(console.error);
