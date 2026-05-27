const state = {
  view: "dashboard",
  meta: null,
  auth: null,
  clients: [],
  orders: [],
  dashboard: null,
  settings: null,
  savedViews: [],
  activeSavedViewId: "",
  orderFilter: { q: "", status: "", clientId: "", attention: "", tag: "" },
  searchTimer: null,
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
  return `<span class="badge badge--unpaid">${escapeHtml(status)}</span>`;
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

function formatAddressDisplay(client) {
  if (!client) return "";
  if (client.addressLine1 || client.city || client.state || client.zip) {
    const lines = [client.addressLine1, client.addressLine2, [client.city, client.state].filter(Boolean).join(", "), client.zip]
      .filter(Boolean);
    return lines.join("\n");
  }
  return client.address || "";
}

function prefixedName(prefix, name) {
  return prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;
}

function buildClientPayloadFromForm(fd, prefix = "") {
  const get = (key) => fd.get(prefixedName(prefix, key)) || "";
  return {
    name: String(get("name")).trim(),
    email: String(get("email")).trim(),
    phone: String(get("phone")).trim(),
    addressLine1: String(get("addressLine1")).trim(),
    addressLine2: String(get("addressLine2")).trim(),
    city: String(get("city")).trim(),
    state: String(get("state")).trim(),
    zip: String(get("zip")).trim(),
    notes: String(get("notes")).trim(),
  };
}

function parseFormDecimal(value, label = "Amount") {
  const s = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!s) return 0;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a valid number.`);
  return n;
}

function decimalField(name, label, value = "", options = {}) {
  const display = value === "" || value == null ? "" : String(value);
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(display)}" placeholder="0.00"${options.required ? " required" : ""} /></div>`;
}

function addressFieldsHtml(prefix = "", parts = {}) {
  const id = (key) => prefixedName(prefix, key);
  const stateOptions = (state.meta?.usStates || [])
    .map(
      ([code, label]) =>
        `<option value="${code}" ${parts.state === code ? "selected" : ""}>${escapeHtml(label)}</option>`
    )
    .join("");
  return `
    <div class="field address-autocomplete-wrap">
      <label for="${id("addressLine1")}">Street address</label>
      <input id="${id("addressLine1")}" name="${id("addressLine1")}" type="text" value="${escapeHtml(parts.addressLine1 || "")}" autocomplete="address-line1" placeholder="Start typing for suggestions…" />
      <div class="address-suggest" id="${id("addressSuggest")}" hidden></div>
    </div>
    ${field("addressLine2", "Apt, suite, unit", parts.addressLine2 || "", "text", { name: id("addressLine2"), id: id("addressLine2") })}
    <div class="field-row">
      ${field("city", "City", parts.city || "", "text", { name: id("city"), id: id("city") })}
      <div class="field">
        <label for="${id("state")}">State</label>
        <select id="${id("state")}" name="${id("state")}">
          <option value="">Select state</option>
          ${stateOptions}
        </select>
      </div>
    </div>
    ${field("zip", "ZIP code", parts.zip || "", "text", { name: id("zip"), id: id("zip"), placeholder: "12345" })}
  `;
}

function fillAddressFields(prefix, data) {
  const set = (key, val) => {
    const el = document.getElementById(prefixedName(prefix, key));
    if (el) el.value = val || "";
  };
  set("addressLine1", data.addressLine1);
  set("addressLine2", data.addressLine2);
  set("city", data.city);
  set("state", data.state);
  set("zip", data.zip);
}

let googleMapsLoadPromise = null;

function loadGoogleMaps(apiKey) {
  if (window.google?.maps?.places) return Promise.resolve();
  if (!googleMapsLoadPromise) {
    googleMapsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google Maps failed to load."));
      document.head.appendChild(script);
    });
  }
  return googleMapsLoadPromise;
}

