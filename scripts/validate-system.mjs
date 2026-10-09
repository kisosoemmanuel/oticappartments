import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "superadmin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "otic12";
const OTIC1_ADMIN_USERNAME = process.env.OTIC1_ADMIN_USERNAME || "adminotic1";
const OTIC1_ADMIN_PASSWORD = process.env.OTIC1_ADMIN_PASSWORD || "oticruiru";
const OTIC2_ADMIN_USERNAME = process.env.OTIC2_ADMIN_USERNAME || "adminotic2";
const OTIC2_ADMIN_PASSWORD = process.env.OTIC2_ADMIN_PASSWORD || "oticbondo";

function log(message) {
  console.log(message);
}

function adminCookieFrom(response) {
  const raw = response.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

async function request(baseUrl, path, { method = "GET", headers = {}, body, cookie } = {}) {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { response, data, text };
}

async function benchmark(label, requests, concurrency, task) {
  let index = 0;
  const latencies = [];
  const startedAt = performance.now();

  async function worker() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= requests) return;
      const requestStarted = performance.now();
      await task(current);
      latencies.push(performance.now() - requestStarted);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const durationMs = performance.now() - startedAt;
  const sorted = latencies.slice().sort((a, b) => a - b);
  const averageMs = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  const p95Ms = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  const maxMs = sorted[sorted.length - 1];

  return {
    label,
    requests,
    concurrency,
    duration_ms: Number(durationMs.toFixed(2)),
    requests_per_second: Number(((requests * 1000) / durationMs).toFixed(2)),
    average_ms: Number(averageMs.toFixed(2)),
    p95_ms: Number(p95Ms.toFixed(2)),
    max_ms: Number(maxMs.toFixed(2)),
  };
}

