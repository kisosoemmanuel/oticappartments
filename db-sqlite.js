import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDbPath = path.join(__dirname, "data.sqlite");
export const DATABASE_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : defaultDbPath;

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const db = new Database(DATABASE_PATH);

function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

export function initDb() {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT,
      account_number_hash TEXT NOT NULL,
      access_token TEXT,
      tenant_id TEXT UNIQUE,
      landlord_id TEXT,
      property_id TEXT,
      property_name TEXT,
      floor_number TEXT,
      house_number TEXT,
      phone_number TEXT,
      email_address TEXT,
      national_id TEXT,
      rent TEXT,
      deposit TEXT,
      bill TEXT,
      arrears TEXT,
      account_balance TEXT,
      amount TEXT,
      state TEXT,
      temp_account_balance TEXT,
      minimum_days_to_vacate TEXT,
      date_created TEXT,
      wallet TEXT,
      status TEXT,
      id_verification_status TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    DROP INDEX IF EXISTS idx_users_first_name;
  `);

  ensureColumn("users", "floor_number", "TEXT");
  ensureColumn("users", "deposit", "TEXT");
  ensureColumn("users", "rent_balance", "TEXT");
  ensureColumn("users", "water_balance", "TEXT");
  ensureColumn("users", "trash_balance", "TEXT");
  ensureColumn("users", "electricity_balance", "TEXT");
  ensureColumn("users", "last_seen_at", "TEXT");
  ensureColumn("users", "last_login_at", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_property_id ON users(property_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN', 'PROPERTY_ADMIN')),
      property_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      last_login_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(property_id) REFERENCES properties(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      property_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
    );
  `);

  const upsertProperty = db.prepare(`
    INSERT INTO properties (id, name)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(NULLIF(excluded.name, ''), properties.name)
  `);
  upsertProperty.run("otic-1", "Otic 1");
  upsertProperty.run("otic-2", "Otic 2");

  db.prepare(`
    DELETE FROM properties
    WHERE id NOT IN ('otic-1', 'otic-2')
  `).run();

  const legacyProperties = db.prepare(`
    SELECT DISTINCT
      TRIM(property_id) AS id,
      COALESCE(NULLIF(TRIM(property_name), ''), TRIM(property_id)) AS name
    FROM users
    WHERE COALESCE(NULLIF(TRIM(property_id), ''), '') <> ''
  `).all();
  for (const property of legacyProperties) {
    if (property.id === "otic-1" || property.id === "otic-2") {
      upsertProperty.run(property.id, property.name || property.id);
    }
  }

  db.prepare(`
    UPDATE users
    SET property_id = 'otic-1'
    WHERE COALESCE(NULLIF(TRIM(property_id), ''), '') = ''
  `).run();

  db.prepare(`
    UPDATE admin_users
    SET property_id = 'otic-1'
    WHERE username = 'adminotic1'
  `).run();

  db.prepare(`
    UPDATE admin_users
    SET property_id = 'otic-2'
    WHERE username = 'adminotic2'
  `).run();

  db.prepare(`
    UPDATE users
    SET property_name = COALESCE(
      (SELECT name FROM properties WHERE properties.id = users.property_id LIMIT 1),
      NULLIF(TRIM(property_name), ''),
      'Otic 1'
    )
  `).run();

  const upsertAdminUser = db.prepare(`
    INSERT INTO admin_users (username, password_hash, full_name, role, property_id, status)
    VALUES (@username, @password_hash, @full_name, @role, @property_id, @status)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      full_name = excluded.full_name,
      role = excluded.role,
      property_id = excluded.property_id,
      status = excluded.status,
      updated_at = datetime('now')
  `);

  const superAdminUsername = String(process.env.ADMIN_USERNAME || "superadmin").trim() || "superadmin";
  const superAdminPassword = String(process.env.ADMIN_PASSWORD || "otic12").trim() || "otic12";
  const otic1AdminUsername = String(process.env.OTIC1_ADMIN_USERNAME || "adminotic1").trim() || "adminotic1";
  const otic1AdminPassword = String(process.env.OTIC1_ADMIN_PASSWORD || "oticruiru").trim() || "oticruiru";
  const otic2AdminUsername = String(process.env.OTIC2_ADMIN_USERNAME || "adminotic2").trim() || "adminotic2";
  const otic2AdminPassword = String(process.env.OTIC2_ADMIN_PASSWORD || "oticbondo").trim() || "oticbondo";

  upsertAdminUser.run({
    username: superAdminUsername,
    password_hash: hashPassword(superAdminPassword),
    full_name: "Super Admin",
    role: "SUPER_ADMIN",
    property_id: null,
    status: "ACTIVE",
  });

  upsertAdminUser.run({
    username: otic1AdminUsername,
    password_hash: hashPassword(otic1AdminPassword),
    full_name: "Otic 1 Admin",
    role: "PROPERTY_ADMIN",
    property_id: "otic-1",
    status: "ACTIVE",
  });

  upsertAdminUser.run({
    username: otic2AdminUsername,
    password_hash: hashPassword(otic2AdminPassword),
    full_name: "Otic 2 Admin",
    role: "PROPERTY_ADMIN",
    property_id: "otic-2",
    status: "ACTIVE",
  });

  db.exec(`
    CREATE TABLE IF NOT EXISTS arrears (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      description TEXT,
      balance TEXT,
      due_date TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount TEXT,
      date_created TEXT,
      type TEXT,
      description TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS leases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      property_id TEXT,
      unit_id INTEGER,
      lease_name TEXT,
      start_date TEXT,
      end_date TEXT,
      monthly_rent TEXT,
      deposit TEXT DEFAULT '0',
      rent_amount TEXT DEFAULT '0',
      move_in_date TEXT,
      move_out_date TEXT,
      status TEXT,
      notes TEXT,
      billing_settings TEXT,
      utility_settings TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(unit_id) REFERENCES units(id) ON DELETE SET NULL
    );
  `);
  ensureColumn("leases", "property_id", "TEXT");
  ensureColumn("leases", "unit_id", "INTEGER");
  ensureColumn("leases", "deposit", "TEXT DEFAULT '0'");
  ensureColumn("leases", "rent_amount", "TEXT DEFAULT '0'");
  ensureColumn("leases", "move_in_date", "TEXT");
  ensureColumn("leases", "move_out_date", "TEXT");
  ensureColumn("leases", "notes", "TEXT");
  ensureColumn("leases", "billing_settings", "TEXT");
  ensureColumn("leases", "utility_settings", "TEXT");
  db.prepare(`
    UPDATE leases
    SET property_id = COALESCE(NULLIF(TRIM(property_id), ''), 'otic-1')
    WHERE COALESCE(NULLIF(TRIM(property_id), ''), '') = ''
  `).run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id TEXT,
      unit_code TEXT UNIQUE NOT NULL,
      floor_number TEXT,
      status TEXT DEFAULT 'VACANT',
      tenant_id TEXT,
      current_tenant_id INTEGER,
      current_tenancy_id INTEGER,
      rent_amount TEXT DEFAULT '0',
      occupancy_status TEXT DEFAULT 'VACANT',
      balance TEXT DEFAULT '0',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(property_id) REFERENCES properties(id)
    );
  `);
  ensureColumn("units", "property_id", "TEXT");
  ensureColumn("units", "current_tenant_id", "INTEGER");
  ensureColumn("units", "current_tenancy_id", "INTEGER");
  ensureColumn("units", "rent_amount", "TEXT DEFAULT '0'");
  ensureColumn("units", "occupancy_status", "TEXT DEFAULT 'VACANT'");
  ensureColumn("units", "balance", "TEXT DEFAULT '0'");
  ensureColumn("units", "unit_number", "TEXT");
  db.prepare(`
    UPDATE units
    SET property_id = COALESCE(NULLIF(TRIM(property_id), ''), 'otic-1')
    WHERE COALESCE(NULLIF(TRIM(property_id), ''), '') = ''
  `).run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      method TEXT NOT NULL,
      amount TEXT NOT NULL,
      phone_number TEXT,
      reference TEXT,
      payment_time TEXT,
      status TEXT DEFAULT 'PENDING',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  ensureColumn("payment_requests", "payment_for", "TEXT");
  ensureColumn("payment_requests", "payment_time", "TEXT");
  ensureColumn("payment_requests", "reviewed_at", "TEXT");
  ensureColumn("payment_requests", "review_note", "TEXT");
  ensureColumn("payment_requests", "receipt_number", "TEXT");
  ensureColumn("payment_requests", "provider", "TEXT");
  ensureColumn("payment_requests", "provider_request_id", "TEXT");
  ensureColumn("payment_requests", "provider_checkout_id", "TEXT");
  ensureColumn("payment_requests", "provider_result_code", "TEXT");
  ensureColumn("payment_requests", "provider_result_description", "TEXT");
  ensureColumn("payment_requests", "provider_metadata_json", "TEXT");
  ensureColumn("payment_requests", "prompted_at", "TEXT");
  ensureColumn("payment_requests", "callback_received_at", "TEXT");
  ensureColumn("payment_requests", "auto_applied_at", "TEXT");
  ensureColumn("payment_requests", "completed_at", "TEXT");
  ensureColumn("payment_requests", "tenant_reference", "TEXT");
  ensureColumn("payment_requests", "tenant_payment_time", "TEXT");
  ensureColumn("payment_requests", "tenant_confirmed_at", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_monthly_statements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      opening_balance_override TEXT,
      deposit TEXT DEFAULT '0',
      garbage_amount TEXT DEFAULT '0',
      rent_bill TEXT DEFAULT '0',
      remarks TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(property_id, user_id, month_key),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(property_id) REFERENCES properties(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_water_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      previous_reading TEXT DEFAULT '0',
      latest_reading TEXT DEFAULT '0',
      rate TEXT DEFAULT '0',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(property_id, user_id, month_key),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(property_id) REFERENCES properties(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_monthly_payment_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      amount TEXT NOT NULL,
      payment_date TEXT,
      receipt_number TEXT,
      remarks TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(property_id) REFERENCES properties(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      status TEXT DEFAULT 'ACTIVE',
      trigger_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_alert_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_owner_admin_user_id INTEGER NOT NULL,
      property_id TEXT,
      sender_admin_user_id INTEGER,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(thread_owner_admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY(property_id) REFERENCES properties(id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_admin_alert_messages_thread_owner ON admin_alert_messages(thread_owner_admin_user_id, created_at DESC, id DESC);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_admin_alert_messages_property_id ON admin_alert_messages(property_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Pending',
      technician_name TEXT,
      repair_cost TEXT DEFAULT '0',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  ensureColumn("maintenance_tickets", "repair_cost", "TEXT DEFAULT '0'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'AVAILABLE',
      url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id TEXT,
      name TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'AVAILABLE',
      url TEXT,
      original_name TEXT,
      stored_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  ensureColumn("shared_documents", "property_id", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shared_documents_property_id ON shared_documents(property_id);
  `);
  db.prepare(`
    UPDATE shared_documents
    SET property_id = 'otic-1'
    WHERE COALESCE(NULLIF(TRIM(property_id), ''), '') = ''
  `).run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      note TEXT,
      original_name TEXT,
      stored_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      sender_type TEXT DEFAULT 'SYSTEM',
      sender_name TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      status TEXT DEFAULT 'UNREAD',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS vacate_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      move_out_date TEXT NOT NULL,
      reason TEXT,
      forwarding_address TEXT,
      phone_number TEXT,
      status TEXT DEFAULT 'Pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  ensureColumn("vacate_notices", "reviewed_at", "TEXT");
  ensureColumn("vacate_notices", "review_note", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      period_key TEXT NOT NULL,
      period_label TEXT,
      due_date TEXT,
      rent_amount TEXT DEFAULT '0',
      water_amount TEXT DEFAULT '0',
      trash_amount TEXT DEFAULT '0',
      electricity_amount TEXT DEFAULT '0',
      total_amount TEXT DEFAULT '0',
      paid_amount TEXT DEFAULT '0',
      balance_amount TEXT DEFAULT '0',
      status TEXT DEFAULT 'UNPAID',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, period_key),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    UPDATE users
    SET
      deposit = COALESCE(NULLIF(TRIM(deposit), ''), '0'),
      rent = COALESCE(NULLIF(TRIM(rent), ''), '0'),
      bill = COALESCE(NULLIF(TRIM(bill), ''), '0'),
      arrears = COALESCE(NULLIF(TRIM(arrears), ''), '0'),
      account_balance = COALESCE(NULLIF(TRIM(account_balance), ''), '0'),
      rent_balance = COALESCE(NULLIF(TRIM(rent_balance), ''), NULLIF(TRIM(rent), ''), '0'),
      water_balance = COALESCE(NULLIF(TRIM(water_balance), ''), NULLIF(TRIM(bill), ''), '0'),
      trash_balance = COALESCE(NULLIF(TRIM(trash_balance), ''), '0'),
      electricity_balance = COALESCE(NULLIF(TRIM(electricity_balance), ''), '0')
  `);
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

export function listProperties() {
  return db
    .prepare(`
      SELECT *
      FROM properties
      ORDER BY
        CASE id
          WHEN 'otic-1' THEN 0
          WHEN 'otic-2' THEN 1
          ELSE 2
        END,
        LOWER(name) ASC
    `)
    .all();
}

export function getPropertyById(propertyId) {
  return db.prepare("SELECT * FROM properties WHERE id = ? LIMIT 1").get(propertyId) || null;
}

export function createUnit({ property_id, unit_code, floor_number = null, status = "VACANT", tenant_id = null, current_tenant_id = null, current_tenancy_id = null, rent_amount = "0", notes = "" }) {
  const normalizedPropertyId = String(property_id || "").trim() || "otic-1";
  const normalizedUnitCode = String(unit_code || "").trim();
  if (!normalizedUnitCode) throw new Error("unit_code is required");

  const existing = db.prepare("SELECT * FROM units WHERE unit_code = ? LIMIT 1").get(normalizedUnitCode);
  if (existing) {
    db.prepare(`
      UPDATE units
      SET property_id = ?, floor_number = ?, status = ?, tenant_id = ?, current_tenant_id = ?, current_tenancy_id = ?, rent_amount = ?, occupancy_status = ?, balance = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      normalizedPropertyId,
      floor_number ?? existing.floor_number,
      status ?? existing.status,
      tenant_id ?? existing.tenant_id,
      current_tenant_id ?? existing.current_tenant_id,
      current_tenancy_id ?? existing.current_tenancy_id,
      String(rent_amount ?? existing.rent_amount ?? "0"),
      String(status ?? existing.occupancy_status ?? existing.status ?? "VACANT"),
      String(existing.balance ?? "0"),
      notes ?? existing.notes,
      existing.id
    );
    return db.prepare("SELECT * FROM units WHERE id = ? LIMIT 1").get(existing.id) || null;
  }

  const result = db.prepare(`
    INSERT INTO units (property_id, unit_code, floor_number, status, tenant_id, current_tenant_id, current_tenancy_id, rent_amount, occupancy_status, balance, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    normalizedPropertyId,
    normalizedUnitCode,
    floor_number,
    status,
    tenant_id,
    current_tenant_id,
    current_tenancy_id,
    String(rent_amount ?? "0"),
    status,
    "0",
    notes || ""
  );

  return db.prepare("SELECT * FROM units WHERE id = ? LIMIT 1").get(result.lastInsertRowid) || null;
}

export function listUnitsForProperty(propertyId) {
  const normalizedPropertyId = String(propertyId || "").trim();
  if (!normalizedPropertyId) return [];
  return db.prepare("SELECT * FROM units WHERE property_id = ? ORDER BY floor_number ASC, unit_code ASC").all(normalizedPropertyId);
}

export function getUnitById(id) {
  return db.prepare("SELECT * FROM units WHERE id = ? LIMIT 1").get(id) || null;
}

export function listTenantTenancies(tenantId) {
  return db.prepare("SELECT * FROM leases WHERE user_id = ? ORDER BY start_date DESC, id DESC").all(tenantId);
}

export function createTenancy({ tenant_id, property_id, unit_id, lease_name, start_date, end_date, monthly_rent, deposit = "0", move_in_date = null, move_out_date = null, status = "ACTIVE", notes = "", billing_settings = null, utility_settings = null }) {
  const normalizedTenantId = Number(tenant_id);
  const normalizedPropertyId = String(property_id || "").trim() || "otic-1";
  const normalizedUnitId = unit_id ? Number(unit_id) : null;
  const leaseLabel = String(lease_name || "Tenancy Agreement").trim() || "Tenancy Agreement";

  if (!normalizedTenantId) throw new Error("tenant_id is required");

  const result = db.prepare(`
    INSERT INTO leases (user_id, property_id, unit_id, lease_name, start_date, end_date, monthly_rent, deposit, rent_amount, move_in_date, move_out_date, status, notes, billing_settings, utility_settings, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    normalizedTenantId,
    normalizedPropertyId,
    normalizedUnitId,
    leaseLabel,
    start_date || null,
    end_date || null,
    monthly_rent || "0",
    String(deposit ?? "0"),
    String(monthly_rent ?? "0"),
    move_in_date || start_date || null,
    move_out_date || end_date || null,
    status || "ACTIVE",
    notes || "",
    billing_settings ? JSON.stringify(billing_settings) : null,
    utility_settings ? JSON.stringify(utility_settings) : null
  );

  const created = db.prepare("SELECT * FROM leases WHERE id = ? LIMIT 1").get(result.lastInsertRowid) || null;
  if (normalizedUnitId) {
    db.prepare(`
      UPDATE units
      SET current_tenancy_id = ?, current_tenant_id = ?, status = ?, occupancy_status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(created.id, normalizedTenantId, status || "OCCUPIED", status || "OCCUPIED", normalizedUnitId);
  }

  return created;
}

export function listTenanciesForProperty(propertyId) {
  const normalizedPropertyId = String(propertyId || "").trim();
  if (!normalizedPropertyId) return [];
  return db.prepare("SELECT * FROM leases WHERE property_id = ? ORDER BY start_date DESC, id DESC").all(normalizedPropertyId);
}

export function getAdminUserByUsername(username) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) return null;
  return db.prepare("SELECT * FROM admin_users WHERE username = ? LIMIT 1").get(normalizedUsername) || null;
}

export function getAdminUserById(id) {
  return db.prepare("SELECT * FROM admin_users WHERE id = ? LIMIT 1").get(id) || null;
}

export function listAdminUsers() {
  return db.prepare("SELECT * FROM admin_users ORDER BY id ASC").all();
}

export function addAdminAlertMessage({
  thread_owner_admin_user_id,
  property_id = null,
  sender_admin_user_id = null,
  sender_role,
  sender_name,
  body,
}) {
  const result = db.prepare(
    `
      INSERT INTO admin_alert_messages (
        thread_owner_admin_user_id,
        property_id,
        sender_admin_user_id,
        sender_role,
        sender_name,
        body
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(thread_owner_admin_user_id, property_id, sender_admin_user_id, sender_role, sender_name, body);

  return db.prepare("SELECT * FROM admin_alert_messages WHERE id = ? LIMIT 1").get(result.lastInsertRowid) || null;
}

export function listAdminAlertMessagesByThreadOwner(threadOwnerAdminUserId) {
  return db.prepare(
    `
      SELECT
        admin_alert_messages.*,
        sender.username AS sender_username,
        sender.full_name AS sender_full_name,
        sender.property_id AS sender_property_id,
        owner.username AS thread_owner_username,
        owner.full_name AS thread_owner_full_name,
        owner.property_id AS thread_owner_property_id,
        properties.name AS property_name
      FROM admin_alert_messages
      LEFT JOIN admin_users AS sender ON sender.id = admin_alert_messages.sender_admin_user_id
      LEFT JOIN admin_users AS owner ON owner.id = admin_alert_messages.thread_owner_admin_user_id
      LEFT JOIN properties ON properties.id = admin_alert_messages.property_id
      WHERE admin_alert_messages.thread_owner_admin_user_id = ?
      ORDER BY datetime(admin_alert_messages.created_at) ASC, admin_alert_messages.id ASC
    `
  ).all(threadOwnerAdminUserId);
}

export function listAdminAlertThreads() {
  return db.prepare(
    `
      SELECT
        admin_alert_messages.thread_owner_admin_user_id,
        admin_alert_messages.property_id,
        owner.username AS owner_username,
        owner.full_name AS owner_full_name,
        owner.role AS owner_role,
        owner.property_id AS owner_property_id,
        properties.name AS property_name,
        COUNT(*) AS message_count,
        MAX(admin_alert_messages.created_at) AS last_message_at,
        (
          SELECT latest.body
          FROM admin_alert_messages AS latest
          WHERE latest.thread_owner_admin_user_id = admin_alert_messages.thread_owner_admin_user_id
          ORDER BY datetime(latest.created_at) DESC, latest.id DESC
          LIMIT 1
        ) AS last_message_body
      FROM admin_alert_messages
      INNER JOIN admin_users AS owner ON owner.id = admin_alert_messages.thread_owner_admin_user_id
      LEFT JOIN properties ON properties.id = admin_alert_messages.property_id
      GROUP BY
        admin_alert_messages.thread_owner_admin_user_id,
        admin_alert_messages.property_id,
        owner.username,
        owner.full_name,
        owner.role,
        owner.property_id,
        properties.name
      ORDER BY datetime(last_message_at) DESC, admin_alert_messages.thread_owner_admin_user_id DESC
    `
  ).all();
}

export function createAdminUser({ username, password, full_name, role, property_id = null, status = "ACTIVE" }) {
  const normalizedUsername = String(username || "").trim();
  const normalizedFullName = String(full_name || "").trim();
  const normalizedRole = String(role || "PROPERTY_ADMIN").trim().toUpperCase();
  if (!normalizedUsername) {
    throw new Error("username is required");
  }
  if (!password) {
    throw new Error("password is required");
  }
  if (!normalizedFullName) {
    throw new Error("full_name is required");
  }
  if (!['SUPER_ADMIN', 'PROPERTY_ADMIN'].includes(normalizedRole)) {
    throw new Error("role must be SUPER_ADMIN or PROPERTY_ADMIN");
  }

  const existing = getAdminUserByUsername(normalizedUsername);
  if (existing) {
    throw new Error("Admin username is already in use");
  }

  const result = db.prepare(`
    INSERT INTO admin_users (username, password_hash, full_name, role, property_id, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(normalizedUsername, hashPassword(password), normalizedFullName, normalizedRole, property_id || null, status);

  return getAdminUserById(result.lastInsertRowid);
}

export function writeAuditLog({ admin_user_id = null, action, entity_type = null, entity_id = null, property_id = null, details = null }) {
  return db.prepare(`
    INSERT INTO audit_logs (admin_user_id, action, entity_type, entity_id, property_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    admin_user_id,
    String(action || "").trim() || "UNKNOWN_ACTION",
    entity_type || null,
    entity_id || null,
    property_id || null,
    details ? JSON.stringify(details) : null
  );
}

export function listAuditLogs({ property_id = null, limit = 50 } = {}) {
  const normalizedPropertyId = String(property_id || "").trim();
  const whereClause = normalizedPropertyId ? "WHERE property_id = ?" : "";
  const query = `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ?`;
  return normalizedPropertyId
    ? db.prepare(query).all(normalizedPropertyId, Number(limit || 50))
    : db.prepare(query).all(Number(limit || 50));
}

const FINANCIAL_BALANCE_FIELDS = ["rent_balance", "water_balance", "trash_balance", "electricity_balance"];

function toMoneyNumber(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function hasFinancialBreakdown(user) {
  return FINANCIAL_BALANCE_FIELDS.some((field) => String(user?.[field] ?? "").trim() !== "");
}

function calculateUserOutstanding(user) {
  if (!user) return 0;
  if (!hasFinancialBreakdown(user)) {
    return Math.max(toMoneyNumber(user.account_balance), toMoneyNumber(user.arrears));
  }

  return FINANCIAL_BALANCE_FIELDS.reduce((total, field) => total + toMoneyNumber(user[field]), 0);
}

function withDerivedFinancials(user) {
  if (!user) return null;

  const outstanding = calculateUserOutstanding(user);
  return {
    ...user,
    account_balance: String(outstanding),
    arrears: String(outstanding),
  };
}

function normalizeMonthKey(monthKey) {
  const normalized = String(monthKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new Error("month_key must be in YYYY-MM format");
  }
  return normalized;
}

function previousMonthKey(monthKey) {
  const [yearPart, monthPart] = normalizeMonthKey(monthKey).split("-");
  const date = new Date(Date.UTC(Number(yearPart), Number(monthPart) - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toLedgerNumber(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function computeDues({ openingBalance, deposit, waterBill, garbageAmount, rentBill }) {
  const currentCharges = deposit + waterBill + garbageAmount + rentBill;
  if (openingBalance < 0) {
    return currentCharges + Math.abs(openingBalance);
  }
  if (openingBalance > 0) {
    return currentCharges - openingBalance;
  }
  return currentCharges;
}

function buildLedgerMaps(rows, keyBuilder) {
  const map = new Map();
  for (const row of rows) {
    map.set(keyBuilder(row), row);
  }
  return map;
}

function buildPaymentMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.user_id}:${row.month_key}`;
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) => {
      const leftTime = new Date(left.payment_date || left.created_at || 0).getTime();
      const rightTime = new Date(right.payment_date || right.created_at || 0).getTime();
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return Number(right.id || 0) - Number(left.id || 0);
    });
  }
  return map;
}

function buildMonthlyTimeline(user, targetMonthKey, statementMap, waterMap, paymentMap) {
  const months = new Set([targetMonthKey]);

  for (const mapKey of statementMap.keys()) {
    const [userId, monthKey] = String(mapKey).split(":");
    if (Number(userId) === Number(user.id) && monthKey <= targetMonthKey) {
      months.add(monthKey);
    }
  }

  for (const mapKey of waterMap.keys()) {
    const [userId, monthKey] = String(mapKey).split(":");
    if (Number(userId) === Number(user.id) && monthKey <= targetMonthKey) {
      months.add(monthKey);
    }
  }

  for (const mapKey of paymentMap.keys()) {
    const [userId, monthKey] = String(mapKey).split(":");
    if (Number(userId) === Number(user.id) && monthKey <= targetMonthKey) {
      months.add(monthKey);
    }
  }

  const orderedMonths = [...months].sort();
  let closingBalance = null;
  let hadPriorComputedMonth = false;
  let targetRow = null;

  for (const monthKey of orderedMonths) {
    const key = `${user.id}:${monthKey}`;
    const statement = statementMap.get(key) || null;
    const water = waterMap.get(key) || null;
    const paymentEntries = paymentMap.get(key) || [];
    const hasOverride = statement && statement.opening_balance_override !== null && statement.opening_balance_override !== "";
    const openingBalance = hasOverride
      ? toLedgerNumber(statement.opening_balance_override)
      : closingBalance !== null
        ? closingBalance
        : toLedgerNumber(user.account_balance);
    const previousReading = toLedgerNumber(water?.previous_reading);
    const latestReading = toLedgerNumber(water?.latest_reading);
    const rate = toLedgerNumber(water?.rate);
    const consumption = latestReading - previousReading;
    const waterBill = consumption * rate;
    const deposit = toLedgerNumber(statement?.deposit);
    const garbageAmount = toLedgerNumber(statement?.garbage_amount);
    const rentBill = toLedgerNumber(statement?.rent_bill);
    const paymentTotal = paymentEntries.reduce((sum, entry) => sum + toLedgerNumber(entry.amount), 0);
    const dues = computeDues({ openingBalance, deposit, waterBill, garbageAmount, rentBill });
    const balance = paymentTotal - dues;
    const latestPayment = paymentEntries[0] || null;

    targetRow = monthKey === targetMonthKey
      ? {
          tenant_id: user.tenant_id,
          user_id: user.id,
          tenant_name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.first_name || "Tenant",
          house_number: user.house_number || "-",
          floor_number: user.floor_number || "Unassigned",
          month_key: monthKey,
          statement_id: statement?.id || null,
          water_reading_id: water?.id || null,
          opening_balance: openingBalance,
          opening_balance_override: hasOverride ? toLedgerNumber(statement.opening_balance_override) : null,
          opening_balance_locked: hadPriorComputedMonth,
          deposit,
          previous_meter_reading: previousReading,
          latest_meter_reading: latestReading,
          consumption,
          rate,
          water_bill: waterBill,
          garbage_amount: garbageAmount,
          rent_bill: rentBill,
          dues,
          payment_total: paymentTotal,
          latest_payment_date: latestPayment?.payment_date || null,
          latest_receipt_number: latestPayment?.receipt_number || null,
          latest_payment_remarks: latestPayment?.remarks || "",
          balance,
          remarks: statement?.remarks || "",
          payment_entries: paymentEntries,
          previous_month_key: previousMonthKey(monthKey),
        }
      : targetRow;

    closingBalance = balance;
    hadPriorComputedMonth = true;
  }

  return targetRow;
}

function buildInClausePlaceholders(values) {
  return values.map(() => "?").join(", ");
}

function buildCurrentArrearsRows(user) {
  const outstanding = calculateUserOutstanding(user);
  if (!user || outstanding <= 0) {
    return [];
  }

  return [
    {
      id: `current-${user.id}`,
      user_id: user.id,
      description: "Current outstanding balance",
      balance: String(outstanding),
      due_date: null,
    },
  ];
}

export function createUser({
  first_name,
  last_name,
  account_number,
  landlord_id,
  property_id,
  property_name,
  floor_number,
  house_number,
  phone_number,
  email_address,
  national_id,
  rent,
  deposit,
  bill,
  rent_balance,
  water_balance,
  trash_balance,
  electricity_balance,
  arrears,
  account_balance,
  amount,
  state,
  temp_account_balance,
  minimum_days_to_vacate,
  wallet,
  status,
  id_verification_status,
}) {
  const account_number_hash = hashPassword(account_number);
  const access_token = generateToken();
  const tenant_id = `tenant-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const stmt = db.prepare(`
    INSERT INTO users (
      first_name,
      last_name,
      account_number_hash,
      access_token,
      tenant_id,
      landlord_id,
      property_id,
      property_name,
      floor_number,
      house_number,
      phone_number,
      email_address,
      national_id,
      rent,
      deposit,
      bill,
      rent_balance,
      water_balance,
      trash_balance,
      electricity_balance,
      arrears,
      account_balance,
      amount,
      state,
      temp_account_balance,
      minimum_days_to_vacate,
      wallet,
      status,
      id_verification_status,
      date_created
    ) VALUES (
      @first_name,
      @last_name,
      @account_number_hash,
      @access_token,
      @tenant_id,
      @landlord_id,
      @property_id,
      @property_name,
      @floor_number,
      @house_number,
      @phone_number,
      @email_address,
      @national_id,
      @rent,
      @deposit,
      @bill,
      @rent_balance,
      @water_balance,
      @trash_balance,
      @electricity_balance,
      @arrears,
      @account_balance,
      @amount,
      @state,
      @temp_account_balance,
      @minimum_days_to_vacate,
      @wallet,
      @status,
      @id_verification_status,
      datetime('now')
    )
  `);

  const info = stmt.run({
    first_name,
    last_name,
    account_number_hash,
    access_token,
    tenant_id,
    landlord_id,
    property_id,
    property_name,
    floor_number,
    house_number,
    phone_number,
    email_address,
    national_id,
    rent,
    deposit: deposit ?? "0",
    bill,
    rent_balance: rent_balance ?? rent ?? "0",
    water_balance: water_balance ?? bill ?? "0",
    trash_balance: trash_balance ?? "0",
    electricity_balance: electricity_balance ?? "0",
    arrears,
    account_balance,
    amount,
    state,
    temp_account_balance,
    minimum_days_to_vacate,
    wallet,
    status,
    id_verification_status,
  });

  return getUserById(info.lastInsertRowid);
}

export function getUserByFirstName(first_name) {
  const stmt = db.prepare("SELECT * FROM users WHERE LOWER(first_name) = LOWER(?) LIMIT 1");
  return withDerivedFinancials(stmt.get(first_name) || null);
}

export function listUsersByFirstName(first_name) {
  return db
    .prepare("SELECT * FROM users WHERE LOWER(first_name) = LOWER(?) ORDER BY id ASC")
    .all(first_name)
    .map((user) => withDerivedFinancials(user));
}

export function getUserByTenantId(tenant_id) {
  const stmt = db.prepare("SELECT * FROM users WHERE tenant_id = ? LIMIT 1");
  return withDerivedFinancials(stmt.get(tenant_id) || null);
}

export function getUserById(id) {
  const stmt = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1");
  return withDerivedFinancials(stmt.get(id) || null);
}

export function updateUserToken(userId, token) {
  db.prepare("UPDATE users SET access_token = ? WHERE id = ?").run(token, userId);
}

export function touchUserActivity(userId, { occurred_at = new Date().toISOString(), mark_login = false } = {}) {
  if (mark_login) {
    db.prepare("UPDATE users SET last_seen_at = ?, last_login_at = ? WHERE id = ?").run(occurred_at, occurred_at, userId);
  } else {
    db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(occurred_at, userId);
  }

  return getUserById(userId);
}

export function updateUserProfile(
  userId,
  {
    first_name,
    last_name,
    phone_number,
    email_address,
    national_id,
    floor_number,
    house_number,
    rent,
    deposit,
    bill,
    rent_balance,
    water_balance,
    trash_balance,
    electricity_balance,
    account_balance,
    arrears,
  } = {}
) {
  const fields = [];
  const values = [];

  const pushField = (column, value) => {
    if (value !== undefined) {
      fields.push(`${column} = ?`);
      values.push(value);
    }
  };

  pushField("first_name", first_name);
  pushField("last_name", last_name);
  pushField("phone_number", phone_number);
  pushField("email_address", email_address);
  pushField("national_id", national_id);
  pushField("floor_number", floor_number);
  pushField("house_number", house_number);
  pushField("rent", rent !== undefined ? String(rent) : undefined);
  pushField("deposit", deposit !== undefined ? String(deposit) : undefined);
  pushField("bill", bill !== undefined ? String(bill) : undefined);
  pushField("rent_balance", rent_balance !== undefined ? String(rent_balance) : undefined);
  pushField("water_balance", water_balance !== undefined ? String(water_balance) : undefined);
  pushField("trash_balance", trash_balance !== undefined ? String(trash_balance) : undefined);
  pushField("electricity_balance", electricity_balance !== undefined ? String(electricity_balance) : undefined);
  pushField("account_balance", account_balance !== undefined ? String(account_balance) : undefined);
  pushField("arrears", arrears !== undefined ? String(arrears) : undefined);

  if (!fields.length) {
    return getUserById(userId);
  }

  values.push(userId);
  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  return getUserById(userId);
}

export function listUsers({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const rows = normalizedPropertyId
    ? db.prepare("SELECT * FROM users WHERE property_id = ? ORDER BY id ASC").all(normalizedPropertyId)
    : db.prepare("SELECT * FROM users ORDER BY id ASC").all();
  return rows.map((user) => withDerivedFinancials(user));
}

export function createOrUpdateUnit({ unit_code, floor_number = null, status = "VACANT", tenant_id = null, notes = "" }) {
  db.prepare(
    `
      INSERT INTO units (unit_code, floor_number, status, tenant_id, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(unit_code) DO UPDATE SET
        floor_number = excluded.floor_number,
        status = excluded.status,
        tenant_id = excluded.tenant_id,
        notes = excluded.notes,
        updated_at = datetime('now')
    `
  ).run(unit_code, floor_number, status, tenant_id, notes);

  return db.prepare("SELECT * FROM units WHERE unit_code = ? LIMIT 1").get(unit_code) || null;
}

export function listUnits() {
  return db.prepare("SELECT * FROM units ORDER BY floor_number ASC, unit_code ASC").all();
}

export function syncUnitForUser(user) {
  if (!user?.house_number) return null;
  return createOrUpdateUnit({
    unit_code: user.house_number,
    floor_number: user.floor_number || null,
    status: "OCCUPIED",
    tenant_id: user.tenant_id || null,
  });
}

export function releaseUnitByTenantId(tenantId) {
  db.prepare(
    `
      UPDATE units
      SET status = 'VACANT',
          tenant_id = NULL,
          updated_at = datetime('now')
      WHERE tenant_id = ?
    `
  ).run(tenantId);
}

export function updateUnitStatus(unit_code, { floor_number = null, status = null, tenant_id = null, notes = null }) {
  const existing = db.prepare("SELECT * FROM units WHERE unit_code = ? LIMIT 1").get(unit_code);
  if (!existing) return null;

  db.prepare(
    `
      UPDATE units
      SET floor_number = ?,
          status = ?,
          tenant_id = ?,
          notes = ?,
          updated_at = datetime('now')
      WHERE unit_code = ?
    `
  ).run(
    floor_number ?? existing.floor_number,
    status ?? existing.status,
    tenant_id ?? existing.tenant_id,
    notes ?? existing.notes,
    unit_code
  );

  return db.prepare("SELECT * FROM units WHERE unit_code = ? LIMIT 1").get(unit_code) || null;
}

export function recalculateUserFinancials(userId) {
  const user = getUserById(userId);
  if (!user) return null;

  const total = calculateUserOutstanding(user);

  db.prepare("UPDATE users SET account_balance = ?, arrears = ? WHERE id = ?").run(String(total), String(total), userId);
  return getUserById(userId);
}

export function applyGlobalBilling({ rent = 0, water = 0, trash = 0, electricity = 0, userIds = null }) {
  const total = Number(rent) + Number(water) + Number(trash) + Number(electricity);
  const args = [
    String(rent),
    String(water),
    String(rent),
    String(water),
    String(trash),
    String(electricity),
    String(total),
    String(total),
  ];
  const normalizedUserIds = Array.isArray(userIds)
    ? [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
    : [];

  const statement =
    normalizedUserIds.length > 0
      ? `
      UPDATE users
      SET rent = ?,
          bill = ?,
          rent_balance = ?,
          water_balance = ?,
          trash_balance = ?,
          electricity_balance = ?,
          account_balance = ?,
          arrears = ?
      WHERE id IN (${normalizedUserIds.map(() => "?").join(", ")})
    `
      : `
      UPDATE users
      SET rent = ?,
          bill = ?,
          rent_balance = ?,
          water_balance = ?,
          trash_balance = ?,
          electricity_balance = ?,
          account_balance = ?,
          arrears = ?
    `;

  db.prepare(statement).run(...args, ...normalizedUserIds);

  return listUsers();
}

export function applyBulkTenantBalanceAction({ action, userIds = [] }) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  const normalizedUserIds = [...new Set((userIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];

  if (!normalizedUserIds.length) {
    return [];
  }

  const placeholders = normalizedUserIds.map(() => "?").join(", ");

  if (normalizedAction === "reset") {
    db.prepare(
      `
        UPDATE users
        SET rent_balance = '0',
            water_balance = '0',
            trash_balance = '0',
            electricity_balance = '0',
            account_balance = '0',
            arrears = '0'
        WHERE id IN (${placeholders})
      `
    ).run(...normalizedUserIds);
    return normalizedUserIds;
  }

  if (normalizedAction === "rent_due") {
    db.prepare(
      `
        UPDATE users
        SET rent_balance = COALESCE(NULLIF(TRIM(rent), ''), '0'),
            water_balance = '0',
            trash_balance = '0',
            electricity_balance = '0',
            account_balance = COALESCE(NULLIF(TRIM(rent), ''), '0'),
            arrears = COALESCE(NULLIF(TRIM(rent), ''), '0')
        WHERE id IN (${placeholders})
      `
    ).run(...normalizedUserIds);
    return normalizedUserIds;
  }

  throw new Error(`Unsupported bulk tenant balance action: ${action}`);
}

export function updateUserBilling(userId, { rent = 0, water = 0, trash = 0, electricity = 0, deposit = 0, resetAccountBalance = false }) {
  const user = getUserById(userId);
  if (!user) return null;

  const nextRent = resetAccountBalance ? 0 : Number(rent);
  const nextWater = resetAccountBalance ? 0 : Number(water);
  const nextTrash = resetAccountBalance ? 0 : Number(trash);
  const nextElectricity = resetAccountBalance ? 0 : Number(electricity);
  const nextDeposit = Number(deposit);
  const total = nextRent + nextWater + nextTrash + nextElectricity;
  db.prepare(
    `
      UPDATE users
      SET rent = ?,
          bill = ?,
          deposit = ?,
          rent_balance = ?,
          water_balance = ?,
          trash_balance = ?,
          electricity_balance = ?,
          account_balance = ?,
          arrears = ?
      WHERE id = ?
    `
  ).run(
    String(nextRent),
    String(nextWater),
    String(nextDeposit),
    String(nextRent),
    String(nextWater),
    String(nextTrash),
    String(nextElectricity),
    String(total),
    String(total),
    userId
  );

  return getUserById(userId);
}

export function adjustUserBalance(userId, paymentFor, amount) {
  const user = getUserById(userId);
  if (!user) return null;

  const fieldMap = {
    RENT: "rent_balance",
    WATER: "water_balance",
    TRASH: "trash_balance",
    ELECTRICITY: "electricity_balance",
  };

  const field = fieldMap[String(paymentFor || "").toUpperCase()];
  if (!field) {
    return user;
  }

  const current = Number(user[field] || 0);
  const next = Math.max(current - Number(amount || 0), 0);
  db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(String(next), userId);
  return recalculateUserFinancials(userId);
}

export function deleteUserById(id) {
  return db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function addArrear(userId, { description, balance, due_date }) {
  return db
    .prepare("INSERT INTO arrears (user_id, description, balance, due_date) VALUES (?, ?, ?, ?)")
    .run(userId, description, balance, due_date);
}

export function listArrearsForUser(userId) {
  return buildCurrentArrearsRows(getUserById(userId));
}

export function addTransaction(userId, { amount, date_created, type, description }) {
  return db
    .prepare(
      "INSERT INTO transactions (user_id, amount, date_created, type, description) VALUES (?, ?, ?, ?, ?)"
    )
    .run(userId, amount, date_created, type, description);
}

export function listTransactionsForUser(userId) {
  return db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC").all(userId);
}

export function addLease(userId, { lease_name, start_date, end_date, monthly_rent, status = "ACTIVE" }) {
  return db
    .prepare(
      "INSERT INTO leases (user_id, lease_name, start_date, end_date, monthly_rent, status) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(userId, lease_name, start_date, end_date, monthly_rent, status);
}

export function listLeasesForUser(userId) {
  return db.prepare("SELECT * FROM leases WHERE user_id = ? ORDER BY id DESC").all(userId);
}

export function getActiveLeaseForUser(userId) {
  return (
    db
      .prepare("SELECT * FROM leases WHERE user_id = ? AND UPPER(COALESCE(status, '')) = 'ACTIVE' ORDER BY id DESC LIMIT 1")
      .get(userId) || null
  );
}

export function addPaymentRequest(
  userId,
  {
    method,
    amount,
    phone_number,
    reference,
    payment_time,
    payment_for = "RENT",
    status = "PENDING",
    note,
    provider = null,
    provider_request_id = null,
    provider_checkout_id = null,
    provider_result_code = null,
    provider_result_description = null,
    provider_metadata_json = null,
    prompted_at = null,
    callback_received_at = null,
    auto_applied_at = null,
    completed_at = null,
    tenant_reference = null,
    tenant_payment_time = null,
    tenant_confirmed_at = null,
    review_note = null,
    reviewed_at = null,
    receipt_number = null,
  }
) {
  const result = db
    .prepare(
      `INSERT INTO payment_requests (
        user_id, method, amount, phone_number, reference, payment_time, payment_for, status, note,
        provider, provider_request_id, provider_checkout_id, provider_result_code, provider_result_description,
        provider_metadata_json, prompted_at, callback_received_at, auto_applied_at, completed_at,
        tenant_reference, tenant_payment_time, tenant_confirmed_at, review_note, reviewed_at, receipt_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      method,
      amount,
      phone_number,
      reference,
      payment_time,
      payment_for,
      status,
      note,
      provider,
      provider_request_id,
      provider_checkout_id,
      provider_result_code,
      provider_result_description,
      provider_metadata_json,
      prompted_at,
      callback_received_at,
      auto_applied_at,
      completed_at,
      tenant_reference,
      tenant_payment_time,
      tenant_confirmed_at,
      review_note,
      reviewed_at,
      receipt_number
    );
  return getPaymentRequestById(result.lastInsertRowid);
}

export function listPaymentRequestsForUser(userId) {
  return db.prepare("SELECT * FROM payment_requests WHERE user_id = ? ORDER BY id DESC").all(userId);
}

export function getPaymentRequestById(id) {
  return db.prepare("SELECT * FROM payment_requests WHERE id = ? LIMIT 1").get(id) || null;
}

export function getPaymentRequestByProviderCheckoutId(checkoutId) {
  return db.prepare("SELECT * FROM payment_requests WHERE provider_checkout_id = ? LIMIT 1").get(checkoutId) || null;
}

export function listAllPaymentRequests({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  if (!normalizedPropertyId) {
    return db.prepare("SELECT * FROM payment_requests ORDER BY datetime(created_at) DESC, id DESC").all();
  }

  return db
    .prepare(`
      SELECT payment_requests.*
      FROM payment_requests
      INNER JOIN users ON users.id = payment_requests.user_id
      WHERE users.property_id = ?
      ORDER BY datetime(payment_requests.created_at) DESC, payment_requests.id DESC
    `)
    .all(normalizedPropertyId);
}

export function updatePaymentRequestStatus(id, status, review_note = "") {
  const receiptNumber =
    String(status || "").toUpperCase() === "APPROVED" ? `RCT-${Date.now()}-${Math.floor(Math.random() * 1e4)}` : null;
  db.prepare(
    `
      UPDATE payment_requests
      SET status = ?, review_note = ?, reviewed_at = datetime('now'), receipt_number = COALESCE(?, receipt_number)
      WHERE id = ?
    `
  ).run(status, review_note, receiptNumber, id);

  return getPaymentRequestById(id);
}

export function updatePaymentRequest(id, fields = {}) {
  const allowed = {
    method: fields.method,
    amount: fields.amount,
    phone_number: fields.phone_number,
    reference: fields.reference,
    payment_time: fields.payment_time,
    payment_for: fields.payment_for,
    status: fields.status,
    note: fields.note,
    reviewed_at: fields.reviewed_at,
    review_note: fields.review_note,
    receipt_number: fields.receipt_number,
    provider: fields.provider,
    provider_request_id: fields.provider_request_id,
    provider_checkout_id: fields.provider_checkout_id,
    provider_result_code: fields.provider_result_code,
    provider_result_description: fields.provider_result_description,
    provider_metadata_json: fields.provider_metadata_json,
    prompted_at: fields.prompted_at,
    callback_received_at: fields.callback_received_at,
    auto_applied_at: fields.auto_applied_at,
    completed_at: fields.completed_at,
    tenant_reference: fields.tenant_reference,
    tenant_payment_time: fields.tenant_payment_time,
    tenant_confirmed_at: fields.tenant_confirmed_at,
  };

  const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    return getPaymentRequestById(id);
  }

  const setters = entries.map(([key]) => `${key} = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  db.prepare(`UPDATE payment_requests SET ${setters} WHERE id = ?`).run(...values, id);
  return getPaymentRequestById(id);
}

export function addAlert(
  userId,
  { type, title, message, severity = "info", status = "ACTIVE", trigger_date = null }
) {
  return db
    .prepare(
      "INSERT INTO alerts (user_id, type, title, message, severity, status, trigger_date) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(userId, type, title, message, severity, status, trigger_date);
}

export function listStoredAlertsForUser(userId) {
  return db.prepare("SELECT * FROM alerts WHERE user_id = ? ORDER BY id DESC").all(userId);
}

export function addMaintenanceTicket(
  userId,
  { title, description, priority = "Medium", status = "Pending", technician_name = null }
) {
  return db
    .prepare(
      "INSERT INTO maintenance_tickets (user_id, title, description, priority, status, technician_name) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(userId, title, description, priority, status, technician_name);
}

export function listMaintenanceForUser(userId) {
  return db
    .prepare("SELECT * FROM maintenance_tickets WHERE user_id = ? ORDER BY datetime(updated_at) DESC, id DESC")
    .all(userId);
}

export function listAllMaintenanceTickets({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  if (!normalizedPropertyId) {
    return db
      .prepare("SELECT * FROM maintenance_tickets ORDER BY datetime(updated_at) DESC, id DESC")
      .all();
  }

  return db
    .prepare(`
      SELECT maintenance_tickets.*
      FROM maintenance_tickets
      INNER JOIN users ON users.id = maintenance_tickets.user_id
      WHERE users.property_id = ?
      ORDER BY datetime(maintenance_tickets.updated_at) DESC, maintenance_tickets.id DESC
    `)
    .all(normalizedPropertyId);
}

export function getMaintenanceTicketById(id) {
  return db.prepare("SELECT * FROM maintenance_tickets WHERE id = ? LIMIT 1").get(id) || null;
}

export function updateMaintenanceTicketStatus(id, status, technician_name = null, repair_cost = null) {
  db.prepare(
    `
      UPDATE maintenance_tickets
      SET status = ?,
          technician_name = COALESCE(?, technician_name),
          repair_cost = COALESCE(?, repair_cost),
          updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(status, technician_name, repair_cost, id);

  return db.prepare("SELECT * FROM maintenance_tickets WHERE id = ? LIMIT 1").get(id) || null;
}

export function addDocument(userId, { name, category, status = "AVAILABLE", url = null }) {
  return db
    .prepare("INSERT INTO documents (user_id, name, category, status, url) VALUES (?, ?, ?, ?, ?)")
    .run(userId, name, category, status, url);
}

export function addSharedDocument({
  property_id = null,
  name,
  category = "General",
  status = "AVAILABLE",
  url = null,
  original_name = "",
  stored_path = "",
}) {
  return db
    .prepare(
      "INSERT INTO shared_documents (property_id, name, category, status, url, original_name, stored_path) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(property_id, name, category, status, url, original_name, stored_path);
}

export function listSharedDocuments({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const args = [];
  let where = "";
  if (normalizedPropertyId) {
    where = "WHERE property_id = ?";
    args.push(normalizedPropertyId);
  }

  return db
    .prepare(`SELECT *, 'shared' AS scope FROM shared_documents ${where} ORDER BY datetime(created_at) DESC, id DESC`)
    .all(...args);
}

export function listDocumentsForUser(userId, { propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const args = [userId];
  const sharedWhere = normalizedPropertyId ? "WHERE property_id = ?" : "";
  if (normalizedPropertyId) {
    args.push(normalizedPropertyId);
  }

  return db
    .prepare(
      `
        SELECT *
        FROM (
          SELECT
            id,
            user_id,
            name,
            category,
            status,
            url,
            created_at,
            'tenant' AS scope
          FROM documents
          WHERE user_id = ?

          UNION ALL

          SELECT
            id,
            NULL AS user_id,
            name,
            category,
            status,
            url,
            created_at,
            'shared' AS scope
          FROM shared_documents
          ${sharedWhere}
        )
        ORDER BY created_at DESC, id DESC
      `
    )
    .all(...args);
}

export function addTenantUpload(userId, { name, category = "General", note = "", original_name = "", stored_path = "" }) {
  return db
    .prepare(
      "INSERT INTO tenant_uploads (user_id, name, category, note, original_name, stored_path) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(userId, name, category, note, original_name, stored_path);
}

export function listTenantUploadsForUser(userId) {
  return db.prepare("SELECT * FROM tenant_uploads WHERE user_id = ? ORDER BY datetime(created_at) DESC, id DESC").all(userId);
}

export function addMessage(
  userId,
  { sender_type = "SYSTEM", sender_name = null, subject = null, body, category = "General", status = "UNREAD" }
) {
  return db
    .prepare(
      "INSERT INTO messages (user_id, sender_type, sender_name, subject, body, category, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(userId, sender_type, sender_name, subject, body, category, status);
}

export function listMessagesForUser(userId) {
  return db.prepare("SELECT * FROM messages WHERE user_id = ? ORDER BY datetime(created_at) DESC, id DESC").all(userId);
}

export function listAllMessages({ sender_type = null, propertyId = null } = {}) {
  const args = [];
  const where = [];
  if (sender_type) {
    where.push("messages.sender_type = ?");
    args.push(sender_type);
  }

  const normalizedPropertyId = String(propertyId || "").trim();
  if (normalizedPropertyId) {
    where.push("users.property_id = ?");
    args.push(normalizedPropertyId);
  }

  return db
    .prepare(`
      SELECT
        messages.*,
        users.tenant_id,
        users.first_name,
        users.last_name,
        users.house_number,
        users.floor_number,
        users.property_name
      FROM messages
      INNER JOIN users ON users.id = messages.user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY datetime(messages.created_at) DESC, messages.id DESC
    `)
    .all(...args);
}

export function addVacateNotice(
  userId,
  { move_out_date, reason = "", forwarding_address = "", phone_number = "", status = "Pending" }
) {
  return db
    .prepare(
      "INSERT INTO vacate_notices (user_id, move_out_date, reason, forwarding_address, phone_number, status) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(userId, move_out_date, reason, forwarding_address, phone_number, status);
}

export function listVacateNoticesForUser(userId) {
  return db
    .prepare("SELECT * FROM vacate_notices WHERE user_id = ? ORDER BY datetime(created_at) DESC, id DESC")
    .all(userId);
}

export function listAllVacateNotices({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  if (!normalizedPropertyId) {
    return db
      .prepare("SELECT * FROM vacate_notices ORDER BY datetime(created_at) DESC, id DESC")
      .all();
  }

  return db
    .prepare(`
      SELECT vacate_notices.*
      FROM vacate_notices
      INNER JOIN users ON users.id = vacate_notices.user_id
      WHERE users.property_id = ?
      ORDER BY datetime(vacate_notices.created_at) DESC, vacate_notices.id DESC
    `)
    .all(normalizedPropertyId);
}

export function getVacateNoticeById(id) {
  return db.prepare("SELECT * FROM vacate_notices WHERE id = ? LIMIT 1").get(id) || null;
}

export function updateVacateNoticeStatus(id, status, review_note = "") {
  db.prepare(
    `
      UPDATE vacate_notices
      SET status = ?, review_note = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `
  ).run(status, review_note, id);

  return getVacateNoticeById(id);
}

export function createInvoice(
  userId,
  {
    period_key,
    period_label,
    due_date,
    rent_amount = "0",
    water_amount = "0",
    trash_amount = "0",
    electricity_amount = "0",
  }
) {
  const total =
    Number(rent_amount || 0) +
    Number(water_amount || 0) +
    Number(trash_amount || 0) +
    Number(electricity_amount || 0);

  db.prepare(
    `
      INSERT OR IGNORE INTO invoices (
        user_id, period_key, period_label, due_date,
        rent_amount, water_amount, trash_amount, electricity_amount,
        total_amount, paid_amount, balance_amount, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '0', ?, 'UNPAID')
    `
  ).run(
    userId,
    period_key,
    period_label,
    due_date,
    String(rent_amount),
    String(water_amount),
    String(trash_amount),
    String(electricity_amount),
    String(total),
    String(total)
  );

  return db
    .prepare("SELECT * FROM invoices WHERE user_id = ? AND period_key = ? LIMIT 1")
    .get(userId, period_key) || null;
}

export function listInvoicesForUser(userId) {
  return db.prepare("SELECT * FROM invoices WHERE user_id = ? ORDER BY period_key DESC, id DESC").all(userId);
}

export function listAllInvoices() {
  return db.prepare("SELECT * FROM invoices ORDER BY period_key DESC, id DESC").all();
}

export function applyPaymentToLatestInvoice(userId, amount) {
  const invoice =
    db.prepare("SELECT * FROM invoices WHERE user_id = ? ORDER BY period_key DESC, id DESC LIMIT 1").get(userId) || null;
  if (!invoice) return null;

  const paid = Number(invoice.paid_amount || 0) + Number(amount || 0);
  const total = Number(invoice.total_amount || 0);
  const balance = Math.max(total - paid, 0);
  const status = balance <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";

  db.prepare(
    `
      UPDATE invoices
      SET paid_amount = ?, balance_amount = ?, status = ?
      WHERE id = ?
    `
  ).run(String(paid), String(balance), status, invoice.id);

  return db.prepare("SELECT * FROM invoices WHERE id = ? LIMIT 1").get(invoice.id) || null;
}

export function getAdminSetting(key, fallbackValue = null) {
  const row = db.prepare("SELECT value FROM admin_settings WHERE key = ? LIMIT 1").get(key);
  return row ? row.value : fallbackValue;
}

export function setAdminSetting(key, value) {
  db.prepare(
    `
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `
  ).run(key, String(value ?? ""));

  return getAdminSetting(key, "");
}

export function getMonthlyStatement(userId, monthKey, propertyId) {
  return db.prepare(
    "SELECT * FROM admin_monthly_statements WHERE user_id = ? AND month_key = ? AND property_id = ? LIMIT 1"
  ).get(userId, normalizeMonthKey(monthKey), String(propertyId || "").trim()) || null;
}

export function upsertMonthlyStatement(userId, { property_id, month_key, opening_balance_override, deposit, garbage_amount, rent_bill, remarks }) {
  const propertyId = String(property_id || "").trim();
  const normalizedMonthKey = normalizeMonthKey(month_key);
  const existing = getMonthlyStatement(userId, normalizedMonthKey, propertyId);

  if (!existing) {
    db.prepare(
      `
        INSERT INTO admin_monthly_statements (
          property_id, user_id, month_key, opening_balance_override, deposit, garbage_amount, rent_bill, remarks, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `
    ).run(
      propertyId,
      userId,
      normalizedMonthKey,
      opening_balance_override ?? null,
      String(deposit ?? 0),
      String(garbage_amount ?? 0),
      String(rent_bill ?? 0),
      remarks ?? ""
    );
  } else {
    const allowed = {
      opening_balance_override,
      deposit,
      garbage_amount,
      rent_bill,
      remarks,
    };
    const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);
    if (entries.length) {
      const setters = entries.map(([key]) => `${key} = ?`).join(", ");
      db.prepare(
        `UPDATE admin_monthly_statements SET ${setters}, updated_at = datetime('now') WHERE id = ?`
      ).run(...entries.map(([, value]) => value), existing.id);
    }
  }

  return getMonthlyStatement(userId, normalizedMonthKey, propertyId);
}

export function getMonthlyWaterReading(userId, monthKey, propertyId) {
  return db.prepare(
    "SELECT * FROM admin_water_readings WHERE user_id = ? AND month_key = ? AND property_id = ? LIMIT 1"
  ).get(userId, normalizeMonthKey(monthKey), String(propertyId || "").trim()) || null;
}

export function upsertMonthlyWaterReading(userId, { property_id, month_key, previous_reading, latest_reading, rate }) {
  const propertyId = String(property_id || "").trim();
  const normalizedMonthKey = normalizeMonthKey(month_key);
  const existing = getMonthlyWaterReading(userId, normalizedMonthKey, propertyId);

  if (!existing) {
    db.prepare(
      `
        INSERT INTO admin_water_readings (
          property_id, user_id, month_key, previous_reading, latest_reading, rate, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `
    ).run(propertyId, userId, normalizedMonthKey, String(previous_reading ?? 0), String(latest_reading ?? 0), String(rate ?? 0));
  } else {
    const allowed = { previous_reading, latest_reading, rate };
    const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);
    if (entries.length) {
      const setters = entries.map(([key]) => `${key} = ?`).join(", ");
      db.prepare(`UPDATE admin_water_readings SET ${setters}, updated_at = datetime('now') WHERE id = ?`).run(
        ...entries.map(([, value]) => value),
        existing.id
      );
    }
  }

  return getMonthlyWaterReading(userId, normalizedMonthKey, propertyId);
}

export function addMonthlyPaymentEntry(userId, { property_id, month_key, amount, payment_date = null, receipt_number = null, remarks = "" }) {
  const propertyId = String(property_id || "").trim();
  const normalizedMonthKey = normalizeMonthKey(month_key);
  const result = db.prepare(
    `
      INSERT INTO admin_monthly_payment_entries (
        property_id, user_id, month_key, amount, payment_date, receipt_number, remarks, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `
  ).run(propertyId, userId, normalizedMonthKey, String(amount ?? 0), payment_date, receipt_number, remarks);

  return db.prepare("SELECT * FROM admin_monthly_payment_entries WHERE id = ? LIMIT 1").get(result.lastInsertRowid) || null;
}

export function updateMonthlyPaymentEntry(id, fields = {}) {
  const allowed = {
    amount: fields.amount,
    payment_date: fields.payment_date,
    receipt_number: fields.receipt_number,
    remarks: fields.remarks,
  };
  const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    return db.prepare("SELECT * FROM admin_monthly_payment_entries WHERE id = ? LIMIT 1").get(id) || null;
  }

  const setters = entries.map(([key]) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE admin_monthly_payment_entries SET ${setters}, updated_at = datetime('now') WHERE id = ?`).run(
    ...entries.map(([, value]) => value),
    id
  );

  return db.prepare("SELECT * FROM admin_monthly_payment_entries WHERE id = ? LIMIT 1").get(id) || null;
}

export function setMonthlyGarbageAmount({ property_id, month_key, user_ids, amount }) {
  const propertyId = String(property_id || "").trim();
  const normalizedMonthKey = normalizeMonthKey(month_key);
  const normalizedUserIds = [...new Set((Array.isArray(user_ids) ? user_ids : []).map((id) => Number(id)).filter(Boolean))];

  for (const userId of normalizedUserIds) {
    upsertMonthlyStatement(userId, {
      property_id: propertyId,
      month_key: normalizedMonthKey,
      garbage_amount: String(amount ?? 0),
    });
  }

  return normalizedUserIds.length;
}

export function listMonthlyTenantLedger({ propertyId = null, floorNumber = null, monthKey }) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  const users = listUsers({ propertyId: normalizedPropertyId }).filter((user) => {
    const normalizedFloor = String(floorNumber || "").trim();
    if (!normalizedFloor || normalizedFloor.toLowerCase() === "all") {
      return true;
    }
    return String(user.floor_number || "").trim() === normalizedFloor;
  });
  const allPropertyUsers = listUsers({ propertyId: normalizedPropertyId });
  const floors = [...new Set(allPropertyUsers.map((user) => String(user.floor_number || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  if (!users.length) {
    return { month_key: normalizedMonthKey, floors, rows: [] };
  }

  const userIds = users.map((user) => Number(user.id));
  const placeholders = buildInClausePlaceholders(userIds);
  const statements = db.prepare(
    `
      SELECT *
      FROM admin_monthly_statements
      WHERE property_id = ?
        AND month_key <= ?
        AND user_id IN (${placeholders})
      ORDER BY month_key ASC, user_id ASC
    `
  ).all(normalizedPropertyId, normalizedMonthKey, ...userIds);
  const waterReadings = db.prepare(
    `
      SELECT *
      FROM admin_water_readings
      WHERE property_id = ?
        AND month_key <= ?
        AND user_id IN (${placeholders})
      ORDER BY month_key ASC, user_id ASC
    `
  ).all(normalizedPropertyId, normalizedMonthKey, ...userIds);
  const paymentEntries = db.prepare(
    `
      SELECT *
      FROM admin_monthly_payment_entries
      WHERE property_id = ?
        AND month_key <= ?
        AND user_id IN (${placeholders})
      ORDER BY COALESCE(payment_date, created_at) DESC, id DESC
    `
  ).all(normalizedPropertyId, normalizedMonthKey, ...userIds);

  const statementMap = buildLedgerMaps(statements, (row) => `${row.user_id}:${row.month_key}`);
  const waterMap = buildLedgerMaps(waterReadings, (row) => `${row.user_id}:${row.month_key}`);
  const paymentMap = buildPaymentMap(paymentEntries);

  return {
    month_key: normalizedMonthKey,
    floors,
    rows: users
      .map((user) => buildMonthlyTimeline(user, normalizedMonthKey, statementMap, waterMap, paymentMap))
      .filter(Boolean)
      .sort((left, right) => {
        const floorCompare = String(left.floor_number || "").localeCompare(String(right.floor_number || ""), undefined, { numeric: true });
        if (floorCompare !== 0) return floorCompare;
        return String(left.house_number || "").localeCompare(String(right.house_number || ""), undefined, { numeric: true });
      }),
  };
}

export function getPortfolioOverview({ propertyId = null } = {}) {
  const users = listUsers({ propertyId });
  const activeTenants = users.filter((user) => String(user.status || user.state || "").trim().toUpperCase() === "ACTIVE").length;
  const overdueTenants = users.filter((user) => calculateUserOutstanding(user) > 0).length;
  const currentActiveTenants = users.filter((user) => {
    const isActive = String(user.status || user.state || "").trim().toUpperCase() === "ACTIVE";
    return isActive && calculateUserOutstanding(user) <= 0;
  }).length;
  const normalizedPropertyId = String(propertyId || "").trim();
  const activeLeases = normalizedPropertyId
    ? db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM leases
          INNER JOIN users ON users.id = leases.user_id
          WHERE UPPER(COALESCE(leases.status, '')) = 'ACTIVE'
            AND users.property_id = ?
        `)
        .get(normalizedPropertyId)?.count || 0
    : db.prepare("SELECT COUNT(*) AS count FROM leases WHERE UPPER(COALESCE(status, '')) = 'ACTIVE'").get()?.count || 0;
  const occupiedUnits = Number(activeTenants || 0);
  const totalUnits = Math.max(occupiedUnits + 2, 6);
  const vacancies = Math.max(totalUnits - occupiedUnits, 0);
  const rentCollectionRate = occupiedUnits
    ? Math.round((Number(currentActiveTenants || 0) / occupiedUnits) * 100)
    : 100;

  return {
    total_units: totalUnits,
    occupied_units: occupiedUnits,
    vacant_units: vacancies,
    active_leases: activeLeases,
    overdue_tenants: Number(overdueTenants || 0),
    rent_collection_rate: rentCollectionRate,
  };
}

// Initialize the schema when the module loads.
initDb();

export default db;