function wireAddressAutocomplete(prefix = "") {
  const line1 = document.getElementById(prefixedName(prefix, "addressLine1"));
  const suggestBox = document.getElementById(prefixedName(prefix, "addressSuggest"));
  if (!line1) return;

  if (state.meta?.googleMapsApiKey) {
    loadGoogleMaps(state.meta.googleMapsApiKey)
      .then(() => {
        const autocomplete = new google.maps.places.Autocomplete(line1, {
          types: ["address"],
          componentRestrictions: { country: "us" },
          fields: ["address_components", "formatted_address"],
        });
        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          if (!place?.address_components) return;
          const byType = (type) => place.address_components.find((c) => c.types.includes(type));
          const streetNumber = byType("street_number")?.long_name || "";
          const route = byType("route")?.long_name || "";
          fillAddressFields(prefix, {
            addressLine1: [streetNumber, route].filter(Boolean).join(" "),
            addressLine2: byType("subpremise")?.long_name || "",
            city:
              byType("locality")?.long_name ||
              byType("postal_town")?.long_name ||
              byType("sublocality")?.long_name ||
              "",
            state: byType("administrative_area_level_1")?.short_name || "",
            zip: byType("postal_code")?.long_name || "",
          });
        });
      })
      .catch(() => {});
    return;
  }

  if (!suggestBox) return;
  let suggestTimer = null;

  function hideSuggest() {
    suggestBox.hidden = true;
    suggestBox.innerHTML = "";
  }

  line1.addEventListener("input", () => {
    clearTimeout(suggestTimer);
    const q = line1.value.trim();
    if (q.length < 3) {
      hideSuggest();
      return;
    }
    suggestTimer = setTimeout(async () => {
      try {
        const rows = await api(`/api/address/suggest?q=${encodeURIComponent(q)}`);
        if (!rows.length) {
          hideSuggest();
          return;
        }
        suggestBox.innerHTML = rows
          .map(
            (row, i) =>
              `<button type="button" class="address-suggest__hit" data-suggest-idx="${i}">${escapeHtml(row.label)}</button>`
          )
          .join("");
        suggestBox.hidden = false;
        suggestBox._rows = rows;
        suggestBox.querySelectorAll(".address-suggest__hit").forEach((btn) => {
          btn.onclick = () => {
            fillAddressFields(prefix, suggestBox._rows[Number(btn.dataset.suggestIdx)]);
            hideSuggest();
          };
        });
      } catch {
        hideSuggest();
      }
    }, 280);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".address-autocomplete-wrap")) hideSuggest();
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tagBadges(tags) {
  if (!tags?.length) return "";
  return tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
}

function miniBarChart(data, valueKey = "value", maxBars = 30) {
  if (!data?.length) return `<div class="empty">No data yet</div>`;
  const slice = data.slice(-maxBars);
  const max = Math.max(...slice.map((d) => Number(d[valueKey]) || 0), 1);
  return `<div class="mini-chart">${slice
    .map(
      (d) =>
        `<div class="mini-chart__bar" style="--h:${Math.max(4, Math.round(((Number(d[valueKey]) || 0) / max) * 100))}%" title="${escapeHtml(d.date)}: ${money(d[valueKey])}"></div>`
    )
    .join("")}</div>`;
}

function pipelineBars(pipelineCount, pipelineValue) {
  const statuses = state.meta?.orderStatuses || ["New", "In Progress", "Shipped", "Delivered"];
  const maxVal = Math.max(...statuses.map((s) => Number(pipelineValue[s]) || 0), 1);
  return statuses
    .map(
      (s) => `<div class="pipeline-row">
        <span class="pipeline-row__label">${escapeHtml(s)}</span>
        <div class="pipeline-row__bar"><span style="width:${Math.round(((Number(pipelineValue[s]) || 0) / maxVal) * 100)}%"></span></div>
        <span class="pipeline-row__meta">${pipelineCount[s] || 0} · ${money(pipelineValue[s] || 0)}</span>
      </div>`
    )
    .join("");
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
  $("#saved-views-nav").hidden = view !== "orders";

  const titles = {
    dashboard: ["Dashboard", "At-a-glance pipeline, payments, and follow-ups"],
    orders: ["Orders", "Track status, due dates, and payments"],
    clients: ["Clients", "Contact directory and open order counts"],
  };
  const [title, subtitle] = titles[view];
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;
  renderTopbarActions();
  renderSavedViewsNav();
  renderCurrentView();
}

function renderTopbarActions() {
  const actions = $("#topbar-actions");
  if (state.view === "dashboard") {
    actions.innerHTML = `
      <button type="button" class="btn" id="digest-preview-btn">Digest preview</button>
      <button type="button" class="btn btn--primary" id="add-order-dash-btn">+ New order</button>`;
    $("#add-order-dash-btn").onclick = () => openOrderModal();
    $("#digest-preview-btn").onclick = async () => {
      try {
        const res = await fetch("/api/digest/preview", { credentials: "include" });
        const text = await res.text();
        openModal("Daily digest preview", `<pre class="digest-preview">${escapeHtml(text)}</pre>`, null, {
          wide: true,
          hideSave: true,
        });
        $("#modal-cancel").textContent = "Close";
      } catch (err) {
        toast(err.message);
      }
    };
    return;
  }
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
  const [auth, meta, clients, orders, dashboard, settings, savedViews] = await Promise.all([
    api("/api/auth/status"),
    api("/api/meta"),
    api("/api/clients"),
    api("/api/orders"),
    api("/api/dashboard"),
    api("/api/settings"),
    api("/api/saved-views"),
  ]);
  state.auth = auth;
  state.meta = meta;
  state.clients = clients;
  state.orders = orders;
  state.dashboard = dashboard;
  state.settings = settings;
  state.savedViews = savedViews;
  updateChrome();
  maybeNotifyOverdue();
}

