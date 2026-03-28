const app = document.getElementById("app");
const AUTO_REFRESH_INTERVAL_MS = 10000;
const TENANT_AUTO_REFRESH_ENABLED = false;
let tenantAutoRefreshTimer = null;
let tenantAutoRefreshInFlight = false;
let tenantDashboardLoadRequestId = 0;

const SESSION_KEY = "oticSession";
const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "messages", label: "Messages" },
  { id: "payments", label: "Payments" },
  { id: "alerts", label: "Alerts" },
  { id: "maintenance", label: "Maintenance" },
  { id: "vacating", label: "Vacating Notice" },
  { id: "documents", label: "Documents" },
  { id: "profile", label: "Profile" },
  { id: "transactions", label: "Transactions" },
  { id: "arrears", label: "Arrears" },
  { id: "agreements", label: "Leases" },
];

function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function shouldPauseAutoRefresh() {
  const active = document.activeElement;
  if (!active) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName) && !active.readOnly && !active.disabled;
}

function stopTenantAutoRefresh() {
  if (!tenantAutoRefreshTimer) return;
  clearInterval(tenantAutoRefreshTimer);
  tenantAutoRefreshTimer = null;
}

function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearLegacyStorage() {
  localStorage.removeItem("tenant_details");
  localStorage.removeItem("tenant_details_backup");
  localStorage.removeItem("tenant_tickets");
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  clearLegacyStorage();
}

function formatMoney(value) {
  const num = Number(value || 0);
  return `KES ${num.toLocaleString()}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function normalizeTicketStatus(status) {
  const normalized = String(status || "").trim();
  return normalized === "Resolved" ? "Solved" : normalized || "Pending";
}

function isClosedTicketStatus(status) {
  return ["Solved", "Resolved"].includes(String(status || "").trim());
}

function ticketStatusClass(status) {
  return normalizeTicketStatus(status).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function getBody() {
  const session = getSession();
  return {
    tenant_id: session?.tenant_id,
    property_id: session?.property_id,
    landlord_id: session?.landlord_id,
  };
}

async function api(path, { method = "POST", body, auth = true } = {}) {
  const session = getSession();
  const headers = { "Content-Type": "application/json" };

  if (auth && session?.access_token) {
    headers.token = session.access_token;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (res.status === 401 && auth) {
    clearSession();
    navigate("/");
    throw new Error("Session expired. Please sign in again.");
  }

  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Request failed with ${res.status}`);
  }

  return data;
}

function navigate(path) {
  window.history.pushState({}, "", path);
  render();
}

window.addEventListener("popstate", render);

async function runTenantAutoRefresh() {
  if (tenantAutoRefreshInFlight || document.hidden || shouldPauseAutoRefresh() || !getSession()) {
    return;
  }

  tenantAutoRefreshInFlight = true;
  try {
    await loadDashboardData(getActiveView(), { showLoading: false });
  } catch (error) {
    console.error("Tenant auto-refresh failed:", error);
  } finally {
    tenantAutoRefreshInFlight = false;
  }
}

function startTenantAutoRefresh() {
  stopTenantAutoRefresh();
  if (!TENANT_AUTO_REFRESH_ENABLED) {
    return;
  }
  tenantAutoRefreshTimer = window.setInterval(() => {
    runTenantAutoRefresh();
  }, AUTO_REFRESH_INTERVAL_MS);
}

window.addEventListener("visibilitychange", () => {
  if (!document.hidden && TENANT_AUTO_REFRESH_ENABLED) {
    runTenantAutoRefresh();
  }
});

function render() {
  const path = window.location.pathname;
  const session = getSession();

  if (!session && path !== "/") {
    stopTenantAutoRefresh();
    navigate("/");
    return;
  }

  if (session && path === "/") {
    navigate("/home");
    return;
  }

  if (!session) {
    stopTenantAutoRefresh();
    renderLogin();
    return;
  }

  renderDashboard();
}

function renderLogin(status = "") {
  stopTenantAutoRefresh();
  app.className = "shell auth-shell";
  app.innerHTML = `
    <div class="auth-card">
      <section class="auth-hero">
        <div class="auth-brand">
          <img src="./brand.png" alt="Otic Apartments" />
        </div>
        <div>
          <div class="eyebrow">Tenant Portal</div>
          <h1>One place for your rent, notices, messages, and move-out requests.</h1>
          <p>Sign in with your first name and account number to manage payments, maintenance, documents, lease details, and system messages.</p>
        </div>
        <div class="muted">Use the tenant credentials your administrator created for you.</div>
      </section>
      <section class="auth-panel">
        <h2 class="panel-title">Sign In</h2>
        <p class="panel-copy">This portal now includes a tenant inbox, vacating notice workflow, and tenant-specific dashboard information.</p>
        <form id="loginForm">
          <div class="field">
            <label for="firstName">First name</label>
            <input class="input" id="firstName" name="firstName" autocomplete="given-name" />
          </div>
          <div class="field" style="margin-top:14px;">
            <label for="accountNumber">Account number</label>
            <input class="input" id="accountNumber" name="accountNumber" autocomplete="current-password" />
          </div>
          <div class="status ${status ? "error" : ""}" id="status" style="margin-top:14px;">${escapeHtml(status)}</div>
          <button class="button" type="submit" style="margin-top:8px; width:100%;">Open Dashboard</button>
        </form>
      </section>
    </div>
  `;

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const first_name = document.getElementById("firstName").value.trim();
    const account_number = document.getElementById("accountNumber").value.trim();
    const statusEl = document.getElementById("status");

    if (!first_name || !account_number) {
      statusEl.textContent = "Enter both first name and account number.";
      statusEl.className = "status error";
      return;
    }

    statusEl.textContent = "Signing in...";
    statusEl.className = "status";

    try {
      clearLegacyStorage();
      const user = await api("/api/pegasus/visionary/tenant/app/login", {
        auth: false,
        body: { first_name, account_number },
      });
      setSession(user);
      navigate("/home");
    } catch (error) {
      statusEl.textContent = error.message;
      statusEl.className = "status error";
    }
  });
}

