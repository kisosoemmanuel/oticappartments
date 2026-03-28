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
  addSharedDocument,
  addMaintenanceTicket,
  addMessage,
  addPaymentRequest,
  addVacateNotice,
  adjustUserBalance,
  applyGlobalBilling,
  createUser,
  DATABASE_PROVIDER,
  DATABASE_PATH,
  deleteUserById,
  getPaymentRequestById,
  getAdminSetting,
  getActiveLeaseForUser,
  getPortfolioOverview,
  getUserByTenantId,
  getVacateNoticeById,
  listArrearsForUser,
  listAllMaintenanceTickets,
  listAllPaymentRequests,
  listDocumentsForUser,
  listLeasesForUser,
  listAllMessages,
  listMaintenanceForUser,
  listMessagesForUser,
  listPaymentRequestsForUser,
  listUsersByFirstName,
  listSharedDocuments,
  listStoredAlertsForUser,
  listTransactionsForUser,
  listUsers,
  listVacateNoticesForUser,
  recalculateUserFinancials,
  setAdminSetting,
  updateMaintenanceTicketStatus,
  updatePaymentRequestStatus,
  updateUserToken,
  updateUserProfile,
  updateVacateNoticeStatus,
  verifyPassword,
  addTransaction,
} from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const DEFAULT_BACKUP_SECRET = "otic-local-backup-secret";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const BACKUP_SECRET = process.env.BACKUP_SECRET || DEFAULT_BACKUP_SECRET;
const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(__dirname, "backups");
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, "uploads");
const DOCUMENT_UPLOAD_DIR = path.join(UPLOAD_DIR, "documents");
const ADMIN_SESSION_COOKIE = "otic_admin_session";
const MPESA_PAYBILL_NUMBER = "222111";
const MPESA_ACCOUNT_NUMBER = "024000000880";
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
  const response = { ...user };
  delete response.account_number_hash;
  return response;
}

function sanitizeTenantMaintenanceTicket(ticket) {
  const response = { ...ticket };
  delete response.repair_cost;
  return response;
}

async function buildAutomatedAlerts(user) {
  const generated = [];
  const arrearsAmount = Number(user.arrears || 0);
  if (arrearsAmount > 0) {
    generated.push({
      id: `auto-overdue-${user.id}`,
      type: "overdue",
      title: "Overdue balance alert",
      message: `Your account has an overdue balance of KES ${arrearsAmount.toLocaleString()}.`,
      severity: "critical",
      status: "ACTIVE",
      trigger_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      source: "system",
    });
  }

  const activeLease = await getActiveLeaseForUser(user.id);
  if (activeLease?.end_date) {
    const now = new Date();
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

  generated.push({
    id: `auto-rent-${user.id}`,
    type: "rent_reminder",
    title: "Upcoming rent reminder",
    message: "Rent reminders are active for the 5th of every month.",
    severity: "info",
    status: "ACTIVE",
    trigger_date: null,
    created_at: new Date().toISOString(),
    source: "system",
  });

  return generated;
}

function paymentMethodsFor(user) {
  return [
    {
      id: "mpesa-paybill",
      label: "M-PESA Paybill",
      provider: "Safaricom",
      description: `Pay via Paybill ${MPESA_PAYBILL_NUMBER} using account ${MPESA_ACCOUNT_NUMBER}.`,
      enabled: true,
      prefill: user.phone_number || "",
      paybill_number: MPESA_PAYBILL_NUMBER,
      account_number: MPESA_ACCOUNT_NUMBER,
    },
  ];
}

async function getBillingConfig() {
  return {
    rent: Number((await getAdminSetting("billing_rent", "0")) || 0),
    water: Number((await getAdminSetting("billing_water", "0")) || 0),
    trash: Number((await getAdminSetting("billing_trash", "0")) || 0),
    electricity: Number((await getAdminSetting("billing_electricity", "0")) || 0),
  };
}

async function getOccupancyConfig() {
  const occupied = Number((await getAdminSetting("occupied_units_manual", "")) || NaN);
  const vacant = Number((await getAdminSetting("vacant_units_manual", "")) || NaN);
  return {
    occupied_units: Number.isFinite(occupied) ? occupied : null,
    vacant_units: Number.isFinite(vacant) ? vacant : null,
  };
}

async function getPortfolioOverviewWithOverrides() {
  const base = await getPortfolioOverview();
  const occupancy = await getOccupancyConfig();
  const occupied = occupancy.occupied_units ?? base.occupied_units;
  const vacant = occupancy.vacant_units ?? base.vacant_units;
  return {
    ...base,
    occupied_units: occupied,
    vacant_units: vacant,
    total_units: occupied + vacant,
  };
}

async function getTenantBillBreakdown(user) {
  const config = await getBillingConfig();
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

async function getExpectedCollectionTotal(users = null) {
  const resolvedUsers = users || (await listUsers());
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

function createAdminSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  adminSessions.set(token, {
    username,
    created_at: new Date().toISOString(),
  });
  return token;
}

function clearAdminSession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (token) {
    adminSessions.delete(token);
  }
  res.cookie(ADMIN_SESSION_COOKIE, "", {
    ...adminCookieOptions,
    expires: new Date(0),
  });
}

function requireAdminSession(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.adminSession = adminSessions.get(token);
  next();
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

  return user;
}

createEncryptedBackup();

app.post("/api/pegasus/visionary/tenant/app/login", asyncHandler(async (req, res) => {
  const { first_name, account_number } = req.body || {};
  if (!first_name || !account_number) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const user = (await listUsersByFirstName(first_name)).find((item) =>
    verifyPassword(account_number, item.account_number_hash)
  );
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const access_token = crypto.randomBytes(24).toString("hex");
  await updateUserToken(user.id, access_token);

  const refreshedUser = await getUserByTenantId(user.tenant_id);
  res.json({ ...sanitizeUser(refreshedUser), access_token });
}));

app.use("/uploads", express.static(UPLOAD_DIR));

app.post("/api/pegasus/visionary/tenant/app/tenantDetails", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  res.json(sanitizeUser(user));
}));

