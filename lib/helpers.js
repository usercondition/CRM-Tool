const crypto = require("crypto");

const ORDER_STATUSES = ["New", "In Progress", "Ready", "Shipped", "Delivered"];
const PAYMENT_STATUSES = ["Unpaid", "Partial", "Paid", "Refunded"];

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function createPublicToken() {
  return crypto.randomBytes(24).toString("base64url");
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

const { normalizeClientNames } = require("./names");

function validateClient(body, partial = false) {
  const errors = [];
  const names = normalizeClientNames(body);
  if (!partial || body.firstName !== undefined || body.lastName !== undefined || body.name !== undefined) {
    if (!names.firstName && !names.lastName) errors.push("First or last name is required.");
  }
  if (body.email !== undefined && body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push("Email format is invalid.");
  }
  return errors;
}

function parseDecimal(value) {
  const s = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
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
  if (body.totalCost !== undefined && Number.isNaN(parseDecimal(body.totalCost))) {
    errors.push("Total cost must be a number.");
  }
  if (body.quantity !== undefined && Number.isNaN(parseDecimal(body.quantity))) {
    errors.push("Quantity must be a number.");
  }
  return errors;
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvEscape(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(typeof c.value === "function" ? c.value(row) : row[c.key])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

module.exports = {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  newId,
  createPublicToken,
  todayIso,
  daysOverdue,
  parseDecimal,
  enrichOrder,
  enrichClient,
  validateClient,
  validateOrder,
  toCsv,
};
