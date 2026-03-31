import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const { Pool } = pg;

export const DATABASE_PROVIDER = "postgres";
export const DATABASE_PATH = null;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Set DATABASE_URL to use the Postgres database adapter.");
}

function getSslConfig() {
  const sslMode = String(process.env.PGSSLMODE || "").trim().toLowerCase();
  if (sslMode === "disable") {
    return false;
  }

  try {
    const parsed = new URL(connectionString);
    const hostname = String(parsed.hostname || "").trim().toLowerCase();
    const sslParam = String(parsed.searchParams.get("sslmode") || "").trim().toLowerCase();
    const sslEnabled = String(parsed.searchParams.get("ssl") || "").trim().toLowerCase();
    if (sslParam === "disable") {
      return false;
    }
    if (["false", "0", "no"].includes(sslEnabled)) {
      return false;
    }
    if (["require", "prefer", "verify-ca", "verify-full"].includes(sslParam)) {
      return { rejectUnauthorized: false };
    }
    if (["true", "1", "yes"].includes(sslEnabled)) {
      return { rejectUnauthorized: false };
    }
    if (hostname.endsWith(".render.com") || hostname.endsWith(".render.internal")) {
      return { rejectUnauthorized: false };
    }
  } catch {
    // Fall back to env-driven behavior below.
  }

  if (["require", "prefer", "verify-ca", "verify-full"].includes(sslMode)) {
    return { rejectUnauthorized: false };
  }

  return false;
}

const pool = new Pool({
  connectionString,
  ssl: getSslConfig(),
});

