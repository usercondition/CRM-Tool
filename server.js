const http = require("http");
const fs = require("fs");
const path = require("path");
const { createStore } = require("./lib/store");
const {
  isAuthEnabled,
  isAuthenticated,
  isPublicApiPath,
  verifyPassword,
  createSessionToken,
  buildSessionCookie,
  buildClearSessionCookie,
} = require("./lib/auth");
const {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  enrichClient,
  validateClient,
  validateOrder,
  toCsv,
} = require("./lib/helpers");
const {
  STALE_DAYS,
  ORDER_TAG_PRESETS,
  tagsToString,
  enrichOrderMetrics,
  enrichClientHealth,
  buildDashboardAnalytics,
  searchAll,
} = require("./lib/analytics");
const { sendDigestEmail, buildDigestText, smtpConfigured } = require("./lib/digest");
const { buildPublicOrderView, publicTrackUrl } = require("./lib/publicOrder");
const { nextStatus } = require("./lib/activity");

const PORT = Number(process.env.PORT || 3847);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": contentType, ...extraHeaders });
  res.end(text);
}

function serveStatic(req, res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, "Not found");
      return;
    }
    const headers = { "Content-Type": contentType };
    if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
      headers["Cache-Control"] = "no-cache";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

async function loadEnrichedData(store, activityLimit = 500) {
  const clientsRaw = await store.listClients();
  const ordersRaw = await store.listOrders();
  const activity = await store.listRecentActivity(activityLimit);
  const clientsById = Object.fromEntries(clientsRaw.map((c) => [c.id, c]));
  const lastActivityByOrder = {};
  for (const a of activity) {
    if (!lastActivityByOrder[a.orderId] || a.createdAt > lastActivityByOrder[a.orderId]) {
      lastActivityByOrder[a.orderId] = a.createdAt;
    }
  }
  const orders = ordersRaw.map((o) => enrichOrderMetrics(o, clientsById, lastActivityByOrder));
  const clients = clientsRaw.map((c) => enrichClientHealth(c, orders, lastActivityByOrder));
  return { clients, orders, activity, clientsById, lastActivityByOrder };
}

async function buildDashboard(store) {
  const { clients, orders, activity } = await loadEnrichedData(store);
  return buildDashboardAnalytics(clients, orders, activity);
}

function normalizeClientInput(body, existing = null) {
  return {
    name: body.name !== undefined ? String(body.name).trim() : existing.name,
    email: body.email !== undefined ? String(body.email).trim() : existing.email,
    phone: body.phone !== undefined ? String(body.phone).trim() : existing.phone,
    address: body.address !== undefined ? String(body.address).trim() : existing.address,
    notes: body.notes !== undefined ? String(body.notes).trim() : existing.notes,
  };
}

function normalizeOrderInput(body, existing = null) {
  const tags =
    body.tags !== undefined
      ? tagsToString(body.tags)
      : existing
        ? tagsToString(existing.tags)
        : "";
  return {
    orderId: body.orderId !== undefined ? String(body.orderId).trim() : existing.orderId,
    clientId: body.clientId !== undefined ? body.clientId : existing.clientId,
    dateReceived: body.dateReceived !== undefined ? body.dateReceived : existing.dateReceived,
    items: body.items !== undefined ? String(body.items).trim() : existing.items,
    quantity: body.quantity !== undefined ? Number(body.quantity) : existing.quantity,
    totalCost: body.totalCost !== undefined ? Number(body.totalCost) : existing.totalCost,
    status: body.status !== undefined ? body.status : existing.status,
    paymentStatus: body.paymentStatus !== undefined ? body.paymentStatus : existing.paymentStatus,
    dueDate: body.dueDate !== undefined ? body.dueDate : existing.dueDate,
    notes: body.notes !== undefined ? String(body.notes).trim() : existing.notes,
    tags,
    invoiceNumber:
      body.invoiceNumber !== undefined ? String(body.invoiceNumber).trim() : existing?.invoiceNumber || "",
    poNumber: body.poNumber !== undefined ? String(body.poNumber).trim() : existing?.poNumber || "",
  };
}

