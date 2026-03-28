import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const sourceDbPath = process.env.SQLITE_DB_PATH
  ? path.resolve(process.env.SQLITE_DB_PATH)
  : path.join(projectRoot, "data.sqlite");
const databaseUrl = process.env.DATABASE_URL || "";

if (!databaseUrl) {
  throw new Error("Set DATABASE_URL before running the SQLite to Postgres migration.");
}

const { default: pool, initDb } = await import("../db-postgres.js");
await initDb();

const sqlite = new Database(sourceDbPath, { readonly: true });

const tableOrder = [
  "users",
  "arrears",
  "transactions",
  "leases",
  "units",
  "payment_requests",
  "alerts",
  "maintenance_tickets",
  "documents",
  "shared_documents",
  "tenant_uploads",
  "messages",
  "vacate_notices",
  "admin_settings",
  "invoices",
];

const sequenceTables = [
  "users",
  "arrears",
  "transactions",
  "leases",
  "units",
  "payment_requests",
  "alerts",
  "maintenance_tickets",
  "documents",
  "shared_documents",
  "tenant_uploads",
  "messages",
  "vacate_notices",
  "invoices",
];

function hasTable(tableName) {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return Boolean(row);
}

function readRows(tableName) {
  if (!hasTable(tableName)) {
    return [];
  }

  const orderBy = tableName === "admin_settings" ? "key" : "id";
  return sqlite.prepare(`SELECT * FROM ${tableName} ORDER BY ${orderBy} ASC`).all();
}

async function truncateTarget() {
  await pool.query(`
    TRUNCATE TABLE
      invoices,
      tenant_uploads,
      shared_documents,
      documents,
      maintenance_tickets,
      alerts,
      payment_requests,
      messages,
      vacate_notices,
      leases,
      transactions,
      arrears,
      units,
      users,
      admin_settings
    RESTART IDENTITY CASCADE
  `);
}

async function insertRows(tableName, rows) {
  if (!rows.length) {
    return 0;
  }

  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const values = columns.map((column) => (row[column] === undefined ? null : row[column]));
    await pool.query(
      `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
      values
    );
  }

  return rows.length;
}

async function resetSequences() {
  for (const tableName of sequenceTables) {
    await pool.query(
      `
        SELECT setval(
          pg_get_serial_sequence($1, 'id'),
          COALESCE((SELECT MAX(id)::bigint FROM ${tableName}), 1),
          COALESCE((SELECT MAX(id) IS NOT NULL FROM ${tableName}), false)
        )
      `,
      [tableName]
    );
  }
}

const counts = {};

try {
  await truncateTarget();

  for (const tableName of tableOrder) {
    const rows = readRows(tableName);
    counts[tableName] = await insertRows(tableName, rows);
  }

  await resetSequences();

  console.log(
    JSON.stringify(
      {
        source: sourceDbPath,
        target: "postgres",
        migrated: counts,
        status: "migration-complete",
      },
      null,
      2
    )
  );
} finally {
  sqlite.close();
  await pool.end();
}