pool.on("error", (error) => {
  console.error("Unexpected Postgres pool error:", error);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function getOne(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function ensureColumn(tableName, columnName, columnDefinition) {
  const existing = await getOne(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName]
  );

  if (!existing) {
    await query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    DROP INDEX IF EXISTS idx_users_first_name
  `);

  await ensureColumn("users", "floor_number", "TEXT");
  await ensureColumn("users", "deposit", "TEXT");
  await ensureColumn("users", "rent_balance", "TEXT");
  await ensureColumn("users", "water_balance", "TEXT");
  await ensureColumn("users", "trash_balance", "TEXT");
  await ensureColumn("users", "electricity_balance", "TEXT");
  await ensureColumn("users", "last_seen_at", "TEXT");
  await ensureColumn("users", "last_login_at", "TEXT");

  await query(`
    CREATE TABLE IF NOT EXISTS arrears (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      description TEXT,
      balance TEXT,
      due_date TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount TEXT,
      date_created TEXT,
      type TEXT,
      description TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS leases (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lease_name TEXT,
      start_date TEXT,
      end_date TEXT,
      monthly_rent TEXT,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS units (
      id BIGSERIAL PRIMARY KEY,
      unit_code TEXT UNIQUE NOT NULL,
      floor_number TEXT,
      status TEXT DEFAULT 'VACANT',
      tenant_id TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      amount TEXT NOT NULL,
      phone_number TEXT,
      reference TEXT,
      status TEXT DEFAULT 'PENDING',
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await ensureColumn("payment_requests", "payment_for", "TEXT");
  await ensureColumn("payment_requests", "reviewed_at", "TIMESTAMPTZ");
  await ensureColumn("payment_requests", "review_note", "TEXT");
  await ensureColumn("payment_requests", "receipt_number", "TEXT");

  await query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      status TEXT DEFAULT 'ACTIVE',
      trigger_date TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS maintenance_tickets (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Pending',
      technician_name TEXT,
      repair_cost TEXT DEFAULT '0',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await ensureColumn("maintenance_tickets", "repair_cost", "TEXT DEFAULT '0'");

  await query(`
    CREATE TABLE IF NOT EXISTS documents (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'AVAILABLE',
      url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS shared_documents (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'AVAILABLE',
      url TEXT,
      original_name TEXT,
      stored_path TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tenant_uploads (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT,
      note TEXT,
      original_name TEXT,
      stored_path TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_type TEXT DEFAULT 'SYSTEM',
      sender_name TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      status TEXT DEFAULT 'UNREAD',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS vacate_notices (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      move_out_date TEXT NOT NULL,
      reason TEXT,
      forwarding_address TEXT,
      phone_number TEXT,
      status TEXT DEFAULT 'Pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await ensureColumn("vacate_notices", "reviewed_at", "TIMESTAMPTZ");
  await ensureColumn("vacate_notices", "review_note", "TEXT");

  await query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, period_key)
    )
  `);

  await query(`
    UPDATE users
    SET
      deposit = COALESCE(NULLIF(BTRIM(deposit), ''), '0'),
      rent = COALESCE(NULLIF(BTRIM(rent), ''), '0'),
      bill = COALESCE(NULLIF(BTRIM(bill), ''), '0'),
      arrears = COALESCE(NULLIF(BTRIM(arrears), ''), '0'),
      account_balance = COALESCE(NULLIF(BTRIM(account_balance), ''), '0'),
      rent_balance = COALESCE(NULLIF(BTRIM(rent_balance), ''), NULLIF(BTRIM(rent), ''), '0'),
      water_balance = COALESCE(NULLIF(BTRIM(water_balance), ''), NULLIF(BTRIM(bill), ''), '0'),
      trash_balance = COALESCE(NULLIF(BTRIM(trash_balance), ''), '0'),
      electricity_balance = COALESCE(NULLIF(BTRIM(electricity_balance), ''), '0')
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

export async function createUser({
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

  const inserted = await getOne(
    `
      INSERT INTO users (
        first_name, last_name, account_number_hash, access_token, tenant_id,
        landlord_id, property_id, property_name, floor_number, house_number,
        phone_number, email_address, national_id, rent, deposit, bill,
        rent_balance, water_balance, trash_balance, electricity_balance,
        arrears, account_balance, amount, state, temp_account_balance,
        minimum_days_to_vacate, wallet, status, id_verification_status, date_created
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23, $24, $25,
        $26, $27, $28, $29, NOW()::text
      )
      RETURNING id
    `,
    [
      first_name,
      last_name,
      account_number_hash,
      access_token,
      tenant_id,
      landlord_id ?? null,
      property_id ?? null,
      property_name ?? null,
      floor_number ?? null,
      house_number ?? null,
      phone_number ?? null,
      email_address ?? null,
      national_id ?? null,
      rent ?? null,
      deposit ?? "0",
      bill ?? null,
      rent_balance ?? rent ?? "0",
      water_balance ?? bill ?? "0",
      trash_balance ?? "0",
      electricity_balance ?? "0",
      arrears ?? null,
      account_balance ?? null,
      amount ?? null,
      state ?? null,
      temp_account_balance ?? null,
      minimum_days_to_vacate ?? null,
      wallet ?? null,
      status ?? null,
      id_verification_status ?? null,
    ]
  );

  return getUserById(inserted.id);
}

export async function getUserByFirstName(first_name) {
  return withDerivedFinancials(await getOne("SELECT * FROM users WHERE LOWER(first_name) = LOWER($1) LIMIT 1", [first_name]));
}

export async function listUsersByFirstName(first_name) {
  const result = await query("SELECT * FROM users WHERE LOWER(first_name) = LOWER($1) ORDER BY id ASC", [first_name]);
  return result.rows.map((user) => withDerivedFinancials(user));
}

export async function getUserByTenantId(tenant_id) {
  return withDerivedFinancials(await getOne("SELECT * FROM users WHERE tenant_id = $1 LIMIT 1", [tenant_id]));
}

export async function getUserById(id) {
  return withDerivedFinancials(await getOne("SELECT * FROM users WHERE id = $1 LIMIT 1", [id]));
}

export async function updateUserToken(userId, token) {
  await query("UPDATE users SET access_token = $1 WHERE id = $2", [token, userId]);
}

export async function touchUserActivity(userId, { occurred_at = new Date().toISOString(), mark_login = false } = {}) {
  if (mark_login) {
    await query("UPDATE users SET last_seen_at = $1, last_login_at = $2 WHERE id = $3", [occurred_at, occurred_at, userId]);
  } else {
    await query("UPDATE users SET last_seen_at = $1 WHERE id = $2", [occurred_at, userId]);
  }

  return getUserById(userId);
}

export async function updateUserProfile(
  userId,
  { first_name, last_name, phone_number, email_address, national_id }
) {
  await query(
    `
      UPDATE users
      SET first_name = $1,
          last_name = $2,
          phone_number = $3,
          email_address = $4,
          national_id = $5
      WHERE id = $6
    `,
    [first_name, last_name, phone_number, email_address, national_id, userId]
  );

  return getUserById(userId);
}

export async function listUsers() {
  const result = await query("SELECT * FROM users ORDER BY id ASC");
  return result.rows.map((user) => withDerivedFinancials(user));
}

export async function createOrUpdateUnit({ unit_code, floor_number = null, status = "VACANT", tenant_id = null, notes = "" }) {
  await query(
    `
      INSERT INTO units (unit_code, floor_number, status, tenant_id, notes, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (unit_code) DO UPDATE SET
        floor_number = EXCLUDED.floor_number,
        status = EXCLUDED.status,
        tenant_id = EXCLUDED.tenant_id,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    `,
    [unit_code, floor_number, status, tenant_id, notes]
  );

  return getOne("SELECT * FROM units WHERE unit_code = $1 LIMIT 1", [unit_code]);
}

export async function listUnits() {
  const result = await query("SELECT * FROM units ORDER BY floor_number ASC NULLS LAST, unit_code ASC");
  return result.rows;
}

export async function syncUnitForUser(user) {
  if (!user?.house_number) return null;
  return createOrUpdateUnit({
    unit_code: user.house_number,
    floor_number: user.floor_number || null,
    status: "OCCUPIED",
    tenant_id: user.tenant_id || null,
  });
}

export async function releaseUnitByTenantId(tenantId) {
  await query(
    `
      UPDATE units
      SET status = 'VACANT',
          tenant_id = NULL,
          updated_at = NOW()
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
}

export async function updateUnitStatus(unit_code, { floor_number = null, status = null, tenant_id = null, notes = null }) {
  const existing = await getOne("SELECT * FROM units WHERE unit_code = $1 LIMIT 1", [unit_code]);
  if (!existing) return null;

  await query(
    `
      UPDATE units
      SET floor_number = $1,
          status = $2,
          tenant_id = $3,
          notes = $4,
          updated_at = NOW()
      WHERE unit_code = $5
    `,
    [
      floor_number ?? existing.floor_number,
      status ?? existing.status,
      tenant_id ?? existing.tenant_id,
      notes ?? existing.notes,
      unit_code,
    ]
  );

  return getOne("SELECT * FROM units WHERE unit_code = $1 LIMIT 1", [unit_code]);
}

export async function recalculateUserFinancials(userId) {
  const user = await getUserById(userId);
  if (!user) return null;

  const total = calculateUserOutstanding(user);

  await query("UPDATE users SET account_balance = $1, arrears = $2 WHERE id = $3", [String(total), String(total), userId]);
  return getUserById(userId);
}

export async function applyGlobalBilling({ rent = 0, water = 0, trash = 0, electricity = 0, userIds = null }) {
  const total = Number(rent) + Number(water) + Number(trash) + Number(electricity);
  const params = [
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

  if (normalizedUserIds.length > 0) {
    await query(
      `
        UPDATE users
        SET rent = $1,
            bill = $2,
            rent_balance = $3,
            water_balance = $4,
            trash_balance = $5,
            electricity_balance = $6,
            account_balance = $7,
            arrears = $8
        WHERE id = ANY($9::bigint[])
      `,
      [...params, normalizedUserIds]
    );
  } else {
    await query(
      `
        UPDATE users
        SET rent = $1,
            bill = $2,
            rent_balance = $3,
            water_balance = $4,
            trash_balance = $5,
            electricity_balance = $6,
            account_balance = $7,
            arrears = $8
      `,
      params
    );
  }

  return listUsers();
}

export async function adjustUserBalance(userId, paymentFor, amount) {
  const user = await getUserById(userId);
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
  await query(`UPDATE users SET ${field} = $1 WHERE id = $2`, [String(next), userId]);
  return recalculateUserFinancials(userId);
}

export async function deleteUserById(id) {
  return query("DELETE FROM users WHERE id = $1", [id]);
}

export async function addArrear(userId, { description, balance, due_date }) {
  return query("INSERT INTO arrears (user_id, description, balance, due_date) VALUES ($1, $2, $3, $4)", [
    userId,
    description,
    balance,
    due_date,
  ]);
}

export async function listArrearsForUser(userId) {
  return buildCurrentArrearsRows(await getUserById(userId));
}

export async function addTransaction(userId, { amount, date_created, type, description }) {
  return query(
    "INSERT INTO transactions (user_id, amount, date_created, type, description) VALUES ($1, $2, $3, $4, $5)",
    [userId, amount, date_created, type, description]
  );
}

export async function listTransactionsForUser(userId) {
  const result = await query("SELECT * FROM transactions WHERE user_id = $1 ORDER BY id DESC", [userId]);
  return result.rows;
}

export async function addLease(userId, { lease_name, start_date, end_date, monthly_rent, status = "ACTIVE" }) {
  return query(
    "INSERT INTO leases (user_id, lease_name, start_date, end_date, monthly_rent, status) VALUES ($1, $2, $3, $4, $5, $6)",
    [userId, lease_name, start_date, end_date, monthly_rent, status]
  );
}

export async function listLeasesForUser(userId) {
  const result = await query("SELECT * FROM leases WHERE user_id = $1 ORDER BY id DESC", [userId]);
  return result.rows;
}

export async function getActiveLeaseForUser(userId) {
  return getOne(
    "SELECT * FROM leases WHERE user_id = $1 AND UPPER(COALESCE(status, '')) = 'ACTIVE' ORDER BY id DESC LIMIT 1",
    [userId]
  );
}

export async function addPaymentRequest(
  userId,
  { method, amount, phone_number, reference, payment_for = "RENT", status = "PENDING", note }
) {
  return query(
    "INSERT INTO payment_requests (user_id, method, amount, phone_number, reference, payment_for, status, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [userId, method, amount, phone_number, reference, payment_for, status, note]
  );
}

export async function listPaymentRequestsForUser(userId) {
  const result = await query("SELECT * FROM payment_requests WHERE user_id = $1 ORDER BY id DESC", [userId]);
  return result.rows;
}

export async function getPaymentRequestById(id) {
  return getOne("SELECT * FROM payment_requests WHERE id = $1 LIMIT 1", [id]);
}

export async function listAllPaymentRequests() {
  const result = await query("SELECT * FROM payment_requests ORDER BY created_at DESC, id DESC");
  return result.rows;
}

export async function updatePaymentRequestStatus(id, status, review_note = "") {
  const receiptNumber =
    String(status || "").toUpperCase() === "APPROVED" ? `RCT-${Date.now()}-${Math.floor(Math.random() * 1e4)}` : null;
  await query(
    `
      UPDATE payment_requests
      SET status = $1,
          review_note = $2,
          reviewed_at = NOW(),
          receipt_number = COALESCE($3, receipt_number)
      WHERE id = $4
    `,
    [status, review_note, receiptNumber, id]
  );

  return getPaymentRequestById(id);
}

export async function addAlert(
  userId,
  { type, title, message, severity = "info", status = "ACTIVE", trigger_date = null }
) {
  return query(
    "INSERT INTO alerts (user_id, type, title, message, severity, status, trigger_date) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [userId, type, title, message, severity, status, trigger_date]
  );
}

export async function listStoredAlertsForUser(userId) {
  const result = await query("SELECT * FROM alerts WHERE user_id = $1 ORDER BY id DESC", [userId]);
  return result.rows;
}

export async function addMaintenanceTicket(
  userId,
  { title, description, priority = "Medium", status = "Pending", technician_name = null }
) {
  return query(
    "INSERT INTO maintenance_tickets (user_id, title, description, priority, status, technician_name) VALUES ($1, $2, $3, $4, $5, $6)",
    [userId, title, description, priority, status, technician_name]
  );
}

export async function listMaintenanceForUser(userId) {
  const result = await query("SELECT * FROM maintenance_tickets WHERE user_id = $1 ORDER BY updated_at DESC, id DESC", [userId]);
  return result.rows;
}

export async function listAllMaintenanceTickets() {
  const result = await query("SELECT * FROM maintenance_tickets ORDER BY updated_at DESC, id DESC");
  return result.rows;
}

export async function updateMaintenanceTicketStatus(id, status, technician_name = null, repair_cost = null) {
  await query(
    `
      UPDATE maintenance_tickets
      SET status = $1,
          technician_name = COALESCE($2, technician_name),
          repair_cost = COALESCE($3, repair_cost),
          updated_at = NOW()
      WHERE id = $4
    `,
    [status, technician_name, repair_cost, id]
  );

  return getOne("SELECT * FROM maintenance_tickets WHERE id = $1 LIMIT 1", [id]);
}

export async function addDocument(userId, { name, category, status = "AVAILABLE", url = null }) {
  return query("INSERT INTO documents (user_id, name, category, status, url) VALUES ($1, $2, $3, $4, $5)", [
    userId,
    name,
    category,
    status,
    url,
  ]);
}

export async function addSharedDocument({
  name,
  category = "General",
  status = "AVAILABLE",
  url = null,
  original_name = "",
  stored_path = "",
}) {
  return query(
    "INSERT INTO shared_documents (name, category, status, url, original_name, stored_path) VALUES ($1, $2, $3, $4, $5, $6)",
    [name, category, status, url, original_name, stored_path]
  );
}

export async function listSharedDocuments() {
  const result = await query(
    "SELECT *, 'shared' AS scope FROM shared_documents ORDER BY created_at DESC, id DESC"
  );
  return result.rows;
}

export async function listDocumentsForUser(userId) {
  const result = await query(
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
        WHERE user_id = $1

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
      ) AS combined_documents
      ORDER BY created_at DESC, id DESC
    `,
    [userId]
  );

  return result.rows;
}

export async function addTenantUpload(userId, { name, category = "General", note = "", original_name = "", stored_path = "" }) {
  return query(
    "INSERT INTO tenant_uploads (user_id, name, category, note, original_name, stored_path) VALUES ($1, $2, $3, $4, $5, $6)",
    [userId, name, category, note, original_name, stored_path]
  );
}

export async function listTenantUploadsForUser(userId) {
  const result = await query("SELECT * FROM tenant_uploads WHERE user_id = $1 ORDER BY created_at DESC, id DESC", [userId]);
  return result.rows;
}

export async function addMessage(
  userId,
  { sender_type = "SYSTEM", sender_name = null, subject = null, body, category = "General", status = "UNREAD" }
) {
  return query(
    "INSERT INTO messages (user_id, sender_type, sender_name, subject, body, category, status) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [userId, sender_type, sender_name, subject, body, category, status]
  );
}

export async function listMessagesForUser(userId) {
  const result = await query("SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at DESC, id DESC", [userId]);
  return result.rows;
}

export async function listAllMessages({ sender_type = null } = {}) {
  if (sender_type) {
    const result = await query(
      `
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
        WHERE messages.sender_type = $1
        ORDER BY messages.created_at DESC, messages.id DESC
      `,
      [sender_type]
    );
    return result.rows;
  }

  const result = await query(`
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
    ORDER BY messages.created_at DESC, messages.id DESC
  `);

  return result.rows;
}

export async function addVacateNotice(
  userId,
  { move_out_date, reason = "", forwarding_address = "", phone_number = "", status = "Pending" }
) {
  return query(
    "INSERT INTO vacate_notices (user_id, move_out_date, reason, forwarding_address, phone_number, status) VALUES ($1, $2, $3, $4, $5, $6)",
    [userId, move_out_date, reason, forwarding_address, phone_number, status]
  );
}

export async function listVacateNoticesForUser(userId) {
  const result = await query("SELECT * FROM vacate_notices WHERE user_id = $1 ORDER BY created_at DESC, id DESC", [userId]);
  return result.rows;
}

export async function listAllVacateNotices() {
  const result = await query("SELECT * FROM vacate_notices ORDER BY created_at DESC, id DESC");
  return result.rows;
}

export async function getVacateNoticeById(id) {
  return getOne("SELECT * FROM vacate_notices WHERE id = $1 LIMIT 1", [id]);
}

export async function updateVacateNoticeStatus(id, status, review_note = "") {
  await query(
    `
      UPDATE vacate_notices
      SET status = $1, review_note = $2, reviewed_at = NOW()
      WHERE id = $3
    `,
    [status, review_note, id]
  );

  return getVacateNoticeById(id);
}

export async function createInvoice(
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

  const inserted = await query(
    `
      INSERT INTO invoices (
        user_id, period_key, period_label, due_date,
        rent_amount, water_amount, trash_amount, electricity_amount,
        total_amount, paid_amount, balance_amount, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '0', $10, 'UNPAID')
      ON CONFLICT (user_id, period_key) DO NOTHING
      RETURNING *
    `,
    [
      userId,
      period_key,
      period_label,
      due_date,
      String(rent_amount),
      String(water_amount),
      String(trash_amount),
      String(electricity_amount),
      String(total),
      String(total),
    ]
  );

  if (inserted.rows[0]) {
    return inserted.rows[0];
  }

  return getOne("SELECT * FROM invoices WHERE user_id = $1 AND period_key = $2 LIMIT 1", [userId, period_key]);
}

export async function listInvoicesForUser(userId) {
  const result = await query("SELECT * FROM invoices WHERE user_id = $1 ORDER BY period_key DESC, id DESC", [userId]);
  return result.rows;
}

export async function listAllInvoices() {
  const result = await query("SELECT * FROM invoices ORDER BY period_key DESC, id DESC");
  return result.rows;
}

export async function applyPaymentToLatestInvoice(userId, amount) {
  const invoice = await getOne("SELECT * FROM invoices WHERE user_id = $1 ORDER BY period_key DESC, id DESC LIMIT 1", [userId]);
  if (!invoice) return null;

  const paid = Number(invoice.paid_amount || 0) + Number(amount || 0);
  const total = Number(invoice.total_amount || 0);
  const balance = Math.max(total - paid, 0);
  const status = balance <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";

  await query(
    `
      UPDATE invoices
      SET paid_amount = $1, balance_amount = $2, status = $3
      WHERE id = $4
    `,
    [String(paid), String(balance), status, invoice.id]
  );

  return getOne("SELECT * FROM invoices WHERE id = $1 LIMIT 1", [invoice.id]);
}

export async function getAdminSetting(key, fallbackValue = null) {
  const row = await getOne("SELECT value FROM admin_settings WHERE key = $1 LIMIT 1", [key]);
  return row ? row.value : fallbackValue;
}

export async function setAdminSetting(key, value) {
  await query(
    `
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
    `,
    [key, String(value ?? "")]
  );

  return getAdminSetting(key, "");
}

export async function getPortfolioOverview() {
  const users = await listUsers();
  const activeTenants = users.filter((user) => String(user.status || user.state || "").trim().toUpperCase() === "ACTIVE").length;
  const overdueTenants = users.filter((user) => calculateUserOutstanding(user) > 0).length;
  const currentActiveTenants = users.filter((user) => {
    const isActive = String(user.status || user.state || "").trim().toUpperCase() === "ACTIVE";
    return isActive && calculateUserOutstanding(user) <= 0;
  }).length;
  const activeLeases = Number(
    (await getOne("SELECT COUNT(*) AS count FROM leases WHERE UPPER(COALESCE(status, '')) = 'ACTIVE'"))?.count || 0
  );
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

try {
  await initDb();
} catch (error) {
  const message = [
    "Postgres initialization failed.",
    error?.message || "Unknown database error.",
    "If you are using Render's internal connection string, make sure the web service and Postgres database are in the same region.",
  ].join(" ");
  throw new Error(message);
}

export default pool;
