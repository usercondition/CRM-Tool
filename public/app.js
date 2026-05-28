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
  orderFilter: { q: "", status: "", clientId: "", attention: "", tag: "", dueDate: "" },
  clientFilter: { q: "" },
  expandedOrderId: "",
  orderActivityCache: {},
  ordersViewMode: localStorage.getItem("crm-orders-view") || "board",
  dashboardAttention: "overdue",
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
    Ready: "badge--ready",
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
    firstName: String(get("firstName")).trim(),
    lastName: String(get("lastName")).trim(),
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

function clientNamesForForm(client) {
  if (!client) return { firstName: "", lastName: "" };
  if (client.firstName || client.lastName) {
    return { firstName: client.firstName || "", lastName: client.lastName || "" };
  }
  const parts = String(client.name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function clientNameFieldsHtml(prefix = "", client = null) {
  const names = clientNamesForForm(client);
  const id = (key) => prefixedName(prefix, key);
  const required = prefix === "newClient";
  return `<div class="field-row">
    ${field("firstName", "First name", names.firstName, "text", { required, name: id("firstName"), id: id("firstName") })}
    ${field("lastName", "Last name", names.lastName, "text", { name: id("lastName"), id: id("lastName") })}
  </div>`;
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
  const statuses = state.meta?.orderStatuses || ["New", "In Progress", "Ready", "Shipped", "Delivered"];
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

function confirmAction(title, message) {
  return new Promise((resolve) => {
    const confirmBtn = $("#modal-confirm");
    openModal(title, `<p class="confirm-message">${escapeHtml(message)}</p>`, null, { hideSave: true, keepConfirm: true });
    $("#modal-cancel").textContent = "Cancel";
    confirmBtn.hidden = false;
    const finish = (ok) => {
      confirmBtn.hidden = true;
      $("#modal").close();
      resolve(ok);
    };
    confirmBtn.onclick = () => finish(true);
    $("#modal-cancel").onclick = () => finish(false);
    $("#modal-close").onclick = () => finish(false);
  });
}

function promptAction(title, label, defaultValue = "") {
  return new Promise((resolve) => {
    const confirmBtn = $("#modal-confirm");
    openModal(
      title,
      `<div class="field"><label for="prompt-input">${escapeHtml(label)}</label><input id="prompt-input" type="text" value="${escapeHtml(defaultValue)}" autofocus /></div>`,
      null,
      { hideSave: true, keepConfirm: true }
    );
    $("#modal-cancel").textContent = "Cancel";
    confirmBtn.hidden = false;
    confirmBtn.textContent = "Save";
    const input = $("#prompt-input");
    const finish = (ok) => {
      confirmBtn.hidden = true;
      confirmBtn.textContent = "Confirm";
      const value = ok ? input.value.trim() : "";
      $("#modal").close();
      resolve(value);
    };
    confirmBtn.onclick = () => finish(true);
    $("#modal-cancel").onclick = () => finish(false);
    $("#modal-close").onclick = () => finish(false);
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      }
    };
  });
}

async function copyOrderLink(orderId) {
  const { url } = await api(`/api/orders/${orderId}/share-link`, { method: "POST", body: JSON.stringify({}) });
  await navigator.clipboard.writeText(url);
  toast("Client link copied");
}

function allOrderTags() {
  const set = new Set(state.meta?.orderTagPresets || []);
  for (const o of state.orders) {
    for (const t of o.tags || []) set.add(t);
  }
  return [...set].sort();
}

function notifyClientChecked(root = document) {
  const el = root.querySelector("#detail-notify-client");
  if (!el) return state.settings?.notifyClientOnStatus !== false;
  return el.checked;
}

function buildOrderDetailPanel(order, activity) {
  const flow = state.meta.orderStatuses;
  const next = flow[flow.indexOf(order.status) + 1];
  const atReady = order.status === "Ready";
  const isPickup = order.fulfillmentType === "Pickup";
  const canNotify = state.meta?.smtpConfigured && state.settings?.notifyClientOnStatus !== false;
  const notifyRow =
    canNotify && ["Ready", "In Progress", "New", "Shipped"].includes(order.status)
      ? `<label class="notify-toggle"><input type="checkbox" id="detail-notify-client" checked /> Email client on status change</label>`
      : "";
  const advanceBtn =
    next && !atReady
      ? `<button type="button" class="btn btn--primary" id="detail-advance">Advance to ${escapeHtml(next)}</button>`
      : "";
  const readyActions = atReady
    ? isPickup
      ? `<button type="button" class="btn btn--primary" id="detail-pickup">Mark picked up</button>
         <button type="button" class="btn" id="detail-ship">Mark shipped anyway</button>`
      : `<button type="button" class="btn btn--primary" id="detail-ship">Mark shipped</button>
         <button type="button" class="btn" id="detail-pickup">Mark picked up</button>`
    : "";
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

  return `
    <div class="order-detail">
      <div class="order-detail__header">
        <div>
          <div class="order-detail__id">${escapeHtml(order.orderId)}</div>
          <div class="order-detail__client">${escapeHtml(order.clientName)}</div>
        </div>
        <button type="button" class="btn btn--ghost btn--tiny" data-collapse-order="${order.id}">Close</button>
      </div>
      <div class="order-detail__badges">
        ${statusBadge(order.status)}
        ${paymentBadge(order.paymentStatus)}
        ${order.fulfillmentType === "Pickup" ? `<span class="tag">Pickup</span>` : ""}
        ${order.tags?.length ? tagBadges(order.tags) : ""}
      </div>
      <div class="order-detail__grid">
        <dl class="fact-list">
          <div><dt>Total</dt><dd class="money">${money(order.totalCost)}</dd></div>
          <div><dt>Received</dt><dd>${formatDate(order.dateReceived)}</dd></div>
          <div><dt>Due</dt><dd>${formatDate(order.dueDate)}${order.daysOverdue ? ` <span class="badge badge--overdue">${order.daysOverdue}d late</span>` : ""}</dd></div>
          ${order.invoiceNumber ? `<div><dt>Invoice</dt><dd>${escapeHtml(order.invoiceNumber)}</dd></div>` : ""}
          ${order.poNumber ? `<div><dt>PO</dt><dd>${escapeHtml(order.poNumber)}</dd></div>` : ""}
        </dl>
        <div class="order-detail__side">
          ${order.items ? `<div class="order-detail__block"><span class="detail-label">Items</span><p>${escapeHtml(order.items)}</p></div>` : ""}
          ${order.notes ? `<div class="order-detail__block"><span class="detail-label">Notes</span><p>${escapeHtml(order.notes)}</p></div>` : ""}
          ${notifyRow}
          <div class="detail-actions detail-actions--primary">
            ${advanceBtn}
            ${readyActions}
            ${order.paymentStatus !== "Paid" ? `<button type="button" class="btn" id="detail-mark-paid">Mark paid</button>` : ""}
          </div>
          <div class="detail-actions detail-actions--secondary">
            <button type="button" class="btn btn--ghost" id="detail-share">Copy link</button>
            <button type="button" class="btn btn--ghost" id="detail-rotate-link">New link</button>
            <button type="button" class="btn btn--ghost" id="detail-edit">Edit</button>
          </div>
        </div>
      </div>
      <details class="order-detail__activity"${activity.length ? " open" : ""}>
        <summary>Activity (${activity.length})</summary>
        <ul class="timeline timeline--compact">${timeline}</ul>
      </details>
      <div class="detail-note">
        <div class="detail-note__row">
          <input id="detail-note-input" type="text" placeholder="Add a note…" aria-label="Add note" />
          <button type="button" class="btn btn--primary" id="detail-add-note">Add</button>
        </div>
      </div>
    </div>
  `;
}

function renderOrderCard(order) {
  const selected = state.expandedOrderId === order.id && state.ordersViewMode === "board";
  return `<div class="card${selected ? " card--selected" : ""}" data-order-id="${order.id}"${selected ? "" : ' draggable="true"'}>
    <div class="card__summary">
      <div class="card__head">
        <strong class="card__title">${escapeHtml(order.orderId)}</strong>
        <span class="card__chevron" aria-hidden="true">${selected ? "●" : "○"}</span>
      </div>
      <div class="card__sub">${escapeHtml(order.clientName)} · ${money(order.totalCost)}</div>
      ${order.daysOverdue ? `<div class="card__flags"><span class="badge badge--overdue">${order.daysOverdue}d late</span></div>` : ""}
    </div>
  </div>`;
}

function renderOrderInspector() {
  const id = state.expandedOrderId;
  if (!id || state.ordersViewMode !== "board") return "";
  const order = state.orders.find((o) => o.id === id);
  if (!order) return "";
  const activity = state.orderActivityCache[id] || [];
  return `<section class="order-inspector" id="order-inspector" aria-label="Order details">
    <div class="order-detail-panel order-detail-panel--inspector" data-order-id="${id}">
      ${buildOrderDetailPanel(order, activity)}
    </div>
  </section>`;
}

function scrollToExpandedOrder(id) {
  requestAnimationFrame(() => {
    if (state.ordersViewMode === "board") {
      $("#order-inspector")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    $(`.order-detail-panel[data-order-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function renderOrderTableRows(order) {
  const expanded = state.expandedOrderId === order.id;
  const activity = state.orderActivityCache[order.id] || [];
  const summaryRow = `<tr class="order-row${expanded ? " order-row--open" : ""}" data-order-id="${order.id}">
    <td>
      <strong>${escapeHtml(order.orderId)}</strong>
      <div class="cell-sub">${escapeHtml(order.clientName)}</div>
    </td>
    <td>${formatDate(order.dueDate)}${order.daysOverdue ? `<div class="cell-sub"><span class="badge badge--overdue">${order.daysOverdue}d late</span></div>` : ""}</td>
    <td>${statusBadge(order.status)}</td>
    <td class="money">${money(order.totalCost)}</td>
    <td class="row-actions row-actions--compact">
      <button type="button" class="btn btn--ghost btn--tiny${expanded ? " is-active" : ""}" data-toggle-order="${order.id}">${expanded ? "Hide" : "Open"}</button>
      <button type="button" class="btn btn--ghost btn--tiny" data-edit-order="${order.id}">Edit</button>
      <button type="button" class="btn btn--ghost btn--tiny" data-copy-order="${order.id}" title="Copy link">Link</button>
      <button type="button" class="btn btn--ghost btn--tiny btn--danger-text" data-delete-order="${order.id}">Delete</button>
    </td>
  </tr>`;
  const detailRow = expanded
    ? `<tr class="order-detail-row" data-order-detail-for="${order.id}">
        <td colspan="5"><div class="order-detail-panel order-detail-panel--table" data-order-id="${order.id}">${buildOrderDetailPanel(order, activity)}</div></td>
      </tr>`
    : "";
  return summaryRow + detailRow;
}

async function refreshExpandedOrder(id) {
  delete state.orderActivityCache[id];
  try {
    state.orderActivityCache[id] = await api(`/api/orders/${id}/activity`);
  } catch {
    state.orderActivityCache[id] = [];
  }
  state.expandedOrderId = id;
  if (state.view === "orders") renderOrders();
  wireOrderDetailPanel(id);
}

function wireOrderDetailPanel(id) {
  const root = $(`.order-detail-panel[data-order-id="${id}"]`);
  if (!root) return;
  const q = (sel) => root.querySelector(sel);
  const order = state.orders.find((o) => o.id === id);
  if (!order) return;
  const flow = state.meta.orderStatuses;
  const next = flow[flow.indexOf(order.status) + 1];
  const atReady = order.status === "Ready";

  q("[data-collapse-order]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.expandedOrderId = "";
    renderOrders();
  });

  q("#detail-advance")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const result = await quickOrderPatch(id, { advanceStatus: true, notifyClient: notifyClientChecked(root) });
    toast(result.clientNotified ? `Moved to ${next} · client emailed` : `Moved to ${next}`);
    await refreshExpandedOrder(id);
  });

  q("#detail-ship")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const result = await quickOrderPatch(id, { status: "Shipped", notifyClient: notifyClientChecked(root) });
    toast(result.clientNotified ? "Marked as shipped · client emailed" : "Marked as shipped");
    await refreshExpandedOrder(id);
  });

  q("#detail-pickup")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const result = await quickOrderPatch(id, { status: "Delivered", notifyClient: notifyClientChecked(root) });
    toast(result.clientNotified ? "Marked as picked up · client emailed" : "Marked as picked up");
    await refreshExpandedOrder(id);
  });

  q("#detail-mark-paid")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await quickOrderPatch(id, { paymentStatus: "Paid" });
    toast("Marked as paid");
    await refreshExpandedOrder(id);
  });

  q("#detail-edit")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openOrderModal(id);
  });

  q("#detail-share")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const { url } = await api(`/api/orders/${id}/share-link`, { method: "POST", body: JSON.stringify({}) });
      await navigator.clipboard.writeText(url);
      toast("Client link copied");
    } catch (err) {
      toast(err.message);
    }
  });

  q("#detail-rotate-link")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!(await confirmAction("New tracking link", "Generate a new link? The old link will stop working."))) return;
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
  });

  q("#detail-add-note")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const text = q("#detail-note-input")?.value.trim();
    if (!text) return;
    await api(`/api/orders/${id}/activity`, { method: "POST", body: JSON.stringify({ message: text }) });
    toast("Note added");
    await refreshExpandedOrder(id);
  });
}

async function expandOrder(id, { scroll = true } = {}) {
  if (state.expandedOrderId === id) {
    state.expandedOrderId = "";
    renderOrders();
    return;
  }
  state.expandedOrderId = id;
  if (!state.orderActivityCache[id]) {
    try {
      state.orderActivityCache[id] = await api(`/api/orders/${id}/activity`);
    } catch {
      state.orderActivityCache[id] = [];
    }
  }
  renderOrders();
  wireOrderDetailPanel(id);
  if (scroll) scrollToExpandedOrder(id);
}

async function showOrderInList(id) {
  state.expandedOrderId = id;
  if (!state.orderActivityCache[id]) {
    try {
      state.orderActivityCache[id] = await api(`/api/orders/${id}/activity`);
    } catch {
      state.orderActivityCache[id] = [];
    }
  }
  if (state.view !== "orders") setView("orders");
  else renderOrders();
  wireOrderDetailPanel(id);
  scrollToExpandedOrder(id);
}

function wireKanbanDrag() {
  let draggedId = null;
  $$(".card[data-order-id]:not(.card--selected)").forEach((card) => {
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      draggedId = card.dataset.orderId;
      card.classList.add("card--dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("card--dragging");
      $$(".kanban__col").forEach((col) => col.classList.remove("kanban__col--over"));
    });
  });
  $$(".kanban__col[data-kanban-status]").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("kanban__col--over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("kanban__col--over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("kanban__col--over");
      if (!draggedId) return;
      const status = col.dataset.kanbanStatus;
      const order = state.orders.find((o) => o.id === draggedId);
      if (!order || order.status === status) return;
      try {
        await quickOrderPatch(draggedId, {
          status,
          notifyClient: state.settings?.notifyClientOnStatus !== false,
        });
        if (state.expandedOrderId === draggedId) await refreshExpandedOrder(draggedId);
        toast(`Moved to ${status}`);
      } catch (err) {
        toast(err.message);
      }
    });
  });
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
    dashboard: ["Dashboard", "What needs your attention today"],
    orders: ["Orders", "Board or list — click to expand details"],
    clients: ["Clients", "Contacts and open order counts"],
    settings: ["Settings", "Digest, notifications, and automation"],
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
      <button type="button" class="btn" id="digest-send-btn">Send digest</button>
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
    $("#digest-send-btn").onclick = async () => {
      try {
        const result = await api("/api/digest/send", { method: "POST", body: JSON.stringify({}) });
        toast(`Digest sent to ${result.to}`);
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
  if (state.view === "settings") renderSettings();
}

function renderDashboard() {
  const d = state.dashboard;
  if (!d) return;

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

  const attentionTab = state.dashboardAttention;
  const attentionTables = {
    overdue: { title: "Overdue orders", rows: overdueRows, cols: `<tr><th>Order</th><th>Client</th><th>Late</th><th>Total</th></tr>` },
    unpaid: { title: "Unpaid orders", rows: unpaidRows, cols: `<tr><th>Order</th><th>Client</th><th>Payment</th><th>Total</th></tr>` },
    stale: { title: "Stale orders", rows: staleRows, cols: `<tr><th>Order</th><th>Client</th><th>Idle</th><th>Status</th></tr>` },
  };
  const activeAttention = attentionTables[attentionTab] || attentionTables.overdue;

  $("#view-dashboard").innerHTML = `
    <div class="kpi-row">
      <div class="kpi kpi--warn"><span class="kpi__label">Overdue</span><strong class="kpi__value">${d.overdueOrders}</strong></div>
      <div class="kpi kpi--warn"><span class="kpi__label">Unpaid</span><strong class="kpi__value">${d.unpaidOrders}</strong></div>
      <div class="kpi"><span class="kpi__label">Open orders</span><strong class="kpi__value">${d.openOrders}</strong></div>
      <div class="kpi"><span class="kpi__label">Open value</span><strong class="kpi__value money">${money(d.openValue)}</strong></div>
    </div>

    <section class="section">
      <div class="section__head">
        <h2 class="section__title">Needs attention</h2>
        <div class="segmented">
          <button type="button" class="segmented__btn${attentionTab === "overdue" ? " is-active" : ""}" data-attention-tab="overdue">Overdue</button>
          <button type="button" class="segmented__btn${attentionTab === "unpaid" ? " is-active" : ""}" data-attention-tab="unpaid">Unpaid</button>
          <button type="button" class="segmented__btn${attentionTab === "stale" ? " is-active" : ""}" data-attention-tab="stale">Stale</button>
        </div>
      </div>
      <div class="panel panel--flat">
        <div class="table-wrap table-wrap--comfortable">
          <table><thead>${activeAttention.cols}</thead><tbody>${activeAttention.rows}</tbody></table>
        </div>
        <div class="section__foot">
          <button type="button" class="btn btn--ghost btn--tiny" data-dash-action="${attentionTab}">View all in Orders →</button>
        </div>
      </div>
    </section>

    <details class="section section--collapsible">
      <summary class="section__summary">Insights — pipeline, payments, revenue</summary>
      <div class="grid-3 section__body">
        <div class="panel panel--flat">
          <h3 class="panel__subtitle">Pipeline</h3>
          <div class="pipeline">${pipelineBars(d.pipelineCount || {}, d.pipelineValue || {})}</div>
        </div>
        <div class="panel panel--flat">
          <h3 class="panel__subtitle">Payments</h3>
          <ul class="snapshot-list">
            <li><span>Unpaid</span><strong>${pay.unpaid?.count || 0} · ${money(pay.unpaid?.value || 0)}</strong></li>
            <li><span>Partial</span><strong>${pay.partial?.count || 0} · ${money(pay.partial?.value || 0)}</strong></li>
            <li><span>Paid (open)</span><strong>${pay.paidOpen?.count || 0} · ${money(pay.paidOpen?.value || 0)}</strong></li>
          </ul>
        </div>
        <div class="panel panel--flat">
          <h3 class="panel__subtitle">Revenue (90d)</h3>
          ${miniBarChart(d.revenueChart)}
        </div>
      </div>
    </details>

    <div class="grid-2">
      <section class="section">
        <h2 class="section__title">Due dates</h2>
        <div class="panel panel--flat">
          <div class="cal-strip">${calendarCells}</div>
          <p class="section__hint">Click a day to filter orders by due date.</p>
        </div>
      </section>
      <section class="section">
        <h2 class="section__title">Recent activity</h2>
        <div class="panel panel--flat">
          <ul class="timeline timeline--feed">${activityItems}</ul>
        </div>
      </section>
    </div>
  `;

  $$("[data-attention-tab]").forEach((btn) => {
    btn.onclick = () => {
      state.dashboardAttention = btn.dataset.attentionTab;
      renderDashboard();
    };
  });

  $$("#view-dashboard [data-order-id]").forEach((el) => {
    el.style.cursor = "pointer";
    el.onclick = () => showOrderInList(el.dataset.orderId);
  });
  $$(".cal-day[data-cal-date]").forEach((el) => {
    if (!el.dataset.calDate) return;
    el.style.cursor = "pointer";
    el.onclick = () => {
      state.orderFilter = { q: "", status: "", clientId: "", attention: "", tag: "", dueDate: el.dataset.calDate };
      state.activeSavedViewId = "";
      setView("orders");
    };
  });
  $$("[data-dash-action]").forEach((btn) => {
    btn.onclick = () => {
      state.orderFilter = { q: "", status: "", clientId: "", attention: btn.dataset.dashAction, tag: "", dueDate: "" };
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
      if (!(await confirmAction("Delete saved view", "Remove this saved view?"))) return;
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
    dueDate: view.filters?.dueDate || "",
  };
  setView("orders");
}

async function saveCurrentView() {
  const name = await promptAction("Save view", "View name", "My filtered orders");
  if (!name) return;
  await api("/api/saved-views", {
    method: "POST",
    body: JSON.stringify({ name, filters: { ...state.orderFilter } }),
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
    if (state.orderFilter.dueDate && o.dueDate !== state.orderFilter.dueDate) return false;
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
  const tagOptions = allOrderTags()
    .map((t) => `<option value="${escapeHtml(t)}" ${state.orderFilter.tag === t ? "selected" : ""}>${escapeHtml(t)}</option>`)
    .join("");
  const dueHint = state.orderFilter.dueDate
    ? `<button type="button" class="chip is-active" id="clear-due-filter">Due ${formatDate(state.orderFilter.dueDate)} ×</button>`
    : "";

  const viewMode = state.ordersViewMode;
  const boardActive = viewMode === "board";

  const kanbanCols = state.meta.orderStatuses
    .map((status) => {
      const cards = orders
        .filter((o) => o.status === status)
        .map((o) => renderOrderCard(o))
        .join("");
      const count = orders.filter((o) => o.status === status).length;
      return `<div class="kanban__col" data-kanban-status="${escapeHtml(status)}">
        <div class="kanban__head"><h3 class="kanban__title">${escapeHtml(status)}</h3><span class="kanban__count">${count}</span></div>
        <div class="kanban__cards">${cards || `<div class="empty empty--inline">None</div>`}</div>
      </div>`;
    })
    .join("");

  const listSection = `
    <div class="panel panel--flat">
      <div class="table-wrap table-wrap--comfortable">
        <table>
          <thead><tr><th>Order</th><th>Due</th><th>Status</th><th>Total</th><th></th></tr></thead>
          <tbody>${orders.length ? orders.map((o) => renderOrderTableRows(o)).join("") : `<tr><td colspan="5" class="empty">No orders match your filters.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  const boardSection = `<div class="orders-board">
    <div class="kanban">${kanbanCols}</div>
    ${renderOrderInspector()}
  </div>`;

  $("#view-orders").innerHTML = `
    <div class="toolbar">
      <div class="toolbar__filters">
        <input type="search" id="order-search" class="toolbar__search" placeholder="Search orders…" value="${escapeHtml(state.orderFilter.q)}" />
        <select id="order-status-filter" class="toolbar__select" aria-label="Status">
          <option value="">All statuses</option>
          ${state.meta.orderStatuses.map((s) => `<option value="${s}" ${state.orderFilter.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <select id="order-client-filter" class="toolbar__select" aria-label="Client">
          <option value="">All clients</option>
          ${clientOptions}
        </select>
        <select id="order-tag-filter" class="toolbar__select" aria-label="Tag">
          <option value="">All tags</option>
          ${tagOptions}
        </select>
        ${dueHint}
      </div>
      <div class="segmented segmented--sm">
        <button type="button" class="segmented__btn${boardActive ? " is-active" : ""}" data-orders-view="board">Board</button>
        <button type="button" class="segmented__btn${!boardActive ? " is-active" : ""}" data-orders-view="list">List</button>
      </div>
    </div>
    <div class="chips chips--subtle">
      ${attentionChip("", "All")}
      ${attentionChip("open", "Open")}
      ${attentionChip("overdue", "Overdue")}
      ${attentionChip("unpaid", "Unpaid")}
      ${attentionChip("stale", "Stale")}
    </div>
    ${boardActive ? boardSection : listSection}
  `;

  $$("[data-orders-view]").forEach((btn) => {
    btn.onclick = () => {
      state.ordersViewMode = btn.dataset.ordersView;
      localStorage.setItem("crm-orders-view", state.ordersViewMode);
      renderOrders();
      renderSavedViewsNav();
    };
  });

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
  $("#order-tag-filter").onchange = (e) => {
    state.orderFilter.tag = e.target.value;
    state.activeSavedViewId = "";
    renderOrders();
    renderSavedViewsNav();
  };
  $("#clear-due-filter")?.addEventListener("click", () => {
    state.orderFilter.dueDate = "";
    state.activeSavedViewId = "";
    renderOrders();
    renderSavedViewsNav();
  });
  $$(".chip[data-attention]").forEach((chip) => {
    chip.onclick = () => {
      state.orderFilter.attention = chip.dataset.attention;
      state.activeSavedViewId = "";
      renderOrders();
      renderSavedViewsNav();
    };
  });
  wireKanbanDrag();
  if (state.expandedOrderId) wireOrderDetailPanel(state.expandedOrderId);
}

function handleOrdersViewClick(e) {
  if (e.target.closest(".order-detail-panel")) return;

  const collapseBtn = e.target.closest("[data-collapse-order]");
  if (collapseBtn) return;

  const toggleBtn = e.target.closest("[data-toggle-order]");
  if (toggleBtn) {
    e.preventDefault();
    expandOrder(toggleBtn.dataset.toggleOrder);
    return;
  }
  const editBtn = e.target.closest("[data-edit-order]");
  if (editBtn) {
    e.preventDefault();
    openOrderModal(editBtn.dataset.editOrder);
    return;
  }
  const copyBtn = e.target.closest("[data-copy-order]");
  if (copyBtn) {
    e.preventDefault();
    copyOrderLink(copyBtn.dataset.copyOrder).catch((err) => toast(err.message));
    return;
  }
  const deleteBtn = e.target.closest("[data-delete-order]");
  if (deleteBtn) {
    e.preventDefault();
    (async () => {
      if (!(await confirmAction("Delete order", "Delete this order permanently?"))) return;
      const deletedId = deleteBtn.dataset.deleteOrder;
      if (state.expandedOrderId === deletedId) state.expandedOrderId = "";
      await api(`/api/orders/${deletedId}`, { method: "DELETE" });
      toast("Order deleted");
      await refresh();
    })().catch((err) => toast(err.message));
    return;
  }
  const card = e.target.closest(".card[data-order-id]");
  if (card && !e.target.closest("button, input, a, label")) {
    e.preventDefault();
    expandOrder(card.dataset.orderId);
  }
}

function filteredClients() {
  const q = state.clientFilter.q.trim().toLowerCase();
  if (!q) return state.clients;
  return state.clients.filter((c) => {
    const hay = [c.name, c.firstName, c.lastName, c.email, c.phone, c.address, c.notes].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function renderClients() {
  const clients = filteredClients();
  $("#view-clients").innerHTML = `
    <div class="toolbar toolbar--single">
      <input type="search" id="client-search" class="toolbar__search" placeholder="Search clients…" value="${escapeHtml(state.clientFilter.q)}" />
    </div>
    <div class="panel panel--flat">
      <div class="table-wrap table-wrap--comfortable">
        <table>
          <thead>
            <tr><th>Name</th><th>Contact</th><th>Open</th><th>Value</th><th></th></tr>
          </thead>
          <tbody>
            ${
              clients.length
                ? clients
                    .map(
                      (c) => `<tr>
                        <td>
                          <strong>${escapeHtml(c.name)}</strong>
                          ${c.notes ? `<div class="cell-sub">${escapeHtml(c.notes)}</div>` : ""}
                        </td>
                        <td>
                          ${c.email ? `<div><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>` : ""}
                          ${c.phone ? `<div class="cell-sub"><a href="tel:${escapeHtml(c.phone.replace(/\s/g, ""))}">${escapeHtml(c.phone)}</a></div>` : ""}
                        </td>
                        <td>${c.totalOpenOrders}</td>
                        <td class="money">${money(c.totalOpenValue)}</td>
                        <td class="row-actions row-actions--compact">
                          <button type="button" class="btn btn--ghost btn--tiny" data-view-client="${c.id}">View</button>
                          <button type="button" class="btn btn--ghost btn--tiny" data-edit-client="${c.id}">Edit</button>
                          <button type="button" class="btn btn--ghost btn--tiny" data-view-client-orders="${c.id}">Orders</button>
                        </td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="5" class="empty">${state.clients.length ? "No clients match your search." : "No clients yet. Add your first client."}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $("#client-search").oninput = (e) => {
    state.clientFilter.q = e.target.value;
    renderClients();
  };

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
      if (!(await confirmAction("Delete client", "Delete this client and all their orders?"))) return;
      await api(`/api/clients/${btn.dataset.deleteClient}`, { method: "DELETE" });
      toast("Client deleted");
      await refresh();
    };
  });
}

function renderSettings() {
  const s = state.settings || {};
  const meta = state.meta || {};
  const cronUrl = `${location.origin}/api/cron/digest`;
  $("#view-settings").innerHTML = `
    <div class="grid-2">
      <div class="panel">
        <div class="panel__header"><h2>Daily digest</h2></div>
        <div class="settings-form">
          <div class="field">
            <label for="settings-digest-email">Digest email</label>
            <input id="settings-digest-email" type="email" value="${escapeHtml(s.digestEmail || "")}" placeholder="you@example.com" />
          </div>
          <p class="field-hint">Used when you click Send digest or when a scheduled cron job runs.</p>
          <div class="settings-actions">
            <button type="button" class="btn" id="settings-preview-digest">Preview</button>
            <button type="button" class="btn btn--primary" id="settings-send-digest">Send now</button>
          </div>
          <ul class="settings-status">
            <li>SMTP: ${meta.smtpConfigured ? "✓ configured" : "✗ not configured"}</li>
            <li>Cron secret: ${meta.cronConfigured ? "✓ set" : "✗ set CRM_CRON_SECRET on server"}</li>
          </ul>
          ${
            meta.cronConfigured
              ? `<pre class="settings-cron">curl -X POST "${cronUrl}" -H "x-cron-secret: YOUR_SECRET"</pre>
                 <p class="field-hint">Schedule that daily on Render Cron Jobs or any scheduler.</p>`
              : ""
          }
        </div>
      </div>
      <div class="panel">
        <div class="panel__header"><h2>Notifications</h2></div>
        <div class="settings-form">
          <label class="settings-check">
            <input type="checkbox" id="settings-browser-notify" ${s.browserNotifications !== false ? "checked" : ""} />
            Browser alerts for overdue orders
          </label>
          <label class="settings-check">
            <input type="checkbox" id="settings-client-notify" ${s.notifyClientOnStatus !== false ? "checked" : ""} />
            Email clients when order reaches Ready, Shipped, or Delivered
          </label>
          <p class="field-hint">Client emails require SMTP and a client email address on the order.</p>
          <button type="button" class="btn btn--primary" id="settings-save">Save settings</button>
        </div>
      </div>
    </div>
    <div class="panel" style="margin-top:1rem;">
      <div class="panel__header"><h2>Quick tips</h2></div>
      <ul class="settings-tips">
        <li>Drag orders on the Kanban board to change status quickly.</li>
        <li>Click a date on the dashboard calendar to filter orders due that day.</li>
        <li>Press <kbd>/</kbd> to focus search, <kbd>Esc</kbd> to close dialogs.</li>
        <li>Use Ship vs Pickup on new orders — Ready actions adapt automatically.</li>
      </ul>
    </div>
  `;

  $("#settings-save").onclick = async () => {
    try {
      state.settings = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          digestEmail: $("#settings-digest-email").value.trim(),
          browserNotifications: $("#settings-browser-notify").checked,
          notifyClientOnStatus: $("#settings-client-notify").checked,
        }),
      });
      toast("Settings saved");
    } catch (err) {
      toast(err.message);
    }
  };
  $("#settings-preview-digest").onclick = async () => {
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
  $("#settings-send-digest").onclick = async () => {
    try {
      const email = $("#settings-digest-email").value.trim();
      const result = await api("/api/digest/send", {
        method: "POST",
        body: JSON.stringify({ to: email || undefined }),
      });
      toast(`Digest sent to ${result.to}`);
    } catch (err) {
      toast(err.message);
    }
  };
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
  const confirmBtn = $("#modal-confirm");
  if (confirmBtn && !options.keepConfirm) confirmBtn.hidden = true;
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

async function quickOrderPatch(orderId, payload) {
  const data = await api(`/api/orders/${orderId}/quick`, { method: "PATCH", body: JSON.stringify(payload) });
  await refresh();
  return data;
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
      <div><span class="detail-label">Email</span>${data.email ? `<a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a>` : "—"}</div>
      <div><span class="detail-label">Phone</span>${data.phone ? `<a href="tel:${escapeHtml(data.phone.replace(/\s/g, ""))}">${escapeHtml(data.phone)}</a>` : "—"}</div>
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
      showOrderInList(row.dataset.orderId);
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
  return `<div class="field"><label for="${fieldId}">${label}</label><input id="${fieldId}" name="${fieldName}" type="${type}" value="${escapeHtml(value)}"${options.required ? " required" : ""}${options.readonly ? " readonly" : ""}${options.step !== undefined ? ` step="${escapeHtml(String(options.step))}"` : ""}${options.min !== undefined ? ` min="${escapeHtml(String(options.min))}"` : ""}${options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : ""}${options.inputmode ? ` inputmode="${options.inputmode}"` : ""} /></div>`;
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
    ${clientNameFieldsHtml("", existing)}
    <div class="field-row">
      ${field("email", "Email", existing?.email || "", "email")}
      ${field("phone", "Phone", existing?.phone || "")}
    </div>
    ${addressFieldsHtml("", parts)}
    ${field("notes", "Notes", existing?.notes || "", "textarea")}
  `;
  openModalForm(existing ? "Edit client" : "New client", body, async (fd) => {
    const payload = buildClientPayloadFromForm(fd, "");
    if (!payload.firstName && !payload.lastName) throw new Error("First or last name is required.");
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
  (async () => {
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
      ${clientNameFieldsHtml("newClient", null)}
      <div class="field-row">
        ${field("newClientEmail", "Email", "", "email", { name: "newClientEmail", id: "newClientEmail" })}
        ${field("newClientPhone", "Phone", "", "text", { name: "newClientPhone", id: "newClientPhone" })}
      </div>
      ${addressFieldsHtml("newClient", {})}
    </div>`
      : `<div class="field"><label for="clientId">Client</label><select id="clientId" name="clientId" required>${clientOptions}</select></div>`;

    const numberFields = existing
      ? `<div class="field-row">
          ${field("orderId", "Order ID", existing.orderId, "text", { required: true })}
          ${field("invoiceNumber", "Invoice #", existing.invoiceNumber || "")}
        </div>`
      : `<p class="field-hint auto-number-note">Order ID and invoice number are created automatically when you save.</p>`;

    const body = `
    ${numberFields}
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
    ${
      existing
        ? field("poNumber", "PO #", existing.poNumber || "")
        : field("poNumber", "PO #", "")
    }
    <div class="field-row">
      ${field("fulfillmentType", "Fulfillment", existing?.fulfillmentType || "Ship", "select", {
        choices: state.meta?.fulfillmentTypes || ["Ship", "Pickup"],
      })}
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
        if (!clientPayload.firstName && !clientPayload.lastName) throw new Error("First or last name is required.");
        const client = await api("/api/clients", { method: "POST", body: JSON.stringify(clientPayload) });
        payload.clientId = client.id;
      }

      delete payload.clientMode;
      delete payload.newClientFirstName;
      delete payload.newClientLastName;
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
  })();
}

function wireNewClientToggle(initialMode) {
  const existingBlock = $("#existing-client-fields");
  const newBlock = $("#new-client-fields");
  const clientSelect = $("#clientId");
  const firstNameInput = $("#newClientFirstName");
  if (!existingBlock || !newBlock) return;

  function applyMode(mode) {
    const isNew = mode === "new";
    existingBlock.hidden = isNew;
    newBlock.hidden = !isNew;
    if (clientSelect) clientSelect.required = !isNew;
    if (firstNameInput) firstNameInput.required = isNew;
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

async function refresh() {
  await loadAll();
  renderCurrentView();
  if (state.view === "orders" && state.expandedOrderId) wireOrderDetailPanel(state.expandedOrderId);
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
            showOrderInList(btn.dataset.openOrder);
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
  if (state.settings?.browserNotifications === false) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const n = state.dashboard?.overdueOrders || 0;
  if (n <= 0) return;
  const key = `crm-notify-${new Date().toISOString().slice(0, 10)}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  new Notification("CRM: overdue orders", { body: `${n} open order${n === 1 ? "" : "s"} past due`, icon: "/icon.svg" });
}

async function requestNotifications() {
  if (state.settings?.browserNotifications === false) return;
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
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const dialog = $("#modal");
      if (dialog?.open) dialog.close();
      return;
    }
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      $("#global-search")?.focus();
    }
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