async function startServer() {
  const store = await createStore();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      serveStatic(req, res, path.join(ROOT, "public", "index.html"), "text/html; charset=utf-8");
      return;
    }

    const trackMatch = pathname.match(/^\/track\/([^/]+)$/);
    if (req.method === "GET" && trackMatch) {
      serveStatic(req, res, path.join(ROOT, "public", "track.html"), "text/html; charset=utf-8");
      return;
    }

    const staticMap = {
      "/styles.css": "text/css; charset=utf-8",
      "/app.js": "application/javascript; charset=utf-8",
      "/sw.js": "application/javascript; charset=utf-8",
      "/track.js": "application/javascript; charset=utf-8",
      "/track.css": "text/css; charset=utf-8",
      "/manifest.webmanifest": "application/manifest+json; charset=utf-8",
      "/icon.svg": "image/svg+xml",
    };
    if (req.method === "GET" && staticMap[pathname]) {
      serveStatic(req, res, path.join(ROOT, "public", pathname.slice(1)), staticMap[pathname]);
      return;
    }

    if (pathname.startsWith("/api/")) {
      try {
        if (!isPublicApiPath(pathname, req.method) && !isAuthenticated(req)) {
          sendJson(res, 401, { error: "Login required." });
          return;
        }

        if (pathname === "/api/health" && req.method === "GET") {
          sendJson(res, 200, { ok: true, service: "crm-tool", storage: store.mode, auth: isAuthEnabled() });
          return;
        }

        if (pathname === "/api/auth/status" && req.method === "GET") {
          sendJson(res, 200, {
            authRequired: isAuthEnabled(),
            authenticated: isAuthenticated(req),
            storage: store.mode,
          });
          return;
        }

        if (pathname === "/api/auth/login" && req.method === "POST") {
          const body = await readBody(req);
          if (!verifyPassword(body?.password)) {
            sendJson(res, 401, { error: "Incorrect password." });
            return;
          }
          const token = createSessionToken();
          sendJson(res, 200, { ok: true }, { "Set-Cookie": buildSessionCookie(token, req) });
          return;
        }

        if (pathname === "/api/auth/logout" && req.method === "POST") {
          sendJson(res, 200, { ok: true }, { "Set-Cookie": buildClearSessionCookie(req) });
          return;
        }

        if (pathname === "/api/meta" && req.method === "GET") {
          sendJson(res, 200, {
            orderStatuses: ORDER_STATUSES,
            paymentStatuses: PAYMENT_STATUSES,
            orderTagPresets: ORDER_TAG_PRESETS,
            staleOrderDays: STALE_DAYS,
            authRequired: isAuthEnabled(),
            storage: store.mode,
            digestEmailConfigured: Boolean(process.env.CRM_DIGEST_EMAIL),
            smtpConfigured: smtpConfigured(),
          });
          return;
        }

        if (pathname === "/api/dashboard" && req.method === "GET") {
          sendJson(res, 200, await buildDashboard(store));
          return;
        }

        if (pathname === "/api/search" && req.method === "GET") {
          const q = url.searchParams.get("q") || "";
          const { clients, orders } = await loadEnrichedData(store);
          sendJson(res, 200, searchAll(clients, orders, q));
          return;
        }

        if (pathname === "/api/settings" && req.method === "GET") {
          sendJson(res, 200, await store.getSettings());
          return;
        }

        if (pathname === "/api/settings" && req.method === "PUT") {
          const body = await readBody(req);
          const partial = {};
          if (body?.digestEmail !== undefined) partial.digestEmail = String(body.digestEmail).trim();
          sendJson(res, 200, await store.saveSettings(partial));
          return;
        }

        if (pathname === "/api/saved-views" && req.method === "GET") {
          sendJson(res, 200, await store.listSavedViews());
          return;
        }

        if (pathname === "/api/saved-views" && req.method === "POST") {
          const body = await readBody(req);
          if (!String(body?.name || "").trim()) {
            sendJson(res, 400, { error: "View name is required." });
            return;
          }
          const view = await store.addSavedView(body);
          sendJson(res, 201, view);
          return;
        }

        const savedViewMatch = pathname.match(/^\/api\/saved-views\/([^/]+)$/);
        if (savedViewMatch && req.method === "DELETE") {
          const ok = await store.deleteSavedView(savedViewMatch[1]);
          if (!ok) {
            sendJson(res, 404, { error: "Saved view not found." });
            return;
          }
          sendJson(res, 200, { ok: true });
          return;
        }

        if (pathname === "/api/digest/preview" && req.method === "GET") {
          const analytics = await buildDashboard(store);
          sendText(res, 200, buildDigestText(analytics), "text/plain; charset=utf-8");
          return;
        }

        if (pathname === "/api/digest/send" && req.method === "POST") {
          const body = await readBody(req);
          const analytics = await buildDashboard(store);
          const result = await sendDigestEmail(analytics, body?.to);
          if (!result.ok) {
            sendJson(res, result.preview ? 503 : 400, result);
            return;
          }
          sendJson(res, 200, result);
          return;
        }

        const publicOrderMatch = pathname.match(/^\/api\/public\/orders\/([^/]+)$/);
        if (publicOrderMatch && req.method === "GET") {
          const token = decodeURIComponent(publicOrderMatch[1]);
          const order = await store.getOrderByPublicToken(token);
          if (!order) {
            sendJson(res, 404, { error: "Order not found." });
            return;
          }
          const client = await store.getClient(order.clientId);
          const activity = await store.listOrderActivity(order.id);
          sendJson(res, 200, buildPublicOrderView(order, client, activity));
          return;
        }

        if (pathname === "/api/export/clients.csv" && req.method === "GET") {
          const clients = await store.listClients();
          const orders = await store.listOrders();
          const rows = clients.map((c) => enrichClient(c, orders));
          const csv = toCsv(rows, [
            { header: "Name", key: "name" },
            { header: "Email", key: "email" },
            { header: "Phone", key: "phone" },
            { header: "Address", key: "address" },
            { header: "Open orders", key: "totalOpenOrders" },
            { header: "Open value", key: "totalOpenValue" },
            { header: "Total orders", key: "orderCount" },
            { header: "Notes", key: "notes" },
          ]);
          sendText(res, 200, csv, "text/csv; charset=utf-8", {
            "Content-Disposition": 'attachment; filename="clients.csv"',
          });
          return;
        }

        if (pathname === "/api/export/orders.csv" && req.method === "GET") {
          const { orders } = await loadEnrichedData(store);
          const csv = toCsv(orders, [
            { header: "Order ID", key: "orderId" },
            { header: "Client", key: "clientName" },
            { header: "Date received", key: "dateReceived" },
            { header: "Due date", key: "dueDate" },
            { header: "Status", key: "status" },
            { header: "Payment status", key: "paymentStatus" },
            { header: "Quantity", key: "quantity" },
            { header: "Total cost", key: "totalCost" },
            { header: "Days overdue", key: "daysOverdue" },
            { header: "Tags", key: "tagsLabel" },
            { header: "Invoice #", key: "invoiceNumber" },
            { header: "PO #", key: "poNumber" },
            { header: "Items", key: "items" },
            { header: "Notes", key: "notes" },
          ]);
          sendText(res, 200, csv, "text/csv; charset=utf-8", {
            "Content-Disposition": 'attachment; filename="orders.csv"',
          });
          return;
        }

        if (pathname === "/api/clients") {
          if (req.method === "GET") {
            const { clients } = await loadEnrichedData(store);
            clients.sort((a, b) => a.name.localeCompare(b.name));
            sendJson(res, 200, clients);
            return;
          }

          if (req.method === "POST") {
            const body = await readBody(req);
            const errors = validateClient(body);
            if (errors.length) {
              sendJson(res, 400, { error: errors.join(" ") });
              return;
            }
            const client = await store.createClient(normalizeClientInput(body));
            const orders = await store.listOrders();
            sendJson(res, 201, enrichClient(client, orders));
            return;
          }
        }

        const clientMatch = pathname.match(/^\/api\/clients\/([^/]+)$/);
        if (clientMatch) {
          const id = clientMatch[1];

          if (req.method === "GET") {
            const { clients, orders, clientsById, lastActivityByOrder } = await loadEnrichedData(store);
            const client = clients.find((c) => c.id === id) || null;
            if (!client) {
              sendJson(res, 404, { error: "Client not found." });
              return;
            }
            const clientOrders = orders
              .filter((o) => o.clientId === id)
              .sort((a, b) => (b.dateReceived || "").localeCompare(a.dateReceived || ""));
            if (url.searchParams.get("detail") === "1") {
              sendJson(res, 200, { ...client, orders: clientOrders });
              return;
            }
            sendJson(res, 200, client);
            return;
          }

          if (req.method === "PUT") {
            const existing = await store.getClient(id);
            if (!existing) {
              sendJson(res, 404, { error: "Client not found." });
              return;
            }
            const body = await readBody(req);
            const errors = validateClient(body, true);
            if (errors.length) {
              sendJson(res, 400, { error: errors.join(" ") });
              return;
            }
            const updated = await store.updateClient(id, normalizeClientInput(body, existing));
            const orders = await store.listOrders();
            sendJson(res, 200, enrichClient(updated, orders));
            return;
          }

          if (req.method === "DELETE") {
            const ok = await store.deleteClient(id);
            if (!ok) {
              sendJson(res, 404, { error: "Client not found." });
              return;
            }
            sendJson(res, 200, { ok: true });
            return;
          }
        }

        if (pathname === "/api/orders") {
          if (req.method === "GET") {
            const { orders } = await loadEnrichedData(store);
            let filtered = orders;
            const clientId = url.searchParams.get("clientId");
            const status = url.searchParams.get("status");
            const attention = url.searchParams.get("attention");
            const tag = url.searchParams.get("tag");
            if (clientId) filtered = filtered.filter((o) => o.clientId === clientId);
            if (status) filtered = filtered.filter((o) => o.status === status);
            if (tag) filtered = filtered.filter((o) => (o.tags || []).includes(tag.toLowerCase()));
            if (attention === "overdue") filtered = filtered.filter((o) => o.isOpen && o.daysOverdue > 0);
            if (attention === "unpaid") {
              filtered = filtered.filter(
                (o) => o.isOpen && (o.paymentStatus === "Unpaid" || o.paymentStatus === "Partial")
              );
            }
            if (attention === "open") filtered = filtered.filter((o) => o.isOpen);
            if (attention === "stale") filtered = filtered.filter((o) => o.isStale);
            filtered.sort((a, b) => (b.dateReceived || "").localeCompare(a.dateReceived || ""));
            sendJson(res, 200, filtered);
            return;
          }

          if (req.method === "POST") {
            const body = await readBody(req);
            const errors = validateOrder(body);
            if (errors.length) {
              sendJson(res, 400, { error: errors.join(" ") });
              return;
            }
            const clientsById = Object.fromEntries((await store.listClients()).map((c) => [c.id, c]));
            if (!clientsById[body.clientId]) {
              sendJson(res, 400, { error: "Client not found." });
              return;
            }
            const order = await store.createOrder(normalizeOrderInput(body));
            sendJson(res, 201, enrichOrderMetrics(order, clientsById, {}));
            return;
          }
        }

        const orderShareMatch = pathname.match(/^\/api\/orders\/([^/]+)\/share-link$/);
        if (orderShareMatch && req.method === "POST") {
          const id = orderShareMatch[1];
          const order = await store.getOrder(id);
          if (!order) {
            sendJson(res, 404, { error: "Order not found." });
            return;
          }
          const body = await readBody(req);
          const token = body?.rotate ? await store.rotatePublicToken(id) : await store.ensurePublicToken(id);
          sendJson(res, 200, { url: publicTrackUrl(req, token), token });
          return;
        }

        const orderActivityMatch = pathname.match(/^\/api\/orders\/([^/]+)\/activity$/);
        if (orderActivityMatch) {
          const id = orderActivityMatch[1];
          const order = await store.getOrder(id);
          if (!order) {
            sendJson(res, 404, { error: "Order not found." });
            return;
          }
          if (req.method === "GET") {
            sendJson(res, 200, await store.listOrderActivity(id));
            return;
          }
          if (req.method === "POST") {
            const body = await readBody(req);
            const text = String(body?.message || "").trim();
            if (!text) {
              sendJson(res, 400, { error: "Note message is required." });
              return;
            }
            await store.addOrderNote(id, text);
            sendJson(res, 201, { ok: true });
            return;
          }
        }

        const orderQuickMatch = pathname.match(/^\/api\/orders\/([^/]+)\/quick$/);
        if (orderQuickMatch && req.method === "PATCH") {
          const id = orderQuickMatch[1];
          const existing = await store.getOrder(id);
          if (!existing) {
            sendJson(res, 404, { error: "Order not found." });
            return;
          }
          const body = await readBody(req);
          const patch = {};
          if (body?.status !== undefined) {
            if (!ORDER_STATUSES.includes(body.status)) {
              sendJson(res, 400, { error: "Invalid status." });
              return;
            }
            patch.status = body.status;
          }
          if (body?.paymentStatus !== undefined) {
            if (!PAYMENT_STATUSES.includes(body.paymentStatus)) {
              sendJson(res, 400, { error: "Invalid payment status." });
              return;
            }
            patch.paymentStatus = body.paymentStatus;
          }
          if (body?.advanceStatus) {
            const next = nextStatus(existing.status);
            if (!next) {
              sendJson(res, 400, { error: "Order is already at final status." });
              return;
            }
            patch.status = next;
          }
          if (!Object.keys(patch).length) {
            sendJson(res, 400, { error: "No changes requested." });
            return;
          }
          const { clientsById, lastActivityByOrder } = await loadEnrichedData(store);
          const updated = await store.updateOrder(id, patch);
          sendJson(res, 200, enrichOrderMetrics(updated, clientsById, lastActivityByOrder));
          return;
        }

        const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
        if (orderMatch) {
          const id = orderMatch[1];

          if (req.method === "GET") {
            const order = await store.getOrder(id);
            if (!order) {
              sendJson(res, 404, { error: "Order not found." });
              return;
            }
            const { clientsById, lastActivityByOrder } = await loadEnrichedData(store);
            sendJson(res, 200, enrichOrderMetrics(order, clientsById, lastActivityByOrder));
            return;
          }

          if (req.method === "PUT") {
            const existing = await store.getOrder(id);
            if (!existing) {
              sendJson(res, 404, { error: "Order not found." });
              return;
            }
            const body = await readBody(req);
            const errors = validateOrder(body, true);
            if (errors.length) {
              sendJson(res, 400, { error: errors.join(" ") });
              return;
            }
            const clientsById = Object.fromEntries((await store.listClients()).map((c) => [c.id, c]));
            if (body.clientId && !clientsById[body.clientId]) {
              sendJson(res, 400, { error: "Client not found." });
              return;
            }
            const updated = await store.updateOrder(id, normalizeOrderInput(body, existing));
            sendJson(res, 200, enrichOrderMetrics(updated, clientsById, {}));
            return;
          }

          if (req.method === "DELETE") {
            const ok = await store.deleteOrder(id);
            if (!ok) {
              sendJson(res, 404, { error: "Order not found." });
              return;
            }
            sendJson(res, 200, { ok: true });
            return;
          }
        }

        sendJson(res, 404, { error: "Not found." });
      } catch (err) {
        console.error(err);
        sendJson(res, 500, { error: err.message || "Server error." });
      }
      return;
    }

    sendText(res, 404, "Not found");
  });

  server.listen(PORT, HOST, () => {
    console.log(`Simple CRM running on http://${HOST}:${PORT}`);
    if (isAuthEnabled()) console.log("[auth] Password protection enabled");
    else console.log("[auth] No CRM_PASSWORD set — login disabled (fine for local dev)");
  });
}

startServer().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
