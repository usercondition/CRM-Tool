const POLL_MS = 30000;

function getToken() {
  const parts = location.pathname.split("/track/");
  return parts[1] ? decodeURIComponent(parts[1].replace(/\/$/, "")) : "";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d + (d.length === 10 ? "T12:00:00" : ""));
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusClass(status) {
  const map = {
    New: "status--new",
    "In Progress": "status--progress",
    Ready: "status--ready",
    Shipped: "status--shipped",
    Delivered: "status--delivered",
  };
  return map[status] || "";
}

function activityIcon(type) {
  const map = { created: "＋", status: "↦", payment: "$", due_date: "📅", amount: "¤", note: "💬" };
  return map[type] || "•";
}

function render(order) {
  const root = document.getElementById("track-root");
  const timeline =
    order.activity?.length > 0
      ? order.activity
          .map(
            (a) => `<li class="timeline__item">
              <span class="timeline__icon" aria-hidden="true">${activityIcon(a.type)}</span>
              <div>
                <div class="timeline__title">${escapeHtml(a.message)}</div>
                <div class="timeline__meta">${formatDateTime(a.createdAt)}</div>
              </div>
            </li>`
          )
          .join("")
      : `<li class="timeline__item timeline__item--empty">Updates will appear here as your order progresses.</li>`;

  root.innerHTML = `
    <header class="track__header">
      <div class="track__brand">
        <span class="track__mark" aria-hidden="true">◫</span>
        <div>
          <strong>Order status</strong>
          <span>${escapeHtml(order.clientName || "Your order")}</span>
        </div>
      </div>
      <button type="button" class="track__refresh" id="track-refresh">Refresh</button>
    </header>
    <section class="track__hero">
      <p class="track__label">Order</p>
      <h1>${escapeHtml(order.orderId)}</h1>
      <div class="track__badges">
        <span class="status ${statusClass(order.status)}">${escapeHtml(order.status)}</span>
        <span class="payment payment--${escapeHtml(order.paymentStatus.toLowerCase())}">${escapeHtml(order.paymentStatus)}</span>
        ${order.daysOverdue ? `<span class="status status--late">${order.daysOverdue} days past due</span>` : ""}
      </div>
    </section>
    <section class="track__grid">
      <div class="track__card">
        <span class="track__card-label">Received</span>
        <strong>${formatDate(order.dateReceived)}</strong>
      </div>
      <div class="track__card">
        <span class="track__card-label">Due date</span>
        <strong>${formatDate(order.dueDate)}</strong>
      </div>
      <div class="track__card">
        <span class="track__card-label">Quantity</span>
        <strong>${order.quantity || 0}</strong>
      </div>
      <div class="track__card">
        <span class="track__card-label">Total</span>
        <strong>${money(order.totalCost)}</strong>
      </div>
      ${order.invoiceNumber ? `<div class="track__card"><span class="track__card-label">Invoice #</span><strong>${escapeHtml(order.invoiceNumber)}</strong></div>` : ""}
      ${order.poNumber ? `<div class="track__card"><span class="track__card-label">PO #</span><strong>${escapeHtml(order.poNumber)}</strong></div>` : ""}
    </section>
    ${
      order.items
        ? `<section class="track__section"><h2>Items</h2><p>${escapeHtml(order.items)}</p></section>`
        : ""
    }
    <section class="track__section">
      <h2>Timeline</h2>
      <ul class="timeline">${timeline}</ul>
    </section>
    <footer class="track__footer">
      <span id="track-updated">Last updated ${formatDateTime(order.updatedAt)}</span>
      <span>Auto-refreshes every 30 seconds</span>
    </footer>
  `;

  document.getElementById("track-refresh").onclick = () => load(true);
}

function renderError(message) {
  document.getElementById("track-root").innerHTML = `
    <div class="track__error">
      <h1>Order not found</h1>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="track__refresh" onclick="location.reload()">Try again</button>
    </div>
  `;
}

let lastUpdatedAt = "";

async function load(manual = false) {
  const token = getToken();
  if (!token) {
    renderError("This link is invalid.");
    return;
  }
  try {
    const res = await fetch(`/api/public/orders/${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Order not found.");
    if (manual || data.updatedAt !== lastUpdatedAt) {
      lastUpdatedAt = data.updatedAt;
      render(data);
    } else {
      const el = document.getElementById("track-updated");
      if (el) el.textContent = `Last checked ${formatDateTime(new Date().toISOString())} · no changes`;
    }
  } catch (err) {
    if (!lastUpdatedAt) renderError(err.message);
  }
}

load();
setInterval(load, POLL_MS);
