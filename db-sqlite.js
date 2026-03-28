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
      lease_name TEXT,
      start_date TEXT,
      end_date TEXT,
      monthly_rent TEXT,
      status TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_code TEXT UNIQUE NOT NULL,
      floor_number TEXT,
      status TEXT DEFAULT 'VACANT',
      tenant_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      method TEXT NOT NULL,
      amount TEXT NOT NULL,
      phone_number TEXT,
      reference TEXT,
      status TEXT DEFAULT 'PENDING',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  ensureColumn("payment_requests", "payment_for", "TEXT");
  ensureColumn("payment_requests", "reviewed_at", "TEXT");
  ensureColumn("payment_requests", "review_note", "TEXT");
  ensureColumn("payment_requests", "receipt_number", "TEXT");

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
      name TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'AVAILABLE',
      url TEXT,
      original_name TEXT,
      stored_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

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
      rent_balance = COALESCE(rent_balance, rent, '0'),
      water_balance = COALESCE(water_balance, bill, '0'),
      trash_balance = COALESCE(trash_balance, '0'),
      electricity_balance = COALESCE(electricity_balance, '0')
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
  return stmt.get(first_name) || null;
}

export function listUsersByFirstName(first_name) {
  return db.prepare("SELECT * FROM users WHERE LOWER(first_name) = LOWER(?) ORDER BY id ASC").all(first_name);
}

export function getUserByTenantId(tenant_id) {
  const stmt = db.prepare("SELECT * FROM users WHERE tenant_id = ? LIMIT 1");
  return stmt.get(tenant_id) || null;
}

export function getUserById(id) {
  const stmt = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1");
  return stmt.get(id) || null;
}

export function updateUserToken(userId, token) {
  db.prepare("UPDATE users SET access_token = ? WHERE id = ?").run(token, userId);
}

export function updateUserProfile(
  userId,
  { first_name, last_name, phone_number, email_address, national_id }
) {
  db.prepare(
    `
      UPDATE users
      SET first_name = ?,
          last_name = ?,
          phone_number = ?,
          email_address = ?,
          national_id = ?
      WHERE id = ?
    `
  ).run(first_name, last_name, phone_number, email_address, national_id, userId);

  return getUserById(userId);
}

export function listUsers() {
  return db.prepare("SELECT * FROM users ORDER BY id ASC").all();
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

  const total =
    Number(user.rent_balance || 0) +
    Number(user.water_balance || 0) +
    Number(user.trash_balance || 0) +
    Number(user.electricity_balance || 0);

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
  return db.prepare("SELECT * FROM arrears WHERE user_id = ? ORDER BY id ASC").all(userId);
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
  { method, amount, phone_number, reference, payment_for = "RENT", status = "PENDING", note }
) {
  return db
    .prepare(
      "INSERT INTO payment_requests (user_id, method, amount, phone_number, reference, payment_for, status, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(userId, method, amount, phone_number, reference, payment_for, status, note);
}

export function listPaymentRequestsForUser(userId) {
  return db.prepare("SELECT * FROM payment_requests WHERE user_id = ? ORDER BY id DESC").all(userId);
}

export function getPaymentRequestById(id) {
  return db.prepare("SELECT * FROM payment_requests WHERE id = ? LIMIT 1").get(id) || null;
}

export function listAllPaymentRequests() {
  return db.prepare("SELECT * FROM payment_requests ORDER BY datetime(created_at) DESC, id DESC").all();
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

export function listAllMaintenanceTickets() {
  return db
    .prepare("SELECT * FROM maintenance_tickets ORDER BY datetime(updated_at) DESC, id DESC")
    .all();
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
  name,
  category = "General",
  status = "AVAILABLE",
  url = null,
  original_name = "",
  stored_path = "",
}) {
  return db
    .prepare(
      "INSERT INTO shared_documents (name, category, status, url, original_name, stored_path) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(name, category, status, url, original_name, stored_path);
}

export function listSharedDocuments() {
  return db
    .prepare("SELECT *, 'shared' AS scope FROM shared_documents ORDER BY datetime(created_at) DESC, id DESC")
    .all();
}

export function listDocumentsForUser(userId) {
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
        )
        ORDER BY created_at DESC, id DESC
      `
    )
    .all(userId);
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

export function listAllMessages({ sender_type = null } = {}) {
  if (sender_type) {
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
        WHERE messages.sender_type = ?
        ORDER BY datetime(messages.created_at) DESC, messages.id DESC
      `)
      .all(sender_type);
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
      ORDER BY datetime(messages.created_at) DESC, messages.id DESC
    `)
    .all();
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

export function getPortfolioOverview() {
  const totals =
    db
      .prepare(`
        SELECT
          COUNT(*) AS total_tenants,
          SUM(CASE WHEN UPPER(COALESCE(status, state, '')) = 'ACTIVE' THEN 1 ELSE 0 END) AS active_tenants,
          SUM(CASE WHEN CAST(COALESCE(arrears, '0') AS REAL) > 0 THEN 1 ELSE 0 END) AS overdue_tenants,
          SUM(CASE WHEN CAST(COALESCE(arrears, '0') AS REAL) <= 0 THEN 1 ELSE 0 END) AS current_tenants
        FROM users
      `)
      .get() || {};

  const activeLeases =
    db.prepare("SELECT COUNT(*) AS count FROM leases WHERE UPPER(COALESCE(status, '')) = 'ACTIVE'").get()?.count || 0;
  const occupiedUnits = Number(totals.active_tenants || 0);
  const totalUnits = Math.max(occupiedUnits + 2, 6);
  const vacancies = Math.max(totalUnits - occupiedUnits, 0);
  const rentCollectionRate = occupiedUnits
    ? Math.round((Number(totals.current_tenants || 0) / occupiedUnits) * 100)
    : 100;

  return {
    total_units: totalUnits,
    occupied_units: occupiedUnits,
    vacant_units: vacancies,
    active_leases: activeLeases,
    overdue_tenants: Number(totals.overdue_tenants || 0),
    rent_collection_rate: rentCollectionRate,
  };
}

// Initialize the schema when the module loads.
initDb();

export default db;
