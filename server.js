import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import multer from "multer";
import net from "net";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  addAlert,
  addAdminAlertMessage,
  addSharedDocument,
  addMaintenanceTicket,
  applyBulkTenantBalanceAction,
  addMessage,
  addPaymentRequest,
  addVacateNotice,
  adjustUserBalance,
  applyGlobalBilling,
  createUser,
  createAdminUser,
  createUnit,
  createTenancy,
  DATABASE_PROVIDER,
  DATABASE_PATH,
  deleteUserById,
  getAdminUserByUsername,
  getAdminUserById,
  getUnitById,
  getMonthlyStatement,
  listAdminAlertMessagesByThreadOwner,
  listAdminAlertThreads,
  listAdminUsers,
  listAuditLogs,
  listMonthlyTenantLedger,
  listTenantTenancies,
  listTenanciesForProperty,
  listUnitsForProperty,
  writeAuditLog,
  getMaintenanceTicketById,
  getPaymentRequestById,
  getPaymentRequestByProviderCheckoutId,
  getAdminSetting,
  getActiveLeaseForUser,
  getPortfolioOverview,
  getPropertyById,
  getUserById,
  getUserByTenantId,
  getVacateNoticeById,
  listArrearsForUser,
  listAllMaintenanceTickets,
  listAllPaymentRequests,
  listDocumentsForUser,
  listLeasesForUser,
  listAllMessages,
  listAllVacateNotices,
  listMaintenanceForUser,
  listMessagesForUser,
  listPaymentRequestsForUser,
  listProperties,
  listUsersByFirstName,
  listSharedDocuments,
  listStoredAlertsForUser,
  listTransactionsForUser,
  listUsers,
  listVacateNoticesForUser,
  recalculateUserFinancials,
  setAdminSetting,
  setMonthlyGarbageAmount,
  touchUserActivity,
  upsertMonthlyStatement,
  upsertMonthlyWaterReading,
  updateMaintenanceTicketStatus,
  updatePaymentRequest,
  updatePaymentRequestStatus,
  addMonthlyPaymentEntry,
  updateUserBilling,
  updateUserToken,
  updateUserProfile,
  updateVacateNoticeStatus,
  verifyPassword,
  addTransaction,
} from "./src/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.join(__dirname, "frontend");

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEFAULT_ADMIN_USERNAME = "superadmin";
const DEFAULT_ADMIN_PASSWORD = "otic12";
const DEFAULT_BACKUP_SECRET = "otic-local-backup-secret";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const BACKUP_SECRET = process.env.BACKUP_SECRET || DEFAULT_BACKUP_SECRET;
const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(__dirname, "backups");
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, "uploads");
const DOCUMENT_UPLOAD_DIR = path.join(UPLOAD_DIR, "documents");
const ADMIN_SESSION_COOKIE = "otic_admin_session";
const DEFAULT_PROPERTY_ID = "otic-1";
const MPESA_PAYBILL_NUMBER = "222111";
const MPESA_ACCOUNT_NUMBER = "024000000880";
const TENANT_ONLINE_WINDOW_MS = 2 * 60 * 1000;
const TENANT_RECENT_WINDOW_MS = 30 * 60 * 1000;
const TENANT_ACTIVITY_TOUCH_WINDOW_MS = 20 * 1000;
const APP_BASE_URL = String(process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
const PROPERTY_TIME_ZONE = process.env.APP_TIME_ZONE || "Africa/Nairobi";
const BILLING_DUE_DAY = 7;
const OVERDUE_ALERT_DELAY_DAYS = 5;
const MPESA_CALLBACK_PATH = "/api/payments/mpesa/callback";
const MPESA_PROVIDER = "SAFARICOM";
const MPESA_PROVIDER_MODE = String(process.env.MPESA_PROVIDER_MODE || "").trim().toLowerCase();
const MPESA_ENV = String(process.env.MPESA_ENV || process.env.MPESA_DARAJA_ENV || "sandbox").trim().toLowerCase();
const MPESA_SHORTCODE = String(process.env.MPESA_SHORTCODE || process.env.MPESA_BUSINESS_SHORTCODE || "").trim();
const MPESA_PASSKEY = String(process.env.MPESA_PASSKEY || "").trim();
const MPESA_CONSUMER_KEY = String(process.env.MPESA_CONSUMER_KEY || "").trim();
const MPESA_CONSUMER_SECRET = String(process.env.MPESA_CONSUMER_SECRET || "").trim();
const MPESA_CALLBACK_URL = String(process.env.MPESA_CALLBACK_URL || (APP_BASE_URL ? `${APP_BASE_URL}${MPESA_CALLBACK_PATH}` : "")).trim();
const MPESA_TRANSACTION_TYPE = String(process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline").trim();
const propertyDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PROPERTY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const propertyDateLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PROPERTY_TIME_ZONE,
  month: "long",
  day: "numeric",
  year: "numeric",
});
const mpesaDateTimePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PROPERTY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const adminSessions = new Map();
const adminCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PRODUCTION,
};
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

fs.mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });

const sharedDocumentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, DOCUMENT_UPLOAD_DIR);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname || "");
      const basename = path
        .basename(file.originalname || "document", extension)
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "document";
      callback(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${basename}${extension}`);
    },
  }),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

if (IS_PRODUCTION) {
  app.set("trust proxy", 1);

  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD before starting the server in production.");
  }

  if (!process.env.BACKUP_SECRET) {
    throw new Error("Set BACKUP_SECRET before starting the server in production.");
  }
}

function getBackupStats() {
  if (!fs.existsSync(BACKUP_DIR)) {
    return { backup_count: 0, last_backup_at: null };
  }

  const entries = fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".backup.json"))
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(BACKUP_DIR, entry.name),
      mtime: fs.statSync(path.join(BACKUP_DIR, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return {
    backup_count: entries.length,
    last_backup_at: entries[0] ? new Date(entries[0].mtime).toISOString() : null,
  };
}

function createEncryptedBackup() {
  if (DATABASE_PROVIDER !== "sqlite" || !DATABASE_PATH || !fs.existsSync(DATABASE_PATH)) {
    return getBackupStats();
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const raw = fs.readFileSync(DATABASE_PATH);
  const key = crypto.scryptSync(BACKUP_SECRET, "otic-backup-salt", 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(raw), cipher.final()]);
  const tag = cipher.getAuthTag();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `${stamp}.backup.json`);

  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        algorithm: "aes-256-gcm",
        created_at: new Date().toISOString(),
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
        data: encrypted.toString("hex"),
      },
      null,
      2
    )
  );

  return getBackupStats();
}

function sanitizeUser(user) {
  const response = { ...user, ...buildTenantActivityMeta(user) };
  delete response.account_number_hash;
  return response;
}

function parseTimestamp(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function getDatePartsInPropertyTimeZone(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = {};
  for (const part of propertyDatePartsFormatter.formatToParts(date)) {
    if (part.type !== "literal") {
      parts[part.type] = part.value;
    }
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function buildDateKey({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatPropertyDateLabel(parts) {
  return propertyDateLabelFormatter.format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0)));
}

function hasPaymentActivitySince(dateKey, payments = [], transactions = []) {
  const seenSinceDate = (value) => {
    const parts = getDatePartsInPropertyTimeZone(value);
    return parts ? buildDateKey(parts) >= dateKey : false;
  };

  const paymentRecorded = payments.some((payment) => {
    const normalizedStatus = String(payment?.status || "").trim().toUpperCase();
    if (normalizedStatus === "DISAPPROVED") {
      return false;
    }

    return seenSinceDate(payment?.created_at);
  });

  if (paymentRecorded) {
    return true;
  }

  return transactions.some((transaction) => seenSinceDate(transaction?.date_created || transaction?.created_at));
}

function buildTenantActivityMeta(user) {
  const lastSeenAt = user?.last_seen_at || null;
  const lastLoginAt = user?.last_login_at || null;
  const lastSeenTime = parseTimestamp(lastSeenAt);
  let activityStatus = "NEVER_SEEN";

  if (lastSeenTime !== null) {
    const ageMs = Math.max(Date.now() - lastSeenTime, 0);
    if (ageMs <= TENANT_ONLINE_WINDOW_MS) {
      activityStatus = "ONLINE";
    } else if (ageMs <= TENANT_RECENT_WINDOW_MS) {
      activityStatus = "RECENTLY_ACTIVE";
    } else {
      activityStatus = "OFFLINE";
    }
  }

  return {
    last_seen_at: lastSeenAt,
    last_login_at: lastLoginAt,
    activity_status: activityStatus,
    is_online: activityStatus === "ONLINE",
  };
}

function shouldTouchTenantActivity(lastSeenAt) {
  const lastSeenTime = parseTimestamp(lastSeenAt);
  if (lastSeenTime === null) {
    return true;
  }

  return Math.max(Date.now() - lastSeenTime, 0) >= TENANT_ACTIVITY_TOUCH_WINDOW_MS;
}

function sanitizeTenantMaintenanceTicket(ticket) {
  const response = { ...ticket };
  delete response.repair_cost;
  return response;
}

async function buildAutomatedAlerts(user) {
  const generated = [];
  const now = new Date();
  const bills = await getTenantBillBreakdown(user);
  const outstanding = Number(bills.total || 0);
  const todayParts = getDatePartsInPropertyTimeZone(now);

  if (outstanding > 0 && todayParts) {
    const todayKey = buildDateKey(todayParts);
    const dueDateParts = { ...todayParts, day: BILLING_DUE_DAY };
    const overdueDateParts = { ...todayParts, day: BILLING_DUE_DAY + OVERDUE_ALERT_DELAY_DAYS };
    const dueDateKey = buildDateKey(dueDateParts);
    const overdueDateKey = buildDateKey(overdueDateParts);

    if (todayParts.day <= BILLING_DUE_DAY) {
      generated.push({
        id: `auto-rent-due-${user.id}-${dueDateKey}`,
        type: "rent_reminder",
        title: "Rent due reminder",
        message: `Please clear your outstanding rent and bills of KES ${outstanding.toLocaleString()} by ${formatPropertyDateLabel(
          dueDateParts
        )}.`,
        severity: "info",
        status: "ACTIVE",
        trigger_date: dueDateKey,
        created_at: now.toISOString(),
        source: "system",
      });
    } else if (todayKey >= overdueDateKey) {
      const [payments, transactions] = await Promise.all([
        listPaymentRequestsForUser(user.id),
        listTransactionsForUser(user.id),
      ]);
      const paymentRecordedSinceDueDate = hasPaymentActivitySince(dueDateKey, payments, transactions);

      if (!paymentRecordedSinceDueDate) {
        generated.push({
          id: `auto-overdue-${user.id}-${overdueDateKey}`,
          type: "overdue",
          title: "Late payment alert",
          message: `Your balance of KES ${outstanding.toLocaleString()} is still unpaid 5 days after the ${formatPropertyDateLabel(
            dueDateParts
          )} due date.`,
          severity: "critical",
          status: "ACTIVE",
          trigger_date: overdueDateKey,
          created_at: now.toISOString(),
          source: "system",
        });
      }
    }
  }

  const activeLease = await getActiveLeaseForUser(user.id);
  if (activeLease?.end_date) {
    const leaseEnd = new Date(activeLease.end_date);
    const daysRemaining = Math.ceil((leaseEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysRemaining > 0 && daysRemaining <= 90) {
      generated.push({
        id: `auto-lease-${activeLease.id}`,
        type: "lease_expiry",
        title: "Lease expiry reminder",
        message: `Your active lease expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`,
        severity: daysRemaining <= 30 ? "warning" : "info",
        status: "ACTIVE",
        trigger_date: activeLease.end_date,
        created_at: new Date().toISOString(),
        source: "system",
      });
    }
  }

  return generated;
}

function paymentMethodsFor(user) {
  const providerSummary = buildMpesaProviderSummary();
  return [
    {
      id: "mpesa-stk-push",
      label: providerSummary.mode === "daraja" ? "M-PESA Prompt" : "M-PESA Prompt (Local Mode)",
      provider: "Safaricom",
      description:
        providerSummary.mode === "daraja"
          ? "Enter the amount and phone number, then approve the M-PESA prompt on your handset."
          : "Local mode is active. The system will simulate a prompt so you can test the full admin workflow.",
      enabled: true,
      prefill: user.phone_number || "",
      paybill_number: MPESA_PAYBILL_NUMBER,
      account_number: MPESA_ACCOUNT_NUMBER,
      provider_mode: providerSummary.mode,
    },
  ];
}

function getScopedAdminSettingKey(propertyId, key) {
  const normalizedPropertyId = String(propertyId || "").trim();
  return normalizedPropertyId ? `property:${normalizedPropertyId}:${key}` : key;
}

async function getScopedAdminSetting(propertyId, key, fallbackValue = null) {
  const scopedValue = await getAdminSetting(getScopedAdminSettingKey(propertyId, key), null);
  if (scopedValue !== null && scopedValue !== undefined) {
    return scopedValue;
  }

  if (!propertyId || propertyId === DEFAULT_PROPERTY_ID) {
    return getAdminSetting(key, fallbackValue);
  }

  return fallbackValue;
}

async function setScopedAdminSetting(propertyId, key, value) {
  return setAdminSetting(getScopedAdminSettingKey(propertyId, key), value);
}

async function getBillingConfig(propertyId = null) {
  return {
    rent: Number((await getScopedAdminSetting(propertyId, "billing_rent", "0")) || 0),
    water: Number((await getScopedAdminSetting(propertyId, "billing_water", "0")) || 0),
    trash: Number((await getScopedAdminSetting(propertyId, "billing_trash", "0")) || 0),
    electricity: Number((await getScopedAdminSetting(propertyId, "billing_electricity", "0")) || 0),
  };
}

async function getOccupancyConfig(propertyId = null) {
  const occupied = Number((await getScopedAdminSetting(propertyId, "occupied_units_manual", "")) || NaN);
  const vacant = Number((await getScopedAdminSetting(propertyId, "vacant_units_manual", "")) || NaN);
  return {
    occupied_units: Number.isFinite(occupied) ? occupied : null,
    vacant_units: Number.isFinite(vacant) ? vacant : null,
  };
}

async function getPortfolioOverviewWithOverrides(propertyId = null) {
  const base = await getPortfolioOverview({ propertyId });
  const occupancy = await getOccupancyConfig(propertyId);
  const occupied = occupancy.occupied_units ?? base.occupied_units;
  const vacant = occupancy.vacant_units ?? base.vacant_units;
  return {
    ...base,
    occupied_units: occupied,
    vacant_units: vacant,
    total_units: occupied + vacant,
  };
}

function buildAdminDatabaseMeta(property = null) {
  return {
    database_provider: DATABASE_PROVIDER,
    storage_label: DATABASE_PROVIDER === "postgres" ? "Postgres" : "SQLite",
    property_id: property?.id || null,
    property_name: property?.name || null,
  };
}

async function getTenantBillBreakdown(user) {
  const config = await getBillingConfig(user?.property_id || DEFAULT_PROPERTY_ID);
  const breakdown = {
    rent: Number(user.rent_balance ?? user.rent ?? config.rent ?? 0),
    water: Number(user.water_balance ?? user.bill ?? config.water ?? 0),
    trash: Number(user.trash_balance ?? config.trash ?? 0),
    electricity: Number(user.electricity_balance ?? config.electricity ?? 0),
  };

  return {
    ...breakdown,
    total: breakdown.rent + breakdown.water + breakdown.trash + breakdown.electricity,
  };
}

function isClosedTicketStatus(status) {
  return ["Resolved", "Solved"].includes(String(status || "").trim());
}

function parseNonNegativeMoney(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "0";
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }

  return String(amount);
}

function parseLedgerMonthKey(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new Error("month must be in YYYY-MM format");
  }
  return normalized;
}

function getCurrentLedgerMonthKey() {
  const parts = getDatePartsInPropertyTimeZone(new Date());
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function formatLedgerMonthLabel(monthKey) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PROPERTY_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(new Date(`${monthKey}-01T12:00:00Z`));
}

function parseOptionalLedgerNumber(value, fieldName, { allowNegative = false, emptyValue = 0 } = {}) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return emptyValue;
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) {
    throw new Error(`${fieldName} must be a number`);
  }
  if (!allowNegative && amount < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }

  return amount;
}

function normalizeFloorValue(value) {
  const normalized = String(value || "").trim();
  return normalized && normalized.toLowerCase() !== "all" ? normalized : null;
}

function summarizeMonthlyLedgerRows(rows = []) {
  return rows.reduce(
    (summary, row) => {
      summary.tenant_count += 1;
      summary.dues_total += Number(row.dues || 0);
      summary.payment_total += Number(row.payment_total || 0);
      summary.balance_total += Number(row.balance || 0);
      summary.water_total += Number(row.water_bill || 0);
      summary.garbage_total += Number(row.garbage_amount || 0);
      return summary;
    },
    {
      tenant_count: 0,
      dues_total: 0,
      payment_total: 0,
      balance_total: 0,
      water_total: 0,
      garbage_total: 0,
    }
  );
}

async function buildMonthlyLedgerPayload(propertyId, monthKey, floorNumber = null) {
  const initial = await listMonthlyTenantLedger({ propertyId, monthKey, floorNumber });
  const selectedFloor = floorNumber || null;
  const ledger = selectedFloor ? await listMonthlyTenantLedger({ propertyId, monthKey, floorNumber: selectedFloor }) : initial;
  const waterRate = Number((await getScopedAdminSetting(propertyId, "utility_water_rate", "0")) || 0);

  const rows = ledger.rows.map((row) => {
    const previousReading = Number(row.previous_meter_reading || 0);
    const latestReading = Number(row.latest_meter_reading || 0);
    const consumption = latestReading - previousReading;
    const effectiveRate = Number.isFinite(waterRate) ? waterRate : Number(row.rate || 0);
    const waterBill = consumption * effectiveRate;
    const dues = Number(row.dues || 0) - Number(row.water_bill || 0) + waterBill;
    const balance = Number(row.payment_total || 0) - dues;

    return {
      ...row,
      rate: effectiveRate,
      water_bill: waterBill,
      dues,
      balance,
    };
  });

  return {
    month_key: monthKey,
    month_label: formatLedgerMonthLabel(monthKey),
    selected_floor: selectedFloor,
    floors: initial.floors,
    water_rate: waterRate,
    rows,
    summary: summarizeMonthlyLedgerRows(rows),
  };
}

function parseRequiredDateTime(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date and time`);
  }

  return parsed.toISOString();
}

function parseBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function hasDarajaMpesaConfig() {
  return Boolean(
    MPESA_SHORTCODE &&
      MPESA_PASSKEY &&
      MPESA_CONSUMER_KEY &&
      MPESA_CONSUMER_SECRET &&
      isHttpUrl(MPESA_CALLBACK_URL)
  );
}

function getMpesaPromptMode() {
  if (MPESA_PROVIDER_MODE === "mock") {
    return "mock";
  }
  if (MPESA_PROVIDER_MODE === "daraja") {
    return hasDarajaMpesaConfig() ? "daraja" : "misconfigured";
  }
  return hasDarajaMpesaConfig() ? "daraja" : "mock";
}

function buildMpesaProviderSummary() {
  const mode = getMpesaPromptMode();
  return {
    provider: MPESA_PROVIDER,
    mode,
    environment: MPESA_ENV,
    prompt_supported: mode === "daraja" || mode === "mock",
    live_callback_configured: mode === "daraja",
    callback_url: mode === "daraja" ? MPESA_CALLBACK_URL : null,
  };
}

function normalizePaymentFor(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["RENT", "WATER", "TRASH", "ELECTRICITY"].includes(normalized) ? normalized : "RENT";
}

function normalizeKenyanPhoneNumber(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) {
    return "";
  }
  if (digits.startsWith("254") && digits.length === 12) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `254${digits.slice(1)}`;
  }
  if (digits.startsWith("7") && digits.length === 9) {
    return `254${digits}`;
  }
  if (digits.startsWith("1") && digits.length === 9) {
    return `254${digits}`;
  }
  return "";
}