async function startServer() {
  return new Promise((resolve, reject) => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "otic-validate-"));
    const child = spawn(process.execPath, ["server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: "",
        DB_PATH: path.join(tempRoot, "data.sqlite"),
        BACKUP_DIR: path.join(tempRoot, "backups"),
        UPLOAD_DIR: path.join(tempRoot, "uploads"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rmSync(tempRoot, { recursive: true, force: true });
      reject(new Error(`Timed out waiting for server start.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }, 15000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/http:\/\/localhost:(\d+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ child, baseUrl: `http://localhost:${match[1]}`, tempRoot });
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rmSync(tempRoot, { recursive: true, force: true });
      reject(new Error(`Server exited early with code ${code}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

async function main() {
  const server = process.env.BASE_URL ? { child: null, baseUrl: process.env.BASE_URL } : await startServer();
  const { child, baseUrl, tempRoot } = server;
  let adminCookie = "";
  let createdTenantId = "";

  try {
    log(`Using ${baseUrl}`);

    const adminHtml = readFileSync("admin.html", "utf8");
    assert(adminHtml.includes("OTIC Admin Console"), "OTIC admin console title should be present");
    assert(adminHtml.includes("Tenant directory"), "Tenant directory section should be present");
    assert(adminHtml.includes("Admin alerts"), "Admin alerts section should be present");
    assert(adminHtml.includes("Shared documents"), "Documents panel should be present");
    assert(adminHtml.includes("Generate report"), "Report generation control should be present");

    const rootPage = await request(baseUrl, "/");
    assert(rootPage.response.redirected || rootPage.response.url.endsWith("/secure-admin/login"), "Root path should redirect to admin login");
    assert(!rootPage.text.includes("Tenant portal"), "Legacy tenant landing page should be removed");

    const legacyTenantRoute = await request(baseUrl, "/api/pegasus/visionary/tenant/app/login", {
      method: "POST",
      body: { first_name: "legacy", account_number: "legacy" },
    });
    assert.equal(legacyTenantRoute.response.status, 404, "Legacy tenant login endpoint should be removed");

    const adminPage = await request(baseUrl, "/secure-admin");
    assert.equal(adminPage.response.status, 200, "Admin page should load");
    assert(adminPage.text.includes("Admin Console"), "Admin HTML should render");

    const adminLogin = await request(baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    assert.equal(adminLogin.response.status, 200, "Admin login should succeed");
    adminCookie = adminCookieFrom(adminLogin.response);
    assert(adminCookie, "Admin session cookie should be set");

    const sessionCheck = await request(baseUrl, "/api/admin/session", { cookie: adminCookie });
    assert.equal(sessionCheck.response.status, 200, "Admin session should be active");

    const tenantSeed = Date.now();
    const firstName = `Temp${tenantSeed}`;
    const accountNumber = `A${tenantSeed}`;
    const createUser = await request(baseUrl, "/api/admin/users", {
      method: "POST",
      cookie: adminCookie,
      body: {
        first_name: firstName,
        last_name: "Verifier",
        account_number: accountNumber,
        floor_number: "9",
        house_number: `T-${String(tenantSeed).slice(-4)}`,
        phone_number: "0711111111",
        rent: "1000",
        account_balance: "0",
        arrears: "0",
      },
    });
    assert.equal(createUser.response.status, 200, "Tenant should be created through the admin API");
    createdTenantId = createUser.data.user.tenant_id;
    assert(createdTenantId, "Created tenant must have a tenant_id");

    const adminUsers = await request(baseUrl, "/api/admin/users", { cookie: adminCookie });
    assert.equal(adminUsers.response.status, 200, "Admin users feed should load");
    assert(adminUsers.data.users.some((user) => user.tenant_id === createdTenantId), "Created tenant should appear in the admin list");

    const sharedDocumentName = `Validation Welcome Pack ${tenantSeed}`;
    const sharedDocumentForm = new FormData();
    sharedDocumentForm.append("name", sharedDocumentName);
    sharedDocumentForm.append("category", "Onboarding");
    sharedDocumentForm.append("status", "IMPORTANT");
    sharedDocumentForm.append("file", new Blob(["Validation document body"], { type: "text/plain" }), "welcome-pack.txt");

    const sharedDocumentUpload = await request(baseUrl, "/api/admin/documents/shared", {
      method: "POST",
      cookie: adminCookie,
      body: sharedDocumentForm,
    });
    assert.equal(sharedDocumentUpload.response.status, 200, "Admin should upload a shared document");
    assert(sharedDocumentUpload.data.document?.url, "Uploaded document should expose a URL");

    const adminDocuments = await request(baseUrl, "/api/admin/documents", { cookie: adminCookie });
    assert.equal(adminDocuments.response.status, 200, "Admin documents feed should load");
    assert(
      adminDocuments.data.documents.some((item) => item.name === sharedDocumentName),
      "Admin documents feed should include uploaded shared document"
    );

    const overviewBefore = await request(baseUrl, "/api/admin/overview", { cookie: adminCookie });
    assert.equal(overviewBefore.response.status, 200, "Admin overview should load");

    const adminMessages = await request(baseUrl, "/api/admin/messages", {
      method: "POST",
      cookie: adminCookie,
      body: {
        tenant_id: createdTenantId,
        sender_name: "Property Admin",
        subject: "Validation admin message",
        category: "Operations",
        body: "Testing the admin-only messaging flow.",
      },
    });
    assert.equal(adminMessages.response.status, 200, "Admin message send should succeed");

    const messageFeed = await request(baseUrl, "/api/admin/messages", { cookie: adminCookie });
    assert.equal(messageFeed.response.status, 200, "Admin messages feed should load");
    assert(
      messageFeed.data.messages.some((item) => item.tenant_id === createdTenantId && item.subject === "Validation admin message"),
      "Admin should see the created tenant message"
    );

    const ticketSeed = `Validation ticket ${tenantSeed}`;
    const maintenanceTicket = await request(baseUrl, `/api/admin/tickets`, { cookie: adminCookie });
    assert.equal(maintenanceTicket.response.status, 200, "Admin tickets endpoint should load");

    const billingApply = await request(baseUrl, "/api/admin/payments/config", {
      method: "POST",
      cookie: adminCookie,
      body: {
        rent: "123",
        water: "0",
        trash: "0",
        electricity: "0",
        tenant_ids: [createdTenantId],
      },
    });
    assert.equal(billingApply.response.status, 200, "Selected-tenant billing update should succeed");

    const tenantDetail = await request(baseUrl, `/api/admin/tenants/${createdTenantId}/details`, { cookie: adminCookie });
    assert.equal(tenantDetail.response.status, 200, "Admin tenant detail should load");
    assert.equal(Number(tenantDetail.data.tenant.account_balance || 0), 123, "Admin tenant detail should reflect billed balance");

    const tenantUpdate = await request(baseUrl, `/api/admin/users/${createdTenantId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: {
        first_name: `${firstName}Edited`,
        last_name: "Verifier",
        floor_number: "10",
        house_number: "V-100",
        phone_number: "0722222222",
        email_address: "validator@example.com",
        national_id: "12345678",
        rent: "1400",
        deposit: "2500",
      },
    });
    assert.equal(tenantUpdate.response.status, 200, "Tenant update endpoint should succeed");
    assert.equal(tenantUpdate.data.user.house_number, "V-100", "Tenant update should persist unit changes");
    assert.equal(String(tenantUpdate.data.user.rent || ""), "1400", "Tenant update should persist rent changes");

    const tenantDetailAfterUpdate = await request(baseUrl, `/api/admin/tenants/${createdTenantId}/details`, { cookie: adminCookie });
    assert.equal(tenantDetailAfterUpdate.response.status, 200, "Updated tenant detail should load");
    assert.equal(tenantDetailAfterUpdate.data.tenant.house_number, "V-100", "Tenant detail should reflect updated unit");

    const propertyAdminOneLogin = await request(baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: OTIC1_ADMIN_USERNAME, password: OTIC1_ADMIN_PASSWORD },
    });
    assert.equal(propertyAdminOneLogin.response.status, 200, "Otic 1 admin login should succeed");
    const propertyAdminOneCookie = adminCookieFrom(propertyAdminOneLogin.response);

    const propertyAdminTwoLogin = await request(baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: OTIC2_ADMIN_USERNAME, password: OTIC2_ADMIN_PASSWORD },
    });
    assert.equal(propertyAdminTwoLogin.response.status, 200, "Otic 2 admin login should succeed");
    const propertyAdminTwoCookie = adminCookieFrom(propertyAdminTwoLogin.response);

    const propertyAdminAlert = await request(baseUrl, "/api/admin/alerts", {
      method: "POST",
      cookie: propertyAdminOneCookie,
      body: {
        body: "Validation private admin alert.",
      },
    });
    assert.equal(propertyAdminAlert.response.status, 200, "Property admin alert should be created");
    assert(
      propertyAdminAlert.data.messages.some((item) => item.body === "Validation private admin alert."),
      "Property admin should see their own private alert"
    );

    const superadminAlerts = await request(baseUrl, "/api/admin/alerts", { cookie: adminCookie });
    assert.equal(superadminAlerts.response.status, 200, "Superadmin alerts feed should load");
    const adminOneThread = superadminAlerts.data.threads.find((thread) => thread.owner_username === OTIC1_ADMIN_USERNAME);
    assert(adminOneThread, "Superadmin should see the Otic 1 admin thread");

    const superadminReply = await request(baseUrl, "/api/admin/alerts", {
      method: "POST",
      cookie: adminCookie,
      body: {
        thread_owner_admin_user_id: adminOneThread.thread_owner_admin_user_id,
        body: "Validation superadmin reply.",
      },
    });
    assert.equal(superadminReply.response.status, 200, "Superadmin reply should succeed");

    const propertyAdminAlertsAfterReply = await request(baseUrl, "/api/admin/alerts", { cookie: propertyAdminOneCookie });
    assert.equal(propertyAdminAlertsAfterReply.response.status, 200, "Property admin alerts feed should load");
    assert(
      propertyAdminAlertsAfterReply.data.messages.some((item) => item.body === "Validation superadmin reply."),
      "Property admin should receive the superadmin reply"
    );

    const unrelatedPropertyAdminAlerts = await request(baseUrl, "/api/admin/alerts", { cookie: propertyAdminTwoCookie });
    assert.equal(unrelatedPropertyAdminAlerts.response.status, 200, "Other property admin alerts feed should load");
    assert(
      !unrelatedPropertyAdminAlerts.data.messages.some((item) => item.body === "Validation private admin alert."),
      "Other property admin should not see the private alert"
    );

    const occupancyUpdate = await request(baseUrl, "/api/admin/occupancy", {
      method: "POST",
      cookie: adminCookie,
      body: {
        occupied_units: Number(overviewBefore.data.overview.occupied_units || 0),
        vacant_units: Number(overviewBefore.data.overview.vacant_units || 0),
      },
    });
    assert.equal(occupancyUpdate.response.status, 200, "Occupancy update should succeed");

    const benchmarks = [];
    benchmarks.push(
      await benchmark("health", 80, 8, async () => {
        const result = await request(baseUrl, "/api/health");
        assert.equal(result.response.status, 200);
      })
    );
    benchmarks.push(
      await benchmark("admin_overview", 40, 4, async () => {
        const result = await request(baseUrl, "/api/admin/overview", { cookie: adminCookie });
        assert.equal(result.response.status, 200);
      })
    );

    const summary = {
      base_url: baseUrl,
      validation: "passed",
      created_tenant_id: createdTenantId,
      benchmarks,
      notes: [
        "The app is restricted to admin/property operations; the standalone tenant portal is removed.",
        "Coverage includes root redirect, admin login, tenant creation, document upload, messaging, billing, and overview checks.",
      ],
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (createdTenantId && adminCookie) {
      try {
        await request(baseUrl, `/api/admin/users/${encodeURIComponent(createdTenantId)}`, {
          method: "DELETE",
          cookie: adminCookie,
        });
      } catch (error) {
        console.error("Cleanup warning:", error);
      }
    }

    if (child) {
      child.kill();
      await delay(500);
    }

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
