const state = {
  view: "dashboard",
  meta: null,
  auth: null,
  clients: [],
  orders: [],
  dashboard: null,
  orderFilter: { q: "", status: "", clientId: "", attention: "" },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/auth/login") {
    showLogin();
    throw new Error(data.error || "Login required.");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showLogin(message = "") {
  $("#app-root").hidden = true;
  $("#login-screen").hidden = false;
  const err = $("#login-error");
  if (message) {
    err.textContent = message;
    err.hidden = false;
  } else {
    err.hidden = true;
  }
}

function showApp(loading = false) {
  $("#login-screen").hidden = true;
  $("#app-root").hidden = false;
  if (loading) {
    $("#view-dashboard").hidden = false;
    $$(".view").forEach((el) => {
      if (el.id !== "view-dashboard") el.hidden = true;
    });
    $("#view-dashboard").innerHTML = `<div class="app-loading">Loading your CRM…</div>`;
  }
}

function updateChrome() {
  const badge = $("#storage-badge");
  const logout = $("#logout-btn");
  if (state.meta?.storage === "postgres") {
    badge.textContent = "Storage: PostgreSQL";
  } else {
    badge.textContent = "Storage: local JSON";
  }
  logout.hidden = !state.auth?.authRequired;
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
  const dt = new Date(iso);
  return dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function paymentBadge(status) {
  if (status === "Paid") return `<span class="badge badge--delivered">${escapeHtml(status)}</span>`;
  if (status === "Partial") return `<span class="badge badge--progress">${escapeHtml(status)}</span>`;
  if (status === "Refunded") return `<span class="badge badge--overdue">${escapeHtml(status)}</span>`;
  return `<span class="badge badge--overdue">${escapeHtml(status)}</span>`;
}

function activityIcon(type) {
  const map = { created: "＋", status: "↦", payment: "$", due_date: "📅", amount: "¤", note: "💬" };
  return map[type] || "•";
}

function statusBadge(status) {
  const map = {
    New: "badge--new",
    "In Progress": "badge--progress",
    Shipped: "badge--shipped",
    Delivered: "badge--delivered",
  };
  return `<span class="badge ${map[status] || ""}">${escapeHtml(status)}</span>`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function setView(view) {
  state.view = view;
  $$(".nav__item").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.view === view));
  $$(".view").forEach((section) => {
    section.hidden = section.id !== `view-${view}`;
  });

  const titles = {
    dashboard: ["Dashboard", "Overview of clients and open work"],
    orders: ["Orders", "Track status, due dates, and payments"],
    clients: ["Clients", "Contact directory and open order counts"],
  };
  const [title, subtitle] = titles[view];
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;
  renderTopbarActions();
  renderCurrentView();
}

function renderTopbarActions() {
  const actions = $("#topbar-actions");
  if (state.view === "orders") {
    actions.innerHTML = `
      <button type="button" class="btn" id="export-orders-btn">Export CSV</button>
      <button type="button" class="btn btn--primary" id="add-order-btn">+ New order</button>`;
    $("#export-orders-btn").onclick = () => downloadExport("/api/export/orders.csv", "orders.csv");
    $("#add-order-btn").onclick = () => openOrderModal();
    return;
  }
  if (state.view === "clients") {
    actions.innerHTML = `
      <button type="button" class="btn" id="export-clients-btn">Export CSV</button>
      <button type="button" class="btn btn--primary" id="add-client-btn">+ New client</button>`;
    $("#export-clients-btn").onclick = () => downloadExport("/api/export/clients.csv", "clients.csv");
    $("#add-client-btn").onclick = () => openClientModal();
    return;
  }
  actions.innerHTML = "";
}

function downloadExport(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  toast("Download started");
}

async function loadAll() {
  const [auth, meta, clients, orders, dashboard] = await Promise.all([
    api("/api/auth/status"),
    api("/api/meta"),
    api("/api/clients"),
    api("/api/orders"),
    api("/api/dashboard"),
  ]);
  state.auth = auth;
  state.meta = meta;
  state.clients = clients;
  state.orders = orders;
  state.dashboard = dashboard;
  updateChrome();
}

function renderCurrentView() {
  if (state.view === "dashboard") renderDashboard();
  if (state.view === "orders") renderOrders();
  if (state.view === "clients") renderClients();
}

function renderDashboard() {
  const d = state.dashboard;
  if (!d) return;

  const overdueRows =
    d.needsAttention?.overdue?.length > 0
      ? d.needsAttention.overdue
          .map(
            (o) => `<tr data-order-id="${o.id}">
              <td><strong>${escapeHtml(o.orderId)}</strong></td>
              <td>${escapeHtml(o.clientName)}</td>
              <td><span class="badge badge--overdue">${o.daysOverdue}d late</span></td>
              <td class="money">${money(o.totalCost)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="empty">No overdue orders</td></tr>`;

  const unpaidRows =
    d.needsAttention?.unpaid?.length > 0
      ? d.needsAttention.unpaid
          .map(
            (o) => `<tr data-order-id="${o.id}">
              <td><strong>${escapeHtml(o.orderId)}</strong></td>
              <td>${escapeHtml(o.clientName)}</td>
              <td>${paymentBadge(o.paymentStatus)}</td>
              <td class="money">${money(o.totalCost)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="empty">All open orders are paid</td></tr>`;

  const activityItems =
    d.recentActivity?.length > 0
      ? d.recentActivity
          .map(
            (a) => `<li class="timeline__item" data-order-id="${escapeHtml(a.orderId)}">
              <span class="timeline__icon" aria-hidden="true">${activityIcon(a.type)}</span>
              <div>
                <div class="timeline__title">${escapeHtml(a.orderLabel)} · ${escapeHtml(a.message)}</div>
                <div class="timeline__meta">${formatDateTime(a.createdAt)}${a.clientName ? ` · ${escapeHtml(a.clientName)}` : ""}</div>
              </div>
            </li>`
          )
          .join("")
      : `<li class="timeline__item timeline__item--empty">Activity will appear as you update orders.</li>`;

  $("#view-dashboard").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="stat__label">Clients</div><div class="stat__value">${d.totalClients}</div></div>
      <div class="stat"><div class="stat__label">Open orders</div><div class="stat__value">${d.openOrders}</div></div>
      <div class="stat stat--warn"><div class="stat__label">Overdue</div><div class="stat__value">${d.overdueOrders}</div></div>
      <div class="stat stat--warn"><div class="stat__label">Unpaid (open)</div><div class="stat__value">${d.unpaidOrders}</div></div>
      <div class="stat"><div class="stat__label">Open value</div><div class="stat__value money">${money(d.openValue)}</div></div>
      <div class="stat"><div class="stat__label">Unpaid value</div><div class="stat__value money">${money(d.unpaidValue || 0)}</div></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel__header"><h2>Needs attention — overdue</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Client</th><th>Late</th><th>Total</th></tr></thead>
            <tbody>${overdueRows}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel__header"><h2>Needs attention — unpaid</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Client</th><th>Payment</th><th>Total</th></tr></thead>
            <tbody>${unpaidRows}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="grid-2" style="margin-top:1rem;">
      <div class="panel">
        <div class="panel__header"><h2>Recent orders</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Client</th><th>Status</th><th>Due</th><th>Total</th></tr></thead>
            <tbody>
              ${d.recentOrders
                .map(
                  (o) => `<tr data-order-id="${o.id}">
                    <td><strong>${escapeHtml(o.orderId)}</strong></td>
                    <td>${escapeHtml(o.clientName)}</td>
                    <td>${statusBadge(o.status)}</td>
                    <td>${formatDate(o.dueDate)}${o.daysOverdue ? ` <span class="badge badge--overdue">${o.daysOverdue}d late</span>` : ""}</td>
                    <td class="money">${money(o.totalCost)}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel__header"><h2>Recent activity</h2></div>
        <ul class="timeline">${activityItems}</ul>
      </div>
    </div>
  `;

  $$("#view-dashboard [data-order-id]").forEach((el) => {
    el.style.cursor = "pointer";
    el.onclick = () => openOrderDetail(el.dataset.orderId);
  });
}

function filteredOrders() {
  const q = state.orderFilter.q.trim().toLowerCase();
  return state.orders.filter((o) => {
    if (state.orderFilter.status && o.status !== state.orderFilter.status) return false;
    if (state.orderFilter.clientId && o.clientId !== state.orderFilter.clientId) return false;
    if (state.orderFilter.attention === "overdue" && !(o.isOpen && o.daysOverdue > 0)) return false;
    if (
      state.orderFilter.attention === "unpaid" &&
      !(o.isOpen && (o.paymentStatus === "Unpaid" || o.paymentStatus === "Partial"))
    )
      return false;
    if (state.orderFilter.attention === "open" && !o.isOpen) return false;
    if (!q) return true;
    const hay = [o.orderId, o.clientName, o.items, o.notes].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function attentionChip(value, label) {
  const active = state.orderFilter.attention === value ? " is-active" : "";
  return `<button type="button" class="chip${active}" data-attention="${value}">${label}</button>`;
}

function renderOrders() {
  const orders = filteredOrders();
  const clientOptions = state.clients
    .map((c) => `<option value="${c.id}" ${state.orderFilter.clientId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
    .join("");

  const kanbanCols = state.meta.orderStatuses
    .map((status) => {
      const cards = orders
        .filter((o) => o.status === status)
        .map(
          (o) => `<div class="card" data-order-id="${o.id}">
            <div class="card__title">${escapeHtml(o.orderId)}</div>
            <div class="card__meta">${escapeHtml(o.clientName)} · ${money(o.totalCost)}</div>
            ${o.daysOverdue ? `<div class="card__meta"><span class="badge badge--overdue">${o.daysOverdue}d overdue</span></div>` : ""}
          </div>`
        )
        .join("");
      return `<div class="kanban__col"><h3 class="kanban__title">${escapeHtml(status)}</h3>${cards || `<div class="empty" style="padding:0.5rem;">None</div>`}</div>`;
    })
    .join("");

  $("#view-orders").innerHTML = `
    <div class="filters">
      <input type="search" id="order-search" placeholder="Search orders…" value="${escapeHtml(state.orderFilter.q)}" />
      <select id="order-status-filter">
        <option value="">All statuses</option>
        ${state.meta.orderStatuses.map((s) => `<option value="${s}" ${state.orderFilter.status === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <select id="order-client-filter">
        <option value="">All clients</option>
        ${clientOptions}
      </select>
    </div>
    <div class="chips">
      ${attentionChip("", "All")}
      ${attentionChip("open", "Open")}
      ${attentionChip("overdue", "Overdue")}
      ${attentionChip("unpaid", "Unpaid")}
    </div>
    <div class="kanban">${kanbanCols}</div>
    <div class="panel">
      <div class="panel__header"><h2>All orders</h2></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order ID</th><th>Client</th><th>Received</th><th>Due</th><th>Status</th><th>Payment</th><th>Total</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${
              orders.length
                ? orders
                    .map(
                      (o) => `<tr>
                        <td><strong>${escapeHtml(o.orderId)}</strong><div style="color:var(--muted);font-size:0.82rem;">${escapeHtml(o.items || "")}</div></td>
                        <td>${escapeHtml(o.clientName)}</td>
                        <td>${formatDate(o.dateReceived)}</td>
                        <td>${formatDate(o.dueDate)}${o.daysOverdue ? `<div><span class="badge badge--overdue">${o.daysOverdue}d late</span></div>` : ""}</td>
                        <td>${statusBadge(o.status)}</td>
                        <td>${escapeHtml(o.paymentStatus)}</td>
                        <td class="money">${money(o.totalCost)}</td>
                        <td class="row-actions">
                          <button type="button" class="btn" data-view-order="${o.id}">View</button>
                          <button type="button" class="btn" data-edit-order="${o.id}">Edit</button>
                          <button type="button" class="btn btn--danger" data-delete-order="${o.id}">Delete</button>
                        </td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="8" class="empty">No orders match your filters.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $("#order-search").oninput = (e) => {
    state.orderFilter.q = e.target.value;
    renderOrders();
  };
  $("#order-status-filter").onchange = (e) => {
    state.orderFilter.status = e.target.value;
    renderOrders();
  };
  $("#order-client-filter").onchange = (e) => {
    state.orderFilter.clientId = e.target.value;
    renderOrders();
  };
  $$(".chip[data-attention]").forEach((chip) => {
    chip.onclick = () => {
      state.orderFilter.attention = chip.dataset.attention;
      renderOrders();
    };
  });

  $$("[data-order-id]").forEach((el) => {
    if (el.closest(".row-actions")) return;
    el.onclick = () => openOrderDetail(el.dataset.orderId);
  });
  $$("[data-view-order]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openOrderDetail(btn.dataset.viewOrder);
    };
  });
  $$("[data-edit-order]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openOrderModal(btn.dataset.editOrder);
    };
  });
  $$("[data-delete-order]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this order?")) return;
      await api(`/api/orders/${btn.dataset.deleteOrder}`, { method: "DELETE" });
      toast("Order deleted");
      await refresh();
    };
  });
}

function renderClients() {
  $("#view-clients").innerHTML = `
    <div class="panel">
      <div class="panel__header"><h2>Client directory</h2></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Contact</th><th>Open orders</th><th>Open value</th><th></th></tr>
          </thead>
          <tbody>
            ${
              state.clients.length
                ? state.clients
                    .map(
                      (c) => `<tr>
                        <td>
                          <strong>${escapeHtml(c.name)}</strong>
                          ${c.notes ? `<div style="color:var(--muted);font-size:0.82rem;">${escapeHtml(c.notes)}</div>` : ""}
                        </td>
                        <td>
                          ${c.email ? `<div>${escapeHtml(c.email)}</div>` : ""}
                          ${c.phone ? `<div style="color:var(--muted);">${escapeHtml(c.phone)}</div>` : ""}
                          ${c.address ? `<div style="color:var(--muted);font-size:0.82rem;">${escapeHtml(c.address)}</div>` : ""}
                        </td>
                        <td>${c.totalOpenOrders}</td>
                        <td class="money">${money(c.totalOpenValue)}</td>
                        <td class="row-actions">
                          <button type="button" class="btn" data-view-client="${c.id}">View</button>
                          <button type="button" class="btn" data-edit-client="${c.id}">Edit</button>
                          <button type="button" class="btn" data-view-client-orders="${c.id}">Orders</button>
                          <button type="button" class="btn btn--danger" data-delete-client="${c.id}">Delete</button>
                        </td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="5" class="empty">No clients yet. Add your first client.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $$("[data-edit-client]").forEach((btn) => {
    btn.onclick = () => openClientModal(btn.dataset.editClient);
  });
  $$("[data-view-client]").forEach((btn) => {
    btn.onclick = () => openClientDetail(btn.dataset.viewClient);
  });
  $$("[data-view-client-orders]").forEach((btn) => {
    btn.onclick = () => {
      state.orderFilter.clientId = btn.dataset.viewClientOrders;
      setView("orders");
    };
  });
  $$("[data-delete-client]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this client and all their orders?")) return;
      await api(`/api/clients/${btn.dataset.deleteClient}`, { method: "DELETE" });
      toast("Client deleted");
      await refresh();
    };
  });
}

