import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

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

function tenantAuth(session) {
  return {
    headers: { token: session.access_token },
    body: {
      tenant_id: session.tenant_id,
      property_id: session.property_id,
      landlord_id: session.landlord_id,
    },
  };
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
  let tenantSession = null;

  try {
    log(`Using ${baseUrl}`);

    const adminHtml = readFileSync("admin.html", "utf8");
    assert.equal((adminHtml.match(/<h2 class="title">Action Queue<\/h2>/g) || []).length, 1, "Action Queue should appear once");
    assert.equal((adminHtml.match(/<h2 class="title">Occupancy Control<\/h2>/g) || []).length, 1, "Occupancy Control should appear once");
    assert(adminHtml.includes("startAdminAutoRefresh"), "Admin auto-refresh hook missing");
    assert(adminHtml.includes("Upload Shared Document"), "Admin documents tab should be present");

    const tenantJs = readFileSync("static/app.js", "utf8");
    assert(tenantJs.includes("startTenantAutoRefresh"), "Tenant auto-refresh hook missing");

    const homePage = await request(baseUrl, "/");
    assert.equal(homePage.response.status, 200, "Tenant homepage should load");
    assert(homePage.text.includes("app"), "Tenant homepage should serve the app shell");

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
    assert.equal(createUser.response.status, 200, "Temp tenant should be created");
    createdTenantId = createUser.data.user.tenant_id;
    assert(createdTenantId, "Created tenant must have a tenant_id");

    const tenantLogin = await request(baseUrl, "/api/pegasus/visionary/tenant/app/login", {
      method: "POST",
      body: { first_name: firstName, account_number: accountNumber },
    });
    assert.equal(tenantLogin.response.status, 200, "Temp tenant should log in");
    tenantSession = tenantLogin.data;

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

    const tenantDocuments = await request(baseUrl, "/api/pegasus/visionary/tenant/fetch/documents", {
      method: "POST",
      ...tenantAuth(tenantSession),
    });
    assert.equal(tenantDocuments.response.status, 200, "Tenant documents should load");
    const sharedDocument = tenantDocuments.data.documents.find((item) => item.name === sharedDocumentName);
    assert(sharedDocument, "Tenant should receive shared document");
    assert.equal(sharedDocument.scope, "shared", "Shared document should be labeled as shared");

    const uploadedFile = await request(baseUrl, sharedDocument.url);
    assert.equal(uploadedFile.response.status, 200, "Uploaded shared document file should be downloadable");

    const overviewBefore = await request(baseUrl, "/api/admin/overview", { cookie: adminCookie });
    assert.equal(overviewBefore.response.status, 200, "Admin overview should load");
    const originalOccupied = overviewBefore.data.overview.occupied_units;
    const originalVacant = overviewBefore.data.overview.vacant_units;

    const tenantOverview = await request(baseUrl, "/api/pegasus/visionary/tenant/app/dashboardOverview", {
      method: "POST",
      ...tenantAuth(tenantSession),
    });
    assert.equal(tenantOverview.response.status, 200, "Tenant dashboard overview should load");

    const adminUsersAfterTenantActivity = await request(baseUrl, "/api/admin/users", { cookie: adminCookie });
    assert.equal(adminUsersAfterTenantActivity.response.status, 200, "Admin users should load after tenant activity");
    const activeTenant = adminUsersAfterTenantActivity.data.users.find((item) => item.tenant_id === createdTenantId);
    assert(activeTenant?.last_seen_at, "Admin tenant list should include last seen time");
    assert.equal(activeTenant?.activity_status, "ONLINE", "Admin tenant list should mark an active tenant as online");

    const paymentOptions = await request(baseUrl, "/api/pegasus/visionary/tenant/payments/options", {
      method: "POST",
      ...tenantAuth(tenantSession),
    });
    assert.equal(paymentOptions.response.status, 200, "Tenant payments options should load");

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

    const tenantPaymentOptionsAfterBilling = await request(baseUrl, "/api/pegasus/visionary/tenant/payments/options", {
      method: "POST",
      ...tenantAuth(tenantSession),
    });
    assert.equal(
      Number(tenantPaymentOptionsAfterBilling.data.bill_breakdown.total || 0),
      123,
      "Tenant should see the billed amount before paying"
    );

    const tenantMessage = await request(baseUrl, "/api/pegasus/visionary/tenant/app/messages/send", {
      method: "POST",
      headers: tenantAuth(tenantSession).headers,
      body: {
        ...tenantAuth(tenantSession).body,
        subject: "Validation message",
        body: "Testing tenant to admin message flow",
      },
    });
    assert.equal(tenantMessage.response.status, 200, "Tenant message send should succeed");

    const ticketTitle = `Validation ticket ${tenantSeed}`;
    const tenantTicket = await request(baseUrl, "/api/pegasus/visionary/tickets/api/tickets/create", {
      method: "POST",
      headers: tenantAuth(tenantSession).headers,
      body: {
        ...tenantAuth(tenantSession).body,
        title: ticketTitle,
        description: "Testing maintenance flow",
        priority: "High",
      },
    });
    assert.equal(tenantTicket.response.status, 200, "Tenant ticket create should succeed");

    const tenantPayment = await request(baseUrl, "/api/pegasus/visionary/mpesa/StkPush", {
      method: "POST",
      headers: tenantAuth(tenantSession).headers,
      body: {
        ...tenantAuth(tenantSession).body,
        amount: "123",
        phone_number: "0711111111",
        reference: `VAL${tenantSeed}`,
        payment_for: "RENT",
        note: "Validation payment",
      },
    });
    assert.equal(tenantPayment.response.status, 200, "Tenant payment submit should succeed");

    const tenantNotice = await request(baseUrl, "/api/pegasus/visionary/tenant/app/AddNotice", {
      method: "POST",
      headers: tenantAuth(tenantSession).headers,
      body: {
        ...tenantAuth(tenantSession).body,
        move_out_date: "2026-06-30",
        reason: "Validation notice",
      },
    });
    assert.equal(tenantNotice.response.status, 200, "Tenant vacating notice should succeed");

    const adminMessages = await request(baseUrl, "/api/admin/messages", { cookie: adminCookie });
    assert(adminMessages.data.messages.some((item) => item.tenant_id === createdTenantId && item.subject === "Validation message"), "Admin should see tenant message");

    const adminTicketsBefore = await request(baseUrl, "/api/admin/tickets", { cookie: adminCookie });
    const createdTicket = adminTicketsBefore.data.tickets.find((item) => item.tenant_id === createdTenantId && item.title === ticketTitle);
    assert(createdTicket, "Admin should see created ticket");
    assert.equal(createdTicket.status, "Pending", "New ticket should start as Pending");

    const ticketInProgress = await request(baseUrl, `/api/admin/tickets/${createdTicket.id}/status`, {
      method: "POST",
      cookie: adminCookie,
      body: { status: "In Progress" },
    });
    assert.equal(ticketInProgress.response.status, 200, "Admin should move ticket to In Progress");
    assert.equal(ticketInProgress.data.ticket.status, "In Progress", "Ticket should now be In Progress");

    const ticketSolved = await request(baseUrl, `/api/admin/tickets/${createdTicket.id}/status`, {
      method: "POST",
      cookie: adminCookie,
      body: { status: "Solved" },
    });
    assert.equal(ticketSolved.response.status, 200, "Admin should mark ticket as Solved");
    assert.equal(ticketSolved.data.ticket.status, "Solved", "Ticket should now be Solved");

    const adminNotices = await request(baseUrl, "/api/admin/vacating-notices", { cookie: adminCookie });
    const createdNotice = adminNotices.data.notices.find((item) => item.tenant_id === createdTenantId && item.move_out_date === "2026-06-30");
    assert(createdNotice, "Admin should see tenant vacating notice");

    const noticeReview = await request(baseUrl, `/api/admin/vacating-notices/${createdNotice.id}/review`, {
      method: "POST",
      cookie: adminCookie,
      body: { status: "APPROVED" },
    });
    assert.equal(noticeReview.response.status, 200, "Admin should approve notice");

    const adminPayments = await request(baseUrl, "/api/admin/payments", { cookie: adminCookie });
    const createdPayment = adminPayments.data.payments.find((item) => item.tenant_id === createdTenantId && item.reference === `VAL${tenantSeed}`);
    assert(createdPayment, "Admin should see tenant payment");

    const paymentReview = await request(baseUrl, `/api/admin/payments/${createdPayment.id}/review`, {
      method: "POST",
      cookie: adminCookie,
      body: { status: "APPROVED" },
    });
    assert.equal(paymentReview.response.status, 200, "Admin should approve payment");

    const adminTenantDetailAfterPayment = await request(baseUrl, `/api/admin/tenants/${createdTenantId}/details`, {
      cookie: adminCookie,
    });
    assert.equal(
      Number(adminTenantDetailAfterPayment.data.tenant.account_balance || 0),
      0,
      "Admin tenant detail should show a cleared account balance after approval"
    );
    assert.equal(
      Number(adminTenantDetailAfterPayment.data.tenant.arrears || 0),
      0,
      "Admin tenant detail should show cleared arrears after approval"
    );
    assert.equal(
      adminTenantDetailAfterPayment.data.arrears.length,
      0,
      "Admin tenant detail should not show stale arrears after approval"
    );

    const occupancyUpdate = await request(baseUrl, "/api/admin/occupancy", {
      method: "POST",
      cookie: adminCookie,
      body: {
        occupied_units: originalOccupied,
        vacant_units: originalVacant,
      },
    });
    assert.equal(occupancyUpdate.response.status, 200, "Occupancy update should succeed");

    const refreshedTenantPayments = await request(baseUrl, "/api/pegasus/visionary/tenant/payments/options", {
      method: "POST",
      ...tenantAuth(tenantSession),
    });
    assert.equal(refreshedTenantPayments.response.status, 200, "Tenant should still load payments after admin updates");
    assert.equal(
      Number(refreshedTenantPayments.data.bill_breakdown.total || 0),
      0,
      "Tenant bill breakdown should be cleared after approved payment"
    );

    const refreshedTenantDetails = await request(baseUrl, "/api/pegasus/visionary/tenant/app/tenantDetails", {
      method: "POST",
      ...tenantAuth(tenantSession),
    });
    assert.equal(refreshedTenantDetails.response.status, 200, "Tenant details should still load after admin updates");
    assert.equal(
      Number(refreshedTenantDetails.data.account_balance || 0),
      0,
      "Tenant details should show a cleared account balance after approved payment"
    );
    assert.equal(
      Number(refreshedTenantDetails.data.arrears || 0),
      0,
      "Tenant details should show cleared arrears after approved payment"
    );

    const refreshedTenantArrears = await request(baseUrl, "/api/pegasus/visionary/tenant/get/tenant/arrears", {
      method: "POST",
      ...tenantAuth(tenantSession),
    });
    assert.equal(refreshedTenantArrears.response.status, 200, "Tenant arrears endpoint should still load after admin updates");
    assert.equal(refreshedTenantArrears.data.length, 0, "Tenant arrears feed should clear after approved payment");

    const refreshedTenantTickets = await request(baseUrl, "/api/pegasus/visionary/tickets/api/tickets/get/tenant", {
      method: "POST",
      ...tenantAuth(tenantSession),
    });
    assert.equal(refreshedTenantTickets.response.status, 200, "Tenant tickets endpoint should still work");

    const adminTenantAccountUpdate = await request(baseUrl, `/api/admin/tenants/${createdTenantId}/billing`, {
      method: "POST",
      cookie: adminCookie,
      body: {
        rent: "50",
        water: "5",
        trash: "0",
        electricity: "0",
        deposit: "456",
      },
    });
    assert.equal(adminTenantAccountUpdate.response.status, 200, "Admin should update tenant deposit and payable amounts");
    assert.equal(Number(adminTenantAccountUpdate.data.tenant.deposit || 0), 456, "Admin tenant update should save the new deposit");
    assert.equal(Number(adminTenantAccountUpdate.data.tenant.account_balance || 0), 55, "Admin tenant update should recalculate the balance");

    const adminTenantBalanceReset = await request(baseUrl, `/api/admin/tenants/${createdTenantId}/billing`, {
      method: "POST",
      cookie: adminCookie,
      body: {
        rent: "50",
        water: "5",
        trash: "0",
        electricity: "0",
        deposit: "456",
        reset_account_balance: true,
      },
    });
    assert.equal(adminTenantBalanceReset.response.status, 200, "Admin should reset tenant account balance to zero");
    assert.equal(Number(adminTenantBalanceReset.data.tenant.deposit || 0), 456, "Reset should preserve the updated deposit");
    assert.equal(Number(adminTenantBalanceReset.data.tenant.account_balance || 0), 0, "Reset should clear the tenant account balance");
    assert.equal(Number(adminTenantBalanceReset.data.bills.total || 0), 0, "Reset should clear the tenant bill breakdown");

    const tenantPaymentOptionsAfterReset = await request(baseUrl, "/api/pegasus/visionary/tenant/payments/options", {
      method: "POST",
      ...tenantAuth(tenantSession),
    });
    assert.equal(
      Number(tenantPaymentOptionsAfterReset.data.bill_breakdown.total || 0),
      0,
      "Tenant payment options should show a cleared balance after admin reset"
    );

    const benchmarks = [];
    benchmarks.push(
      await benchmark("health", 120, 12, async () => {
        const result = await request(baseUrl, "/api/health");
        assert.equal(result.response.status, 200);
      })
    );
    benchmarks.push(
      await benchmark("admin_overview", 60, 6, async () => {
        const result = await request(baseUrl, "/api/admin/overview", { cookie: adminCookie });
        assert.equal(result.response.status, 200);
      })
    );
    benchmarks.push(
      await benchmark("tenant_dashboard_overview", 60, 6, async () => {
        const result = await request(baseUrl, "/api/pegasus/visionary/tenant/app/dashboardOverview", {
          method: "POST",
          ...tenantAuth(tenantSession),
        });
        assert.equal(result.response.status, 200);
      })
    );

    const summary = {
      base_url: baseUrl,
      validation: "passed",
      created_tenant_id: createdTenantId,
      benchmarks,
      notes: [
        "Covers tenant login, tenant actions, admin visibility, shared document publishing, ticket lifecycle, payment review, selected-tenant billing, occupancy update, and page/script loading.",
        "Auto-refresh behavior is validated by code presence and syntax here; full browser-timing behavior still benefits from a manual click-through.",
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