app.post("/api/pegasus/visionary/tenant/app/profile/update", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;

  const updated = await updateUserProfile(user.id, {
    first_name: String(req.body?.first_name || user.first_name || "").trim(),
    last_name: String(req.body?.last_name || user.last_name || "").trim(),
    phone_number: String(req.body?.phone_number || user.phone_number || "").trim(),
    email_address: String(req.body?.email_address || user.email_address || "").trim(),
    national_id: String(req.body?.national_id || user.national_id || "").trim(),
  });

  res.json({ success: true, user: sanitizeUser(updated) });
}));

app.post("/api/pegasus/visionary/tenant/app/dashboardOverview", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;

  const lease = await getActiveLeaseForUser(user.id);
  const alerts = [...(await buildAutomatedAlerts(user)), ...(await listStoredAlertsForUser(user.id))].slice(0, 5);
  const maintenance = await listMaintenanceForUser(user.id);
  const messages = await listMessagesForUser(user.id);
  const vacateNotices = await listVacateNoticesForUser(user.id);
  const payments = await listPaymentRequestsForUser(user.id);
  const bills = await getTenantBillBreakdown(user);
  res.json({
    portfolio: await getPortfolioOverviewWithOverrides(),
    tenant: {
      rent_status: bills.total > 0 ? "Outstanding" : "Current",
      active_lease: Boolean(lease),
      lease_end_date: lease?.end_date || null,
      next_payment_target: bills.total,
      open_maintenance_count: maintenance.filter((item) => !["Resolved", "Solved"].includes(item.status)).length,
      unread_messages: messages.filter((item) => item.status === "UNREAD").length,
      vacate_notice_status: vacateNotices[0]?.status || "Not Submitted",
      latest_payment_reference: payments[0]?.reference || null,
    },
    alerts,
  });
}));

app.post("/api/pegasus/visionary/tenant/get/tenant/arrears", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  res.json(await listArrearsForUser(user.id));
}));

app.post("/api/pegasus/visionary/tenant/get/tenant/transactions", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  res.json(await listTransactionsForUser(user.id));
}));

app.post("/api/pegasus/visionary/tenant/payments/options", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  const bills = await getTenantBillBreakdown(user);
  res.json({
    methods: paymentMethodsFor(user),
    history: await listPaymentRequestsForUser(user.id),
    bill_breakdown: bills,
    instructions: {
      paybill_number: MPESA_PAYBILL_NUMBER,
      account_number: MPESA_ACCOUNT_NUMBER,
      steps: [
        "Open M-PESA on your phone.",
        `Select Pay Bill and enter ${MPESA_PAYBILL_NUMBER}.`,
        `Use ${MPESA_ACCOUNT_NUMBER} as the account number.`,
        "Enter the amount you are paying and complete the transaction.",
        "Return to the portal and submit the M-PESA confirmation code for verification.",
      ],
    },
  });
}));