function renderCurrentView() {
  if (state.view === "dashboard") renderDashboard();
  if (state.view === "orders") renderOrders();
  if (state.view === "clients") renderClients();
}

function renderDashboard() {
  const d = state.dashboard;
  if (!d) return;

  const strip = d.todayStrip || {};
  const pay = d.paymentSnapshot || {};

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

  const staleRows =
    d.stale?.length > 0
      ? d.stale
          .map(
            (o) => `<tr data-order-id="${o.id}">
              <td><strong>${escapeHtml(o.orderId)}</strong></td>
              <td>${escapeHtml(o.clientName)}</td>
              <td><span class="badge badge--progress">${o.daysSinceUpdate}d idle</span></td>
              <td>${statusBadge(o.status)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="empty">No stale orders</td></tr>`;

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

  const healthRows =
    d.clientHealth?.length > 0
      ? d.clientHealth
          .map(
            (c) => `<tr data-client-id="${c.id}">
              <td><strong>${escapeHtml(c.name)}</strong></td>
              <td>${(c.healthFlags || []).map((f) => `<span class="tag">${escapeHtml(f)}</span>`).join(" ")}</td>
              <td class="money">${money(c.totalOpenValue)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="3" class="empty">All clients look healthy</td></tr>`;

  const calendarCells = (d.calendarDays || [])
    .map(
      (day) => `<div class="cal-day ${day.count ? "cal-day--busy" : ""}" data-cal-date="${day.date}" title="${day.count} due">
        <span class="cal-day__label">${escapeHtml(day.label.split(",")[0] || day.label)}</span>
        <strong>${day.count || "—"}</strong>
      </div>`
    )
    .join("");

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
    <div class="quick-actions">
      <button type="button" class="chip" data-dash-action="overdue">Overdue (${d.overdueOrders})</button>
      <button type="button" class="chip" data-dash-action="unpaid">Unpaid (${d.unpaidOrders})</button>
      <button type="button" class="chip" data-dash-action="stale">Stale (${d.staleOrders || 0})</button>
      <button type="button" class="chip" data-dash-action="open">All open (${d.openOrders})</button>
    </div>
    <div class="today-strip">
      <div class="today-strip__item"><span>Due today</span><strong>${strip.dueToday || 0}</strong><small>${money(strip.dueTodayValue || 0)}</small></div>
      <div class="today-strip__item"><span>Due this week</span><strong>${strip.dueThisWeek || 0}</strong></div>
      <div class="today-strip__item"><span>Received this week</span><strong>${strip.receivedThisWeek || 0}</strong></div>
      <div class="today-strip__item"><span>Shipped this week</span><strong>${strip.shippedThisWeek || 0}</strong></div>
      ${d.avgDaysToDeliver != null ? `<div class="today-strip__item"><span>Avg days to deliver</span><strong>${d.avgDaysToDeliver}</strong></div>` : ""}
    </div>
    <div class="stats">
      <div class="stat"><div class="stat__label">Clients</div><div class="stat__value">${d.totalClients}</div></div>
      <div class="stat"><div class="stat__label">Open orders</div><div class="stat__value">${d.openOrders}</div></div>
      <div class="stat stat--warn"><div class="stat__label">Overdue</div><div class="stat__value">${d.overdueOrders}</div></div>
      <div class="stat stat--warn"><div class="stat__label">Unpaid (open)</div><div class="stat__value">${d.unpaidOrders}</div></div>
      <div class="stat"><div class="stat__label">Open value</div><div class="stat__value money">${money(d.openValue)}</div></div>
      <div class="stat"><div class="stat__label">Outstanding</div><div class="stat__value money">${money(d.unpaidValue || 0)}</div></div>
    </div>
    <div class="grid-3">
      <div class="panel">
        <div class="panel__header"><h2>Pipeline value</h2></div>
        <div class="pipeline">${pipelineBars(d.pipelineCount || {}, d.pipelineValue || {})}</div>
      </div>
      <div class="panel">
        <div class="panel__header"><h2>Payment snapshot</h2></div>
        <ul class="snapshot-list">
          <li><span>Unpaid</span><strong>${pay.unpaid?.count || 0} · ${money(pay.unpaid?.value || 0)}</strong></li>
          <li><span>Partial</span><strong>${pay.partial?.count || 0} · ${money(pay.partial?.value || 0)}</strong></li>
          <li><span>Paid (open)</span><strong>${pay.paidOpen?.count || 0} · ${money(pay.paidOpen?.value || 0)}</strong></li>
          <li><span>Paid this month</span><strong>${pay.paidThisMonth?.count || 0} · ${money(pay.paidThisMonth?.value || 0)}</strong></li>
        </ul>
      </div>
      <div class="panel">
        <div class="panel__header"><h2>Revenue (90 days)</h2></div>
        ${miniBarChart(d.revenueChart)}
      </div>
    </div>
    <div class="panel" style="margin-top:1rem;">
      <div class="panel__header"><h2>Due dates — next 14 days</h2></div>
      <div class="cal-strip">${calendarCells}</div>
    </div>
    <div class="grid-2" style="margin-top:1rem;">
      <div class="panel">
        <div class="panel__header"><h2>Overdue</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Order</th><th>Client</th><th>Late</th><th>Total</th></tr></thead><tbody>${overdueRows}</tbody></table></div>
      </div>
      <div class="panel">
        <div class="panel__header"><h2>Unpaid</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Order</th><th>Client</th><th>Payment</th><th>Total</th></tr></thead><tbody>${unpaidRows}</tbody></table></div>
      </div>
    </div>
    <div class="grid-2" style="margin-top:1rem;">
      <div class="panel">
        <div class="panel__header"><h2>Stale orders</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Order</th><th>Client</th><th>Idle</th><th>Status</th></tr></thead><tbody>${staleRows}</tbody></table></div>
      </div>
      <div class="panel">
        <div class="panel__header"><h2>Client health</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Client</th><th>Flags</th><th>Open value</th></tr></thead><tbody>${healthRows}</tbody></table></div>
      </div>
    </div>
    <div class="grid-2" style="margin-top:1rem;">
      <div class="panel">
        <div class="panel__header"><h2>Recent orders</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Client</th><th>Status</th><th>Due</th><th>Total</th></tr></thead>
            <tbody>
              ${(d.recentOrders || [])
                .map(
                  (o) => `<tr data-order-id="${o.id}">
                    <td><strong>${escapeHtml(o.orderId)}</strong>${tagBadges(o.tags)}</td>
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
  $$("#view-dashboard [data-client-id]").forEach((el) => {
    el.style.cursor = "pointer";
    el.onclick = () => openClientDetail(el.dataset.clientId);
  });
  $$("[data-dash-action]").forEach((btn) => {
    btn.onclick = () => {
      state.orderFilter = { q: "", status: "", clientId: "", attention: btn.dataset.dashAction, tag: "" };
      state.activeSavedViewId = "";
      setView("orders");
    };
  });
}

function renderSavedViewsNav() {
  const list = $("#saved-views-list");
  if (!list) return;
  if (!state.savedViews.length) {
    list.innerHTML = `<p class="saved-views__empty">Save filters from the Orders view.</p>`;
    return;
  }
  list.innerHTML = state.savedViews
    .map(
      (v) => `<button type="button" class="saved-view${state.activeSavedViewId === v.id ? " is-active" : ""}" data-saved-view="${v.id}">
        <span>${escapeHtml(v.name)}</span>
        <span class="saved-view__delete" data-delete-view="${v.id}" title="Delete">×</span>
      </button>`
    )
    .join("");
  $$("[data-saved-view]").forEach((btn) => {
    btn.onclick = (e) => {
      if (e.target.closest("[data-delete-view]")) return;
      applySavedView(btn.dataset.savedView);
    };
  });
  $$("[data-delete-view]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this saved view?")) return;
      await api(`/api/saved-views/${btn.dataset.deleteView}`, { method: "DELETE" });
      if (state.activeSavedViewId === btn.dataset.deleteView) state.activeSavedViewId = "";
      await refresh();
      toast("Saved view deleted");
    };
  });
}

function applySavedView(id) {
  const view = state.savedViews.find((v) => v.id === id);
  if (!view) return;
  state.activeSavedViewId = id;
  state.orderFilter = {
    q: view.filters?.q || "",
    status: view.filters?.status || "",
    clientId: view.filters?.clientId || "",
    attention: view.filters?.attention || "",
    tag: view.filters?.tag || "",
  };
  setView("orders");
}

async function saveCurrentView() {
  const name = prompt("Name this view (e.g. Overdue rush jobs):");
  if (!name?.trim()) return;
  await api("/api/saved-views", {
    method: "POST",
    body: JSON.stringify({ name: name.trim(), filters: { ...state.orderFilter } }),
  });
  await refresh();
  toast("View saved");
}

function filteredOrders() {
  const q = state.orderFilter.q.trim().toLowerCase();
  return state.orders.filter((o) => {
    if (state.orderFilter.status && o.status !== state.orderFilter.status) return false;
    if (state.orderFilter.clientId && o.clientId !== state.orderFilter.clientId) return false;
    if (state.orderFilter.tag && !(o.tags || []).includes(state.orderFilter.tag)) return false;
    if (state.orderFilter.attention === "overdue" && !(o.isOpen && o.daysOverdue > 0)) return false;
    if (
      state.orderFilter.attention === "unpaid" &&
      !(o.isOpen && (o.paymentStatus === "Unpaid" || o.paymentStatus === "Partial"))
    )
      return false;
    if (state.orderFilter.attention === "open" && !o.isOpen) return false;
    if (state.orderFilter.attention === "stale" && !o.isStale) return false;
    if (!q) return true;
    const hay = [o.orderId, o.clientName, o.items, o.notes, o.invoiceNumber, o.poNumber, o.tagsLabel, ...(o.tags || [])]
      .join(" ")
      .toLowerCase();
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
      ${attentionChip("stale", "Stale")}
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
                        <td><strong>${escapeHtml(o.orderId)}</strong><div style="color:var(--muted);font-size:0.82rem;">${escapeHtml(o.items || "")}</div>${tagBadges(o.tags)}</td>
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
    state.activeSavedViewId = "";
    renderOrders();
    renderSavedViewsNav();
  };
  $("#order-status-filter").onchange = (e) => {
    state.orderFilter.status = e.target.value;
    state.activeSavedViewId = "";
    renderOrders();
    renderSavedViewsNav();
  };
  $("#order-client-filter").onchange = (e) => {
    state.orderFilter.clientId = e.target.value;
    state.activeSavedViewId = "";
    renderOrders();
    renderSavedViewsNav();
  };
  $$(".chip[data-attention]").forEach((chip) => {
    chip.onclick = () => {
      state.orderFilter.attention = chip.dataset.attention;
      state.activeSavedViewId = "";
      renderOrders();
      renderSavedViewsNav();
    };
  });
}

function handleOrdersViewClick(e) {
  const viewBtn = e.target.closest("[data-view-order]");
  if (viewBtn) {
    e.preventDefault();
    openOrderDetail(viewBtn.dataset.viewOrder);
    return;
  }
  const editBtn = e.target.closest("[data-edit-order]");
  if (editBtn) {
    e.preventDefault();
    openOrderModal(editBtn.dataset.editOrder);
    return;
  }
  const deleteBtn = e.target.closest("[data-delete-order]");
  if (deleteBtn) {
    e.preventDefault();
    (async () => {
      if (!confirm("Delete this order?")) return;
      await api(`/api/orders/${deleteBtn.dataset.deleteOrder}`, { method: "DELETE" });
      toast("Order deleted");
      await refresh();
    })().catch((err) => toast(err.message));
    return;
  }
  const card = e.target.closest(".card[data-order-id]");
  if (card) {
    openOrderDetail(card.dataset.orderId);
  }
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
                          ${formatAddressDisplay(c) ? `<div style="color:var(--muted);font-size:0.82rem;white-space:pre-line;">${escapeHtml(formatAddressDisplay(c))}</div>` : ""}
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
  const panel = $("#modal-form");
  if (panel) panel.classList.toggle("modal__panel--wide", Boolean(options.wide));
  const saveBtn = $("#modal-save");
  if (!saveBtn || !$("#modal-body") || !$("#modal-title")) {
    throw new Error("Modal UI failed to load. Hard-refresh the page.");
  }
  if (options.hideSave) {
    saveBtn.hidden = true;
    saveBtn.type = "button";
  } else {
    saveBtn.hidden = false;
    saveBtn.type = "submit";
    saveBtn.textContent = options.saveLabel || "Save";
  }
  const dialog = $("#modal");
  if (!dialog) throw new Error("Modal UI failed to load. Hard-refresh the page.");
  if (dialog.open) dialog.close();
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
  dialog.showModal();
}

async function openOrderDetail(id) {
  try {
    const order = state.orders.find((o) => o.id === id) || (await api(`/api/orders/${id}`));
    let activity = [];
    try {
      activity = await api(`/api/orders/${id}/activity`);
    } catch {
      activity = [];
    }
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
      ${order.invoiceNumber ? `<div><span class="detail-label">Invoice #</span>${escapeHtml(order.invoiceNumber)}</div>` : ""}
      ${order.poNumber ? `<div><span class="detail-label">PO #</span>${escapeHtml(order.poNumber)}</div>` : ""}
    </div>
    ${order.tags?.length ? `<div class="detail-block"><span class="detail-label">Tags</span><div>${tagBadges(order.tags)}</div></div>` : ""}
    ${order.items ? `<div class="detail-block"><span class="detail-label">Items</span><p>${escapeHtml(order.items)}</p></div>` : ""}
    ${order.notes ? `<div class="detail-block"><span class="detail-label">Notes</span><p>${escapeHtml(order.notes)}</p></div>` : ""}
    <div class="detail-actions">
      ${next ? `<button type="button" class="btn btn--primary" id="detail-advance">Advance to ${escapeHtml(next)}</button>` : ""}
      ${order.paymentStatus !== "Paid" ? `<button type="button" class="btn" id="detail-mark-paid">Mark paid</button>` : ""}
      <button type="button" class="btn" id="detail-share">Copy client link</button>
      <button type="button" class="btn btn--ghost" id="detail-rotate-link" title="Invalidate old links">New link</button>
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
  $("#detail-share").onclick = async () => {
    try {
      const { url } = await api(`/api/orders/${id}/share-link`, { method: "POST", body: JSON.stringify({}) });
      await navigator.clipboard.writeText(url);
      toast("Client link copied");
    } catch (err) {
      toast(err.message);
    }
  };
  $("#detail-rotate-link").onclick = async () => {
    if (!confirm("Generate a new link? The old link will stop working.")) return;
    try {
      const { url } = await api(`/api/orders/${id}/share-link`, {
        method: "POST",
        body: JSON.stringify({ rotate: true }),
      });
      await navigator.clipboard.writeText(url);
      toast("New client link copied");
    } catch (err) {
      toast(err.message);
    }
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
  } catch (err) {
    toast(err.message);
  }
}

async function quickOrderPatch(orderId, payload) {
  await api(`/api/orders/${orderId}/quick`, { method: "PATCH", body: JSON.stringify(payload) });
  await refresh();
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
    ${formatAddressDisplay(data) ? `<div class="detail-block"><span class="detail-label">Address</span><p style="white-space:pre-line;">${escapeHtml(formatAddressDisplay(data))}</p></div>` : ""}
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
    openOrderModal(null, id);
  };
  $$("#modal-body [data-order-id]").forEach((row) => {
    row.style.cursor = "pointer";
    row.onclick = () => {
      $("#modal").close();
      openOrderDetail(row.dataset.orderId);
    };
  });
}

function openModalForm(title, bodyHtml, onSave, options = {}) {
  $("#modal-cancel").textContent = "Cancel";
  openModal(title, bodyHtml, onSave, options);
}

function field(name, label, value = "", type = "text", options = {}) {
  const fieldName = options.name || name;
  const fieldId = options.id || fieldName;
  if (type === "textarea") {
    return `<div class="field"><label for="${fieldId}">${label}</label><textarea id="${fieldId}" name="${fieldName}">${escapeHtml(value)}</textarea></div>`;
  }
  if (type === "select") {
    const opts = (options.choices || [])
      .map((c) => `<option value="${escapeHtml(c)}" ${c === value ? "selected" : ""}>${escapeHtml(c)}</option>`)
      .join("");
    return `<div class="field"><label for="${fieldId}">${label}</label><select id="${fieldId}" name="${fieldName}">${opts}</select></div>`;
  }
  return `<div class="field"><label for="${fieldId}">${label}</label><input id="${fieldId}" name="${fieldName}" type="${type}" value="${escapeHtml(value)}"${options.required ? " required" : ""}${options.step !== undefined ? ` step="${escapeHtml(String(options.step))}"` : ""}${options.min !== undefined ? ` min="${escapeHtml(String(options.min))}"` : ""}${options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : ""}${options.inputmode ? ` inputmode="${options.inputmode}"` : ""} /></div>`;
}

function clientAddressForForm(client) {
  if (!client) return { addressLine1: "", addressLine2: "", city: "", state: "", zip: "" };
  if (client.addressLine1 || client.city || client.state || client.zip) {
    return {
      addressLine1: client.addressLine1 || "",
      addressLine2: client.addressLine2 || "",
      city: client.city || "",
      state: client.state || "",
      zip: client.zip || "",
    };
  }
  if (client.address) return { addressLine1: client.address, addressLine2: "", city: "", state: "", zip: "" };
  return { addressLine1: "", addressLine2: "", city: "", state: "", zip: "" };
}

function openClientModal(id = null) {
  const existing = id ? state.clients.find((c) => c.id === id) : null;
  const parts = clientAddressForForm(existing);
  const body = `
    ${field("name", "Name", existing?.name || "", "text", { required: true })}
    <div class="field-row">
      ${field("email", "Email", existing?.email || "", "email")}
      ${field("phone", "Phone", existing?.phone || "")}
    </div>
    ${addressFieldsHtml("", parts)}
    ${field("notes", "Notes", existing?.notes || "", "textarea")}
  `;
  openModalForm(existing ? "Edit client" : "New client", body, async (fd) => {
    const payload = buildClientPayloadFromForm(fd, "");
    if (!payload.name) throw new Error("Name is required.");
    if (existing) {
      await api(`/api/clients/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Client updated");
    } else {
      await api("/api/clients", { method: "POST", body: JSON.stringify(payload) });
      toast("Client created");
    }
    await refresh();
  });
  wireAddressAutocomplete("");
}

function openOrderModal(id = null, presetClientId = null) {
  try {
    const existing = id ? state.orders.find((o) => o.id === id) : null;
    const isNew = !existing;
    const hasClients = state.clients.length > 0;
    const defaultMode = isNew && !hasClients ? "new" : "existing";

    const clientOptions = state.clients
      .map(
        (c) =>
          `<option value="${c.id}" ${
            existing
              ? existing.clientId === c.id
                ? "selected"
                : ""
              : presetClientId === c.id
                ? "selected"
                : ""
          }>${escapeHtml(c.name)}</option>`
      )
      .join("");

    const clientSection = isNew
      ? `
    <div class="client-mode">
      <span class="detail-label">Client</span>
      <div class="client-mode__toggle">
        ${
          hasClients
            ? `<label class="client-mode__option"><input type="radio" name="clientMode" value="existing" ${defaultMode === "existing" ? "checked" : ""} /> Existing client</label>`
            : ""
        }
        <label class="client-mode__option"><input type="radio" name="clientMode" value="new" ${defaultMode === "new" ? "checked" : ""} /> New client</label>
      </div>
    </div>
    <div id="existing-client-fields" ${defaultMode === "new" ? "hidden" : ""}>
      <div class="field">
        <label for="clientId">Select client</label>
        <select id="clientId" name="clientId" ${defaultMode === "existing" ? "required" : ""}>${clientOptions}</select>
      </div>
    </div>
    <div id="new-client-fields" ${defaultMode === "new" ? "" : "hidden"}>
      ${field("newClientName", "Client name", "", "text", { required: defaultMode === "new", name: "newClientName", id: "newClientName" })}
      <div class="field-row">
        ${field("newClientEmail", "Email", "", "email", { name: "newClientEmail", id: "newClientEmail" })}
        ${field("newClientPhone", "Phone", "", "text", { name: "newClientPhone", id: "newClientPhone" })}
      </div>
      ${addressFieldsHtml("newClient", {})}
    </div>`
      : `<div class="field"><label for="clientId">Client</label><select id="clientId" name="clientId" required>${clientOptions}</select></div>`;

    const body = `
    ${field("orderId", "Order ID", existing?.orderId || suggestOrderId(), "text", { required: true })}
    ${clientSection}
    <div class="field-row">
      ${field("dateReceived", "Date received", existing?.dateReceived || today(), "date")}
      ${field("dueDate", "Due date", existing?.dueDate || "", "date")}
    </div>
    ${field("items", "Items / description", existing?.items || "", "textarea")}
    <div class="field-row">
      ${decimalField("quantity", "Quantity", existing?.quantity ?? 1)}
      ${decimalField("totalCost", "Total cost", existing?.totalCost ?? "")}
    </div>
    <div class="field-row">
      ${field("status", "Status", existing?.status || "New", "select", { choices: state.meta.orderStatuses })}
      ${field("paymentStatus", "Payment status", existing?.paymentStatus || "Unpaid", "select", { choices: state.meta.paymentStatuses })}
    </div>
    <div class="field-row">
      ${field("invoiceNumber", "Invoice #", existing?.invoiceNumber || "")}
      ${field("poNumber", "PO #", existing?.poNumber || "")}
    </div>
    <div class="field">
      <label for="tags">Tags <span class="field-hint">comma-separated</span></label>
      <input id="tags" name="tags" type="text" value="${escapeHtml(existing?.tagsLabel || (Array.isArray(existing?.tags) ? existing.tags.join(", ") : existing?.tags || ""))}" />
      <div class="tag-presets">${(state.meta?.orderTagPresets || []).map((t) => `<button type="button" class="tag tag--click" data-tag-preset="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}</div>
    </div>
    ${field("notes", "Notes", existing?.notes || "", "textarea")}
  `;

  openModalForm(existing ? "Edit order" : "New order", body, async (fd) => {
      const payload = Object.fromEntries(fd.entries());
      payload.quantity = parseFormDecimal(payload.quantity, "Quantity");
      payload.totalCost = parseFormDecimal(payload.totalCost, "Total cost");

      if (isNew && payload.clientMode === "new") {
        const clientPayload = buildClientPayloadFromForm(fd, "newClient");
        if (!clientPayload.name) throw new Error("Client name is required.");
        const client = await api("/api/clients", { method: "POST", body: JSON.stringify(clientPayload) });
        payload.clientId = client.id;
      }

      delete payload.clientMode;
      delete payload.newClientName;
      delete payload.newClientEmail;
      delete payload.newClientPhone;
      delete payload.newClientAddressLine1;
      delete payload.newClientAddressLine2;
      delete payload.newClientCity;
      delete payload.newClientState;
      delete payload.newClientZip;
      delete payload.newClientAddressSuggest;

      if (!payload.clientId) throw new Error("Please select or create a client.");

      if (existing) {
        await api(`/api/orders/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
        toast("Order updated");
      } else {
        await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
        toast("Order created");
      }
      await refresh();
    });

    if (isNew) wireNewClientToggle(defaultMode);
    wireAddressAutocomplete("newClient");
    $$("[data-tag-preset]").forEach((btn) => {
      btn.onclick = () => {
        const input = $("#tags");
        const parts = input.value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        if (!parts.includes(btn.dataset.tagPreset)) parts.push(btn.dataset.tagPreset);
        input.value = parts.join(", ");
      };
    });
  } catch (err) {
    toast(err.message || "Something went wrong.");
  }
}

function wireNewClientToggle(initialMode) {
  const existingBlock = $("#existing-client-fields");
  const newBlock = $("#new-client-fields");
  const clientSelect = $("#clientId");
  const nameInput = $("#newClientName");
  if (!existingBlock || !newBlock) return;

  function applyMode(mode) {
    const isNew = mode === "new";
    existingBlock.hidden = isNew;
    newBlock.hidden = !isNew;
    if (clientSelect) clientSelect.required = !isNew;
    if (nameInput) nameInput.required = isNew;
    if (isNew) wireAddressAutocomplete("newClient");
  }

  applyMode(initialMode);
  $$('input[name="clientMode"]').forEach((radio) => {
    radio.onchange = () => applyMode(radio.value);
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

function wireGlobalSearch() {
  const input = $("#global-search");
  const results = $("#global-search-results");
  if (!input || !results) return;

  function hideResults() {
    results.hidden = true;
  }

  function showResults(html) {
    results.innerHTML = html;
    results.hidden = !html;
  }

  input.oninput = () => {
    clearTimeout(state.searchTimer);
    const q = input.value.trim();
    if (!q) {
      hideResults();
      return;
    }
    state.searchTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
        if (!data.clients?.length && !data.orders?.length) {
          showResults(`<div class="global-search__empty">No matches for “${escapeHtml(q)}”</div>`);
          return;
        }
        const clientHtml = data.clients?.length
          ? `<div class="global-search__group"><strong>Clients</strong>${data.clients
              .map(
                (c) => `<button type="button" class="global-search__hit" data-open-client="${c.id}">${escapeHtml(c.name)}${c.email ? ` · ${escapeHtml(c.email)}` : ""}</button>`
              )
              .join("")}</div>`
          : "";
        const orderHtml = data.orders?.length
          ? `<div class="global-search__group"><strong>Orders</strong>${data.orders
              .map(
                (o) => `<button type="button" class="global-search__hit" data-open-order="${o.id}">${escapeHtml(o.orderId)} · ${escapeHtml(o.clientName)}</button>`
              )
              .join("")}</div>`
          : "";
        showResults(clientHtml + orderHtml);
        $$("[data-open-client]").forEach((btn) => {
          btn.onclick = () => {
            hideResults();
            input.value = "";
            openClientDetail(btn.dataset.openClient);
          };
        });
        $$("[data-open-order]").forEach((btn) => {
          btn.onclick = () => {
            hideResults();
            input.value = "";
            openOrderDetail(btn.dataset.openOrder);
          };
        });
      } catch {
        hideResults();
      }
    }, 220);
  };

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#global-search-wrap")) hideResults();
  });
}

function maybeNotifyOverdue() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const n = state.dashboard?.overdueOrders || 0;
  if (n <= 0) return;
  const key = `crm-notify-${new Date().toISOString().slice(0, 10)}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  new Notification("CRM: overdue orders", { body: `${n} open order${n === 1 ? "" : "s"} past due`, icon: "/icon.svg" });
}

async function requestNotifications() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    const perm = await Notification.requestPermission();
    if (perm === "granted") maybeNotifyOverdue();
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function wireChrome() {
  $$(".nav__item").forEach((btn) => {
    btn.onclick = () => setView(btn.dataset.view);
  });
  $("#save-view-btn")?.addEventListener("click", () => saveCurrentView().catch((err) => toast(err.message)));
  wireGlobalSearch();
  registerServiceWorker();
  requestNotifications();
  $("#view-orders").addEventListener("click", handleOrdersViewClick);
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