function openModal(title, bodyHtml, onSave, options = {}) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHtml;
  const panel = $("#modal-panel");
  panel.classList.toggle("modal__panel--wide", Boolean(options.wide));
  const saveBtn = $("#modal-save");
  if (options.hideSave) {
    saveBtn.hidden = true;
    saveBtn.type = "button";
  } else {
    saveBtn.hidden = false;
    saveBtn.type = "submit";
    saveBtn.textContent = options.saveLabel || "Save";
  }
  const dialog = $("#modal");
  dialog.showModal();
  const form = $("#modal-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (options.hideSave) return;
    try {
      await onSave(new FormData(form));
      dialog.close();
    } catch (err) {
      toast(err.message);
    }
  };
}

async function quickOrderPatch(orderId, payload) {
  await api(`/api/orders/${orderId}/quick`, { method: "PATCH", body: JSON.stringify(payload) });
  await refresh();
}

async function openOrderDetail(id) {
  const order = state.orders.find((o) => o.id === id) || (await api(`/api/orders/${id}`));
  const activity = await api(`/api/orders/${id}/activity`);
  const flow = state.meta.orderStatuses;
  const next = flow[flow.indexOf(order.status) + 1];
  const timeline =
    activity.length > 0
      ? activity
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
      : `<li class="timeline__item timeline__item--empty">No activity yet.</li>`;

  const body = `
    <div class="detail-grid">
      <div><span class="detail-label">Client</span><strong>${escapeHtml(order.clientName)}</strong></div>
      <div><span class="detail-label">Status</span>${statusBadge(order.status)}</div>
      <div><span class="detail-label">Payment</span>${paymentBadge(order.paymentStatus)}</div>
      <div><span class="detail-label">Total</span><strong class="money">${money(order.totalCost)}</strong></div>
      <div><span class="detail-label">Received</span>${formatDate(order.dateReceived)}</div>
      <div><span class="detail-label">Due</span>${formatDate(order.dueDate)}${order.daysOverdue ? ` <span class="badge badge--overdue">${order.daysOverdue}d late</span>` : ""}</div>
    </div>
    ${order.items ? `<div class="detail-block"><span class="detail-label">Items</span><p>${escapeHtml(order.items)}</p></div>` : ""}
    ${order.notes ? `<div class="detail-block"><span class="detail-label">Notes</span><p>${escapeHtml(order.notes)}</p></div>` : ""}
    <div class="detail-actions">
      ${next ? `<button type="button" class="btn btn--primary" id="detail-advance">Advance to ${escapeHtml(next)}</button>` : ""}
      ${order.paymentStatus !== "Paid" ? `<button type="button" class="btn" id="detail-mark-paid">Mark paid</button>` : ""}
      <button type="button" class="btn" id="detail-edit">Edit order</button>
    </div>
    <div class="detail-block">
      <span class="detail-label">Activity</span>
      <ul class="timeline timeline--compact">${timeline}</ul>
    </div>
    <div class="detail-note">
      <label for="detail-note-input">Add note</label>
      <div class="detail-note__row">
        <input id="detail-note-input" type="text" placeholder="Call client, shipped via UPS…" />
        <button type="button" class="btn btn--primary" id="detail-add-note">Add</button>
      </div>
    </div>
  `;

  openModal(order.orderId, body, null, { wide: true, hideSave: true });
  $("#modal-cancel").textContent = "Close";

  if (next) {
    $("#detail-advance").onclick = async () => {
      await quickOrderPatch(id, { advanceStatus: true });
      toast(`Moved to ${next}`);
      $("#modal").close();
      openOrderDetail(id);
    };
  }
  if (order.paymentStatus !== "Paid") {
    $("#detail-mark-paid").onclick = async () => {
      await quickOrderPatch(id, { paymentStatus: "Paid" });
      toast("Marked as paid");
      $("#modal").close();
      openOrderDetail(id);
    };
  }
  $("#detail-edit").onclick = () => {
    $("#modal").close();
    openOrderModal(id);
  };
  $("#detail-add-note").onclick = async () => {
    const text = $("#detail-note-input").value.trim();
    if (!text) return;
    await api(`/api/orders/${id}/activity`, { method: "POST", body: JSON.stringify({ message: text }) });
    toast("Note added");
    $("#modal").close();
    await refresh();
    openOrderDetail(id);
  };
}

