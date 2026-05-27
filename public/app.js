const state = {
  view: "dashboard",
  meta: null,
  clients: [],
  orders: [],
  dashboard: null,
  orderFilter: { q: "", status: "", clientId: "" },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function money(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d + (d.length === 10 ? "T12:00:00" : ""));
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
    actions.innerHTML = `<button type="button" class="btn btn--primary" id="add-order-btn">+ New order</button>`;
    $("#add-order-btn").onclick = () => openOrderModal();
    return;
  }
  if (state.view === "clients") {
    actions.innerHTML = `<button type="button" class="btn btn--primary" id="add-client-btn">+ New client</button>`;
    $("#add-client-btn").onclick = () => openClientModal();
    return;
  }
  actions.innerHTML = "";
}

async function loadAll() {
  const [meta, clients, orders, dashboard] = await Promise.all([
    api("/api/meta"),
    api("/api/clients"),
    api("/api/orders"),
    api("/api/dashboard"),
  ]);
  state.meta = meta;
  state.clients = clients;
  state.orders = orders;
  state.dashboard = dashboard;
}

function renderCurrentView() {
  if (state.view === "dashboard") renderDashboard();
  if (state.view === "orders") renderOrders();
  if (state.view === "clients") renderClients();
}

function renderDashboard() {
  const d = state.dashboard;
  if (!d) return;

  $("#view-dashboard").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="stat__label">Clients</div><div class="stat__value">${d.totalClients}</div></div>
      <div class="stat"><div class="stat__label">Open orders</div><div class="stat__value">${d.openOrders}</div></div>
      <div class="stat"><div class="stat__label">Overdue</div><div class="stat__value">${d.overdueOrders}</div></div>
      <div class="stat"><div class="stat__label">Open value</div><div class="stat__value money">${money(d.openValue)}</div></div>
    </div>
    <div class="grid-2">
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
        <div class="panel__header"><h2>Pipeline</h2></div>
        <div style="padding:1rem;">
          ${state.meta.orderStatuses
            .map(
              (s) => `<div style="display:flex;justify-content:space-between;padding:0.55rem 0;border-bottom:1px solid var(--border);">
                <span>${escapeHtml(s)}</span><strong>${d.byStatus[s] || 0}</strong>
              </div>`
            )
            .join("")}
        </div>
      </div>
    </div>
  `;

  $$("#view-dashboard tr[data-order-id]").forEach((row) => {
    row.style.cursor = "pointer";
    row.onclick = () => openOrderModal(row.dataset.orderId);
  });
}

function filteredOrders() {
  const q = state.orderFilter.q.trim().toLowerCase();
  return state.orders.filter((o) => {
    if (state.orderFilter.status && o.status !== state.orderFilter.status) return false;
    if (state.orderFilter.clientId && o.clientId !== state.orderFilter.clientId) return false;
    if (!q) return true;
    const hay = [o.orderId, o.clientName, o.items, o.notes].join(" ").toLowerCase();
    return hay.includes(q);
  });
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

  $$("[data-order-id]").forEach((el) => {
    el.onclick = () => openOrderModal(el.dataset.orderId);
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

function openModal(title, bodyHtml, onSave) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHtml;
  const dialog = $("#modal");
  dialog.showModal();
  const form = $("#modal-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await onSave(new FormData(form));
      dialog.close();
    } catch (err) {
      toast(err.message);
    }
  };
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
  openModal(existing ? "Edit client" : "New client", body, async (fd) => {
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

  openModal(existing ? "Edit order" : "New order", body, async (fd) => {
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
}

async function init() {
  wireChrome();
  try {
    await loadAll();
    setView("dashboard");
  } catch (err) {
    toast(err.message);
  }
}

init();
