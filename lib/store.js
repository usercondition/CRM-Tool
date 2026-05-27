const fs = require("fs");
const path = require("path");
const { newId, todayIso } = require("./helpers");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function ensureJsonFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ clients: [], orders: [] }, null, 2) + "\n", "utf8");
  }
}

function loadJsonStore() {
  ensureJsonFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveJsonStore(store) {
  ensureJsonFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function rowToClient(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    address: row.address || "",
    notes: row.notes || "",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function rowToOrder(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    clientId: row.client_id,
    dateReceived: row.date_received || "",
    items: row.items || "",
    quantity: Number(row.quantity) || 0,
    totalCost: Number(row.total_cost) || 0,
    status: row.status,
    paymentStatus: row.payment_status,
    dueDate: row.due_date || "",
    notes: row.notes || "",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

async function createJsonStore() {
  return {
    mode: "json",
    async listClients() {
      return loadJsonStore().clients;
    },
    async listOrders() {
      return loadJsonStore().orders;
    },
    async getClient(id) {
      return loadJsonStore().clients.find((c) => c.id === id) || null;
    },
    async getOrder(id) {
      return loadJsonStore().orders.find((o) => o.id === id) || null;
    },
    async createClient(data) {
      const store = loadJsonStore();
      const now = todayIso();
      const client = {
        id: newId("cli"),
        name: data.name,
        email: data.email || "",
        phone: data.phone || "",
        address: data.address || "",
        notes: data.notes || "",
        createdAt: now,
        updatedAt: now,
      };
      store.clients.push(client);
      saveJsonStore(store);
      return client;
    },
    async updateClient(id, data) {
      const store = loadJsonStore();
      const idx = store.clients.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      const existing = store.clients[idx];
      const updated = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: todayIso(),
      };
      store.clients[idx] = updated;
      saveJsonStore(store);
      return updated;
    },
    async deleteClient(id) {
      const store = loadJsonStore();
      const before = store.clients.length;
      store.clients = store.clients.filter((c) => c.id !== id);
      store.orders = store.orders.filter((o) => o.clientId !== id);
      saveJsonStore(store);
      return before !== store.clients.length;
    },
    async createOrder(data) {
      const store = loadJsonStore();
      const now = todayIso();
      const order = {
        id: newId("ord"),
        orderId: data.orderId,
        clientId: data.clientId,
        dateReceived: data.dateReceived || new Date().toISOString().slice(0, 10),
        items: data.items || "",
        quantity: Number(data.quantity) || 0,
        totalCost: Number(data.totalCost) || 0,
        status: data.status || "New",
        paymentStatus: data.paymentStatus || "Unpaid",
        dueDate: data.dueDate || "",
        notes: data.notes || "",
        createdAt: now,
        updatedAt: now,
      };
      store.orders.push(order);
      saveJsonStore(store);
      return order;
    },
    async updateOrder(id, data) {
      const store = loadJsonStore();
      const idx = store.orders.findIndex((o) => o.id === id);
      if (idx === -1) return null;
      const existing = store.orders[idx];
      const updated = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: todayIso(),
      };
      store.orders[idx] = updated;
      saveJsonStore(store);
      return updated;
    },
    async deleteOrder(id) {
      const store = loadJsonStore();
      const before = store.orders.length;
      store.orders = store.orders.filter((o) => o.id !== id);
      saveJsonStore(store);
      return before !== store.orders.length;
    },
  };
}

async function seedPostgresFromJson(pool) {
  if (!fs.existsSync(DATA_FILE)) return;
  const seed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  for (const c of seed.clients || []) {
    await pool.query(
      `INSERT INTO clients (id, name, email, phone, address, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.name, c.email || "", c.phone || "", c.address || "", c.notes || "", c.createdAt, c.updatedAt]
    );
  }
  for (const o of seed.orders || []) {
    await pool.query(
      `INSERT INTO orders (id, order_id, client_id, date_received, items, quantity, total_cost, status, payment_status, due_date, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      [
        o.id,
        o.orderId,
        o.clientId,
        o.dateReceived || null,
        o.items || "",
        o.quantity || 0,
        o.totalCost || 0,
        o.status,
        o.paymentStatus,
        o.dueDate || null,
        o.notes || "",
        o.createdAt,
        o.updatedAt,
      ]
    );
  }
}

async function createPostgresStore(connectionString) {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      date_received TEXT,
      items TEXT DEFAULT '',
      quantity NUMERIC DEFAULT 0,
      total_cost NUMERIC DEFAULT 0,
      status TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      due_date TEXT,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  const count = await pool.query("SELECT COUNT(*)::int AS n FROM clients");
  if (count.rows[0].n === 0) {
    await seedPostgresFromJson(pool);
    console.log("[store] Seeded PostgreSQL from data/store.json");
  }

  return {
    mode: "postgres",
    pool,
    async listClients() {
      const { rows } = await pool.query("SELECT * FROM clients ORDER BY name ASC");
      return rows.map(rowToClient);
    },
    async listOrders() {
      const { rows } = await pool.query("SELECT * FROM orders ORDER BY date_received DESC NULLS LAST");
      return rows.map(rowToOrder);
    },
    async getClient(id) {
      const { rows } = await pool.query("SELECT * FROM clients WHERE id = $1", [id]);
      return rows[0] ? rowToClient(rows[0]) : null;
    },
    async getOrder(id) {
      const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
      return rows[0] ? rowToOrder(rows[0]) : null;
    },
    async createClient(data) {
      const now = todayIso();
      const client = {
        id: newId("cli"),
        name: data.name,
        email: data.email || "",
        phone: data.phone || "",
        address: data.address || "",
        notes: data.notes || "",
        createdAt: now,
        updatedAt: now,
      };
      await pool.query(
        `INSERT INTO clients (id, name, email, phone, address, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [client.id, client.name, client.email, client.phone, client.address, client.notes, client.createdAt, client.updatedAt]
      );
      return client;
    },
    async updateClient(id, data) {
      const existing = await this.getClient(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: todayIso() };
      await pool.query(
        `UPDATE clients SET name=$2, email=$3, phone=$4, address=$5, notes=$6, updated_at=$7 WHERE id=$1`,
        [updated.id, updated.name, updated.email, updated.phone, updated.address, updated.notes, updated.updatedAt]
      );
      return updated;
    },
    async deleteClient(id) {
      const result = await pool.query("DELETE FROM clients WHERE id = $1", [id]);
      return result.rowCount > 0;
    },
    async createOrder(data) {
      const now = todayIso();
      const order = {
        id: newId("ord"),
        orderId: data.orderId,
        clientId: data.clientId,
        dateReceived: data.dateReceived || new Date().toISOString().slice(0, 10),
        items: data.items || "",
        quantity: Number(data.quantity) || 0,
        totalCost: Number(data.totalCost) || 0,
        status: data.status || "New",
        paymentStatus: data.paymentStatus || "Unpaid",
        dueDate: data.dueDate || "",
        notes: data.notes || "",
        createdAt: now,
        updatedAt: now,
      };
      await pool.query(
        `INSERT INTO orders (id, order_id, client_id, date_received, items, quantity, total_cost, status, payment_status, due_date, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          order.id,
          order.orderId,
          order.clientId,
          order.dateReceived,
          order.items,
          order.quantity,
          order.totalCost,
          order.status,
          order.paymentStatus,
          order.dueDate || null,
          order.notes,
          order.createdAt,
          order.updatedAt,
        ]
      );
      return order;
    },
    async updateOrder(id, data) {
      const existing = await this.getOrder(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: todayIso() };
      await pool.query(
        `UPDATE orders SET order_id=$2, client_id=$3, date_received=$4, items=$5, quantity=$6, total_cost=$7, status=$8, payment_status=$9, due_date=$10, notes=$11, updated_at=$12 WHERE id=$1`,
        [
          updated.id,
          updated.orderId,
          updated.clientId,
          updated.dateReceived,
          updated.items,
          updated.quantity,
          updated.totalCost,
          updated.status,
          updated.paymentStatus,
          updated.dueDate || null,
          updated.notes,
          updated.updatedAt,
        ]
      );
      return updated;
    },
    async deleteOrder(id) {
      const result = await pool.query("DELETE FROM orders WHERE id = $1", [id]);
      return result.rowCount > 0;
    },
  };
}

async function createStore() {
  const dbUrl = String(process.env.DATABASE_URL || "").trim();
  if (dbUrl) {
    const store = await createPostgresStore(dbUrl);
    console.log("[store] Using PostgreSQL");
    return store;
  }
  console.log("[store] Using local JSON file (set DATABASE_URL for persistent cloud storage)");
  return createJsonStore();
}

module.exports = { createStore };
