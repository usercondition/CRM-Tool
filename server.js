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
  enrichOrder,
  enrichClient,
  validateClient,
  validateOrder,
  toCsv,
} = require("./lib/helpers");
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
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

async function buildDashboard(store) {
  const clients = await store.listClients();
  const ordersRaw = await store.listOrders();
  const clientsById = Object.fromEntries(clients.map((c) => [c.id, c]));
  const orders = ordersRaw.map((o) => enrichOrder(o, clientsById));
  const openOrders = orders.filter((o) => o.isOpen);
  const overdue = openOrders.filter((o) => o.daysOverdue > 0);
  const unpaidOpen = openOrders.filter((o) => o.paymentStatus === "Unpaid" || o.paymentStatus === "Partial");
  const byStatus = ORDER_STATUSES.reduce((acc, s) => {
    acc[s] = orders.filter((o) => o.status === s).length;
    return acc;
  }, {});
  const ordersById = Object.fromEntries(orders.map((o) => [o.id, o]));
  const recentActivityRaw = await store.listRecentActivity(12);
  const recentActivity = recentActivityRaw.map((a) => ({
    ...a,
    orderLabel: ordersById[a.orderId]?.orderId || a.orderId,
    clientName: ordersById[a.orderId]?.clientName || "",
  }));
  return {
    totalClients: clients.length,
    totalOrders: orders.length,
    openOrders: openOrders.length,
    overdueOrders: overdue.length,
    unpaidOrders: unpaidOpen.length,
    openValue: openOrders.reduce((sum, o) => sum + (Number(o.totalCost) || 0), 0),
    unpaidValue: unpaidOpen.reduce((sum, o) => sum + (Number(o.totalCost) || 0), 0),
    byStatus,
    recentOrders: [...orders]
      .sort((a, b) => (b.dateReceived || "").localeCompare(a.dateReceived || ""))
      .slice(0, 5),
    needsAttention: {
      overdue: [...overdue].sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 8),
      unpaid: [...unpaidOpen].sort((a, b) => (b.dateReceived || "").localeCompare(a.dateReceived || "")).slice(0, 8),
    },
    recentActivity,
  };
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

    const staticMap = {
      "/styles.css": "text/css; charset=utf-8",
      "/app.js": "application/javascript; charset=utf-8",
      "/manifest.webmanifest": "application/manifest+json; charset=utf-8",
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
            authRequired: isAuthEnabled(),
            storage: store.mode,
          });
          return;
        }

        if (pathname === "/api/dashboard" && req.method === "GET") {
          sendJson(res, 200, await buildDashboard(store));
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
          const clients = await store.listClients();
          const ordersRaw = await store.listOrders();
          const clientsById = Object.fromEntries(clients.map((c) => [c.id, c]));
          const rows = ordersRaw.map((o) => enrichOrder(o, clientsById));
          const csv = toCsv(rows, [
            { header: "Order ID", key: "orderId" },
            { header: "Client", key: "clientName" },
            { header: "Date received", key: "dateReceived" },
            { header: "Due date", key: "dueDate" },
            { header: "Status", key: "status" },
            { header: "Payment status", key: "paymentStatus" },
            { header: "Quantity", key: "quantity" },
            { header: "Total cost", key: "totalCost" },
            { header: "Days overdue", key: "daysOverdue" },
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
            const clients = await store.listClients();
            const orders = await store.listOrders();
            const enriched = clients.map((c) => enrichClient(c, orders));
            enriched.sort((a, b) => a.name.localeCompare(b.name));
            sendJson(res, 200, enriched);
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
          const orders = await store.listOrders();

          if (req.method === "GET") {
            const client = await store.getClient(id);
            if (!client) {
              sendJson(res, 404, { error: "Client not found." });
              return;
            }
            const enriched = enrichClient(client, orders);
            const clientsById = Object.fromEntries((await store.listClients()).map((c) => [c.id, c]));
            const clientOrders = orders
              .filter((o) => o.clientId === id)
              .map((o) => enrichOrder(o, clientsById))
              .sort((a, b) => (b.dateReceived || "").localeCompare(a.dateReceived || ""));
            if (url.searchParams.get("detail") === "1") {
              sendJson(res, 200, { ...enriched, orders: clientOrders });
              return;
            }
            sendJson(res, 200, enriched);
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
          const clients = await store.listClients();
          const clientsById = Object.fromEntries(clients.map((c) => [c.id, c]));

          if (req.method === "GET") {
            let orders = (await store.listOrders()).map((o) => enrichOrder(o, clientsById));
            const clientId = url.searchParams.get("clientId");
            const status = url.searchParams.get("status");
            const attention = url.searchParams.get("attention");
            if (clientId) orders = orders.filter((o) => o.clientId === clientId);
            if (status) orders = orders.filter((o) => o.status === status);
            if (attention === "overdue") orders = orders.filter((o) => o.isOpen && o.daysOverdue > 0);
            if (attention === "unpaid") {
              orders = orders.filter(
                (o) => o.isOpen && (o.paymentStatus === "Unpaid" || o.paymentStatus === "Partial")
              );
            }
            if (attention === "open") orders = orders.filter((o) => o.isOpen);
            orders.sort((a, b) => (b.dateReceived || "").localeCompare(a.dateReceived || ""));
            sendJson(res, 200, orders);
            return;
          }

          if (req.method === "POST") {
            const body = await readBody(req);
            const errors = validateOrder(body);
            if (errors.length) {
              sendJson(res, 400, { error: errors.join(" ") });
              return;
            }
            if (!clientsById[body.clientId]) {
              sendJson(res, 400, { error: "Client not found." });
              return;
            }
            const order = await store.createOrder(normalizeOrderInput(body));
            sendJson(res, 201, enrichOrder(order, clientsById));
            return;
          }
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
          const clients = await store.listClients();
          const clientsById = Object.fromEntries(clients.map((c) => [c.id, c]));
          const updated = await store.updateOrder(id, patch);
          sendJson(res, 200, enrichOrder(updated, clientsById));
          return;
        }

        const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
        if (orderMatch) {
          const id = orderMatch[1];
          const clients = await store.listClients();
          const clientsById = Object.fromEntries(clients.map((c) => [c.id, c]));

          if (req.method === "GET") {
            const order = await store.getOrder(id);
            if (!order) {
              sendJson(res, 404, { error: "Order not found." });
              return;
            }
            sendJson(res, 200, enrichOrder(order, clientsById));
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
            if (body.clientId && !clientsById[body.clientId]) {
              sendJson(res, 400, { error: "Client not found." });
              return;
            }
            const updated = await store.updateOrder(id, normalizeOrderInput(body, existing));
            sendJson(res, 200, enrichOrder(updated, clientsById));
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
