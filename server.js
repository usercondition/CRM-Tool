const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3847);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

const EMPTY_STORE = { clients: [], orders: [] };

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const seed = path.join(DATA_DIR, "store.seed.json");
    if (fs.existsSync(seed)) {
      fs.copyFileSync(seed, DATA_FILE);
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify(EMPTY_STORE, null, 2) + "\n", "utf8");
    }
  }
}

ensureDataFile();

const ORDER_STATUSES = ["New", "In Progress", "Shipped", "Delivered"];
const PAYMENT_STATUSES = ["Unpaid", "Partial", "Paid", "Refunded"];

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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}

function loadStore() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function todayIso() {
  return new Date().toISOString();
}

function daysOverdue(dueDate, status) {
  if (!dueDate || status === "Delivered") return 0;
  const due = new Date(dueDate + "T23:59:59");
  const now = new Date();
  if (now <= due) return 0;
  return Math.floor((now - due) / (1000 * 60 * 60 * 24));
}

function enrichOrder(order, clientsById) {
  const client = clientsById[order.clientId] || null;
  return {
    ...order,
    clientName: client ? client.name : "Unknown client",
    daysOverdue: daysOverdue(order.dueDate, order.status),
    isOpen: order.status !== "Delivered" ? 1 : 0,
  };
}

function enrichClient(client, orders) {
  const clientOrders = orders.filter((o) => o.clientId === client.id);
  const openOrders = clientOrders.filter((o) => o.status !== "Delivered");
  const openValue = openOrders.reduce((sum, o) => sum + (Number(o.totalCost) || 0), 0);
  return {
    ...client,
    totalOpenOrders: openOrders.length,
    totalOpenValue: openValue,
    orderCount: clientOrders.length,
  };
}

function validateClient(body, partial = false) {
  const errors = [];
  if (!partial || body.name !== undefined) {
    if (!String(body.name || "").trim()) errors.push("Name is required.");
  }
  if (body.email !== undefined && body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push("Email format is invalid.");
  }
  return errors;
}

