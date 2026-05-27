const { daysOverdue } = require("./helpers");

function buildPublicOrderView(order, client, activity) {
  return {
    orderId: order.orderId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    items: order.items || "",
    quantity: Number(order.quantity) || 0,
    totalCost: Number(order.totalCost) || 0,
    dateReceived: order.dateReceived || "",
    dueDate: order.dueDate || "",
    invoiceNumber: order.invoiceNumber || "",
    poNumber: order.poNumber || "",
    clientName: client ? client.name : "",
    daysOverdue: daysOverdue(order.dueDate, order.status),
    isOpen: order.status !== "Delivered",
    updatedAt: order.updatedAt || order.createdAt,
    activity: (activity || []).map((a) => ({
      type: a.type,
      message: a.message,
      createdAt: a.createdAt,
    })),
  };
}

function publicTrackPath(token) {
  return `/track/${encodeURIComponent(token)}`;
}

function publicTrackUrl(req, token) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}${publicTrackPath(token)}`;
}

module.exports = { buildPublicOrderView, publicTrackPath, publicTrackUrl };