app.post("/api/pegasus/visionary/tenant/app/alerts/get", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  res.json([...(await buildAutomatedAlerts(user)), ...(await listStoredAlertsForUser(user.id))]);
}));

app.post("/api/pegasus/visionary/tenant/app/messages/get", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  res.json({ messages: await listMessagesForUser(user.id) });
}));

app.post("/api/pegasus/visionary/tenant/app/messages/send", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;

  const body = String(req.body?.body || "").trim();
  if (!body) {
    return res.status(400).json({ error: "body is required" });
  }

  await addMessage(user.id, {
    sender_type: "TENANT",
    sender_name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.first_name,
    subject: req.body?.subject || "Tenant message",
    body,
    category: req.body?.category || "Tenant",
    status: "UNREAD",
  });

  res.json({ success: true, messages: await listMessagesForUser(user.id) });
}));

app.post("/api/pegasus/visionary/tenant/app/AddNotice", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;

  const moveOutDate = String(req.body?.move_out_date || "").trim();
  if (!moveOutDate) {
    return res.status(400).json({ error: "move_out_date is required" });
  }

  await addVacateNotice(user.id, {
    move_out_date: moveOutDate,
    reason: req.body?.reason || "",
    forwarding_address: req.body?.forwarding_address || "",
    phone_number: req.body?.phone_number || user.phone_number || "",
    status: "Pending",
  });

  await addAlert(user.id, {
    type: "vacating_notice",
    title: "Vacating notice submitted",
    message: `Your vacating notice for ${moveOutDate} has been received.`,
    severity: "info",
    trigger_date: new Date().toISOString(),
  });

  await addMessage(user.id, {
    sender_type: "SYSTEM",
    sender_name: "Tenancy Desk",
    subject: "Vacating notice received",
    category: "Tenancy",
    body:
      `Dear ${user.first_name || "Tenant"},\n\n` +
      `We have received your vacating notice for ${moveOutDate}.\n` +
      "Our team will contact you to coordinate inspection and final settlement.\n\nRegards,\nOtic Apartments Team",
  });

  res.json({ success: true, notices: await listVacateNoticesForUser(user.id) });
}));

app.post("/api/pegasus/visionary/authorization/admin/delete/specific/tenant/notices", (req, res) => {
  res.json({ success: true });
});

app.post("/api/pegasus/visionary/agreements/fetch", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  const leases = (await listLeasesForUser(user.id)).map((lease) => ({
    ...lease,
    agreement_title: lease.lease_name,
  }));
  res.json({ agreements: leases });
}));

app.post("/api/pegasus/visionary/lease/active", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  const lease = await getActiveLeaseForUser(user.id);
  res.json({ has_active_lease: Boolean(lease), lease_details: lease });
}));

app.post("/api/pegasus/visionary/lease/history", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  res.json({ lease_history: await listLeasesForUser(user.id) });
}));

app.post("/api/pegasus/visionary/mpesa/StkPush", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;

  const amount = String(req.body?.amount || user.rent || "0");
  const method = "M-PESA Paybill";
  const phone_number = req.body?.phone_number || user.phone_number || "";
  const reference = String(req.body?.reference || "").trim() || `MPESA-PENDING-${Date.now()}`;
  const payment_for = String(req.body?.payment_for || "RENT").toUpperCase();

  await addPaymentRequest(user.id, {
    method,
    amount,
    phone_number,
    reference,
    payment_for,
    status: "PENDING_CONFIRMATION",
    note:
      req.body?.note ||
        `Tenant reported a Paybill payment to ${MPESA_PAYBILL_NUMBER} account ${MPESA_ACCOUNT_NUMBER}.`,
  });

  await addAlert(user.id, {
    type: "payment",
    title: "Payment submitted for verification",
    message: `Your M-PESA Paybill payment of KES ${Number(amount || 0).toLocaleString()} has been submitted and is awaiting confirmation.`,
    severity: "info",
    trigger_date: new Date().toISOString(),
  });

  await addMessage(user.id, {
    sender_type: "SYSTEM",
    sender_name: "Billing Desk",
    subject: "Paybill payment submitted",
    category: "Payments",
    body:
      `Dear ${user.first_name || "Tenant"},\n\n` +
      `We have received your Paybill payment confirmation for KSH: ${Number(amount || 0).toFixed(2)}.\n` +
      `M-PESA Code: ${reference}\n` +
      `Payment For: ${payment_for}\n` +
      `Paybill: ${MPESA_PAYBILL_NUMBER}\n` +
      `Account: ${MPESA_ACCOUNT_NUMBER}\n\n` +
      "Our team will verify the payment and update your account shortly.",
  });

  res.json({
    success: true,
    Message: "Payment confirmation submitted successfully",
    reference,
    method,
  });
}));