function validateOrder(body, partial = false) {
  const errors = [];
  if (!partial || body.orderId !== undefined) {
    if (!String(body.orderId || "").trim()) errors.push("Order ID is required.");
  }
  if (!partial || body.clientId !== undefined) {
    if (!String(body.clientId || "").trim()) errors.push("Client is required.");
  }
  if (body.status !== undefined && !ORDER_STATUSES.includes(body.status)) {
    errors.push("Invalid status.");
  }
  if (body.paymentStatus !== undefined && !PAYMENT_STATUSES.includes(body.paymentStatus)) {
    errors.push("Invalid payment status.");
  }
  if (body.totalCost !== undefined && Number.isNaN(Number(body.totalCost))) {
    errors.push("Total cost must be a number.");
  }
  if (body.quantity !== undefined && Number.isNaN(Number(body.quantity))) {
    errors.push("Quantity must be a number.");
  }
  return errors;
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
  };
  if (req.method === "GET" && staticMap[pathname]) {
    serveStatic(req, res, path.join(ROOT, "public", pathname.slice(1)), staticMap[pathname]);
    return;
  }

  if (pathname.startsWith("/api/")) {
    try {
      if (pathname === "/api/health" && req.method === "GET") {
        sendJson(res, 200, { ok: true, service: "crm-tool" });
        return;
      }

      if (pathname === "/api/meta" && req.method === "GET") {
        sendJson(res, 200, { orderStatuses: ORDER_STATUSES, paymentStatuses: PAYMENT_STATUSES });
        return;
      }

      if (pathname === "/api/dashboard" && req.method === "GET") {
        const store = loadStore();
        const clientsById = Object.fromEntries(store.clients.map((c) => [c.id, c]));
        const orders = store.orders.map((o) => enrichOrder(o, clientsById));
        const openOrders = orders.filter((o) => o.isOpen);
        const overdue = openOrders.filter((o) => o.daysOverdue > 0);
        const byStatus = ORDER_STATUSES.reduce((acc, s) => {
          acc[s] = orders.filter((o) => o.status === s).length;
          return acc;
        }, {});
        sendJson(res, 200, {
          totalClients: store.clients.length,
          totalOrders: orders.length,
          openOrders: openOrders.length,
          overdueOrders: overdue.length,
          openValue: openOrders.reduce((sum, o) => sum + (Number(o.totalCost) || 0), 0),
          byStatus,
          recentOrders: [...orders]
            .sort((a, b) => (b.dateReceived || "").localeCompare(a.dateReceived || ""))
            .slice(0, 5),
        });
        return;
      }

      if (pathname === "/api/clients") {
        const store = loadStore();

        if (req.method === "GET") {
          const enriched = store.clients.map((c) => enrichClient(c, store.orders));
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
          const now = todayIso();
          const client = {
            id: newId("cli"),
            name: String(body.name).trim(),
            email: String(body.email || "").trim(),
            phone: String(body.phone || "").trim(),
            address: String(body.address || "").trim(),
            notes: String(body.notes || "").trim(),
            createdAt: now,
            updatedAt: now,
          };
          store.clients.push(client);
          saveStore(store);
          sendJson(res, 201, enrichClient(client, store.orders));
          return;
        }
      }

      const clientMatch = pathname.match(/^\/api\/clients\/([^/]+)$/);
      if (clientMatch) {
        const store = loadStore();
        const id = clientMatch[1];
        const idx = store.clients.findIndex((c) => c.id === id);

        if (idx === -1) {
          sendJson(res, 404, { error: "Client not found." });
          return;
        }

        if (req.method === "GET") {
          sendJson(res, 200, enrichClient(store.clients[idx], store.orders));
          return;
        }

        if (req.method === "PUT") {
          const body = await readBody(req);
          const errors = validateClient(body, true);
          if (errors.length) {
            sendJson(res, 400, { error: errors.join(" ") });
            return;
          }
          const existing = store.clients[idx];
          const updated = {
            ...existing,
            name: body.name !== undefined ? String(body.name).trim() : existing.name,
            email: body.email !== undefined ? String(body.email).trim() : existing.email,
            phone: body.phone !== undefined ? String(body.phone).trim() : existing.phone,
            address: body.address !== undefined ? String(body.address).trim() : existing.address,
            notes: body.notes !== undefined ? String(body.notes).trim() : existing.notes,
            updatedAt: todayIso(),
          };
          store.clients[idx] = updated;
          saveStore(store);
          sendJson(res, 200, enrichClient(updated, store.orders));
          return;
        }

        if (req.method === "DELETE") {
          store.clients.splice(idx, 1);
          store.orders = store.orders.filter((o) => o.clientId !== id);
          saveStore(store);
          sendJson(res, 200, { ok: true });
          return;
        }
      }

      if (pathname === "/api/orders") {
        const store = loadStore();
        const clientsById = Object.fromEntries(store.clients.map((c) => [c.id, c]));

        if (req.method === "GET") {
          let orders = store.orders.map((o) => enrichOrder(o, clientsById));
          const clientId = url.searchParams.get("clientId");
          const status = url.searchParams.get("status");
          if (clientId) orders = orders.filter((o) => o.clientId === clientId);
          if (status) orders = orders.filter((o) => o.status === status);
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
          const now = todayIso();
          const order = {
            id: newId("ord"),
            orderId: String(body.orderId).trim(),
            clientId: body.clientId,
            dateReceived: body.dateReceived || new Date().toISOString().slice(0, 10),
            items: String(body.items || "").trim(),
            quantity: Number(body.quantity) || 0,
            totalCost: Number(body.totalCost) || 0,
            status: body.status || "New",
            paymentStatus: body.paymentStatus || "Unpaid",
            dueDate: body.dueDate || "",
            notes: String(body.notes || "").trim(),
            createdAt: now,
            updatedAt: now,
          };
          store.orders.push(order);
          saveStore(store);
          sendJson(res, 201, enrichOrder(order, clientsById));
          return;
        }
      }

      const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (orderMatch) {
        const store = loadStore();
        const clientsById = Object.fromEntries(store.clients.map((c) => [c.id, c]));
        const id = orderMatch[1];
        const idx = store.orders.findIndex((o) => o.id === id);

        if (idx === -1) {
          sendJson(res, 404, { error: "Order not found." });
          return;
        }

        if (req.method === "GET") {
          sendJson(res, 200, enrichOrder(store.orders[idx], clientsById));
          return;
        }

        if (req.method === "PUT") {
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
          const existing = store.orders[idx];
          const updated = {
            ...existing,
            orderId: body.orderId !== undefined ? String(body.orderId).trim() : existing.orderId,
            clientId: body.clientId !== undefined ? body.clientId : existing.clientId,
            dateReceived: body.dateReceived !== undefined ? body.dateReceived : existing.dateReceived,
            items: body.items !== undefined ? String(body.items).trim() : existing.items,
            quantity: body.quantity !== undefined ? Number(body.quantity) : existing.quantity,
            totalCost: body.totalCost !== undefined ? Number(body.totalCost) : existing.totalCost,
            status: body.status !== undefined ? body.status : existing.status,
            paymentStatus:
              body.paymentStatus !== undefined ? body.paymentStatus : existing.paymentStatus,
            dueDate: body.dueDate !== undefined ? body.dueDate : existing.dueDate,
            notes: body.notes !== undefined ? String(body.notes).trim() : existing.notes,
            updatedAt: todayIso(),
          };
          store.orders[idx] = updated;
          saveStore(store);
          sendJson(res, 200, enrichOrder(updated, clientsById));
          return;
        }

        if (req.method === "DELETE") {
          store.orders.splice(idx, 1);
          saveStore(store);
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
});