async function openClientDetail(id) {
  const data = await api(`/api/clients/${id}?detail=1`);
  const orderRows =
    data.orders?.length > 0
      ? data.orders
          .map(
            (o) => `<tr data-order-id="${o.id}">
              <td><strong>${escapeHtml(o.orderId)}</strong></td>
              <td>${statusBadge(o.status)}</td>
              <td>${paymentBadge(o.paymentStatus)}</td>
              <td>${formatDate(o.dueDate)}</td>
              <td class="money">${money(o.totalCost)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="empty">No orders yet</td></tr>`;

  const body = `
    <div class="detail-grid">
      <div><span class="detail-label">Email</span>${escapeHtml(data.email || "—")}</div>
      <div><span class="detail-label">Phone</span>${escapeHtml(data.phone || "—")}</div>
      <div><span class="detail-label">Open orders</span><strong>${data.totalOpenOrders}</strong></div>
      <div><span class="detail-label">Open value</span><strong class="money">${money(data.totalOpenValue)}</strong></div>
    </div>
    ${data.address ? `<div class="detail-block"><span class="detail-label">Address</span><p>${escapeHtml(data.address)}</p></div>` : ""}
    ${data.notes ? `<div class="detail-block"><span class="detail-label">Notes</span><p>${escapeHtml(data.notes)}</p></div>` : ""}
    <div class="detail-actions">
      <button type="button" class="btn btn--primary" id="detail-new-order">+ New order</button>
      <button type="button" class="btn" id="detail-edit-client">Edit client</button>
    </div>
    <div class="detail-block">
      <span class="detail-label">Orders for this client</span>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Status</th><th>Payment</th><th>Due</th><th>Total</th></tr></thead>
          <tbody>${orderRows}</tbody>
        </table>
      </div>
    </div>
  `;

  openModal(data.name, body, null, { wide: true, hideSave: true });
  $("#modal-cancel").textContent = "Close";
  $("#detail-edit-client").onclick = () => {
    $("#modal").close();
    openClientModal(id);
  };
  $("#detail-new-order").onclick = () => {
    $("#modal").close();
    openOrderModal();
    setTimeout(() => {
      const sel = $("#clientId");
      if (sel) sel.value = id;
    }, 50);
  };
  $$("#modal-body [data-order-id]").forEach((row) => {
    row.style.cursor = "pointer";
    row.onclick = () => {
      $("#modal").close();
      openOrderDetail(row.dataset.orderId);
    };
  });
}

function openModalForm(title, bodyHtml, onSave) {
  $("#modal-cancel").textContent = "Cancel";
  openModal(title, bodyHtml, onSave);
}

function field(name, label, value = "", type = "text", options = {}) {
  if (type === "textarea") {
    return `<div class="field"><label for="${name}">${label}</label><textarea id="${name}" name="${name}">${escapeHtml(value)}</textarea></div>`;
  }
  if (type === "select") {
    const opts = (options.choices || [])
      .map((c) => `<option value="${escapeHtml(c)}" ${c === value ? "selected" : ""}>${escapeHtml(c)}</option>`)
      .join("");
    return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${opts}</select></div>`;
  }
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${options.required ? "required" : ""} /></div>`;
}

function openClientModal(id = null) {
  const existing = id ? state.clients.find((c) => c.id === id) : null;
  const body = `
    ${field("name", "Name", existing?.name || "", "text", { required: true })}
    <div class="field-row">
      ${field("email", "Email", existing?.email || "", "email")}
      ${field("phone", "Phone", existing?.phone || "")}
    </div>
    ${field("address", "Address", existing?.address || "")}
    ${field("notes", "Notes", existing?.notes || "", "textarea")}
  `;
  openModalForm(existing ? "Edit client" : "New client", body, async (fd) => {
    const payload = Object.fromEntries(fd.entries());
    if (existing) {
      await api(`/api/clients/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Client updated");
    } else {
      await api("/api/clients", { method: "POST", body: JSON.stringify(payload) });
      toast("Client created");
    }
    await refresh();
  });
}

function openOrderModal(id = null) {
  if (!state.clients.length) {
    toast("Add a client before creating an order.");
    setView("clients");
    return;
  }
  const existing = id ? state.orders.find((o) => o.id === id) : null;
  const clientOptions = state.clients
    .map(
      (c) =>
        `<option value="${c.id}" ${existing ? (existing.clientId === c.id ? "selected" : "") : ""}>${escapeHtml(c.name)}</option>`
    )
    .join("");

  const body = `
    ${field("orderId", "Order ID", existing?.orderId || suggestOrderId(), "text", { required: true })}
    <div class="field"><label for="clientId">Client</label><select id="clientId" name="clientId" required>${clientOptions}</select></div>
    <div class="field-row">
      ${field("dateReceived", "Date received", existing?.dateReceived || today(), "date")}
      ${field("dueDate", "Due date", existing?.dueDate || "", "date")}
    </div>
    ${field("items", "Items / description", existing?.items || "", "textarea")}
    <div class="field-row">
      ${field("quantity", "Quantity", existing?.quantity ?? 1, "number")}
      ${field("totalCost", "Total cost", existing?.totalCost ?? 0, "number")}
    </div>
    <div class="field-row">
      ${field("status", "Status", existing?.status || "New", "select", { choices: state.meta.orderStatuses })}
      ${field("paymentStatus", "Payment status", existing?.paymentStatus || "Unpaid", "select", { choices: state.meta.paymentStatuses })}
    </div>
    ${field("notes", "Notes", existing?.notes || "", "textarea")}
  `;

  openModalForm(existing ? "Edit order" : "New order", body, async (fd) => {
    const payload = Object.fromEntries(fd.entries());
    payload.quantity = Number(payload.quantity);
    payload.totalCost = Number(payload.totalCost);
    if (existing) {
      await api(`/api/orders/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Order updated");
    } else {
      await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
      toast("Order created");
    }
    await refresh();
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function suggestOrderId() {
  const stamp = today().replace(/-/g, "").slice(2);
  return `${new Date().getFullYear()}-${stamp}-`;
}

async function refresh() {
  await loadAll();
  renderCurrentView();
}

function wireChrome() {
  $$(".nav__item").forEach((btn) => {
    btn.onclick = () => setView(btn.dataset.view);
  });
  $("#modal-close").onclick = () => $("#modal").close();
  $("#modal-cancel").onclick = () => $("#modal").close();
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const password = $("#login-password").value;
    const submitBtn = $("#login-form").querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      $("#login-password").value = "";
      showApp(true);
      await loadAll();
      setView("dashboard");
      toast("Signed in");
    } catch (err) {
      showLogin(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  };
  $("#logout-btn").onclick = async () => {
    await api("/api/auth/logout", { method: "POST" });
    showLogin();
    toast("Signed out");
  };
}

async function init() {
  wireChrome();
  try {
    const auth = await api("/api/auth/status");
    state.auth = auth;
    if (auth.authRequired && !auth.authenticated) {
      showLogin();
      return;
    }
    showApp(true);
    await loadAll();
    setView("dashboard");
  } catch (err) {
    showLogin(err.message);
  }
}

init();