app.post("/api/pegasus/visionary/tenant/arrear/dirty", (req, res) => {
  res.json({ success: true });
});

app.post("/api/pegasus/visionary/tenant/app/tenant/ID/upload", (req, res) => {
  res.json({ success: true });
});

app.post("/api/pegasus/visionary/tenant/fetch/documents", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  res.json({ success: true, documents: await listDocumentsForUser(user.id) });
}));

app.post("/api/pegasus/visionary/tickets/api/tickets/get/tenant", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  res.json({ tickets: (await listMaintenanceForUser(user.id)).map(sanitizeTenantMaintenanceTicket) });
}));

app.post("/api/pegasus/visionary/tickets/api/tickets/create", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;

  const title = String(req.body?.title || "").trim();
  if (!title) {
    return res.status(400).json({ error: "title is required" });
  }

  await addMaintenanceTicket(user.id, {
    title,
    description: req.body?.description || "",
    priority: req.body?.priority || "Medium",
    status: "Pending",
    technician_name: req.body?.technician_name || null,
  });

  await addAlert(user.id, {
    type: "maintenance",
    title: "Maintenance request created",
    message: `Your request "${title}" has been logged for follow-up.`,
    severity: "info",
    trigger_date: new Date().toISOString(),
  });

  res.json({ success: true, tickets: (await listMaintenanceForUser(user.id)).map(sanitizeTenantMaintenanceTicket) });
}));

app.post("/api/pegasus/visionary/tenant/app/security/status", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;

  res.json({
    encrypted_password_storage: true,
    token_based_auth: true,
    encrypted_backup: DATABASE_PROVIDER === "sqlite",
    backups: getBackupStats(),
    note:
      DATABASE_PROVIDER === "sqlite"
        ? "Account passwords are hashed, tokens are validated per session, and local database backups are encrypted with AES-256-GCM."
        : "Account passwords are hashed, tokens are validated per session, and Postgres is used as the primary database.",
  });
}));

app.post("/api/pegasus/visionary/tenant/app/vacating/get", asyncHandler(async (req, res) => {
  const user = await validateAuth(req, res);
  if (!user) return;
  res.json({ notices: await listVacateNoticesForUser(user.id) });
}));

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }

  const token = createAdminSession(username);
  res.cookie(ADMIN_SESSION_COOKIE, token, {
    ...adminCookieOptions,
    maxAge: 1000 * 60 * 60 * 12,
  });
  res.json({ success: true, username });
});

app.post("/api/admin/logout", (req, res) => {
  clearAdminSession(req, res);
  res.json({ success: true });
});

app.get("/api/admin/session", requireAdminSession, (req, res) => {
  res.json({ authenticated: true, username: req.adminSession.username });
});

app.get("/api/admin/users", requireAdminSession, asyncHandler(async (req, res) => {
  res.json({ users: (await listUsers()).map((user) => sanitizeUser(user)) });
}));