function buildMpesaTimestamp(date = new Date()) {
  const parts = {};
  for (const part of mpesaDateTimePartsFormatter.formatToParts(date)) {
    if (part.type !== "literal") {
      parts[part.type] = part.value;
    }
  }
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

function buildMpesaPassword(timestamp) {
  return Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString("base64");
}

function getMpesaBaseUrl() {
  return MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

async function getMpesaAccessToken() {
  const credentials = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString("base64");
  const response = await fetch(`${getMpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.errorMessage || data?.error_description || "Unable to authenticate with Safaricom M-PESA.");
  }

  return data.access_token;
}

function buildTenantAccountReference(user, paymentFor) {
  const base = `${user?.house_number || user?.tenant_id || user?.id || "OTIC"}-${paymentFor}`;
  return base.replace(/[^A-Za-z0-9-]/g, "").slice(0, 20) || `OTIC-${paymentFor}`;
}

async function sendDarajaStkPush({ user, amount, phoneNumber, paymentFor }) {
  const token = await getMpesaAccessToken();
  const timestamp = buildMpesaTimestamp();
  const payload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: buildMpesaPassword(timestamp),
    Timestamp: timestamp,
    TransactionType: MPESA_TRANSACTION_TYPE,
    Amount: Math.round(Number(amount || 0)),
    PartyA: phoneNumber,
    PartyB: MPESA_SHORTCODE,
    PhoneNumber: phoneNumber,
    CallBackURL: MPESA_CALLBACK_URL,
    AccountReference: buildTenantAccountReference(user, paymentFor),
    TransactionDesc: `${paymentFor} payment`,
  };

  const response = await fetch(`${getMpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  const responseCode = String(data?.ResponseCode ?? "");
  if (!response.ok || responseCode !== "0") {
    throw new Error(data?.errorMessage || data?.ResponseDescription || "Unable to send the M-PESA prompt right now.");
  }

  return {
    payload,
    response: data,
  };
}

function safeParseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseMpesaCallbackMetadata(items = []) {
  const metadata = {};
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.Name) {
      metadata[item.Name] = item.Value ?? null;
    }
  }
  return metadata;
}

function parseMpesaTransactionDate(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{14}$/.test(normalized)) {
    return null;
  }
  const year = normalized.slice(0, 4);
  const month = normalized.slice(4, 6);
  const day = normalized.slice(6, 8);
  const hour = normalized.slice(8, 10);
  const minute = normalized.slice(10, 12);
  const second = normalized.slice(12, 14);
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function paymentStatusNeedsAdminReview(status) {
  return String(status || "").trim().toUpperCase() === "PENDING_CONFIRMATION";
}

function paymentStatusAwaitingCallback(status) {
  return String(status || "").trim().toUpperCase() === "PROMPT_SENT";
}

function paymentStatusAwaitingTenantConfirmation(status) {
  return String(status || "").trim().toUpperCase() === "AUTO_POSTED_PENDING_TENANT_CONFIRMATION";
}

function paymentStatusOpen(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return ["PROMPT_SENT", "AUTO_POSTED_PENDING_TENANT_CONFIRMATION"].includes(normalized);
}

function getOpenTenantPayment(payments = []) {
  return payments.find((payment) => paymentStatusOpen(payment?.status)) || null;
}

function toMinuteKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 16);
}

function generatePortalReceiptNumber(prefix = "RCT") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}

