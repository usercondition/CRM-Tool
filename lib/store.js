const fs = require("fs");
const path = require("path");
const { newId, todayIso, createPublicToken } = require("./helpers");
const { formatAddress } = require("./address");
const { rowToActivity, buildCreatedActivity, buildChangeActivities } = require("./activity");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function ensureJsonFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ clients: [], orders: [], activity: [], settings: defaultSettings() }, null, 2) + "\n",
      "utf8"
    );
  }
}

function loadJsonStore() {
  ensureJsonFile();
  const store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!Array.isArray(store.activity)) store.activity = [];
  if (!store.settings) store.settings = defaultSettings();
  else store.settings = normalizeSettings(store.settings);
  return store;
}

function saveJsonStore(store) {
  ensureJsonFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function rowToClient(row) {
  const parts = {
    addressLine1: row.address_line1 || "",
    addressLine2: row.address_line2 || "",
    city: row.city || "",
    state: row.state || "",
    zip: row.zip || "",
  };
  const formatted = formatAddress(parts);
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    address: row.address || formatted || "",
    addressLine1: parts.addressLine1,
    addressLine2: parts.addressLine2,
    city: parts.city,
    state: parts.state,
    zip: parts.zip,
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
    tags: row.tags || "",
    invoiceNumber: row.invoice_number || "",
    poNumber: row.po_number || "",
    publicToken: row.public_token || "",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function defaultSettings() {
  return {
    savedViews: [],
    digestEmail: String(process.env.CRM_DIGEST_EMAIL || "").trim(),
  };
}

function normalizeSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  return {
    savedViews: Array.isArray(raw.savedViews) ? raw.savedViews : base.savedViews,
    digestEmail: raw.digestEmail !== undefined ? String(raw.digestEmail).trim() : base.digestEmail,
  };
}

function buildClientRecord(data, id, now, existing = null) {
  const parts = {
    addressLine1: data.addressLine1 !== undefined ? data.addressLine1 || "" : existing?.addressLine1 || "",
    addressLine2: data.addressLine2 !== undefined ? data.addressLine2 || "" : existing?.addressLine2 || "",
    city: data.city !== undefined ? data.city || "" : existing?.city || "",
    state: data.state !== undefined ? data.state || "" : existing?.state || "",
    zip: data.zip !== undefined ? data.zip || "" : existing?.zip || "",
  };
  const address =
    data.address !== undefined
      ? data.address || formatAddress(parts)
      : formatAddress(parts) || existing?.address || "";
  return {
    id,
    name: data.name,
    email: data.email !== undefined ? data.email || "" : existing?.email || "",
    phone: data.phone !== undefined ? data.phone || "" : existing?.phone || "",
    address,
    ...parts,
    notes: data.notes !== undefined ? data.notes || "" : existing?.notes || "",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

function appendJsonActivities(store, orderId, entries) {
  const now = todayIso();
  for (const entry of entries) {
    store.activity.push({
      id: newId("act"),
      orderId,
      type: entry.type,
      message: entry.message,
      oldValue: entry.oldValue || "",
      newValue: entry.newValue || "",
      createdAt: now,
    });
  }
}

async function insertActivities(pool, orderId, entries) {
  const now = todayIso();
  for (const entry of entries) {
    await pool.query(
      `INSERT INTO order_activity (id, order_id, type, message, old_value, new_value, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newId("act"), orderId, entry.type, entry.message, entry.oldValue || "", entry.newValue || "", now]
    );
  }
}

function settingsMixin(base, loadSettings, saveSettingsFn) {
  return {
    ...base,
    async getSettings() {
      return normalizeSettings(await loadSettings());
    },
    async saveSettings(partial) {
      const current = normalizeSettings(await loadSettings());
      const next = normalizeSettings({ ...current, ...partial });
      await saveSettingsFn(next);
      return next;
    },
    async listSavedViews() {
      return (await this.getSettings()).savedViews;
    },
    async addSavedView(view) {
      const settings = await this.getSettings();
      const entry = {
        id: newId("sv"),
        name: String(view.name || "Saved view").trim(),
        filters: view.filters || {},
      };
      settings.savedViews.push(entry);
      await saveSettingsFn(settings);
      return entry;
    },
    async deleteSavedView(id) {
      const settings = await this.getSettings();
      const before = settings.savedViews.length;
      settings.savedViews = settings.savedViews.filter((v) => v.id !== id);
      await saveSettingsFn(settings);
      return before !== settings.savedViews.length;
    },
  };
}

function activityMixin(base, persistActivities) {
  return {
    ...base,
    async recordOrderCreated(order) {
      await persistActivities(order.id, [buildCreatedActivity(order)]);
    },
    async recordOrderChanges(before, after) {
      const entries = buildChangeActivities(before, after);
      if (entries.length) await persistActivities(after.id, entries);
    },
    async addOrderNote(orderId, message) {
      const text = String(message || "").trim();
      if (!text) return null;
      await persistActivities(orderId, [{ type: "note", message: text, oldValue: "", newValue: "" }]);
      return { ok: true };
    },
    async listOrderActivity(orderId) {
      return base.listOrderActivity(orderId);
    },
    async listRecentActivity(limit = 15) {
      return base.listRecentActivity(limit);
    },
  };
}

async function createJsonStore() {
  const core = {
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
    async listOrderActivity(orderId) {
      const store = loadJsonStore();
      return store.activity
        .filter((a) => a.orderId === orderId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((a) => ({ ...a }));
    },
    async listRecentActivity(limit = 15) {
      const store = loadJsonStore();
      return [...store.activity].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    },
    async createClient(data) {
      const store = loadJsonStore();
      const now = todayIso();
      const client = buildClientRecord(data, newId("cli"), now);
      store.clients.push(client);
      saveJsonStore(store);
      return client;
    },
    async updateClient(id, data) {
      const store = loadJsonStore();
      const idx = store.clients.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      const existing = store.clients[idx];
      const updated = buildClientRecord({ ...existing, ...data }, existing.id, todayIso(), existing);
      store.clients[idx] = updated;
      saveJsonStore(store);
      return updated;
    },
    async deleteClient(id) {
      const store = loadJsonStore();
      const orderIds = store.orders.filter((o) => o.clientId === id).map((o) => o.id);
      const before = store.clients.length;
      store.clients = store.clients.filter((c) => c.id !== id);
      store.orders = store.orders.filter((o) => o.clientId !== id);
      store.activity = store.activity.filter((a) => !orderIds.includes(a.orderId));
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
        tags: data.tags || "",
        invoiceNumber: data.invoiceNumber || "",
        poNumber: data.poNumber || "",
        publicToken: createPublicToken(),
        createdAt: now,
        updatedAt: now,
      };
      store.orders.push(order);
      appendJsonActivities(store, order.id, [buildCreatedActivity(order)]);
      saveJsonStore(store);
      return order;
    },
    async updateOrder(id, data) {
      const store = loadJsonStore();
      const idx = store.orders.findIndex((o) => o.id === id);
      if (idx === -1) return null;
      const existing = store.orders[idx];
      const updated = { ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: todayIso() };
      appendJsonActivities(store, id, buildChangeActivities(existing, updated));
      store.orders[idx] = updated;
      saveJsonStore(store);
      return updated;
    },
    async deleteOrder(id) {
      const store = loadJsonStore();
      const before = store.orders.length;
      store.orders = store.orders.filter((o) => o.id !== id);
      store.activity = store.activity.filter((a) => a.orderId !== id);
      saveJsonStore(store);
      return before !== store.orders.length;
    },
    async getOrderByPublicToken(token) {
      const store = loadJsonStore();
      return store.orders.find((o) => o.publicToken === token) || null;
    },
    async ensurePublicToken(orderId) {
      const store = loadJsonStore();
      const idx = store.orders.findIndex((o) => o.id === orderId);
      if (idx === -1) return null;
      if (!store.orders[idx].publicToken) {
        store.orders[idx].publicToken = createPublicToken();
        store.orders[idx].updatedAt = todayIso();
        saveJsonStore(store);
      }
      return store.orders[idx].publicToken;
    },
    async rotatePublicToken(orderId) {
      const store = loadJsonStore();
      const idx = store.orders.findIndex((o) => o.id === orderId);
      if (idx === -1) return null;
      store.orders[idx].publicToken = createPublicToken();
      store.orders[idx].updatedAt = todayIso();
      saveJsonStore(store);
      return store.orders[idx].publicToken;
    },
  };

  async function persistActivities(orderId, entries) {
    const store = loadJsonStore();
    appendJsonActivities(store, orderId, entries);
    saveJsonStore(store);
  }

  return settingsMixin(
    activityMixin(core, persistActivities),
    async () => loadJsonStore().settings,
    async (settings) => {
      const store = loadJsonStore();
      store.settings = settings;
      saveJsonStore(store);
    }
  );
}

async function seedPostgresFromJson(pool) {
  if (!fs.existsSync(DATA_FILE)) return;
  const seed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  for (const c of seed.clients || []) {
    await pool.query(
      `INSERT INTO clients (id, name, email, phone, address, address_line1, address_line2, city, state, zip, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      [
        c.id,
        c.name,
        c.email || "",
        c.phone || "",
        c.address || "",
        c.addressLine1 || "",
        c.addressLine2 || "",
        c.city || "",
        c.state || "",
        c.zip || "",
        c.notes || "",
        c.createdAt,
        c.updatedAt,
      ]
    );
  }
  for (const o of seed.orders || []) {
    await pool.query(
      `INSERT INTO orders (id, order_id, client_id, date_received, items, quantity, total_cost, status, payment_status, due_date, notes, tags, invoice_number, po_number, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
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
        o.tags || "",
        o.invoiceNumber || "",
        o.poNumber || "",
        o.createdAt,
        o.updatedAt,
      ]
    );
    await insertActivities(pool, o.id, [buildCreatedActivity(o)]);
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
    CREATE TABLE IF NOT EXISTS order_activity (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT DEFAULT '',
      old_value TEXT DEFAULT '',
      new_value TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS po_number TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS public_token TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_line1 TEXT DEFAULT '';
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_line2 TEXT DEFAULT '';
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '';
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS state TEXT DEFAULT '';
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS zip TEXT DEFAULT '';
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS orders_public_token_idx ON orders (public_token) WHERE public_token IS NOT NULL AND public_token <> '';
  `);

  const settingsCount = await pool.query("SELECT COUNT(*)::int AS n FROM app_settings");
  if (settingsCount.rows[0].n === 0) {
    await pool.query(`INSERT INTO app_settings (id, data) VALUES ('default', $1)`, [defaultSettings()]);
  }

  const count = await pool.query("SELECT COUNT(*)::int AS n FROM clients");
  if (count.rows[0].n === 0) {
    await seedPostgresFromJson(pool);
    console.log("[store] Seeded PostgreSQL from data/store.json");
  }

  const core = {
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
    async listOrderActivity(orderId) {
      const { rows } = await pool.query(
        "SELECT * FROM order_activity WHERE order_id = $1 ORDER BY created_at DESC",
        [orderId]
      );
      return rows.map(rowToActivity);
    },
    async listRecentActivity(limit = 15) {
      const { rows } = await pool.query("SELECT * FROM order_activity ORDER BY created_at DESC LIMIT $1", [limit]);
      return rows.map(rowToActivity);
    },
    async createClient(data) {
      const now = todayIso();
      const client = buildClientRecord(data, newId("cli"), now);
      await pool.query(
        `INSERT INTO clients (id, name, email, phone, address, address_line1, address_line2, city, state, zip, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          client.id,
          client.name,
          client.email,
          client.phone,
          client.address,
          client.addressLine1,
          client.addressLine2,
          client.city,
          client.state,
          client.zip,
          client.notes,
          client.createdAt,
          client.updatedAt,
        ]
      );
      return client;
    },
    async updateClient(id, data) {
      const existing = await this.getClient(id);
      if (!existing) return null;
      const updated = buildClientRecord({ ...existing, ...data }, existing.id, todayIso(), existing);
      await pool.query(
        `UPDATE clients SET name=$2, email=$3, phone=$4, address=$5, address_line1=$6, address_line2=$7, city=$8, state=$9, zip=$10, notes=$11, updated_at=$12 WHERE id=$1`,
        [
          updated.id,
          updated.name,
          updated.email,
          updated.phone,
          updated.address,
          updated.addressLine1,
          updated.addressLine2,
          updated.city,
          updated.state,
          updated.zip,
          updated.notes,
          updated.updatedAt,
        ]
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
        tags: data.tags || "",
        invoiceNumber: data.invoiceNumber || "",
        poNumber: data.poNumber || "",
        publicToken: createPublicToken(),
        createdAt: now,
        updatedAt: now,
      };
      await pool.query(
        `INSERT INTO orders (id, order_id, client_id, date_received, items, quantity, total_cost, status, payment_status, due_date, notes, tags, invoice_number, po_number, public_token, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
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
          order.tags || "",
          order.invoiceNumber || "",
          order.poNumber || "",
          order.publicToken,
          order.createdAt,
          order.updatedAt,
        ]
      );
      await insertActivities(pool, order.id, [buildCreatedActivity(order)]);
      return order;
    },
    async updateOrder(id, data) {
      const existing = await this.getOrder(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: todayIso() };
      await insertActivities(pool, id, buildChangeActivities(existing, updated));
      await pool.query(
        `UPDATE orders SET order_id=$2, client_id=$3, date_received=$4, items=$5, quantity=$6, total_cost=$7, status=$8, payment_status=$9, due_date=$10, notes=$11, tags=$12, invoice_number=$13, po_number=$14, updated_at=$15 WHERE id=$1`,
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
          updated.tags || "",
          updated.invoiceNumber || "",
          updated.poNumber || "",
          updated.updatedAt,
        ]
      );
      return updated;
    },
    async deleteOrder(id) {
      const result = await pool.query("DELETE FROM orders WHERE id = $1", [id]);
      return result.rowCount > 0;
    },
    async getOrderByPublicToken(token) {
      const { rows } = await pool.query("SELECT * FROM orders WHERE public_token = $1", [token]);
      return rows[0] ? rowToOrder(rows[0]) : null;
    },
    async ensurePublicToken(orderId) {
      const existing = await this.getOrder(orderId);
      if (!existing) return null;
      if (existing.publicToken) return existing.publicToken;
      const token = createPublicToken();
      await pool.query("UPDATE orders SET public_token = $2, updated_at = $3 WHERE id = $1", [
        orderId,
        token,
        todayIso(),
      ]);
      return token;
    },
    async rotatePublicToken(orderId) {
      const existing = await this.getOrder(orderId);
      if (!existing) return null;
      const token = createPublicToken();
      await pool.query("UPDATE orders SET public_token = $2, updated_at = $3 WHERE id = $1", [
        orderId,
        token,
        todayIso(),
      ]);
      return token;
    },
  };

  async function loadPgSettings() {
    const { rows } = await pool.query("SELECT data FROM app_settings WHERE id = 'default'");
    return rows[0]?.data || defaultSettings();
  }

  async function savePgSettings(settings) {
    await pool.query(
      `INSERT INTO app_settings (id, data) VALUES ('default', $1)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [settings]
    );
  }

  return settingsMixin(
    activityMixin(core, (orderId, entries) => insertActivities(pool, orderId, entries)),
    loadPgSettings,
    savePgSettings
  );
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