app.post("/api/admin/users", requireAdminSession, asyncHandler(async (req, res) => {
  const { first_name, last_name, account_number, ...rest } = req.body || {};
  if (!first_name || !account_number) {
    return res.status(400).json({ error: "first_name and account_number are required" });
  }

  try {
    const user = await createUser({ first_name, last_name, account_number, ...rest });
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.delete("/api/admin/users/:tenantId", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserByTenantId(req.params.tenantId);
  if (!user) return res.status(404).json({ error: "User not found" });
  await deleteUserById(user.id);
  res.json({ success: true });
}));

app.get("/api/admin/overview", requireAdminSession, asyncHandler(async (req, res) => {
  const users = await listUsers();
  const floors = [...new Set(users.map((user) => user.floor_number).filter(Boolean))].sort();
  const tenantMessages = await listAllMessages({ sender_type: "TENANT" });
  const pendingNoticesNested = await Promise.all(
    users.map(async (tenant) => (await listVacateNoticesForUser(tenant.id)).filter((notice) => notice.status === "Pending"))
  );
  const pendingNotices = pendingNoticesNested.flat();
  const tickets = await listAllMaintenanceTickets();
  const expectedCollection = Number((await getAdminSetting("expected_collection_total", "0")) || 0);
  const acquiredCollection = Number((await getAdminSetting("acquired_collection_total", "0")) || 0);

  res.json({
    overview: await getPortfolioOverviewWithOverrides(),
    security: getBackupStats(),
    stats: {
      total_users: users.length,
      total_floors: floors.length,
      tenant_messages: tenantMessages.length,
      pending_notices: pendingNotices.length,
      open_tickets: tickets.filter((ticket) => !isClosedTicketStatus(ticket.status)).length,
    },
    payments: {
      expected_collection_total: expectedCollection,
      acquired_collection_total: acquiredCollection,
      variance: acquiredCollection - expectedCollection,
    },
    floors,
  });
}));

app.post("/api/admin/occupancy", requireAdminSession, asyncHandler(async (req, res) => {
  const occupied = Number(req.body?.occupied_units ?? NaN);
  const vacant = Number(req.body?.vacant_units ?? NaN);

  if (!Number.isFinite(occupied) || occupied < 0 || !Number.isFinite(vacant) || vacant < 0) {
    return res.status(400).json({ error: "occupied_units and vacant_units must be non-negative numbers" });
  }

  await setAdminSetting("occupied_units_manual", occupied);
  await setAdminSetting("vacant_units_manual", vacant);

  res.json({
    success: true,
    overview: await getPortfolioOverviewWithOverrides(),
  });
}));

app.get("/api/admin/tenants/:tenantId/details", requireAdminSession, asyncHandler(async (req, res) => {
  const user = await getUserByTenantId(req.params.tenantId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const maintenance = await listMaintenanceForUser(user.id);
  const messages = await listMessagesForUser(user.id);
  const notices = await listVacateNoticesForUser(user.id);
  const payments = await listPaymentRequestsForUser(user.id);
  const transactions = await listTransactionsForUser(user.id);
  const arrears = await listArrearsForUser(user.id);
  const lease = await getActiveLeaseForUser(user.id);
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
      pending_payments: payments.filter((item) => item.status === "PENDING_CONFIRMATION").length,
      total_repair_cost: totalRepairCost,
    },
    bills: await getTenantBillBreakdown(user),
    lease,
    messages,
    maintenance,
    notices,
    payments,
    transactions,
    arrears,
  });
}));

app.post("/api/admin/messages", requireAdminSession, asyncHandler(async (req, res) => {
  const tenantId = req.body?.tenant_id;
  const body = String(req.body?.body || "").trim();
  if (!tenantId || !body) {
    return res.status(400).json({ error: "tenant_id and body are required" });
  }

  const user = await getUserByTenantId(tenantId);
  if (!user) {
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
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ messages: await listMessagesForUser(user.id) });
}));

app.get("/api/admin/messages", requireAdminSession, asyncHandler(async (req, res) => {
  const senderType = req.query.sender_type ? String(req.query.sender_type) : null;
  res.json({ messages: await listAllMessages({ sender_type: senderType }) });
}));

app.get("/api/admin/documents", requireAdminSession, asyncHandler(async (_req, res) => {
  res.json({ documents: await listSharedDocuments() });
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
    document: (await listSharedDocuments())[0] || null,
    documents: await listSharedDocuments(),
  });
}));

app.get("/api/admin/vacating-notices", requireAdminSession, asyncHandler(async (req, res) => {
  const users = await listUsers();
  const noticesNested = await Promise.all(
    users.map(async (tenant) =>
      (await listVacateNoticesForUser(tenant.id)).map((notice) => ({
        ...notice,
        tenant_name: `${tenant.first_name || ""} ${tenant.last_name || ""}`.trim() || tenant.first_name,
        tenant_id: tenant.tenant_id,
        house_number: tenant.house_number,
        property_name: tenant.property_name,
      }))
    )
  );
  const notices = noticesNested.flat();

  res.json({ notices });
}));