async function renderDashboard() {
  stopTenantAutoRefresh();
  app.className = "shell";
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <img src="./brand.png" alt="Otic Apartments" />
        </div>
        <nav>
          ${NAV_ITEMS.map((item, index) => `
            <button class="nav-button ${index === 0 ? "active" : ""}" data-view="${item.id}">${item.label}</button>
          `).join("")}
        </nav>
        <button class="button secondary" id="logoutBtn">Log Out</button>
      </aside>
      <main class="main">
        <div class="topbar">
          <div class="page-header">
            <div class="eyebrow" style="background:#e7eefb;color:#1d4ed8;">Tenant View</div>
            <h1>Tenant Dashboard</h1>
            <p id="welcomeCopy">Loading your account...</p>
          </div>
          <div class="actions">
            <button class="button secondary" id="refreshBtn">Refresh</button>
          </div>
        </div>
        <div id="content" class="grid"></div>
      </main>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", () => {
    stopTenantAutoRefresh();
    clearSession();
    navigate("/");
  });

  document.getElementById("refreshBtn").addEventListener("click", () => loadDashboardData(getActiveView()));

  const navButtons = [...document.querySelectorAll(".nav-button")];
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      navButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      loadDashboardData(button.dataset.view);
    });
  });

  await loadDashboardData("dashboard");
  startTenantAutoRefresh();
}

function getActiveView() {
  return document.querySelector(".nav-button.active")?.dataset.view || "dashboard";
}

