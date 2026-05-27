const { newId, todayIso, ORDER_STATUSES } = require("./helpers");

function rowToActivity(row) {
  return {
    id: row.id,
    orderId: row.order_id || row.orderId,
    type: row.type,
    message: row.message || "",
    oldValue: row.old_value || row.oldValue || "",
    newValue: row.new_value || row.newValue || "",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function buildCreatedActivity(order) {
  return {
    type: "created",
    message: `Order created — ${order.status}, ${order.paymentStatus}`,
    oldValue: "",
    newValue: "",
  };
}

function buildChangeActivities(before, after) {
  const entries = [];
  if (before.status !== after.status) {
    entries.push({
      type: "status",
      message: `Status: ${before.status} → ${after.status}`,
      oldValue: before.status,
      newValue: after.status,
    });
  }
  if (before.paymentStatus !== after.paymentStatus) {
    entries.push({
      type: "payment",
      message: `Payment: ${before.paymentStatus} → ${after.paymentStatus}`,
      oldValue: before.paymentStatus,
      newValue: after.paymentStatus,
    });
  }
  if (before.dueDate !== after.dueDate) {
    entries.push({
      type: "due_date",
      message: `Due date set to ${after.dueDate || "none"}`,
      oldValue: before.dueDate || "",
      newValue: after.dueDate || "",
    });
  }
  if (before.totalCost !== after.totalCost) {
    entries.push({
      type: "amount",
      message: `Total updated to $${Number(after.totalCost).toFixed(2)}`,
      oldValue: String(before.totalCost),
      newValue: String(after.totalCost),
    });
  }
  return entries;
}

function nextStatus(current) {
  const idx = ORDER_STATUSES.indexOf(current);
  if (idx === -1 || idx >= ORDER_STATUSES.length - 1) return null;
  return ORDER_STATUSES[idx + 1];
}

module.exports = {
  rowToActivity,
  buildCreatedActivity,
  buildChangeActivities,
  nextStatus,
  newId,
  todayIso,
};
