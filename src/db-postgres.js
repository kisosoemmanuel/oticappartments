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
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'PROPERTY_ADMIN')),
      property_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (property_id) REFERENCES properties(id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      admin_user_id BIGINT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      property_id TEXT,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

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
    CREATE INDEX IF NOT EXISTS idx_users_property_id ON users(property_id)
  `);
  await query(`
    INSERT INTO properties (id, name)
    VALUES ('otic-1', 'Otic 1'), ('otic-2', 'Otic 2')
    ON CONFLICT (id) DO NOTHING
  `);

  await query(`
    DELETE FROM properties
    WHERE id NOT IN ('otic-1', 'otic-2')
  `);

  const legacyProperties = await query(`
    SELECT DISTINCT
      BTRIM(property_id) AS id,
      COALESCE(NULLIF(BTRIM(property_name), ''), BTRIM(property_id)) AS name
    FROM users
    WHERE NULLIF(BTRIM(property_id), '') IS NOT NULL
  `);
  for (const property of legacyProperties.rows) {
    if (property.id === "otic-1" || property.id === "otic-2") {
      await query(
        `
          INSERT INTO properties (id, name)
          VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), properties.name)
        `,
        [property.id, property.name || property.id]
      );
    }
  }

  await query(`
    UPDATE users
    SET property_id = 'otic-1'
    WHERE NULLIF(BTRIM(property_id), '') IS NULL
  `);

  await query(`
    UPDATE admin_users
    SET property_id = 'otic-1'
    WHERE username = 'adminotic1'
  `);

  await query(`
    UPDATE admin_users
    SET property_id = 'otic-2'
    WHERE username = 'adminotic2'
  `);
  await query(`
    UPDATE users
    SET property_name = COALESCE(
      (SELECT name FROM properties WHERE properties.id = users.property_id LIMIT 1),
      NULLIF(BTRIM(property_name), ''),
      'Otic 1'
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS units (
      id BIGSERIAL PRIMARY KEY,
      property_id TEXT,
      unit_code TEXT UNIQUE NOT NULL,
      floor_number TEXT,
      status TEXT DEFAULT 'VACANT',
      tenant_id TEXT,
      current_tenant_id BIGINT,
      current_tenancy_id BIGINT,
      rent_amount TEXT DEFAULT '0',
      occupancy_status TEXT DEFAULT 'VACANT',
      balance TEXT DEFAULT '0',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (property_id) REFERENCES properties(id)
    )
  `);
  await ensureColumn("units", "property_id", "TEXT");
  await ensureColumn("units", "current_tenant_id", "BIGINT");
  await ensureColumn("units", "current_tenancy_id", "BIGINT");
  await ensureColumn("units", "rent_amount", "TEXT DEFAULT '0'");
  await ensureColumn("units", "occupancy_status", "TEXT DEFAULT 'VACANT'");
  await ensureColumn("units", "balance", "TEXT DEFAULT '0'");
  await ensureColumn("units", "unit_number", "TEXT");
  await query(`
    UPDATE units
    SET property_id = 'otic-1'
    WHERE NULLIF(BTRIM(property_id), '') IS NULL
  `);

  const superAdminUsername = String(process.env.ADMIN_USERNAME || "superadmin").trim() || "superadmin";
  const superAdminPassword = String(process.env.ADMIN_PASSWORD || "otic12").trim() || "otic12";
  const otic1AdminUsername = String(process.env.OTIC1_ADMIN_USERNAME || "adminotic1").trim() || "adminotic1";
  const otic1AdminPassword = String(process.env.OTIC1_ADMIN_PASSWORD || "oticruiru").trim() || "oticruiru";
  const otic2AdminUsername = String(process.env.OTIC2_ADMIN_USERNAME || "adminotic2").trim() || "adminotic2";
  const otic2AdminPassword = String(process.env.OTIC2_ADMIN_PASSWORD || "oticbondo").trim() || "oticbondo";

  await query(
    `
      INSERT INTO admin_users (username, password_hash, full_name, role, property_id, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        property_id = EXCLUDED.property_id,
        status = EXCLUDED.status,
        updated_at = NOW()
    `,
    [superAdminUsername, hashPassword(superAdminPassword), "Super Admin", "SUPER_ADMIN", null, "ACTIVE"]
  );

  await query(
    `
      INSERT INTO admin_users (username, password_hash, full_name, role, property_id, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        property_id = EXCLUDED.property_id,
        status = EXCLUDED.status,
        updated_at = NOW()
    `,
    [otic1AdminUsername, hashPassword(otic1AdminPassword), "Otic 1 Admin", "PROPERTY_ADMIN", "otic-1", "ACTIVE"]
  );

  await query(
    `
      INSERT INTO admin_users (username, password_hash, full_name, role, property_id, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        property_id = EXCLUDED.property_id,
        status = EXCLUDED.status,
        updated_at = NOW()
    `,
    [otic2AdminUsername, hashPassword(otic2AdminPassword), "Otic 2 Admin", "PROPERTY_ADMIN", "otic-2", "ACTIVE"]
  );

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
      property_id TEXT,
      unit_id BIGINT,
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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL,
      FOREIGN KEY (property_id) REFERENCES properties(id)
    )
  `);
  await ensureColumn("leases", "property_id", "TEXT");
  await ensureColumn("leases", "unit_id", "BIGINT");
  await ensureColumn("leases", "deposit", "TEXT DEFAULT '0'");
  await ensureColumn("leases", "rent_amount", "TEXT DEFAULT '0'");
  await ensureColumn("leases", "move_in_date", "TEXT");
  await ensureColumn("leases", "move_out_date", "TEXT");
  await ensureColumn("leases", "notes", "TEXT");
  await ensureColumn("leases", "billing_settings", "TEXT");
  await ensureColumn("leases", "utility_settings", "TEXT");
  await query(`
    UPDATE leases
    SET property_id = 'otic-1'
    WHERE NULLIF(BTRIM(property_id), '') IS NULL
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id BIGSERIAL PRIMARY KEY,
      property_id TEXT,
      unit_code TEXT UNIQUE NOT NULL,
      floor_number TEXT,
      status TEXT DEFAULT 'VACANT',
      tenant_id TEXT,
      current_tenant_id BIGINT,
      current_tenancy_id BIGINT,
      rent_amount TEXT DEFAULT '0',
      occupancy_status TEXT DEFAULT 'VACANT',
      balance TEXT DEFAULT '0',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (property_id) REFERENCES properties(id)
    )
  `);
  await ensureColumn("units", "property_id", "TEXT");
  await ensureColumn("units", "current_tenant_id", "BIGINT");
  await ensureColumn("units", "current_tenancy_id", "BIGINT");
  await ensureColumn("units", "rent_amount", "TEXT DEFAULT '0'");
  await ensureColumn("units", "occupancy_status", "TEXT DEFAULT 'VACANT'");
  await ensureColumn("units", "balance", "TEXT DEFAULT '0'");
  await ensureColumn("units", "unit_number", "TEXT");
  await query(`
    UPDATE units
    SET property_id = 'otic-1'
    WHERE NULLIF(BTRIM(property_id), '') IS NULL
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      amount TEXT NOT NULL,
      phone_number TEXT,
      reference TEXT,
      payment_time TIMESTAMPTZ,
      status TEXT DEFAULT 'PENDING',
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await ensureColumn("payment_requests", "payment_for", "TEXT");
  await ensureColumn("payment_requests", "payment_time", "TIMESTAMPTZ");
  await ensureColumn("payment_requests", "reviewed_at", "TIMESTAMPTZ");
  await ensureColumn("payment_requests", "review_note", "TEXT");
  await ensureColumn("payment_requests", "receipt_number", "TEXT");
  await ensureColumn("payment_requests", "provider", "TEXT");
  await ensureColumn("payment_requests", "provider_request_id", "TEXT");
  await ensureColumn("payment_requests", "provider_checkout_id", "TEXT");
  await ensureColumn("payment_requests", "provider_result_code", "TEXT");
  await ensureColumn("payment_requests", "provider_result_description", "TEXT");
  await ensureColumn("payment_requests", "provider_metadata_json", "TEXT");
  await ensureColumn("payment_requests", "prompted_at", "TIMESTAMPTZ");
  await ensureColumn("payment_requests", "callback_received_at", "TIMESTAMPTZ");
  await ensureColumn("payment_requests", "auto_applied_at", "TIMESTAMPTZ");
  await ensureColumn("payment_requests", "completed_at", "TIMESTAMPTZ");
  await ensureColumn("payment_requests", "tenant_reference", "TEXT");
  await ensureColumn("payment_requests", "tenant_payment_time", "TIMESTAMPTZ");
  await ensureColumn("payment_requests", "tenant_confirmed_at", "TIMESTAMPTZ");

  await query(`
    CREATE TABLE IF NOT EXISTS admin_monthly_statements (
      id BIGSERIAL PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month_key TEXT NOT NULL,
      opening_balance_override TEXT,
      deposit TEXT DEFAULT '0',
      garbage_amount TEXT DEFAULT '0',
      rent_bill TEXT DEFAULT '0',
      remarks TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(property_id, user_id, month_key)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admin_water_readings (
      id BIGSERIAL PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month_key TEXT NOT NULL,
      previous_reading TEXT DEFAULT '0',
      latest_reading TEXT DEFAULT '0',
      rate TEXT DEFAULT '0',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(property_id, user_id, month_key)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admin_monthly_payment_entries (
      id BIGSERIAL PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month_key TEXT NOT NULL,
      amount TEXT NOT NULL,
      payment_date TIMESTAMPTZ,
      receipt_number TEXT,
      remarks TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

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
    CREATE TABLE IF NOT EXISTS admin_alert_messages (
      id BIGSERIAL PRIMARY KEY,
      thread_owner_admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      property_id TEXT REFERENCES properties(id),
      sender_admin_user_id BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_admin_alert_messages_thread_owner ON admin_alert_messages(thread_owner_admin_user_id, created_at DESC, id DESC)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_admin_alert_messages_property_id ON admin_alert_messages(property_id)
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
      property_id TEXT,
      name TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'AVAILABLE',
      url TEXT,
      original_name TEXT,
      stored_path TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await ensureColumn("shared_documents", "property_id", "TEXT");
  await query(`
    CREATE INDEX IF NOT EXISTS idx_shared_documents_property_id ON shared_documents(property_id)
  `);
  await query(`
    UPDATE shared_documents
    SET property_id = 'otic-1'
    WHERE NULLIF(BTRIM(property_id), '') IS NULL
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

export async function listProperties() {
  const result = await query(`
    SELECT *
    FROM properties
    ORDER BY
      CASE id
        WHEN 'otic-1' THEN 0
        WHEN 'otic-2' THEN 1
        ELSE 2
      END,
      LOWER(name) ASC
  `);
  return result.rows;
}

export async function getAdminUserByUsername(username) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) return null;
  return getOne("SELECT * FROM admin_users WHERE username = $1 LIMIT 1", [normalizedUsername]);
}

export async function getAdminUserById(id) {
  return getOne("SELECT * FROM admin_users WHERE id = $1 LIMIT 1", [id]);
}

export async function listAdminUsers() {
  const result = await query("SELECT * FROM admin_users ORDER BY id ASC");
  return result.rows;
}

export async function addAdminAlertMessage({
  thread_owner_admin_user_id,
  property_id = null,
  sender_admin_user_id = null,
  sender_role,
  sender_name,
  body,
}) {
  const result = await query(
    `
      INSERT INTO admin_alert_messages (
        thread_owner_admin_user_id,
        property_id,
        sender_admin_user_id,
        sender_role,
        sender_name,
        body
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [thread_owner_admin_user_id, property_id, sender_admin_user_id, sender_role, sender_name, body]
  );

  return result.rows[0] || null;
}

export async function listAdminAlertMessagesByThreadOwner(threadOwnerAdminUserId) {
  const result = await query(
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
      WHERE admin_alert_messages.thread_owner_admin_user_id = $1
      ORDER BY admin_alert_messages.created_at ASC, admin_alert_messages.id ASC
    `,
    [threadOwnerAdminUserId]
  );
  return result.rows;
}

export async function listAdminAlertThreads() {
  const result = await query(
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
          ORDER BY latest.created_at DESC, latest.id DESC
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
      ORDER BY MAX(admin_alert_messages.created_at) DESC, admin_alert_messages.thread_owner_admin_user_id DESC
    `
  );
  return result.rows;
}

export async function createAdminUser({ username, password, full_name, role, property_id = null, status = "ACTIVE" }) {
  const normalizedUsername = String(username || "").trim();
  const normalizedFullName = String(full_name || "").trim();
  const normalizedRole = String(role || "PROPERTY_ADMIN").trim().toUpperCase();

  if (!normalizedUsername) throw new Error("username is required");
  if (!password) throw new Error("password is required");
  if (!normalizedFullName) throw new Error("full_name is required");
  if (!['SUPER_ADMIN', 'PROPERTY_ADMIN'].includes(normalizedRole)) {
    throw new Error("role must be SUPER_ADMIN or PROPERTY_ADMIN");
  }

  const existing = await getAdminUserByUsername(normalizedUsername);
  if (existing) {
    throw new Error("Admin username is already in use");
  }

  const result = await query(
    `
      INSERT INTO admin_users (username, password_hash, full_name, role, property_id, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [normalizedUsername, hashPassword(password), normalizedFullName, normalizedRole, property_id || null, status]
  );

  return result.rows[0] || null;
}

export async function writeAuditLog({ admin_user_id = null, action, entity_type = null, entity_id = null, property_id = null, details = null }) {
  return query(
    `
      INSERT INTO audit_logs (admin_user_id, action, entity_type, entity_id, property_id, details)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [admin_user_id, String(action || "").trim() || "UNKNOWN_ACTION", entity_type || null, entity_id || null, property_id || null, details ? JSON.stringify(details) : null]
  );
}

export async function listAuditLogs({ property_id = null, limit = 50 } = {}) {
  const normalizedPropertyId = String(property_id || "").trim();
  const params = [];
  let queryText = "SELECT * FROM audit_logs";
  if (normalizedPropertyId) {
    queryText += " WHERE property_id = $1";
    params.push(normalizedPropertyId);
  }
  queryText += " ORDER BY created_at DESC, id DESC LIMIT $" + (params.length + 1);
  params.push(Number(limit || 50));
  const result = await query(queryText, params);
  return result.rows;
}

export async function getPropertyById(propertyId) {
  return getOne("SELECT * FROM properties WHERE id = $1 LIMIT 1", [propertyId]);
}

export async function createUnit({ property_id, unit_code, floor_number = null, status = "VACANT", tenant_id = null, current_tenant_id = null, current_tenancy_id = null, rent_amount = "0", notes = "" }) {
  const normalizedPropertyId = String(property_id || "").trim() || "otic-1";
  const normalizedUnitCode = String(unit_code || "").trim();
  if (!normalizedUnitCode) throw new Error("unit_code is required");

  const existing = await getOne("SELECT * FROM units WHERE unit_code = $1 LIMIT 1", [normalizedUnitCode]);
  if (existing) {
    await query(
      `
        UPDATE units
        SET property_id = $1,
            floor_number = $2,
            status = $3,
            tenant_id = $4,
            current_tenant_id = $5,
            current_tenancy_id = $6,
            rent_amount = $7,
            occupancy_status = $8,
            balance = $9,
            notes = $10,
            updated_at = NOW()
        WHERE id = $11
      `,
      [
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
        existing.id,
      ]
    );
    return getOne("SELECT * FROM units WHERE id = $1 LIMIT 1", [existing.id]);
  }

  const result = await query(
    `
      INSERT INTO units (property_id, unit_code, floor_number, status, tenant_id, current_tenant_id, current_tenancy_id, rent_amount, occupancy_status, balance, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `,
    [normalizedPropertyId, normalizedUnitCode, floor_number, status, tenant_id, current_tenant_id, current_tenancy_id, String(rent_amount ?? "0"), status, "0", notes || ""]
  );

  return result.rows[0] || null;
}

export async function listUnitsForProperty(propertyId) {
  const normalizedPropertyId = String(propertyId || "").trim();
  if (!normalizedPropertyId) return [];
  const result = await query("SELECT * FROM units WHERE property_id = $1 ORDER BY floor_number ASC NULLS LAST, unit_code ASC", [normalizedPropertyId]);
  return result.rows;
}

export async function getUnitById(id) {
  return getOne("SELECT * FROM units WHERE id = $1 LIMIT 1", [id]);
}

export async function listTenantTenancies(tenantId) {
  const result = await query("SELECT * FROM leases WHERE user_id = $1 ORDER BY start_date DESC, id DESC", [tenantId]);
  return result.rows;
}

export async function createTenancy({ tenant_id, property_id, unit_id, lease_name, start_date, end_date, monthly_rent, deposit = "0", move_in_date = null, move_out_date = null, status = "ACTIVE", notes = "", billing_settings = null, utility_settings = null }) {
  const normalizedTenantId = Number(tenant_id);
  const normalizedPropertyId = String(property_id || "").trim() || "otic-1";
  const normalizedUnitId = unit_id ? Number(unit_id) : null;
  const leaseLabel = String(lease_name || "Tenancy Agreement").trim() || "Tenancy Agreement";

  if (!normalizedTenantId) throw new Error("tenant_id is required");

  const result = await query(
    `
      INSERT INTO leases (user_id, property_id, unit_id, lease_name, start_date, end_date, monthly_rent, deposit, rent_amount, move_in_date, move_out_date, status, notes, billing_settings, utility_settings)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `,
    [
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
      utility_settings ? JSON.stringify(utility_settings) : null,
    ]
  );

  const created = result.rows[0] || null;
  if (normalizedUnitId) {
    await query(
      `
        UPDATE units
        SET current_tenancy_id = $1,
            current_tenant_id = $2,
            status = $3,
            occupancy_status = $4,
            updated_at = NOW()
        WHERE id = $5
      `,
      [created.id, normalizedTenantId, status || "OCCUPIED", status || "OCCUPIED", normalizedUnitId]
    );
  }

  return created;
}

export async function listTenanciesForProperty(propertyId) {
  const normalizedPropertyId = String(propertyId || "").trim();
  if (!normalizedPropertyId) return [];
  const result = await query("SELECT * FROM leases WHERE property_id = $1 ORDER BY start_date DESC, id DESC", [normalizedPropertyId]);
  return result.rows;
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
  const assignments = [];
  const params = [];

  const addAssignment = (column, value) => {
    if (value !== undefined) {
      assignments.push(`${column} = $${params.length + 1}`);
      params.push(value);
    }
  };

  addAssignment("first_name", first_name);
  addAssignment("last_name", last_name);
  addAssignment("phone_number", phone_number);
  addAssignment("email_address", email_address);
  addAssignment("national_id", national_id);
  addAssignment("floor_number", floor_number);
  addAssignment("house_number", house_number);
  addAssignment("rent", rent !== undefined ? String(rent) : undefined);
  addAssignment("deposit", deposit !== undefined ? String(deposit) : undefined);
  addAssignment("bill", bill !== undefined ? String(bill) : undefined);
  addAssignment("rent_balance", rent_balance !== undefined ? String(rent_balance) : undefined);
  addAssignment("water_balance", water_balance !== undefined ? String(water_balance) : undefined);
  addAssignment("trash_balance", trash_balance !== undefined ? String(trash_balance) : undefined);
  addAssignment("electricity_balance", electricity_balance !== undefined ? String(electricity_balance) : undefined);
  addAssignment("account_balance", account_balance !== undefined ? String(account_balance) : undefined);
  addAssignment("arrears", arrears !== undefined ? String(arrears) : undefined);

  if (!assignments.length) {
    return getUserById(userId);
  }

  params.push(userId);
  await query(`UPDATE users SET ${assignments.join(", ")} WHERE id = $${params.length}`, params);

  return getUserById(userId);
}

export async function listUsers({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const result = normalizedPropertyId
    ? await query("SELECT * FROM users WHERE property_id = $1 ORDER BY id ASC", [normalizedPropertyId])
    : await query("SELECT * FROM users ORDER BY id ASC");
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

export async function applyBulkTenantBalanceAction({ action, userIds = [] }) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  const normalizedUserIds = [...new Set((userIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];

  if (!normalizedUserIds.length) {
    return [];
  }

  if (normalizedAction === "reset") {
    await query(
      `
        UPDATE users
        SET rent_balance = '0',
            water_balance = '0',
            trash_balance = '0',
            electricity_balance = '0',
            account_balance = '0',
            arrears = '0'
        WHERE id = ANY($1::bigint[])
      `,
      [normalizedUserIds]
    );
    return normalizedUserIds;
  }

  if (normalizedAction === "rent_due") {
    await query(
      `
        UPDATE users
        SET rent_balance = COALESCE(NULLIF(BTRIM(rent), ''), '0'),
            water_balance = '0',
            trash_balance = '0',
            electricity_balance = '0',
            account_balance = COALESCE(NULLIF(BTRIM(rent), ''), '0'),
            arrears = COALESCE(NULLIF(BTRIM(rent), ''), '0')
        WHERE id = ANY($1::bigint[])
      `,
      [normalizedUserIds]
    );
    return normalizedUserIds;
  }

  throw new Error(`Unsupported bulk tenant balance action: ${action}`);
}

export async function updateUserBilling(userId, { rent = 0, water = 0, trash = 0, electricity = 0, deposit = 0, resetAccountBalance = false }) {
  const user = await getUserById(userId);
  if (!user) return null;

  const nextRent = resetAccountBalance ? 0 : Number(rent);
  const nextWater = resetAccountBalance ? 0 : Number(water);
  const nextTrash = resetAccountBalance ? 0 : Number(trash);
  const nextElectricity = resetAccountBalance ? 0 : Number(electricity);
  const nextDeposit = Number(deposit);
  const total = nextRent + nextWater + nextTrash + nextElectricity;
  await query(
    `
      UPDATE users
      SET rent = $1,
          bill = $2,
          deposit = $3,
          rent_balance = $4,
          water_balance = $5,
          trash_balance = $6,
          electricity_balance = $7,
          account_balance = $8,
          arrears = $9
      WHERE id = $10
    `,
    [
      String(nextRent),
      String(nextWater),
      String(nextDeposit),
      String(nextRent),
      String(nextWater),
      String(nextTrash),
      String(nextElectricity),
      String(total),
      String(total),
      userId,
    ]
  );

  return getUserById(userId);
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
  const result = await query(
    `INSERT INTO payment_requests (
      user_id, method, amount, phone_number, reference, payment_time, payment_for, status, note,
      provider, provider_request_id, provider_checkout_id, provider_result_code, provider_result_description,
      provider_metadata_json, prompted_at, callback_received_at, auto_applied_at, completed_at,
      tenant_reference, tenant_payment_time, tenant_confirmed_at, review_note, reviewed_at, receipt_number
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19,
      $20, $21, $22, $23, $24, $25
    ) RETURNING *`,
    [
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
      receipt_number,
    ]
  );
  return result.rows[0] || null;
}

export async function listPaymentRequestsForUser(userId) {
  const result = await query("SELECT * FROM payment_requests WHERE user_id = $1 ORDER BY id DESC", [userId]);
  return result.rows;
}

export async function getPaymentRequestById(id) {
  return getOne("SELECT * FROM payment_requests WHERE id = $1 LIMIT 1", [id]);
}

export async function getPaymentRequestByProviderCheckoutId(checkoutId) {
  return getOne("SELECT * FROM payment_requests WHERE provider_checkout_id = $1 LIMIT 1", [checkoutId]);
}

export async function listAllPaymentRequests({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const result = normalizedPropertyId
    ? await query(
        `
          SELECT payment_requests.*
          FROM payment_requests
          INNER JOIN users ON users.id = payment_requests.user_id
          WHERE users.property_id = $1
          ORDER BY payment_requests.created_at DESC, payment_requests.id DESC
        `,
        [normalizedPropertyId]
      )
    : await query("SELECT * FROM payment_requests ORDER BY created_at DESC, id DESC");
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

export async function updatePaymentRequest(id, fields = {}) {
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

  const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  await query(`UPDATE payment_requests SET ${assignments} WHERE id = $${entries.length + 1}`, [...values, id]);
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

export async function listAllMaintenanceTickets({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const result = normalizedPropertyId
    ? await query(
        `
          SELECT maintenance_tickets.*
          FROM maintenance_tickets
          INNER JOIN users ON users.id = maintenance_tickets.user_id
          WHERE users.property_id = $1
          ORDER BY maintenance_tickets.updated_at DESC, maintenance_tickets.id DESC
        `,
        [normalizedPropertyId]
      )
    : await query("SELECT * FROM maintenance_tickets ORDER BY updated_at DESC, id DESC");
  return result.rows;
}

export async function getMaintenanceTicketById(id) {
  return getOne("SELECT * FROM maintenance_tickets WHERE id = $1 LIMIT 1", [id]);
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
  property_id = null,
  name,
  category = "General",
  status = "AVAILABLE",
  url = null,
  original_name = "",
  stored_path = "",
}) {
  return query(
    "INSERT INTO shared_documents (property_id, name, category, status, url, original_name, stored_path) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [property_id, name, category, status, url, original_name, stored_path]
  );
}

export async function listSharedDocuments({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const result = normalizedPropertyId
    ? await query(
        "SELECT *, 'shared' AS scope FROM shared_documents WHERE property_id = $1 ORDER BY created_at DESC, id DESC",
        [normalizedPropertyId]
      )
    : await query("SELECT *, 'shared' AS scope FROM shared_documents ORDER BY created_at DESC, id DESC");
  return result.rows;
}

export async function listDocumentsForUser(userId, { propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const result = normalizedPropertyId
    ? await query(
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
            WHERE property_id = $2
          ) AS combined_documents
          ORDER BY created_at DESC, id DESC
        `,
        [userId, normalizedPropertyId]
      )
    : await query(
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

export async function listAllMessages({ sender_type = null, propertyId = null } = {}) {
  const clauses = [];
  const params = [];
  if (sender_type) {
    params.push(sender_type);
    clauses.push(`messages.sender_type = $${params.length}`);
  }

  const normalizedPropertyId = String(propertyId || "").trim();
  if (normalizedPropertyId) {
    params.push(normalizedPropertyId);
    clauses.push(`users.property_id = $${params.length}`);
  }

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
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY messages.created_at DESC, messages.id DESC
    `,
    params
  );
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

export async function listAllVacateNotices({ propertyId = null } = {}) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const result = normalizedPropertyId
    ? await query(
        `
          SELECT vacate_notices.*
          FROM vacate_notices
          INNER JOIN users ON users.id = vacate_notices.user_id
          WHERE users.property_id = $1
          ORDER BY vacate_notices.created_at DESC, vacate_notices.id DESC
        `,
        [normalizedPropertyId]
      )
    : await query("SELECT * FROM vacate_notices ORDER BY created_at DESC, id DESC");
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

export async function getMonthlyStatement(userId, monthKey, propertyId) {
  return getOne(
    "SELECT * FROM admin_monthly_statements WHERE user_id = $1 AND month_key = $2 AND property_id = $3 LIMIT 1",
    [userId, normalizeMonthKey(monthKey), String(propertyId || "").trim()]
  );
}

export async function upsertMonthlyStatement(userId, { property_id, month_key, opening_balance_override, deposit, garbage_amount, rent_bill, remarks }) {
  const propertyId = String(property_id || "").trim();
  const normalizedMonthKey = normalizeMonthKey(month_key);

  const result = await query(
    `
      INSERT INTO admin_monthly_statements (
        property_id, user_id, month_key, opening_balance_override, deposit, garbage_amount, rent_bill, remarks, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (property_id, user_id, month_key) DO UPDATE SET
        opening_balance_override = COALESCE(EXCLUDED.opening_balance_override, admin_monthly_statements.opening_balance_override),
        deposit = COALESCE(EXCLUDED.deposit, admin_monthly_statements.deposit),
        garbage_amount = COALESCE(EXCLUDED.garbage_amount, admin_monthly_statements.garbage_amount),
        rent_bill = COALESCE(EXCLUDED.rent_bill, admin_monthly_statements.rent_bill),
        remarks = COALESCE(EXCLUDED.remarks, admin_monthly_statements.remarks),
        updated_at = NOW()
      RETURNING *
    `,
    [
      propertyId,
      userId,
      normalizedMonthKey,
      opening_balance_override ?? null,
      deposit !== undefined ? String(deposit) : null,
      garbage_amount !== undefined ? String(garbage_amount) : null,
      rent_bill !== undefined ? String(rent_bill) : null,
      remarks !== undefined ? remarks : null,
    ]
  );

  return result.rows[0] || null;
}

export async function getMonthlyWaterReading(userId, monthKey, propertyId) {
  return getOne(
    "SELECT * FROM admin_water_readings WHERE user_id = $1 AND month_key = $2 AND property_id = $3 LIMIT 1",
    [userId, normalizeMonthKey(monthKey), String(propertyId || "").trim()]
  );
}

export async function upsertMonthlyWaterReading(userId, { property_id, month_key, previous_reading, latest_reading, rate }) {
  const propertyId = String(property_id || "").trim();
  const normalizedMonthKey = normalizeMonthKey(month_key);
  const result = await query(
    `
      INSERT INTO admin_water_readings (
        property_id, user_id, month_key, previous_reading, latest_reading, rate, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (property_id, user_id, month_key) DO UPDATE SET
        previous_reading = COALESCE(EXCLUDED.previous_reading, admin_water_readings.previous_reading),
        latest_reading = COALESCE(EXCLUDED.latest_reading, admin_water_readings.latest_reading),
        rate = COALESCE(EXCLUDED.rate, admin_water_readings.rate),
        updated_at = NOW()
      RETURNING *
    `,
    [
      propertyId,
      userId,
      normalizedMonthKey,
      previous_reading !== undefined ? String(previous_reading) : null,
      latest_reading !== undefined ? String(latest_reading) : null,
      rate !== undefined ? String(rate) : null,
    ]
  );

  return result.rows[0] || null;
}

export async function addMonthlyPaymentEntry(userId, { property_id, month_key, amount, payment_date = null, receipt_number = null, remarks = "" }) {
  const result = await query(
    `
      INSERT INTO admin_monthly_payment_entries (
        property_id, user_id, month_key, amount, payment_date, receipt_number, remarks, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `,
    [String(property_id || "").trim(), userId, normalizeMonthKey(month_key), String(amount ?? 0), payment_date, receipt_number, remarks]
  );
  return result.rows[0] || null;
}

export async function updateMonthlyPaymentEntry(id, fields = {}) {
  const allowed = {
    amount: fields.amount,
    payment_date: fields.payment_date,
    receipt_number: fields.receipt_number,
    remarks: fields.remarks,
  };
  const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    return getOne("SELECT * FROM admin_monthly_payment_entries WHERE id = $1 LIMIT 1", [id]);
  }

  const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
  const result = await query(
    `UPDATE admin_monthly_payment_entries SET ${assignments}, updated_at = NOW() WHERE id = $${entries.length + 1} RETURNING *`,
    [...entries.map(([, value]) => value), id]
  );
  return result.rows[0] || null;
}

export async function setMonthlyGarbageAmount({ property_id, month_key, user_ids, amount }) {
  const propertyId = String(property_id || "").trim();
  const normalizedMonthKey = normalizeMonthKey(month_key);
  const normalizedUserIds = [...new Set((Array.isArray(user_ids) ? user_ids : []).map((id) => Number(id)).filter(Boolean))];

  for (const userId of normalizedUserIds) {
    await upsertMonthlyStatement(userId, {
      property_id: propertyId,
      month_key: normalizedMonthKey,
      garbage_amount: String(amount ?? 0),
    });
  }

  return normalizedUserIds.length;
}

export async function listMonthlyTenantLedger({ propertyId = null, floorNumber = null, monthKey }) {
  const normalizedPropertyId = String(propertyId || "").trim();
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  const allPropertyUsers = await listUsers({ propertyId: normalizedPropertyId });
  const normalizedFloor = String(floorNumber || "").trim();
  const users = allPropertyUsers.filter((user) => {
    if (!normalizedFloor || normalizedFloor.toLowerCase() === "all") {
      return true;
    }
    return String(user.floor_number || "").trim() === normalizedFloor;
  });
  const floors = [...new Set(allPropertyUsers.map((user) => String(user.floor_number || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  if (!users.length) {
    return { month_key: normalizedMonthKey, floors, rows: [] };
  }

  const userIds = users.map((user) => Number(user.id));
  const statements = await query(
    `
      SELECT *
      FROM admin_monthly_statements
      WHERE property_id = $1
        AND month_key <= $2
        AND user_id = ANY($3::bigint[])
      ORDER BY month_key ASC, user_id ASC
    `,
    [normalizedPropertyId, normalizedMonthKey, userIds]
  );
  const waterReadings = await query(
    `
      SELECT *
      FROM admin_water_readings
      WHERE property_id = $1
        AND month_key <= $2
        AND user_id = ANY($3::bigint[])
      ORDER BY month_key ASC, user_id ASC
    `,
    [normalizedPropertyId, normalizedMonthKey, userIds]
  );
  const paymentEntries = await query(
    `
      SELECT *
      FROM admin_monthly_payment_entries
      WHERE property_id = $1
        AND month_key <= $2
        AND user_id = ANY($3::bigint[])
      ORDER BY COALESCE(payment_date, created_at) DESC, id DESC
    `,
    [normalizedPropertyId, normalizedMonthKey, userIds]
  );

  const statementMap = buildLedgerMaps(statements.rows, (row) => `${row.user_id}:${row.month_key}`);
  const waterMap = buildLedgerMaps(waterReadings.rows, (row) => `${row.user_id}:${row.month_key}`);
  const paymentMap = buildPaymentMap(paymentEntries.rows);

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

export async function getPortfolioOverview({ propertyId = null } = {}) {
  const users = await listUsers({ propertyId });
  const activeTenants = users.filter((user) => String(user.status || user.state || "").trim().toUpperCase() === "ACTIVE").length;
  const overdueTenants = users.filter((user) => calculateUserOutstanding(user) > 0).length;
  const currentActiveTenants = users.filter((user) => {
    const isActive = String(user.status || user.state || "").trim().toUpperCase() === "ACTIVE";
    return isActive && calculateUserOutstanding(user) <= 0;
  }).length;
  const normalizedPropertyId = String(propertyId || "").trim();
  const activeLeases = Number(
    normalizedPropertyId
      ? (
          await getOne(
            `
              SELECT COUNT(*) AS count
              FROM leases
              INNER JOIN users ON users.id = leases.user_id
              WHERE UPPER(COALESCE(leases.status, '')) = 'ACTIVE'
                AND users.property_id = $1
            `,
            [normalizedPropertyId]
          )
        )?.count || 0
      : (await getOne("SELECT COUNT(*) AS count FROM leases WHERE UPPER(COALESCE(status, '')) = 'ACTIVE'"))?.count || 0
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