function buildMockPromptConfirmation() {
  const now = new Date();
  return {
    reference: `MP${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    payment_time: now.toISOString(),
  };
}

async function incrementAcquiredCollectionTotal(propertyId, amount) {
  const current = Number((await getScopedAdminSetting(propertyId, "acquired_collection_total", "0")) || 0);
  await setScopedAdminSetting(propertyId, "acquired_collection_total", current + Number(amount || 0));
}

async function applyPaymentAutomatically(payment, user, { reference, paymentTime, statusAfterApply }) {
  if (payment?.auto_applied_at) {
    return {
      payment,
      user: await getUserById(payment.user_id),
    };
  }

  const appliedAt = new Date().toISOString();
  const refreshedUser = await adjustUserBalance(payment.user_id, payment.payment_for, payment.amount);
  await incrementAcquiredCollectionTotal(user?.property_id || DEFAULT_PROPERTY_ID, payment.amount);
  await addTransaction(payment.user_id, {
    amount: payment.amount,
    date_created: appliedAt,
    type: `${payment.payment_for || "Payment"} Payment`,
    description: `M-PESA prompt payment ${reference || payment.reference || ""}`.trim(),
  });

  const updatedPayment = await updatePaymentRequest(payment.id, {
    reference: reference ?? payment.reference ?? null,
    payment_time: paymentTime ?? payment.payment_time ?? null,
    status: statusAfterApply,
    auto_applied_at: appliedAt,
    completed_at: appliedAt,
    receipt_number: payment.receipt_number || reference || generatePortalReceiptNumber("MPS"),
  });

  await addAlert(payment.user_id, {
    type: "payment",
    title: "Payment received",
    message: `Your payment of KES ${Number(payment.amount || 0).toLocaleString()} has been posted to your account balance.`,
    severity: "success",
    trigger_date: appliedAt,
  });

  await addMessage(payment.user_id, {
    sender_type: "SYSTEM",
    sender_name: "Billing Desk",
    subject: "Payment Posted",
    category: "Payments",
    body:
      `Dear ${user?.first_name || "Tenant"},\n\n` +
      `We have posted your payment of KSH ${Number(payment.amount || 0).toFixed(2)} for ${payment.payment_for || "RENT"}.\n` +
      `Remaining balance: KSH ${Number(refreshedUser?.account_balance || 0).toFixed(2)}.\n\n` +
      "If requested, please finish the extra confirmation step in the approval flow.\n\nRegards,\nOtic Apartments Team",
  });

  return {
    payment: updatedPayment,
    user: refreshedUser,
  };
}

async function getExpectedCollectionTotal(users = null, propertyId = null) {
  const resolvedUsers = users || (await listUsers({ propertyId }));
  let total = 0;
  for (const user of resolvedUsers) {
    total += (await getTenantBillBreakdown(user)).total;
  }
  return total;
}


function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((acc, item) => {
    const [name, ...rest] = item.trim().split("=");
    if (!name) return acc;
    acc[name] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function signAdminSessionPayload(payload) {
  return crypto.createHmac("sha256", BACKUP_SECRET).update(payload).digest("hex");
}

function createAdminSession(username, propertyId = null, role = "SUPER_ADMIN") {
  const normalizedPropertyId = String(propertyId || "").trim();
  const payload = Buffer.from(
    JSON.stringify({
      username,
      role: String(role || "SUPER_ADMIN").trim().toUpperCase(),
      property_id: normalizedPropertyId || null,
      expires_at: Date.now() + 1000 * 60 * 60 * 12,
    })
  ).toString("base64url");
  const signature = signAdminSessionPayload(payload);
  return `${payload}.${signature}`;
}

function getAdminSessionFromToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return null;

  const legacySession = adminSessions.get(normalized);
  if (legacySession) {
    return legacySession;
  }

  const [payload, signature] = normalized.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signAdminSessionPayload(payload);
  const received = Buffer.from(signature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.username || Number(parsed.expires_at || 0) <= Date.now()) {
      return null;
    }

    return {
      username: parsed.username,
      role: String(parsed.role || "SUPER_ADMIN").trim().toUpperCase(),
      property_id: String(parsed.property_id || "").trim() || null,
      created_at: new Date(Number(parsed.expires_at) - 1000 * 60 * 60 * 12).toISOString(),
      expires_at: new Date(Number(parsed.expires_at)).toISOString(),
    };
  } catch {
    return null;
  }
}

function clearAdminSession(req, res) {
  res.cookie(ADMIN_SESSION_COOKIE, "", {
    ...adminCookieOptions,
    expires: new Date(0),
  });
}

function setAdminSessionToken(res, token) {
  res.cookie(ADMIN_SESSION_COOKIE, token, {
    ...adminCookieOptions,
    maxAge: 1000 * 60 * 60 * 12,
  });
}

async function resolveAdminPropertyContext(selectedPropertyId = null, role = "SUPER_ADMIN") {
  const allProperties = (await listProperties()).filter((property) => ["otic-1", "otic-2"].includes(String(property.id || "").trim()));
  if (!allProperties.length) {
    throw new Error("No valid OTIC properties are configured.");
  }

  const normalizedRole = String(role || "SUPER_ADMIN").trim().toUpperCase();
  const normalizedPropertyId = String(selectedPropertyId || "").trim();
  const allowedPropertyId = normalizedRole === "PROPERTY_ADMIN" ? normalizedPropertyId || "otic-1" : null;
  const effectivePropertyId = allowedPropertyId || normalizedPropertyId || DEFAULT_PROPERTY_ID;
  const properties = normalizedRole === "PROPERTY_ADMIN"
    ? allProperties.filter((property) => property.id === effectivePropertyId)
    : allProperties;
  const selectedProperty =
    properties.find((property) => property.id === effectivePropertyId) ||
    allProperties.find((property) => property.id === DEFAULT_PROPERTY_ID) ||
    allProperties[0];

  return { properties, selectedProperty, allowedPropertyId };
}

async function requireAdminSession(req, res, next) {
  const cookies = parseCookies(req);
  const token =
    cookies[ADMIN_SESSION_COOKIE] ||
    (req.header("authorization") || "").replace(/^Bearer\s+/i, "") ||
    req.header("x-admin-token");
  const session = getAdminSessionFromToken(token);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const adminUser = await getAdminUserByUsername(session.username);
  if (!adminUser || adminUser.status !== "ACTIVE") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (adminUser.role === "PROPERTY_ADMIN" && session.property_id && session.property_id !== (adminUser.property_id || "otic-1")) {
    return res.status(403).json({ error: "Forbidden: This administrator can only access their assigned property." });
  }

  req.adminSession = {
    ...session,
    role: adminUser.role,
    property_id: adminUser.role === "PROPERTY_ADMIN" ? adminUser.property_id || "otic-1" : session.property_id || null,
  };
  req.adminUser = adminUser;
  next();
}

const requireAdminPropertyContext = asyncHandler(async (req, _res, next) => {
  const { properties, selectedProperty, allowedPropertyId } = await resolveAdminPropertyContext(
    req.adminSession.property_id,
    req.adminSession.role
  );

  if (req.adminSession.role === "PROPERTY_ADMIN" && selectedProperty.id !== (req.adminSession.property_id || "otic-1")) {
    return _res.status(403).json({ error: "Forbidden: This administrator cannot access a different property." });
  }

  req.adminProperties = properties;
  req.adminProperty = selectedProperty;
  req.adminAllowedPropertyId = allowedPropertyId || null;
  next();
});

function assertUserInAdminProperty(user, req) {
  return Boolean(user && String(user.property_id || "").trim() === req.adminProperty.id);
}

function setNoStore(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

async function validateAuth(req, res) {
  const token =
    req.header("token") ||
    req.header("x-access-token") ||
    (req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  const tenantId = req.body?.tenant_id;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const user = await getUserByTenantId(tenantId);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (!user.access_token || user.access_token !== token) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (shouldTouchTenantActivity(user.last_seen_at)) {
    return touchUserActivity(user.id);
  }

  return user;
}

createEncryptedBackup();

app.use("/api/admin", (_req, res, next) => {
  setNoStore(res);
  next();
});

app.use("/uploads", express.static(UPLOAD_DIR));

app.all("/api/pegasus/visionary/*", (req, res) => {
  res.status(404).json({ error: "Legacy tenant API removed. Use the admin/property system instead." });
});

app.post("/api/admin/login", asyncHandler(async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  const adminUser = await getAdminUserByUsername(username);
  if (!adminUser || adminUser.status !== "ACTIVE") {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }

  if (!verifyPassword(password, adminUser.password_hash)) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }

  const selectedPropertyId = adminUser.role === "PROPERTY_ADMIN" ? (adminUser.property_id || "otic-1") : null;
  const { selectedProperty, properties } = await resolveAdminPropertyContext(selectedPropertyId, adminUser.role);
  const token = createAdminSession(username, selectedProperty.id, adminUser.role);
  setAdminSessionToken(res, token);

  await writeAuditLog({
    admin_user_id: adminUser.id,
    action: "login",
    entity_type: "admin_user",
    entity_id: String(adminUser.id),
    property_id: selectedProperty.id,
    details: { username, role: adminUser.role, property_id: selectedProperty.id },
  });

  res.json({ success: true, username, role: adminUser.role, token, selected_property: selectedProperty, properties });
}));

app.post("/api/admin/logout", requireAdminSession, asyncHandler(async (req, res) => {
  await writeAuditLog({
    admin_user_id: req.adminUser.id,
    action: "logout",
    entity_type: "admin_user",
    entity_id: String(req.adminUser.id),
    property_id: req.adminSession.property_id,
    details: { username: req.adminUser.username, role: req.adminUser.role },
  });
  clearAdminSession(req, res);
  res.json({ success: true });
}));

app.get("/api/admin/session", requireAdminSession, asyncHandler(async (req, res) => {
  const { properties, selectedProperty } = await resolveAdminPropertyContext(req.adminSession.property_id, req.adminSession.role);
  res.json({
    authenticated: true,
    username: req.adminSession.username,
    role: req.adminSession.role,
    properties,
    selected_property: selectedProperty,
    property_id: selectedProperty.id,
  });
}));

app.post("/api/admin/context/property", requireAdminSession, asyncHandler(async (req, res) => {
  const propertyId = String(req.body?.property_id || "").trim();
  if (!propertyId) {
    return res.status(400).json({ error: "property_id is required" });
  }

  const property = await getPropertyById(propertyId);
  if (!property) {
    return res.status(404).json({ error: "Property not found" });
  }

  if (req.adminSession.role === "PROPERTY_ADMIN" && property.id !== (req.adminSession.property_id || "otic-1")) {
    return res.status(403).json({ error: "Forbidden: This administrator cannot access a different property." });
  }

  const token = createAdminSession(req.adminSession.username, property.id, req.adminSession.role);
  setAdminSessionToken(res, token);
  res.json({
    success: true,
    token,
    property_id: property.id,
    selected_property: property,
    properties: await listProperties(),
  });
}));

app.use("/api/admin", requireAdminSession, requireAdminPropertyContext);

app.get("/api/admin/alerts", requireAdminSession, asyncHandler(async (req, res) => {
  const threadRows = (await listAdminAlertThreads()).filter((thread) => {
    if (req.adminSession.role === "SUPER_ADMIN") {
      return true;
    }

    return Number(thread.thread_owner_admin_user_id) === Number(req.adminUser.id);
  });

  const messages = threadRows.flatMap((thread) => listAdminAlertMessagesByThreadOwner(thread.thread_owner_admin_user_id));
  const sortedMessages = messages.sort((left, right) => new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime());

  res.json({
    messages: sortedMessages,
    threads: threadRows.map((thread) => ({
      ...thread,
      thread_owner_admin_user_id: Number(thread.thread_owner_admin_user_id),
      message_count: Number(thread.message_count || 0),
    })),
  });
}));

app.post("/api/admin/alerts", requireAdminSession, asyncHandler(async (req, res) => {
  const bodyText = String(req.body?.body || "").trim();
  if (!bodyText) {
    return res.status(400).json({ error: "alert body is required" });
  }

  const threadOwnerId = req.body?.thread_owner_admin_user_id;
  let threadOwnerAdmin = null;

  if (req.adminSession.role === "SUPER_ADMIN") {
    if (!threadOwnerId) {
      return res.status(400).json({ error: "thread_owner_admin_user_id is required for replies" });
    }

    threadOwnerAdmin = await getAdminUserById(Number(threadOwnerId));
    if (!threadOwnerAdmin) {
      return res.status(404).json({ error: "Thread owner not found" });
    }
  } else {
    threadOwnerAdmin = req.adminUser;
  }

  if (req.adminSession.role !== "SUPER_ADMIN" && Number(threadOwnerAdmin.id) !== Number(req.adminUser.id)) {
    return res.status(403).json({ error: "Forbidden: property admins can only post to their own thread" });
  }

  const message = await addAdminAlertMessage({
    thread_owner_admin_user_id: Number(threadOwnerAdmin.id),
    property_id: threadOwnerAdmin.property_id || req.adminProperty?.id || null,
    sender_admin_user_id: req.adminUser.id,
    sender_role: req.adminUser.role,
    sender_name: req.adminUser.full_name || req.adminUser.username,
    body: bodyText,
  });

  const threadMessages = listAdminAlertMessagesByThreadOwner(Number(threadOwnerAdmin.id));
  const threads = (await listAdminAlertThreads()).filter((thread) => {
    if (req.adminSession.role === "SUPER_ADMIN") {
      return true;
    }

    return Number(thread.thread_owner_admin_user_id) === Number(req.adminUser.id);
  });

  res.json({
    success: true,
    message,
    messages: threadMessages,
    threads,
  });
}));

app.get("/api/admin/users", requireAdminSession, asyncHandler(async (req, res) => {
  res.json({ users: (await listUsers({ propertyId: req.adminProperty.id })).map((user) => sanitizeUser(user)) });
}));

app.post("/api/admin/users", requireAdminSession, asyncHandler(async (req, res) => {
  const { first_name, last_name, account_number, ...rest } = req.body || {};
  if (!first_name || !account_number) {
    return res.status(400).json({ error: "first_name and account_number are required" });
  }

  try {
    const user = await createUser({
      first_name,
      last_name,
      account_number,
      ...rest,
      property_id: req.adminProperty.id,
      property_name: req.adminProperty.name,
    });
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.delete("/api/admin/users/:tenantId", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserByTenantId(req.params.tenantId);
  if (!assertUserInAdminProperty(user, req)) return res.status(404).json({ error: "User not found" });
  await deleteUserById(user.id);
  res.json({ success: true });
}));

app.patch("/api/admin/users/:tenantId", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserByTenantId(req.params.tenantId);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "User not found" });
  }

  const payload = req.body || {};
  const profilePatch = {
    first_name: payload.first_name,
    last_name: payload.last_name,
    phone_number: payload.phone_number,
    email_address: payload.email_address,
    national_id: payload.national_id,
    floor_number: payload.floor_number,
    house_number: payload.house_number,
  };

  const billingPatch = {
    rent: payload.rent,
    water: payload.water,
    trash: payload.trash,
    electricity: payload.electricity,
    deposit: payload.deposit,
  };

  let updatedUser = user;
  if (Object.values(profilePatch).some((value) => value !== undefined)) {
    updatedUser = await updateUserProfile(user.id, profilePatch);
  }

  const hasBillingUpdate = Object.values(billingPatch).some((value) => value !== undefined);
  if (hasBillingUpdate) {
    const normalizedBilling = {
      rent: payload.rent !== undefined ? parseNonNegativeMoney(payload.rent, "rent") : String(user.rent ?? "0"),
      water: payload.water !== undefined ? parseNonNegativeMoney(payload.water, "water") : String(user.water_balance ?? user.bill ?? "0"),
      trash: payload.trash !== undefined ? parseNonNegativeMoney(payload.trash, "trash") : String(user.trash_balance ?? "0"),
      electricity: payload.electricity !== undefined ? parseNonNegativeMoney(payload.electricity, "electricity") : String(user.electricity_balance ?? "0"),
      deposit: payload.deposit !== undefined ? parseNonNegativeMoney(payload.deposit, "deposit") : String(user.deposit ?? "0"),
    };

    updatedUser = await updateUserBilling(user.id, {
      rent: Number(normalizedBilling.rent),
      water: Number(normalizedBilling.water),
      trash: Number(normalizedBilling.trash),
      electricity: Number(normalizedBilling.electricity),
      deposit: Number(normalizedBilling.deposit),
    });
  }

  if (payload.account_balance !== undefined) {
    updatedUser = await updateUserProfile(user.id, { account_balance: String(payload.account_balance) });
  }

  if (payload.arrears !== undefined) {
    updatedUser = await updateUserProfile(user.id, { arrears: String(payload.arrears) });
  }

  res.json({ user: sanitizeUser(updatedUser) });
}));

app.put("/api/admin/users/:tenantId", requireAdminSession, asyncHandler(async (req, res) => {
  const patchHandler = async () => {
    const user = await getUserByTenantId(req.params.tenantId);
    if (!assertUserInAdminProperty(user, req)) {
      return res.status(404).json({ error: "User not found" });
    }

    const payload = req.body || {};
    const profilePatch = {
      first_name: payload.first_name,
      last_name: payload.last_name,
      phone_number: payload.phone_number,
      email_address: payload.email_address,
      national_id: payload.national_id,
      floor_number: payload.floor_number,
      house_number: payload.house_number,
    };

    const billingPatch = {
      rent: payload.rent,
      water: payload.water,
      trash: payload.trash,
      electricity: payload.electricity,
      deposit: payload.deposit,
    };

    let updatedUser = user;
    if (Object.values(profilePatch).some((value) => value !== undefined)) {
      updatedUser = await updateUserProfile(user.id, profilePatch);
    }

    const hasBillingUpdate = Object.values(billingPatch).some((value) => value !== undefined);
    if (hasBillingUpdate) {
      updatedUser = await updateUserBilling(user.id, {
        rent: Number(payload.rent !== undefined ? parseNonNegativeMoney(payload.rent, "rent") : user.rent ?? 0),
        water: Number(payload.water !== undefined ? parseNonNegativeMoney(payload.water, "water") : user.water_balance ?? user.bill ?? 0),
        trash: Number(payload.trash !== undefined ? parseNonNegativeMoney(payload.trash, "trash") : user.trash_balance ?? 0),
        electricity: Number(payload.electricity !== undefined ? parseNonNegativeMoney(payload.electricity, "electricity") : user.electricity_balance ?? 0),
        deposit: Number(payload.deposit !== undefined ? parseNonNegativeMoney(payload.deposit, "deposit") : user.deposit ?? 0),
      });
    }

    return res.json({ user: sanitizeUser(updatedUser) });
  };

  return patchHandler();
}));

async function buildAdminUsersPayload(propertyId) {
  return buildAdminUsersPayloadFromUsers(await listUsers({ propertyId }));
}

function buildAdminUserDirectory(users) {
  return new Map(users.map((user) => [String(user.id), user]));
}

function buildAdminUsersPayloadFromUsers(users) {
  return { users: users.map((user) => sanitizeUser(user)) };
}

async function buildAdminOverviewPayload(users = null, propertyId = null) {
  const resolvedUsers = users || (await listUsers({ propertyId }));
  const floors = [...new Set(resolvedUsers.map((user) => user.floor_number).filter(Boolean))].sort();
  const [tenantMessages, notices, tickets, expectedCollectionRaw, acquiredCollectionRaw, overview] = await Promise.all([
    listAllMessages({ sender_type: "TENANT", propertyId }),
    listAllVacateNotices({ propertyId }),
    listAllMaintenanceTickets({ propertyId }),
    getScopedAdminSetting(propertyId, "expected_collection_total", "0"),
    getScopedAdminSetting(propertyId, "acquired_collection_total", "0"),
    getPortfolioOverviewWithOverrides(propertyId),
  ]);
  const expectedCollection = Number(expectedCollectionRaw || 0);
  const acquiredCollection = Number(acquiredCollectionRaw || 0);

  return {
    overview,
    security: getBackupStats(),
    stats: {
      total_users: resolvedUsers.length,
      total_floors: floors.length,
      tenant_messages: tenantMessages.length,
      pending_notices: notices.filter((notice) => notice.status === "Pending").length,
      open_tickets: tickets.filter((ticket) => !isClosedTicketStatus(ticket.status)).length,
    },
    payments: {
      expected_collection_total: expectedCollection,
      acquired_collection_total: acquiredCollection,
      variance: acquiredCollection - expectedCollection,
    },
    floors,
  };
}

async function buildAdminMessagesPayload(senderType = null, propertyId = null) {
  return { messages: await listAllMessages({ sender_type: senderType, propertyId }) };
}

async function buildAdminDocumentsPayload(propertyId = null) {
  return { documents: await listSharedDocuments({ propertyId }) };
}

async function buildAdminReportsPayload(propertyId = null, username = "Admin") {
  const users = await listUsers({ propertyId });
  const overview = await getPortfolioOverviewWithOverrides(propertyId);
  const payments = await buildAdminPaymentsPayload(users, propertyId);
  const totalArrears = users.reduce((sum, user) => sum + Number(user.arrears || 0), 0);
  const totalCredit = users.reduce((sum, user) => sum + Math.max(0, Number(user.account_balance || 0)), 0);
  const totalOutstanding = users.reduce((sum, user) => sum + Math.max(0, -Number(user.account_balance || 0)), 0);
  const expectedCollection = Number(payments.summary.expected_collection_total || 0);
  const acquiredCollection = Number(payments.summary.acquired_collection_total || 0);
  const collectionRate = expectedCollection > 0 ? (acquiredCollection / expectedCollection) * 100 : 0;
  const occupancyRate = overview.total_units > 0 ? (overview.occupied_units / overview.total_units) * 100 : 0;
  const vacantUnits = Number(overview.vacant_units || 0);

  return {
    generated_by: username,
    generated_at: new Date().toISOString(),
    property_id: propertyId,
    property_name: (await getPropertyById(propertyId))?.name || "Otic",
    summary: {
      total_tenants: users.length,
      total_units: Number(overview.total_units || 0),
      occupied_units: Number(overview.occupied_units || 0),
      vacant_units: vacantUnits,
      total_arrears: totalArrears,
      total_credit: totalCredit,
      total_outstanding: totalOutstanding,
      expected_collection: expectedCollection,
      acquired_collection: acquiredCollection,
      variance: acquiredCollection - expectedCollection,
      collection_rate: Number(collectionRate.toFixed(2)),
      occupancy_rate: Number(occupancyRate.toFixed(2)),
    },
    data: {
      tenant_rows: users.map((user) => ({
        tenant_id: user.tenant_id,
        name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Tenant",
        unit: user.house_number || "-",
        rent: Number(user.rent_balance || user.rent || 0),
        arrears: Number(user.arrears || 0),
        balance: Number(user.account_balance || 0),
        status: String(user.status || "ACTIVE").trim() || "ACTIVE",
      })),
      calculations: {
        arrears_total: totalArrears,
        credit_total: totalCredit,
        outstanding_total: totalOutstanding,
        expected_collection_total: expectedCollection,
        acquired_collection_total: acquiredCollection,
        variance_total: acquiredCollection - expectedCollection,
        collection_rate_percent: Number(collectionRate.toFixed(2)),
        occupancy_rate_percent: Number(occupancyRate.toFixed(2)),
      },
    },
  };
}

async function buildAdminVacatingNoticesPayload(users = null, propertyId = null) {
  const resolvedUsers = users || (await listUsers({ propertyId }));
  const userDirectory = buildAdminUserDirectory(resolvedUsers);
  const notices = await listAllVacateNotices({ propertyId });

  return {
    notices: notices.map((notice) => {
      const tenant = userDirectory.get(String(notice.user_id)) || {};
      return {
        ...notice,
        tenant_name: `${tenant.first_name || ""} ${tenant.last_name || ""}`.trim() || tenant.first_name || "Tenant",
        tenant_id: tenant.tenant_id || null,
        house_number: tenant.house_number || null,
        property_name: tenant.property_name || null,
      };
    }),
  };
}

async function buildAdminPaymentsPayload(users = null, propertyId = null) {
  const resolvedUsers = users || (await listUsers({ propertyId }));
  const userDirectory = buildAdminUserDirectory(resolvedUsers);
  const [billing, expectedCollectionRaw, acquiredCollectionRaw, payments] = await Promise.all([
    getBillingConfig(propertyId),
    getScopedAdminSetting(propertyId, "expected_collection_total", "0"),
    getScopedAdminSetting(propertyId, "acquired_collection_total", "0"),
    listAllPaymentRequests({ propertyId }),
  ]);
  const expectedCollection = Number(expectedCollectionRaw || 0);
  const acquiredCollection = Number(acquiredCollectionRaw || 0);
  const paymentItems = payments.map((payment) => {
    const tenant = userDirectory.get(String(payment.user_id)) || {};
    return {
      ...payment,
      tenant_name: `${tenant.first_name || ""} ${tenant.last_name || ""}`.trim() || tenant.first_name || "Tenant",
      tenant_id: tenant.tenant_id || null,
      house_number: tenant.house_number || null,
      floor_number: tenant.floor_number || null,
      property_name: tenant.property_name || null,
    };
  });

  return {
    summary: {
      expected_collection_total: expectedCollection,
      acquired_collection_total: acquiredCollection,
      variance: acquiredCollection - expectedCollection,
      payment_count: paymentItems.length,
    },
    billing,
    payments: paymentItems,
  };
}

async function buildAdminTicketsPayload(users = null, propertyId = null) {
  const resolvedUsers = users || (await listUsers({ propertyId }));
  const userDirectory = buildAdminUserDirectory(resolvedUsers);
  const tickets = await listAllMaintenanceTickets({ propertyId });

  return {
    tickets: tickets.map((ticket) => {
      const tenant = userDirectory.get(String(ticket.user_id)) || {};
      return {
        ...ticket,
        tenant_name: `${tenant.first_name || ""} ${tenant.last_name || ""}`.trim() || tenant.first_name || "Tenant",
        tenant_id: tenant.tenant_id || null,
        house_number: tenant.house_number || null,
        floor_number: tenant.floor_number || null,
        property_name: tenant.property_name || null,
      };
    }),
  };
}

async function buildAdminBootstrapPayload(username, selectedProperty, properties = []) {
  let users = null;
  try {
    users = await listUsers({ propertyId: selectedProperty.id });
  } catch (error) {
    console.error("Admin bootstrap user prefetch failed:", error);
  }

  const sections = [
    {
      key: "overview",
      build: () => buildAdminOverviewPayload(users, selectedProperty.id),
      fallback: {
        overview: { total_units: 0, occupied_units: 0, vacant_units: 0, active_leases: 0, overdue_tenants: 0, rent_collection_rate: 0 },
        security: { backup_count: 0, last_backup_at: null },
        stats: { total_users: 0, total_floors: 0, tenant_messages: 0, pending_notices: 0, open_tickets: 0 },
        payments: { expected_collection_total: 0, acquired_collection_total: 0, variance: 0 },
        floors: [],
      },
    },
    { key: "users", build: () => (users ? buildAdminUsersPayloadFromUsers(users) : buildAdminUsersPayload(selectedProperty.id)), fallback: { users: [] } },
    { key: "documents", build: () => buildAdminDocumentsPayload(selectedProperty.id), fallback: { documents: [] } },
    { key: "messages", build: () => buildAdminMessagesPayload(null, selectedProperty.id), fallback: { messages: [] } },
    { key: "notices", build: () => buildAdminVacatingNoticesPayload(users, selectedProperty.id), fallback: { notices: [] } },
    { key: "tickets", build: () => buildAdminTicketsPayload(users, selectedProperty.id), fallback: { tickets: [] } },
    { key: "payments", build: () => buildAdminPaymentsPayload(users, selectedProperty.id), fallback: { summary: {}, billing: {}, payments: [] } },
  ];

  const response = {
    authenticated: true,
    username,
    properties,
    selected_property: selectedProperty,
    meta: buildAdminDatabaseMeta(selectedProperty),
    failures: [],
  };

  await Promise.all(
    sections.map(async (section) => {
      try {
        response[section.key] = await section.build();
      } catch (error) {
        console.error(`Admin bootstrap failed for ${section.key}:`, error);
        response[section.key] = section.fallback;
        response.failures.push(section.key);
      }
    })
  );

  return response;
}

app.get("/api/admin/bootstrap", requireAdminSession, asyncHandler(async (req, res) => {
  res.json(await buildAdminBootstrapPayload(req.adminSession.username, req.adminProperty, req.adminProperties));
}));

app.get("/api/admin/overview", requireAdminSession, asyncHandler(async (req, res) => {
  res.json(await buildAdminOverviewPayload(null, req.adminProperty.id));
}));

app.get("/api/admin/reports", requireAdminSession, asyncHandler(async (req, res) => {
  res.json(await buildAdminReportsPayload(req.adminProperty.id, req.adminSession.username));
}));

app.post("/api/admin/reports/generate", requireAdminSession, asyncHandler(async (req, res) => {
  res.json(await buildAdminReportsPayload(req.adminProperty.id, req.adminSession.username));
}));

app.post("/api/admin/occupancy", requireAdminSession, asyncHandler(async (req, res) => {
  const occupied = Number(req.body?.occupied_units ?? NaN);
  const vacant = Number(req.body?.vacant_units ?? NaN);

  if (!Number.isFinite(occupied) || occupied < 0 || !Number.isFinite(vacant) || vacant < 0) {
    return res.status(400).json({ error: "occupied_units and vacant_units must be non-negative numbers" });
  }

  await setScopedAdminSetting(req.adminProperty.id, "occupied_units_manual", occupied);
  await setScopedAdminSetting(req.adminProperty.id, "vacant_units_manual", vacant);

  res.json({
    success: true,
    overview: await getPortfolioOverviewWithOverrides(req.adminProperty.id),
  });
}));

app.get("/api/admin/units", requireAdminSession, asyncHandler(async (req, res) => {
  const units = await listUnitsForProperty(req.adminProperty.id);
  const tenantMap = new Map((await listUsers({ propertyId: req.adminProperty.id })).map((tenant) => [String(tenant.id), tenant]));
  res.json({
    units: units.map((unit) => ({
      ...unit,
      current_tenant: unit.current_tenant_id ? tenantMap.get(String(unit.current_tenant_id)) || null : null,
      tenant_name: unit.current_tenant_id ? (() => {
        const tenant = tenantMap.get(String(unit.current_tenant_id));
        return tenant ? `${tenant.first_name || ""} ${tenant.last_name || ""}`.trim() || tenant.first_name || "Tenant" : null;
      })() : null,
    })),
  });
}));

app.post("/api/admin/units", requireAdminSession, asyncHandler(async (req, res) => {
  const unitCode = String(req.body?.unit_code || "").trim();
  if (!unitCode) {
    return res.status(400).json({ error: "unit_code is required" });
  }

  const base = await createUnit({
    property_id: req.adminProperty.id,
    unit_code: unitCode,
    floor_number: req.body?.floor_number || null,
    status: req.body?.status || "VACANT",
    tenant_id: req.body?.tenant_id || null,
    current_tenant_id: req.body?.current_tenant_id || null,
    current_tenancy_id: req.body?.current_tenancy_id || null,
    rent_amount: req.body?.rent_amount || "0",
    notes: req.body?.notes || "",
  });

  res.json({ success: true, unit: base });
}));

app.get("/api/admin/units/:unitId/details", requireAdminSession, asyncHandler(async (req, res) => {
  const unit = await getUnitById(req.params.unitId);
  if (!unit || String(unit.property_id || "").trim() !== String(req.adminProperty.id)) {
    return res.status(404).json({ error: "Unit not found" });
  }

  const tenant = unit.current_tenant_id ? await getUserById(unit.current_tenant_id) : null;
  const tenancy = unit.current_tenancy_id ? (await listTenantTenancies(tenant?.id || -1)).find((record) => Number(record.id) === Number(unit.current_tenancy_id)) || null : null;

  res.json({ unit, tenant, tenancy, history: await listTenanciesForProperty(req.adminProperty.id) });
}));

app.get("/api/admin/tenancies", requireAdminSession, asyncHandler(async (req, res) => {
  const tenancies = await listTenanciesForProperty(req.adminProperty.id);
  const userMap = new Map((await listUsers({ propertyId: req.adminProperty.id })).map((user) => [String(user.id), user]));
  const unitMap = new Map((await listUnitsForProperty(req.adminProperty.id)).map((unit) => [String(unit.id), unit]));

  res.json({
    tenancies: tenancies.map((tenancy) => ({
      ...tenancy,
      tenant: userMap.get(String(tenancy.user_id)) || null,
      unit: unitMap.get(String(tenancy.unit_id)) || null,
    })),
  });
}));

app.post("/api/admin/tenancies", requireAdminSession, asyncHandler(async (req, res) => {
  const tenant = await getUserById(req.body?.tenant_id);
  if (!tenant || String(tenant.property_id || "").trim() !== String(req.adminProperty.id)) {
    return res.status(404).json({ error: "Tenant not found" });
  }

  const unit = req.body?.unit_id ? await getUnitById(req.body.unit_id) : null;
  if (unit && String(unit.property_id || "").trim() !== String(req.adminProperty.id)) {
    return res.status(403).json({ error: "Unit does not belong to this property" });
  }

  const tenancy = await createTenancy({
    tenant_id: tenant.id,
    property_id: req.adminProperty.id,
    unit_id: unit ? unit.id : null,
    lease_name: req.body?.lease_name || "Tenancy Agreement",
    start_date: req.body?.start_date || new Date().toISOString(),
    end_date: req.body?.end_date || null,
    monthly_rent: req.body?.monthly_rent || tenant.rent || "0",
    deposit: req.body?.deposit || "0",
    move_in_date: req.body?.move_in_date || req.body?.start_date || new Date().toISOString(),
    move_out_date: req.body?.move_out_date || null,
    status: req.body?.status || "ACTIVE",
    notes: req.body?.notes || "",
    billing_settings: req.body?.billing_settings || null,
    utility_settings: req.body?.utility_settings || null,
  });

  res.json({ success: true, tenancy });
}));

app.get("/api/admin/tenants/:tenantId/details", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserByTenantId(req.params.tenantId);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "User not found" });
  }

  const maintenance = await listMaintenanceForUser(user.id);
  const messages = await listMessagesForUser(user.id);
  const notices = await listVacateNoticesForUser(user.id);
  const payments = await listPaymentRequestsForUser(user.id);
  const transactions = await listTransactionsForUser(user.id);
  const arrears = await listArrearsForUser(user.id);
  const lease = await getActiveLeaseForUser(user.id);
  const tenancyHistory = await listTenantTenancies(user.id);
  const totalRepairCost = maintenance.reduce(
    (sum, item) => sum + (isClosedTicketStatus(item.status) ? Number(item.repair_cost || 0) : 0),
    0
  );

  res.json({
    tenant: sanitizeUser(user),
    summary: {
      unread_messages: messages.filter((item) => item.status === "UNREAD").length,
      open_tickets: maintenance.filter((item) => !isClosedTicketStatus(item.status)).length,
      pending_notices: notices.filter((item) => item.status === "Pending").length,
      pending_payments: payments.filter((item) => paymentStatusOpen(item?.status) || paymentStatusNeedsAdminReview(item?.status)).length,
      total_repair_cost: totalRepairCost,
    },
    bills: await getTenantBillBreakdown(user),
    lease,
    tenancy_history: tenancyHistory,
    messages,
    maintenance,
    notices,
    payments,
    transactions,
    arrears,
  });
}));

app.post("/api/admin/tenants/:tenantId/billing", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserByTenantId(req.params.tenantId);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "User not found" });
  }

  let rent;
  let water;
  let trash;
  let electricity;
  let deposit;

  try {
    rent = parseNonNegativeMoney(req.body?.rent, "rent");
    water = parseNonNegativeMoney(req.body?.water, "water");
    trash = parseNonNegativeMoney(req.body?.trash, "trash");
    electricity = parseNonNegativeMoney(req.body?.electricity, "electricity");
    deposit = parseNonNegativeMoney(req.body?.deposit ?? user.deposit, "deposit");
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const resetAccountBalance = parseBooleanFlag(req.body?.reset_account_balance);
  const updatedTenant = await updateUserBilling(user.id, {
    rent,
    water,
    trash,
    electricity,
    deposit,
    resetAccountBalance,
  });
  const expectedTotal = await getExpectedCollectionTotal(null, req.adminProperty.id);
  await setScopedAdminSetting(req.adminProperty.id, "expected_collection_total", expectedTotal);

  res.json({
    success: true,
    tenant: sanitizeUser(updatedTenant),
    bills: await getTenantBillBreakdown(updatedTenant),
    expected_collection_total: expectedTotal,
    reset_account_balance: resetAccountBalance,
  });
}));

app.post("/api/admin/tenants/balances/bulk", requireAdminSession, asyncHandler(async (req, res) => {
  const action = String(req.body?.action || "").trim().toLowerCase();
  if (!["reset", "rent_due"].includes(action)) {
    return res.status(400).json({ error: "action must be reset or rent_due" });
  }

  const users = await listUsers({ propertyId: req.adminProperty.id });
  if (!users.length) {
    return res.json({
      success: true,
      action,
      applied_count: 0,
      expected_collection_total: 0,
    });
  }

  await applyBulkTenantBalanceAction({
    action,
    userIds: users.map((user) => user.id),
  });

  const expectedTotal = await getExpectedCollectionTotal(null, req.adminProperty.id);
  await setScopedAdminSetting(req.adminProperty.id, "expected_collection_total", expectedTotal);

  res.json({
    success: true,
    action,
    applied_count: users.length,
    expected_collection_total: expectedTotal,
  });
}));

app.post("/api/admin/messages", requireAdminSession, asyncHandler(async (req, res) => {
  const tenantId = req.body?.tenant_id;
  const body = String(req.body?.body || "").trim();
  if (!tenantId || !body) {
    return res.status(400).json({ error: "tenant_id and body are required" });
  }

  const user = await getUserByTenantId(tenantId);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "User not found" });
  }

  await addMessage(user.id, {
    sender_type: "ADMIN",
    sender_name: req.body?.sender_name || "Admin",
    subject: req.body?.subject || "Admin message",
    body,
    category: req.body?.category || "Admin",
  });

  res.json({ success: true, messages: await listMessagesForUser(user.id) });
}));

app.get("/api/admin/messages/:tenantId", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserByTenantId(req.params.tenantId);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ messages: await listMessagesForUser(user.id) });
}));

app.get("/api/admin/messages", requireAdminSession, asyncHandler(async (req, res) => {
  const senderType = req.query.sender_type ? String(req.query.sender_type) : null;
  res.json(await buildAdminMessagesPayload(senderType, req.adminProperty.id));
}));

app.get("/api/admin/documents", requireAdminSession, asyncHandler(async (req, res) => {
  res.json({ documents: await listSharedDocuments({ propertyId: req.adminProperty.id }) });
}));

app.post("/api/admin/documents/shared", requireAdminSession, (req, res, next) => {
  sharedDocumentUpload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "File exceeds 20MB limit" : error.message });
    }
    if (error) {
      return next(error);
    }
    return next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Choose a file to upload" });
  }

  const name = String(req.body?.name || req.file.originalname || "").trim();
  if (!name) {
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: "Document name is required" });
  }

  const category = String(req.body?.category || "General").trim() || "General";
  const status = String(req.body?.status || "AVAILABLE").trim() || "AVAILABLE";
  const relativePath = path.relative(UPLOAD_DIR, req.file.path).replace(/\\/g, "/");
  const url = `/uploads/${relativePath}`;

  try {
    await addSharedDocument({
      property_id: req.adminProperty.id,
      name,
      category,
      status,
      url,
      original_name: req.file.originalname || name,
      stored_path: req.file.path,
    });
  } catch (error) {
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ error: error.message || "Failed to save document" });
  }

  res.json({
    success: true,
    document: (await listSharedDocuments({ propertyId: req.adminProperty.id }))[0] || null,
    documents: await listSharedDocuments({ propertyId: req.adminProperty.id }),
  });
}));

app.get("/api/admin/vacating-notices", requireAdminSession, asyncHandler(async (req, res) => {
  res.json(await buildAdminVacatingNoticesPayload(null, req.adminProperty.id));
}));

app.post("/api/admin/vacating-notices/:id/review", requireAdminSession, asyncHandler(async (req, res) => {
  const notice = await getVacateNoticeById(req.params.id);
  if (!notice) {
    return res.status(404).json({ error: "Vacating notice not found" });
  }

  const user = await getUserById(notice.user_id);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "Vacating notice not found" });
  }

  const status = String(req.body?.status || "").trim();
  if (!["APPROVED", "DISAPPROVED"].includes(status)) {
    return res.status(400).json({ error: "status must be APPROVED or DISAPPROVED" });
  }
  if (["APPROVED", "DISAPPROVED"].includes(String(notice.status || "").toUpperCase())) {
    return res.status(400).json({ error: "Vacating notice has already been reviewed" });
  }

  const updated = await updateVacateNoticeStatus(notice.id, status, req.body?.review_note || "");
  res.json({ success: true, notice: updated });
}));

app.get("/api/admin/payments", requireAdminSession, asyncHandler(async (req, res) => {
  res.json(await buildAdminPaymentsPayload(null, req.adminProperty.id));
}));

app.post("/api/admin/payments/targets", requireAdminSession, asyncHandler(async (req, res) => {
  const expected = Number(req.body?.expected_collection_total ?? NaN);
  const acquired = Number(req.body?.acquired_collection_total ?? NaN);

  if (!Number.isFinite(expected) || !Number.isFinite(acquired)) {
    return res.status(400).json({ error: "expected_collection_total and acquired_collection_total must be numbers" });
  }

  await setScopedAdminSetting(req.adminProperty.id, "expected_collection_total", expected);
  await setScopedAdminSetting(req.adminProperty.id, "acquired_collection_total", acquired);

  res.json({
    success: true,
    summary: {
      expected_collection_total: expected,
      acquired_collection_total: acquired,
      variance: acquired - expected,
    },
  });
}));

app.post("/api/admin/payments/config", requireAdminSession, asyncHandler(async (req, res) => {
  const rent = Number(req.body?.rent ?? NaN);
  const water = Number(req.body?.water ?? NaN);
  const trash = Number(req.body?.trash ?? NaN);
  const electricity = Number(req.body?.electricity ?? NaN);
  const tenantIds = Array.isArray(req.body?.tenant_ids)
    ? [...new Set(req.body.tenant_ids.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];

  if (![rent, water, trash, electricity].every(Number.isFinite)) {
    return res.status(400).json({ error: "rent, water, trash, and electricity must be numbers" });
  }
  if (!tenantIds.length) {
    return res.status(400).json({ error: "Select at least one tenant to apply bills to" });
  }

  const selectedUsers = (await Promise.all(tenantIds.map((tenantId) => getUserByTenantId(tenantId)))).filter(Boolean);

  if (selectedUsers.length !== tenantIds.length || selectedUsers.some((user) => !assertUserInAdminProperty(user, req))) {
    return res.status(400).json({ error: "One or more selected tenants could not be found" });
  }

  await setScopedAdminSetting(req.adminProperty.id, "billing_rent", rent);
  await setScopedAdminSetting(req.adminProperty.id, "billing_water", water);
  await setScopedAdminSetting(req.adminProperty.id, "billing_trash", trash);
  await setScopedAdminSetting(req.adminProperty.id, "billing_electricity", electricity);
  await applyGlobalBilling({
    rent,
    water,
    trash,
    electricity,
    userIds: selectedUsers.map((user) => user.id),
  });
  const expectedTotal = await getExpectedCollectionTotal(null, req.adminProperty.id);
  await setScopedAdminSetting(req.adminProperty.id, "expected_collection_total", expectedTotal);

  res.json({
    success: true,
    billing: await getBillingConfig(req.adminProperty.id),
    expected_collection_total: expectedTotal,
    applied_count: selectedUsers.length,
    applied_tenant_ids: tenantIds,
  });
}));

app.get("/api/admin/payments/statement", requireAdminSession, asyncHandler(async (req, res) => {
  let monthKey;
  try {
    monthKey = parseLedgerMonthKey(req.query.month || getCurrentLedgerMonthKey());
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const floorNumber = normalizeFloorValue(req.query.floor);
  res.json(await buildMonthlyLedgerPayload(req.adminProperty.id, monthKey, floorNumber));
}));

app.patch("/api/admin/payments/statement/:userId", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserById(req.params.userId);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "Tenant not found" });
  }

  let monthKey;
  let deposit;
  let rentBill;
  let openingBalanceOverride;
  try {
    monthKey = parseLedgerMonthKey(req.body?.month_key || getCurrentLedgerMonthKey());
    deposit = parseOptionalLedgerNumber(req.body?.deposit, "deposit", { allowNegative: false, emptyValue: 0 });
    rentBill = parseOptionalLedgerNumber(req.body?.rent_bill, "rent_bill", { allowNegative: false, emptyValue: 0 });
    openingBalanceOverride = parseOptionalLedgerNumber(req.body?.opening_balance_override, "opening_balance_override", {
      allowNegative: true,
      emptyValue: null,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  await upsertMonthlyStatement(user.id, {
    property_id: req.adminProperty.id,
    month_key: monthKey,
    opening_balance_override: Object.prototype.hasOwnProperty.call(req.body || {}, "opening_balance_override")
      ? openingBalanceOverride
      : undefined,
    deposit: Object.prototype.hasOwnProperty.call(req.body || {}, "deposit") ? deposit : undefined,
    rent_bill: Object.prototype.hasOwnProperty.call(req.body || {}, "rent_bill") ? rentBill : undefined,
    remarks: Object.prototype.hasOwnProperty.call(req.body || {}, "remarks") ? String(req.body?.remarks || "") : undefined,
  });

  const payload = await buildMonthlyLedgerPayload(req.adminProperty.id, monthKey, normalizeFloorValue(user.floor_number));
  res.json({
    success: true,
    row: payload.rows.find((row) => Number(row.user_id) === Number(user.id)) || null,
  });
}));

app.post("/api/admin/payments/statement/:userId/payments", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserById(req.params.userId);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "Tenant not found" });
  }

  let monthKey;
  let amount;
  try {
    monthKey = parseLedgerMonthKey(req.body?.month_key || getCurrentLedgerMonthKey());
    amount = parseOptionalLedgerNumber(req.body?.amount, "amount", { allowNegative: false, emptyValue: 0 });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "amount must be greater than zero" });
  }

  await addMonthlyPaymentEntry(user.id, {
    property_id: req.adminProperty.id,
    month_key: monthKey,
    amount,
    payment_date: req.body?.payment_date ? new Date(req.body.payment_date).toISOString() : new Date().toISOString(),
    receipt_number: String(req.body?.receipt_number || "").trim() || null,
    remarks: String(req.body?.remarks || "").trim(),
  });

  const payload = await buildMonthlyLedgerPayload(req.adminProperty.id, monthKey, normalizeFloorValue(user.floor_number));
  res.json({
    success: true,
    row: payload.rows.find((row) => Number(row.user_id) === Number(user.id)) || null,
  });
}));

app.get("/api/admin/utilities", requireAdminSession, asyncHandler(async (req, res) => {
  let monthKey;
  try {
    monthKey = parseLedgerMonthKey(req.query.month || getCurrentLedgerMonthKey());
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const floorNumber = normalizeFloorValue(req.query.floor);
  res.json(await buildMonthlyLedgerPayload(req.adminProperty.id, monthKey, floorNumber));
}));

app.post("/api/admin/utilities/water-rate", requireAdminSession, asyncHandler(async (req, res) => {
  let rate;
  try {
    rate = parseOptionalLedgerNumber(req.body?.rate, "rate", { allowNegative: false, emptyValue: 0 });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  await setScopedAdminSetting(req.adminProperty.id, "utility_water_rate", rate);
  res.json({ success: true, rate });
}));

app.put("/api/admin/utilities/water/:userId", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserById(req.params.userId);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "Tenant not found" });
  }

  let monthKey;
  let previousReading;
  let latestReading;
  const propertyWaterRate = Number((await getScopedAdminSetting(req.adminProperty.id, "utility_water_rate", "0")) || 0);
  try {
    monthKey = parseLedgerMonthKey(req.body?.month_key || getCurrentLedgerMonthKey());
    previousReading = parseOptionalLedgerNumber(req.body?.previous_reading, "previous_reading", { allowNegative: false, emptyValue: 0 });
    latestReading = parseOptionalLedgerNumber(req.body?.latest_reading, "latest_reading", { allowNegative: false, emptyValue: 0 });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (latestReading < previousReading) {
    return res.status(400).json({ error: "latest_reading must be greater than or equal to previous_reading" });
  }

  await upsertMonthlyWaterReading(user.id, {
    property_id: req.adminProperty.id,
    month_key: monthKey,
    previous_reading: previousReading,
    latest_reading: latestReading,
    rate: propertyWaterRate,
  });

  const payload = await buildMonthlyLedgerPayload(req.adminProperty.id, monthKey, normalizeFloorValue(user.floor_number));
  res.json({
    success: true,
    row: payload.rows.find((row) => Number(row.user_id) === Number(user.id)) || null,
  });
}));

app.post("/api/admin/utilities/garbage", requireAdminSession, asyncHandler(async (req, res) => {
  let monthKey;
  let amount;
  try {
    monthKey = parseLedgerMonthKey(req.body?.month_key || getCurrentLedgerMonthKey());
    amount = parseOptionalLedgerNumber(req.body?.amount, "amount", { allowNegative: false, emptyValue: 0 });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const scope = String(req.body?.scope || "tenant").trim().toLowerCase();
  const users = await listUsers({ propertyId: req.adminProperty.id });
  let scopedUsers = [];

  if (scope === "tenant") {
    const user = await getUserById(req.body?.user_id);
    if (!assertUserInAdminProperty(user, req)) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    scopedUsers = [user];
  } else if (scope === "floor") {
    const floorNumber = normalizeFloorValue(req.body?.floor_number);
    if (!floorNumber) {
      return res.status(400).json({ error: "floor_number is required for floor scope" });
    }
    scopedUsers = users.filter((user) => String(user.floor_number || "").trim() === floorNumber);
  } else if (scope === "all") {
    scopedUsers = users;
  } else {
    return res.status(400).json({ error: "scope must be tenant, floor, or all" });
  }

  if (!scopedUsers.length) {
    return res.status(400).json({ error: "No tenants matched the selected garbage scope" });
  }

  await setMonthlyGarbageAmount({
    property_id: req.adminProperty.id,
    month_key: monthKey,
    user_ids: scopedUsers.map((user) => user.id),
    amount,
  });

  const floorForRefresh = scope === "tenant"
    ? normalizeFloorValue(scopedUsers[0]?.floor_number)
    : scope === "floor"
      ? normalizeFloorValue(req.body?.floor_number)
      : normalizeFloorValue(req.body?.active_floor_number);
  const payload = await buildMonthlyLedgerPayload(req.adminProperty.id, monthKey, floorForRefresh);
  res.json({
    success: true,
    applied_count: scopedUsers.length,
    rows: payload.rows,
  });
}));

app.post("/api/admin/payments/:id/review", requireAdminSession, asyncHandler(async (req, res) => {
  const payment = await getPaymentRequestById(req.params.id);
  if (!payment) {
    return res.status(404).json({ error: "Payment not found" });
  }

  const user = await getUserById(payment.user_id);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "Payment not found" });
  }

  const status = String(req.body?.status || "").trim();
  if (!["APPROVED", "DISAPPROVED"].includes(status)) {
    return res.status(400).json({ error: "status must be APPROVED or DISAPPROVED" });
  }
  if (!paymentStatusNeedsAdminReview(payment.status)) {
    return res.status(400).json({ error: "Only tenant-submitted manual confirmations can be reviewed here." });
  }
  if (["APPROVED", "DISAPPROVED"].includes(String(payment.status || "").toUpperCase())) {
    return res.status(400).json({ error: "Payment has already been reviewed" });
  }

  const reviewNote = String(req.body?.review_note || "").trim();
  const updated = await updatePaymentRequestStatus(payment.id, status, reviewNote);

  if (status === "APPROVED") {
    const refreshed = await adjustUserBalance(payment.user_id, payment.payment_for, payment.amount);
    const acquiredCollection =
      Number((await getScopedAdminSetting(req.adminProperty.id, "acquired_collection_total", "0")) || 0) + Number(payment.amount || 0);
    await setScopedAdminSetting(req.adminProperty.id, "acquired_collection_total", acquiredCollection);
    await addTransaction(payment.user_id, {
      amount: payment.amount,
      date_created: new Date().toISOString(),
      type: `${payment.payment_for || "Payment"} Payment`,
      description: `Approved ${payment.method} payment ${payment.reference || ""}`.trim(),
    });
    await addMessage(payment.user_id, {
      sender_type: "SYSTEM",
      sender_name: "Billing Desk",
      subject: "Payment Approved",
      category: "Payments",
      body:
        `Dear ${user?.first_name || "Tenant"},\n\n` +
        `Your payment of KSH ${Number(payment.amount || 0).toFixed(2)} for ${payment.payment_for || "RENT"} has been approved.\n` +
        `Remaining balance: KSH ${Number(refreshed?.account_balance || 0).toFixed(2)}.\n\nRegards,\nOtic Apartments Team`,
    });
  }

  if (status === "DISAPPROVED") {
    await addMessage(payment.user_id, {
      sender_type: "SYSTEM",
      sender_name: "Billing Desk",
      subject: "Payment Not Approved",
      category: "Payments",
      body:
        `Dear ${user?.first_name || "Tenant"},\n\n` +
        "Your submitted payment could not be approved yet. Please contact admin if you need help.\n\nRegards,\nOtic Apartments Team",
    });
  }

  await recalculateUserFinancials(payment.user_id);
  res.json({ success: true, payment: updated });
}));

app.get("/api/admin/tickets", requireAdminSession, asyncHandler(async (req, res) => {
  res.json(await buildAdminTicketsPayload(null, req.adminProperty.id));
}));

app.post("/api/admin/tickets/:id/status", requireAdminSession, asyncHandler(async (req, res) => {
  const normalizedStatus = String(req.body?.status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const status = {
    pending: "Pending",
    "in progress": "In Progress",
    solved: "Solved",
    resolved: "Solved",
  }[normalizedStatus];

  if (!status) {
    return res.status(400).json({ error: "Invalid ticket status" });
  }

  let repairCost = null;
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "repair_cost")) {
      repairCost = parseNonNegativeMoney(req.body?.repair_cost, "repair_cost");
    } else if (status === "Solved") {
      repairCost = "0";
    }
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const existingTicket = await getMaintenanceTicketById(req.params.id);
  if (!existingTicket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const user = await getUserById(existingTicket.user_id);
  if (!assertUserInAdminProperty(user, req)) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const ticket = await updateMaintenanceTicketStatus(
    req.params.id,
    status,
    req.body?.technician_name || null,
    repairCost
  );
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  res.json({ success: true, ticket });
}));

app.get("/", (req, res) => {
  res.redirect("/secure-admin/login");
});

app.get("/secure-admin", (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(FRONTEND_DIR, "admin.html"));
});

app.get("/secure-admin/login", (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(FRONTEND_DIR, "admin-login.html"));
});

app.get("/admin", (req, res) => {
  res.redirect("/secure-admin/login");
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database_provider: DATABASE_PROVIDER,
  });
});

app.get("/404", (req, res) => {
  res.status(404).sendFile(path.join(FRONTEND_DIR, "404.html"));
});

app.get("/500", (req, res) => {
  res.status(500).sendFile(path.join(FRONTEND_DIR, "500.html"));
});

app.use(express.static(FRONTEND_DIR));

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  console.error(error);
  if (req.path.startsWith("/api/")) {
    res.status(500).json({ error: error.message || "Internal server error" });
    return;
  }

  res.status(500).sendFile(path.join(FRONTEND_DIR, "500.html"));
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

app.get("*", (req, res) => {
  res.status(404).sendFile(path.join(FRONTEND_DIR, "404.html"));
});

function checkPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();

    tester.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(err);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port);
  });
}

async function findAvailablePort(startPort, attempts = 10) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (await checkPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available port found between ${startPort} and ${startPort + attempts - 1}`);
}

async function startServer() {
  const preferredPort = Number(process.env.PORT) || 3000;
  const port = await findAvailablePort(preferredPort);

  app.listen(port, () => {
    if (port !== preferredPort) {
      console.log(`Port ${preferredPort} is busy, using http://localhost:${port} instead.`);
    }
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