app.post("/api/admin/vacating-notices/:id/review", requireAdminSession, asyncHandler(async (req, res) => {
  const notice = await getVacateNoticeById(req.params.id);
  if (!notice) {
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
  const users = await listUsers();
  const billing = await getBillingConfig();
  const expectedCollection = Number((await getAdminSetting("expected_collection_total", "0")) || 0);
  const acquiredCollection = Number((await getAdminSetting("acquired_collection_total", "0")) || 0);
  const paymentNested = await Promise.all(
    users.map(async (tenant) =>
      (await listPaymentRequestsForUser(tenant.id)).map((payment) => ({
        ...payment,
        tenant_name: `${tenant.first_name || ""} ${tenant.last_name || ""}`.trim() || tenant.first_name,
        tenant_id: tenant.tenant_id,
        house_number: tenant.house_number,
        floor_number: tenant.floor_number,
        property_name: tenant.property_name,
      }))
    )
  );
  const paymentItems = paymentNested.flat();

  res.json({
    summary: {
      expected_collection_total: expectedCollection,
      acquired_collection_total: acquiredCollection,
      variance: acquiredCollection - expectedCollection,
      payment_count: paymentItems.length,
    },
    billing,
    payments: paymentItems,
  });
}));

app.post("/api/admin/payments/targets", requireAdminSession, asyncHandler(async (req, res) => {
  const expected = Number(req.body?.expected_collection_total ?? NaN);
  const acquired = Number(req.body?.acquired_collection_total ?? NaN);

  if (!Number.isFinite(expected) || !Number.isFinite(acquired)) {
    return res.status(400).json({ error: "expected_collection_total and acquired_collection_total must be numbers" });
  }

  await setAdminSetting("expected_collection_total", expected);
  await setAdminSetting("acquired_collection_total", acquired);

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

  if (selectedUsers.length !== tenantIds.length) {
    return res.status(400).json({ error: "One or more selected tenants could not be found" });
  }

  await setAdminSetting("billing_rent", rent);
  await setAdminSetting("billing_water", water);
  await setAdminSetting("billing_trash", trash);
  await setAdminSetting("billing_electricity", electricity);
  const users = await applyGlobalBilling({
    rent,
    water,
    trash,
    electricity,
    userIds: selectedUsers.map((user) => user.id),
  });
  const expectedTotal = await getExpectedCollectionTotal(users);
  await setAdminSetting("expected_collection_total", expectedTotal);

  res.json({
    success: true,
    billing: await getBillingConfig(),
    expected_collection_total: expectedTotal,
    applied_count: selectedUsers.length,
    applied_tenant_ids: tenantIds,
  });
}));

app.post("/api/admin/payments/:id/review", requireAdminSession, asyncHandler(async (req, res) => {
  const payment = await getPaymentRequestById(req.params.id);
  if (!payment) {
    return res.status(404).json({ error: "Payment not found" });
  }

  const status = String(req.body?.status || "").trim();
  if (!["APPROVED", "DISAPPROVED"].includes(status)) {
    return res.status(400).json({ error: "status must be APPROVED or DISAPPROVED" });
  }
  if (["APPROVED", "DISAPPROVED"].includes(String(payment.status || "").toUpperCase())) {
    return res.status(400).json({ error: "Payment has already been reviewed" });
  }

  const reviewNote = String(req.body?.review_note || "").trim();
  const user = (await listUsers()).find((item) => item.id === payment.user_id);
  const updated = await updatePaymentRequestStatus(payment.id, status, reviewNote);

  if (status === "APPROVED") {
    const refreshed = await adjustUserBalance(payment.user_id, payment.payment_for, payment.amount);
    const acquiredCollection = Number((await getAdminSetting("acquired_collection_total", "0")) || 0) + Number(payment.amount || 0);
    await setAdminSetting("acquired_collection_total", acquiredCollection);
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
  const users = await listUsers();
  const ticketNested = await Promise.all(
    users.map(async (tenant) =>
      (await listMaintenanceForUser(tenant.id)).map((ticket) => ({
        ...ticket,
        tenant_name: `${tenant.first_name || ""} ${tenant.last_name || ""}`.trim() || tenant.first_name,
        tenant_id: tenant.tenant_id,
        house_number: tenant.house_number,
        floor_number: tenant.floor_number,
        property_name: tenant.property_name,
      }))
    )
  );
  const tickets = ticketNested.flat();

  res.json({ tickets });
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

app.get("/secure-admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/secure-admin/login", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-login.html"));
});

app.get("/admin", (req, res) => {
  res.redirect("/");
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.use(express.static(__dirname));

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

  res.status(500).send("Internal Server Error");
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
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