function activateView(view) {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

async function loadDashboardData(view = "dashboard", { showLoading = true } = {}) {
  const content = document.getElementById("content");
  const welcomeCopy = document.getElementById("welcomeCopy");
  const body = getBody();
  const requestId = ++tenantDashboardLoadRequestId;

  if (showLoading) {
    content.innerHTML = `<div class="section"><p class="panel-copy">Loading dashboard data...</p></div>`;
  }

  try {
    const [
      tenant,
      overview,
      arrears,
      transactions,
      agreements,
      payments,
      alerts,
      maintenance,
      documents,
      messages,
      vacating,
    ] = await Promise.all([
      api("/api/pegasus/visionary/tenant/app/tenantDetails", { body }),
      api("/api/pegasus/visionary/tenant/app/dashboardOverview", { body }),
      api("/api/pegasus/visionary/tenant/get/tenant/arrears", { body }),
      api("/api/pegasus/visionary/tenant/get/tenant/transactions", { body }),
      api("/api/pegasus/visionary/agreements/fetch", { body }),
      api("/api/pegasus/visionary/tenant/payments/options", { body }),
      api("/api/pegasus/visionary/tenant/app/alerts/get", { body }),
      api("/api/pegasus/visionary/tickets/api/tickets/get/tenant", { body }),
      api("/api/pegasus/visionary/tenant/fetch/documents", { body }),
      api("/api/pegasus/visionary/tenant/app/messages/get", { body }),
      api("/api/pegasus/visionary/tenant/app/vacating/get", { body }),
    ]);

    if (requestId !== tenantDashboardLoadRequestId) {
      return;
    }

    const session = getSession();
    setSession({ ...session, ...tenant });
    welcomeCopy.textContent = `Welcome back, ${tenant.first_name || "Tenant"}. Your dashboard now shows only your rent, notices, messages, maintenance, lease, and move-out information.`;

    renderView(view, {
      tenant,
      overview,
      arrears: Array.isArray(arrears) ? arrears : [],
      transactions: Array.isArray(transactions) ? transactions : [],
      agreements: Array.isArray(agreements) ? agreements : agreements?.agreements || [],
      paymentMethods: payments?.methods || [],
      paymentHistory: payments?.history || [],
      paymentInstructions: payments?.instructions || {},
      billBreakdown: payments?.bill_breakdown || {},
      alerts: Array.isArray(alerts) ? alerts : [],
      maintenance: maintenance?.tickets || [],
      documents: documents?.documents || [],
      messages: messages?.messages || [],
      notices: vacating?.notices || [],
    });
  } catch (error) {
    if (requestId !== tenantDashboardLoadRequestId) {
      return;
    }
    content.innerHTML = `
      <section class="section">
        <h2 class="section-title">Load Error</h2>
        <div class="empty">${escapeHtml(error.message)}</div>
        <p class="footer-note">If the session expired, sign in again. Otherwise use Refresh to retry.</p>
      </section>
    `;
  }
}

function renderSummaryCards(tenant, overview) {
  const tenantStats = overview?.tenant || {};

  return `
    <div class="summary-grid grid">
      ${summaryCard("Rent Status", tenantStats.rent_status || "Current", tenantStats.rent_status === "Overdue" ? "alert" : "success", "payments")}
      ${summaryCard("Monthly Rent", formatMoney(tenant.rent), "", "payments")}
      ${summaryCard("Deposit", formatMoney(tenant.deposit), "", "profile")}
      ${summaryCard("Arrears", formatMoney(tenant.arrears), Number(tenant.arrears || 0) > 0 ? "alert" : "", "payments")}
      ${summaryCard("Open Tickets", tenantStats.open_maintenance_count ?? 0, "", "maintenance")}
      ${summaryCard("Unread Messages", tenantStats.unread_messages ?? 0, "", "messages")}
      ${summaryCard("Lease Status", tenantStats.active_lease ? "Active" : "No Active Lease", "", "agreements")}
    </div>
  `;
}

function renderDashboardView(data) {
  const { tenant, overview, transactions, alerts, maintenance, messages } = data;
  const openMaintenance = maintenance.filter((ticket) => !isClosedTicketStatus(ticket.status));

  return `
    <section class="hero-panel">
      <div class="hero-copy-panel">
        <div class="eyebrow hero-eyebrow">Tenant Snapshot</div>
        <h2 class="hero-title">Everything important for ${escapeHtml(tenant.first_name || "your account")} is in one view.</h2>
        <p class="hero-text">Track your rent standing, unread messages, open maintenance items, and lease timeline without digging through tabs.</p>
        <div class="hero-actions">
          <button class="button" id="heroMessagesBtn">Open Messages</button>
          <button class="button secondary" id="heroPaymentsBtn">Make Payment</button>
        </div>
      </div>
      <div class="hero-metrics">
        <article class="hero-stat">
          <span>Account Focus</span>
          <strong>${Number(tenant.arrears || 0) > 0 ? "Balance Needs Attention" : "Account In Good Standing"}</strong>
        </article>
        <article class="hero-stat">
          <span>Property</span>
          <strong>${escapeHtml(tenant.property_name || "Otic Apartments")}</strong>
        </article>
        <article class="hero-stat">
          <span>Unit</span>
          <strong>${escapeHtml(tenant.house_number || "Not Assigned")}</strong>
        </article>
      </div>
    </section>
    <div class="split">
      <section class="section">
        <h2 class="section-title">Your Account</h2>
        <div class="list">
          <div class="list-item">
            <div class="meta-label">Property</div>
            <p class="meta-value">${escapeHtml(tenant.property_name || "Not assigned")}</p>
          </div>
          <div class="list-item">
            <div class="meta-label">Unit</div>
            <p class="meta-value">${escapeHtml(tenant.house_number || "Not assigned")}</p>
          </div>
          <div class="list-item">
            <div class="meta-label">Deposit Held</div>
            <p class="meta-value">${escapeHtml(formatMoney(tenant.deposit || 0))}</p>
          </div>
          <div class="list-item">
            <div class="meta-label">Lease End Date</div>
            <p class="meta-value">${escapeHtml(formatDate(overview?.tenant?.lease_end_date))}</p>
          </div>
          <div class="list-item">
            <div class="meta-label">Latest Payment Reference</div>
            <p class="meta-value">${escapeHtml(overview?.tenant?.latest_payment_reference || "No recent payment")}</p>
          </div>
          <div class="list-item">
            <div class="meta-label">Next Action</div>
            <p class="meta-value">${Number(tenant.arrears || 0) > 0 ? "Clear outstanding balance" : "Account is in good standing"}</p>
          </div>
        </div>
      </section>
      <section class="section accent-section">
        <h2 class="section-title">Quick Actions</h2>
        <div class="list">
          <div class="list-item">
            <strong>Need to move out?</strong>
            <div class="muted">Use the dedicated vacating tab to submit notice and track its pending status.</div>
            <button class="button secondary quick-action-btn" data-view="vacating" style="margin-top:12px;">Open Vacating Notice</button>
          </div>
          <div class="list-item">
            <strong>Need help with billing?</strong>
            <div class="muted">Open Messages to contact admin directly and keep everything in one thread.</div>
            <button class="button secondary quick-action-btn" data-view="messages" style="margin-top:12px;">Open Messages</button>
          </div>
          <div class="list-item">
            <strong>Want to update your details?</strong>
            <div class="muted">Profile now supports editing your personal contact information.</div>
            <button class="button secondary quick-action-btn" data-view="profile" style="margin-top:12px;">Open Profile</button>
          </div>
        </div>
      </section>
    </div>
    <div class="split">
      <section class="section">
        <h2 class="section-title">Latest Messages</h2>
        ${messages.length ? `<div class="list">${messages.slice(0, 3).map(renderMessageCard).join("")}</div>` : '<div class="empty">No system messages yet.</div>'}
      </section>
      <section class="section">
        <h2 class="section-title">Recent Activity</h2>
        ${transactions.length ? `<div class="list">${transactions.slice(0, 3).map((item) => `<article class="list-item"><strong>${escapeHtml(item.description || item.type || "Transaction")}</strong><div>${escapeHtml(formatMoney(item.amount))}</div><div class="muted">${escapeHtml(formatDate(item.date_created))}</div></article>`).join("")}</div>` : '<div class="empty">No recent transactions yet.</div>'}
      </section>
    </div>
    <div class="split">
      <section class="section">
        <h2 class="section-title">Active Alerts</h2>
        ${alerts.length ? `<div class="list">${alerts.slice(0, 3).map((item) => `<article class="list-item"><strong>${escapeHtml(item.title)}</strong><div>${escapeHtml(item.message)}</div></article>`).join("")}</div>` : '<div class="empty">No active alerts.</div>'}
      </section>
      <section class="section">
        <h2 class="section-title">Maintenance Snapshot</h2>
        ${openMaintenance.length ? `<div class="list">${openMaintenance.slice(0, 3).map((ticket) => `<article class="list-item"><strong>${escapeHtml(ticket.title)}</strong><div class="muted">${escapeHtml(normalizeTicketStatus(ticket.status))} | ${escapeHtml(ticket.priority)}</div></article>`).join("")}</div>` : '<div class="empty">No open maintenance tickets.</div>'}
        <div class="toolbar" style="margin-top:14px;">
          <button class="button secondary" id="maintenanceSnapshotBtn">Open Tickets</button>
        </div>
      </section>
    </div>
  `;
}

function renderMessageCard(message) {
  return `
    <article class="list-item">
      <div class="inline-row">
        <strong>${escapeHtml(message.subject || "Message")}</strong>
        <span class="pill">${escapeHtml(message.category || "General")}</span>
      </div>
      <div class="muted">From: ${escapeHtml(message.sender_name || message.sender_type || "System")}</div>
      <pre class="message-body">${escapeHtml(message.body || "")}</pre>
      <div class="muted">${escapeHtml(formatDate(message.created_at))}</div>
    </article>
  `;
}

function renderView(view, data) {
  const content = document.getElementById("content");
  const { tenant, overview, arrears, transactions, agreements, paymentMethods, paymentHistory, paymentInstructions, billBreakdown, alerts, maintenance, documents, messages, notices } = data;
  const summary = renderSummaryCards(tenant, overview);
  const openMaintenance = maintenance.filter((ticket) => !isClosedTicketStatus(ticket.status));

  if (view === "dashboard") {
    content.innerHTML = `${summary}${renderDashboardView(data)}`;
    document.getElementById("heroMessagesBtn")?.addEventListener("click", () => {
      activateView("messages");
      renderView("messages", data);
    });
    document.getElementById("heroPaymentsBtn")?.addEventListener("click", () => {
      activateView("payments");
      renderView("payments", data);
    });
    document.querySelectorAll(".summary-grid [data-view]").forEach((card) => {
      card.addEventListener("click", () => {
        activateView(card.dataset.view);
        renderView(card.dataset.view, data);
      });
    });
    document.querySelectorAll(".quick-action-btn").forEach((button) => {
      button.addEventListener("click", () => {
        activateView(button.dataset.view);
        renderView(button.dataset.view, data);
      });
    });
    document.getElementById("maintenanceSnapshotBtn")?.addEventListener("click", () => {
      activateView("maintenance");
      renderView("maintenance", data);
    });
    return;
  }

  if (view === "messages") {
    content.innerHTML = `
      ${summary}
      <div class="split">
        <section class="section">
          <h2 class="section-title">System Messaging</h2>
          <p class="footer-note">Messages sent from the admin console appear here so tenants can receive billing, onboarding, and support updates directly.</p>
          ${messages.length ? `<div class="list">${messages.map(renderMessageCard).join("")}</div>` : '<div class="empty">No messages have been sent to you yet.</div>'}
        </section>
        <section class="section">
          <h2 class="section-title">Reply to Admin</h2>
          <form id="messageReplyForm" class="stack">
            <div class="field">
              <label for="replySubject">Subject</label>
              <input class="input" id="replySubject" placeholder="Question about my bill" />
            </div>
            <div class="field">
              <label for="replyBody">Message</label>
              <textarea class="input textarea" id="replyBody" placeholder="Type your message to admin"></textarea>
            </div>
            <button class="button" type="submit">Send message</button>
            <div class="status" id="messageReplyStatus"></div>
          </form>
        </section>
      </div>
    `;
    document.getElementById("messageReplyForm").addEventListener("submit", handleMessageReplySubmit);
    return;
  }

  if (view === "payments") {
    const primaryMethod = paymentMethods[0] || {};
    content.innerHTML = `
      ${summary}
      <div class="split">
        <section class="section">
          <h2 class="section-title">Payment Guidelines</h2>
          <div class="list">
            <article class="list-item">
              <strong>Current Bill Breakdown</strong>
              <div class="bill-line">Rent: ${escapeHtml(formatMoney(billBreakdown.rent || 0))}</div>
              <div class="bill-line">Water: ${escapeHtml(formatMoney(billBreakdown.water || 0))}</div>
              <div class="bill-line">Trash: ${escapeHtml(formatMoney(billBreakdown.trash || 0))}</div>
              <div class="bill-line">Electricity: ${escapeHtml(formatMoney(billBreakdown.electricity || 0))}</div>
              <div class="meta-value">Total Outstanding: ${escapeHtml(formatMoney(billBreakdown.total || 0))}</div>
            </article>
            </article>
          </div>
          <div class="list">
            <article class="list-item">
              <strong>Paybill Number</strong>
              <div class="meta-value">${escapeHtml(paymentInstructions.paybill_number || primaryMethod.paybill_number || "222111")}</div>
            </article>
            <article class="list-item">
              <strong>Account Number</strong>
              <div class="meta-value">${escapeHtml(paymentInstructions.account_number || primaryMethod.account_number || "024000000880")}</div>
            </article>
          </div>
          <p class="footer-note">Complete the payment in M-PESA first, then submit the confirmation details below so admin can verify and post it to your account.</p>
          ${Array.isArray(paymentInstructions.steps) ? `<div class="list">${paymentInstructions.steps.map((step) => `<article class="list-item">${escapeHtml(step)}</article>`).join("")}</div>` : ""}
        </section>
        <section class="section">
          <h2 class="section-title">Submit Payment Confirmation</h2>
          <form id="paymentForm" class="stack">
            <div class="field">
              <label for="paymentFor">Paying for</label>
              <select class="input" id="paymentFor">
                <option value="RENT">Rent</option>
                <option value="WATER">Water Bill</option>
                <option value="TRASH">Trash Bill</option>
                <option value="ELECTRICITY">Electricity Bill</option>
              </select>
            </div>
            <div class="field">
              <label for="paymentMethod">Payment method</label>
              <input class="input" id="paymentMethod" value="${escapeHtml(primaryMethod.label || "M-PESA Paybill")}" readonly />
            </div>
            <div class="field">
              <label for="paymentAmount">Amount</label>
              <input class="input" id="paymentAmount" value="${escapeHtml(String(billBreakdown.rent || tenant.rent || "0"))}" />
            </div>
            <div class="field">
              <label for="paymentPhone">Phone number used</label>
              <input class="input" id="paymentPhone" value="${escapeHtml(tenant.phone_number || "")}" />
            </div>
            <div class="field">
              <label for="paymentReference">M-PESA confirmation code</label>
              <input class="input" id="paymentReference" placeholder="e.g. QWE123ABC9" />
            </div>
            <div class="field">
              <label for="paymentNote">Optional note</label>
              <textarea class="input textarea" id="paymentNote" placeholder="Any extra payment note"></textarea>
            </div>
            <button class="button" type="submit">Submit Payment Confirmation</button>
            <div class="status" id="paymentStatus"></div>
          </form>
        </section>
      </div>
      <section class="section">
          <h2 class="section-title">Payment Submissions</h2>
          ${paymentHistory.length ? `
            <div class="list">
              ${paymentHistory.map((item) => `
                <article class="list-item">
                  <strong>${escapeHtml(item.method)}</strong>
                  <div class="muted">For: ${escapeHtml(item.payment_for || "RENT")}</div>
                  <div>${escapeHtml(formatMoney(item.amount))}</div>
                  <div class="muted">${escapeHtml(item.status)} | ${escapeHtml(item.reference || "No reference")}</div>
                  <div class="muted">${escapeHtml(item.note || "")}</div>
                  <div class="muted">${escapeHtml(formatDate(item.created_at))}</div>
                </article>
              `).join("")}
            </div>
          ` : '<div class="empty">No payment confirmations submitted yet.</div>'}
      </section>
    `;

    document.getElementById("paymentForm").addEventListener("submit", handlePaymentSubmit);
    return;
  }

  if (view === "alerts") {
    content.innerHTML = `
      ${summary}
      <section class="section">
        <h2 class="section-title">Automated Alerts</h2>
        ${alerts.length ? `
          <div class="list">
            ${alerts.map((item) => `
              <article class="list-item">
                <div class="inline-row">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span class="pill ${escapeHtml((item.severity || "").toLowerCase())}">${escapeHtml(item.severity || "info")}</span>
                </div>
                <div>${escapeHtml(item.message)}</div>
                <div class="muted">${escapeHtml(formatDate(item.trigger_date || item.created_at))}</div>
              </article>
            `).join("")}
          </div>
        ` : '<div class="empty">No active alerts at the moment.</div>'}
      </section>
    `;
    return;
  }

  if (view === "maintenance") {
    content.innerHTML = `
      ${summary}
      <div class="split">
        <section class="section">
          <h2 class="section-title">Maintenance Tracking</h2>
          ${openMaintenance.length ? `
            <div class="list">
              ${openMaintenance.map((ticket) => `
                <article class="list-item">
                  <div class="inline-row">
                    <strong>${escapeHtml(ticket.title)}</strong>
                    <span class="pill ${escapeHtml(ticketStatusClass(ticket.status))}">${escapeHtml(normalizeTicketStatus(ticket.status))}</span>
                  </div>
                  <div>${escapeHtml(ticket.description || "No extra details provided.")}</div>
                  <div class="muted">Priority: ${escapeHtml(ticket.priority || "Medium")} | Technician: ${escapeHtml(ticket.technician_name || "Pending assignment")}</div>
                  <div class="muted">Updated: ${escapeHtml(formatDate(ticket.updated_at || ticket.created_at))}</div>
                </article>
              `).join("")}
            </div>
          ` : '<div class="empty">No maintenance tickets are open right now.</div>'}
        </section>
        <section class="section">
          <h2 class="section-title">Request Maintenance</h2>
          <form id="maintenanceForm" class="stack">
            <div class="field">
              <label for="maintenanceTitle">Title</label>
              <input class="input" id="maintenanceTitle" placeholder="e.g. Bathroom leak" />
            </div>
            <div class="field">
              <label for="maintenancePriority">Priority</label>
              <select class="input" id="maintenancePriority">
                <option>Low</option>
                <option selected>Medium</option>
                <option>High</option>
              </select>
            </div>
            <div class="field">
              <label for="maintenanceDescription">Description</label>
              <textarea class="input textarea" id="maintenanceDescription" placeholder="Describe the issue clearly"></textarea>
            </div>
            <button class="button" type="submit">Create Request</button>
            <div class="status" id="maintenanceStatus"></div>
          </form>
        </section>
      </div>
    `;

    document.getElementById("maintenanceForm").addEventListener("submit", handleMaintenanceSubmit);
    return;
  }

  if (view === "vacating") {
    content.innerHTML = `
      ${summary}
      <div class="split">
        <section class="section">
          <h2 class="section-title">Vacating Notice Form</h2>
          <form id="vacatingForm" class="stack">
            <div class="field">
              <label for="moveOutDate">Move-out date</label>
              <input class="input" id="moveOutDate" type="date" />
            </div>
            <div class="field">
              <label for="vacatingPhone">Phone number</label>
              <input class="input" id="vacatingPhone" value="${escapeHtml(tenant.phone_number || "")}" />
            </div>
            <div class="field">
              <label for="forwardingAddress">Forwarding address</label>
              <input class="input" id="forwardingAddress" placeholder="Where should final documents be sent?" />
            </div>
            <div class="field">
              <label for="vacatingReason">Reason</label>
              <textarea class="input textarea" id="vacatingReason" placeholder="Share your reason for moving out"></textarea>
            </div>
            <button class="button" type="submit">Submit Vacating Notice</button>
            <div class="status" id="vacatingStatus"></div>
          </form>
        </section>
        <section class="section">
          <h2 class="section-title">Submitted Notices</h2>
          ${notices.length ? `<div class="list">${notices.map((notice) => `<article class="list-item"><strong>${escapeHtml(notice.status)}</strong><div>Move-out date: ${escapeHtml(formatDate(notice.move_out_date))}</div><div class="muted">${escapeHtml(notice.reason || "No reason provided")}</div><div class="muted">${escapeHtml(formatDate(notice.created_at))}</div></article>`).join("")}</div>` : '<div class="empty">You have not submitted a vacating notice yet.</div>'}
        </section>
      </div>
    `;
    document.getElementById("vacatingForm").addEventListener("submit", handleVacatingSubmit);
    return;
  }

  if (view === "documents") {
    content.innerHTML = `
      ${summary}
      <section class="section">
        <h2 class="section-title">Tenant Portal Documents</h2>
        ${documents.length ? `
          <div class="list">
            ${documents.map((doc) => `
              <article class="list-item">
                <strong>${escapeHtml(doc.name)}</strong>
                <div class="muted">${escapeHtml(doc.category || "Document")} | ${escapeHtml(doc.status || "AVAILABLE")}${doc.scope === "shared" ? " | Shared with all tenants" : ""}</div>
                <div class="muted">Added: ${escapeHtml(formatDate(doc.created_at))}</div>
                ${doc.url ? `<div style="margin-top:12px;"><a class="button secondary" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener">Open Document</a></div>` : ""}
              </article>
            `).join("")}
          </div>
        ` : '<div class="empty">No documents are available yet.</div>'}
      </section>
    `;
    return;
  }

  if (view === "profile") {
    content.innerHTML = `
      ${summary}
      <div class="split">
        <section class="section">
          <h2 class="section-title">Edit Profile</h2>
          <form id="profileForm" class="stack">
            <div class="field">
              <label for="profileFirstName">First name</label>
              <input class="input" id="profileFirstName" value="${escapeHtml(tenant.first_name || "")}" />
            </div>
            <div class="field">
              <label for="profileLastName">Last name</label>
              <input class="input" id="profileLastName" value="${escapeHtml(tenant.last_name || "")}" />
            </div>
            <div class="field">
              <label for="profilePhone">Phone</label>
              <input class="input" id="profilePhone" value="${escapeHtml(tenant.phone_number || "")}" />
            </div>
            <div class="field">
              <label for="profileEmail">Email</label>
              <input class="input" id="profileEmail" value="${escapeHtml(tenant.email_address || "")}" />
            </div>
            <div class="field">
              <label for="profileNationalId">National ID</label>
              <input class="input" id="profileNationalId" value="${escapeHtml(tenant.national_id || "")}" />
            </div>
            <button class="button" type="submit">Save profile</button>
            <div class="status" id="profileStatus"></div>
          </form>
        </section>
        <section class="section">
          <h2 class="section-title">Read-Only Account Info</h2>
          <div class="profile-grid">
            ${meta("Tenant ID", tenant.tenant_id)}
            ${meta("Property", tenant.property_name)}
            ${meta("House Number", tenant.house_number)}
            ${meta("Deposit", formatMoney(tenant.deposit || 0))}
            ${meta("Verification", tenant.id_verification_status)}
          </div>
        </section>
      </div>
    `;
    document.getElementById("profileForm").addEventListener("submit", handleProfileSubmit);
    return;
  }

  if (view === "transactions") {
    content.innerHTML = `
      ${summary}
      <section class="section">
        <h2 class="section-title">Transactions</h2>
        ${transactions.length ? `
          <div class="list">
            ${transactions.map((item) => `
              <article class="list-item">
                <strong>${escapeHtml(item.description || item.type || "Transaction")}</strong>
                <div>${escapeHtml(formatMoney(item.amount))}</div>
                <div class="muted">${escapeHtml(formatDate(item.date_created))}</div>
              </article>
            `).join("")}
          </div>
        ` : '<div class="empty">No transactions have been recorded for this tenant yet.</div>'}
      </section>
    `;
    return;
  }

  if (view === "arrears") {
    content.innerHTML = `
      ${summary}
      <section class="section">
        <h2 class="section-title">Arrears</h2>
        ${arrears.length ? `
          <div class="list">
            ${arrears.map((item) => `
              <article class="list-item">
                <strong>${escapeHtml(item.description || "Outstanding charge")}</strong>
                <div>${escapeHtml(formatMoney(item.balance))}</div>
                <div class="muted">Due: ${escapeHtml(formatDate(item.due_date))}</div>
              </article>
            `).join("")}
          </div>
        ` : '<div class="empty">No arrears are currently recorded.</div>'}
      </section>
    `;
    return;
  }

  if (view === "agreements") {
    content.innerHTML = `
      ${summary}
      <section class="section">
        <h2 class="section-title">Active Leases</h2>
        ${agreements.length ? `
          <div class="list">
            ${agreements.map((item) => `
              <article class="list-item">
                <strong>${escapeHtml(item.agreement_title || item.lease_name || "Tenancy Agreement")}</strong>
                <div>${escapeHtml(formatMoney(item.monthly_rent || tenant.rent))}</div>
                <div class="muted">${escapeHtml(item.status || "Draft")} | ${escapeHtml(item.start_date || "N/A")} to ${escapeHtml(item.end_date || "N/A")}</div>
              </article>
            `).join("")}
          </div>
        ` : '<div class="empty">No lease records are available yet.</div>'}
      </section>
    `;
    return;
  }

  content.innerHTML = `
    ${summary}
    <div class="split">
      <section class="section">
        <h2 class="section-title">Dashboard Overview</h2>
        <div class="list">
          <div class="list-item">
            <div class="meta-label">Occupancy</div>
            <p class="meta-value">${escapeHtml(String(overview?.portfolio?.occupied_units ?? 0))} occupied / ${escapeHtml(String(overview?.portfolio?.total_units ?? 0))} total units</p>
          </div>
          <div class="list-item">
            <div class="meta-label">Vacancies</div>
            <p class="meta-value">${escapeHtml(String(overview?.portfolio?.vacant_units ?? 0))} units available</p>
          </div>
          <div class="list-item">
            <div class="meta-label">Active Lease</div>
            <p class="meta-value">${escapeHtml(overview?.tenant?.active_lease ? "Yes" : "No")}</p>
          </div>
          <div class="list-item">
            <div class="meta-label">Next Payment Target</div>
            <p class="meta-value">${escapeHtml(formatMoney(overview?.tenant?.next_payment_target || tenant.rent))}</p>
          </div>
        </div>
      </section>
      <section class="section">
        <h2 class="section-title">Recent Activity</h2>
        ${transactions.length ? `
          <div class="list">
            ${transactions.slice(0, 4).map((item) => `
              <article class="list-item">
                <strong>${escapeHtml(item.description || item.type || "Transaction")}</strong>
                <div>${escapeHtml(formatMoney(item.amount))}</div>
                <div class="muted">${escapeHtml(formatDate(item.date_created))}</div>
              </article>
            `).join("")}
          </div>
        ` : '<div class="empty">No recent transactions yet.</div>'}
      </section>
    </div>
    <div class="split">
      <section class="section">
        <h2 class="section-title">Active Alerts</h2>
        ${alerts.length ? `
          <div class="list">
            ${alerts.slice(0, 3).map((item) => `
              <article class="list-item">
                <strong>${escapeHtml(item.title)}</strong>
                <div>${escapeHtml(item.message)}</div>
              </article>
            `).join("")}
          </div>
        ` : '<div class="empty">No active alerts.</div>'}
      </section>
      <section class="section">
        <h2 class="section-title">Maintenance Snapshot</h2>
        ${openMaintenance.length ? `
          <div class="list">
            ${openMaintenance.slice(0, 3).map((ticket) => `
              <article class="list-item">
                <strong>${escapeHtml(ticket.title)}</strong>
                <div class="muted">${escapeHtml(normalizeTicketStatus(ticket.status))} | ${escapeHtml(ticket.priority)}</div>
              </article>
            `).join("")}
          </div>
        ` : '<div class="empty">No open maintenance tickets.</div>'}
      </section>
    </div>
  `;
}

async function handlePaymentSubmit(event) {
  event.preventDefault();
  const statusEl = document.getElementById("paymentStatus");
  statusEl.className = "status";
  statusEl.textContent = "Submitting payment confirmation...";

  try {
    const method = document.getElementById("paymentMethod").value;
    const payment_for = document.getElementById("paymentFor").value;
    const amount = document.getElementById("paymentAmount").value.trim();
    const phone_number = document.getElementById("paymentPhone").value.trim();
    const reference = document.getElementById("paymentReference").value.trim();
    const note = document.getElementById("paymentNote").value.trim();
    await api("/api/pegasus/visionary/mpesa/StkPush", {
      body: {
        ...getBody(),
        method,
        payment_for,
        amount,
        phone_number,
        reference,
        note,
      },
    });
    statusEl.textContent = "Payment confirmation submitted for verification.";
    statusEl.className = "status success";
    await loadDashboardData("payments");
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.className = "status error";
  }
}

async function handleMessageReplySubmit(event) {
  event.preventDefault();
  const statusEl = document.getElementById("messageReplyStatus");
  statusEl.className = "status";
  statusEl.textContent = "Sending message...";

  try {
    const subject = document.getElementById("replySubject").value.trim();
    const body = document.getElementById("replyBody").value.trim();
    await api("/api/pegasus/visionary/tenant/app/messages/send", {
      body: {
        ...getBody(),
        subject,
        body,
        category: "Tenant Reply",
      },
    });
    statusEl.textContent = "Message sent to admin.";
    statusEl.className = "status success";
    await loadDashboardData("messages");
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.className = "status error";
  }
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const statusEl = document.getElementById("profileStatus");
  statusEl.className = "status";
  statusEl.textContent = "Saving profile...";

  try {
    const response = await api("/api/pegasus/visionary/tenant/app/profile/update", {
      body: {
        ...getBody(),
        first_name: document.getElementById("profileFirstName").value.trim(),
        last_name: document.getElementById("profileLastName").value.trim(),
        phone_number: document.getElementById("profilePhone").value.trim(),
        email_address: document.getElementById("profileEmail").value.trim(),
        national_id: document.getElementById("profileNationalId").value.trim(),
      },
    });

    const session = getSession();
    setSession({ ...session, ...response.user });
    statusEl.textContent = "Profile updated.";
    statusEl.className = "status success";
    await loadDashboardData("profile");
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.className = "status error";
  }
}

async function handleMaintenanceSubmit(event) {
  event.preventDefault();
  const statusEl = document.getElementById("maintenanceStatus");
  statusEl.className = "status";
  statusEl.textContent = "Creating maintenance request...";

  try {
    const title = document.getElementById("maintenanceTitle").value.trim();
    const description = document.getElementById("maintenanceDescription").value.trim();
    const priority = document.getElementById("maintenancePriority").value;
    await api("/api/pegasus/visionary/tickets/api/tickets/create", {
      body: {
        ...getBody(),
        title,
        description,
        priority,
      },
    });
    statusEl.textContent = "Maintenance request created.";
    statusEl.className = "status success";
    await loadDashboardData("maintenance");
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.className = "status error";
  }
}

async function handleVacatingSubmit(event) {
  event.preventDefault();
  const statusEl = document.getElementById("vacatingStatus");
  statusEl.className = "status";
  statusEl.textContent = "Submitting vacating notice...";

  try {
    const move_out_date = document.getElementById("moveOutDate").value;
    const phone_number = document.getElementById("vacatingPhone").value.trim();
    const forwarding_address = document.getElementById("forwardingAddress").value.trim();
    const reason = document.getElementById("vacatingReason").value.trim();
    await api("/api/pegasus/visionary/tenant/app/AddNotice", {
      body: {
        ...getBody(),
        move_out_date,
        phone_number,
        forwarding_address,
        reason,
      },
    });
    statusEl.textContent = "Vacating notice submitted.";
    statusEl.className = "status success";
    await loadDashboardData("vacating");
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.className = "status error";
  }
}

function summaryCard(label, value, tone = "", view = "") {
  return `
    <section class="card ${tone ? `card-${escapeHtml(tone)}` : ""}" ${view ? `data-view="${escapeHtml(view)}" style="cursor:pointer;"` : ""}>
      <p class="card-title">${escapeHtml(label)}</p>
      <h2 class="card-value">${escapeHtml(value)}</h2>
    </section>
  `;
}

function meta(label, value) {
  return `
    <div class="list-item">
      <div class="meta-label">${escapeHtml(label)}</div>
      <p class="meta-value">${escapeHtml(value || "N/A")}</p>
    </div>
  `;
}

render();



