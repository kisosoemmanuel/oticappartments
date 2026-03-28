import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const databaseUrl = process.env.DATABASE_URL || "";
const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(projectRoot, "data.sqlite");
const backupDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(projectRoot, "backups");
const uploadDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(projectRoot, "uploads");

const resetTables = [
  "invoices",
  "tenant_uploads",
  "shared_documents",
  "documents",
  "maintenance_tickets",
  "alerts",
  "payment_requests",
  "messages",
  "vacate_notices",
  "leases",
  "transactions",
  "arrears",
  "units",
  "users",
  "admin_settings",
];

function resetDirectory(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

let tablesCleared = [];

if (databaseUrl) {
  const pg = await import("pg");
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === "disable" ? false : process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  try {
    const existingTables = new Set(
      (
        await pool.query(
          `
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
          `
        )
      ).rows.map((row) => row.tablename)
    );

    for (const table of resetTables) {
      if (!existingTables.has(table)) continue;
      await pool.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
      tablesCleared.push(table);
    }
  } finally {
    await pool.end();
  }
} else {
  const sqlite = await import("better-sqlite3");

  if (fileExists(dbPath)) {
    const db = new sqlite.default(dbPath);
    const existingTables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name)
    );

    const truncate = db.transaction(() => {
      for (const table of resetTables) {
        if (!existingTables.has(table)) continue;
        db.prepare(`DELETE FROM ${table}`).run();
        tablesCleared.push(table);
      }

      if (existingTables.has("sqlite_sequence")) {
        db.prepare("DELETE FROM sqlite_sequence").run();
      }
    });

    truncate();
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
    db.close();
  }

  for (const suffix of ["-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

resetDirectory(backupDir);
resetDirectory(uploadDir);

console.log(
  JSON.stringify(
    {
      database: databaseUrl || dbPath,
      backups: backupDir,
      uploads: uploadDir,
      cleared_tables: tablesCleared,
      status: "reset-complete",
    },
    null,
    2
  )
);
