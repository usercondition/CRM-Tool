const { smtpConfigured } = require("./digest");

const NOTIFY_STATUSES = new Set(["Ready", "Shipped", "Delivered"]);

function statusMessage(status, fulfillmentType) {
  const pickup = fulfillmentType === "Pickup";
  if (status === "Ready") {
    return pickup
      ? "Your order is complete and ready for pickup."
      : "Your order is complete and will ship soon.";
  }
  if (status === "Shipped") {
    return pickup ? "Your order is on its way to you." : "Your order has shipped.";
  }
  if (status === "Delivered") {
    return pickup ? "Your order has been picked up. Thank you!" : "Your order has been delivered. Thank you!";
  }
  return `Your order status is now: ${status}.`;
}

function buildClientEmailText({ order, client, oldStatus, newStatus, trackUrl }) {
  const name = client.name || "there";
  const lines = [
    `Hi ${name},`,
    "",
    statusMessage(newStatus, order.fulfillmentType || "Ship"),
    "",
    `Order: ${order.orderId}`,
    `Status: ${oldStatus} → ${newStatus}`,
  ];
  if (order.items) lines.push(`Items: ${order.items}`);
  if (order.dueDate) lines.push(`Due date: ${order.dueDate}`);
  lines.push("", "Track your order anytime:", trackUrl, "", "— Simple CRM");
  return lines.join("\n");
}

async function sendClientStatusEmail({ order, client, oldStatus, newStatus, trackUrl }) {
  if (!NOTIFY_STATUSES.has(newStatus) || oldStatus === newStatus) {
    return { ok: false, skipped: true, reason: "Status not notifiable." };
  }
  const to = String(client.email || "").trim();
  if (!to) {
    return { ok: false, skipped: true, reason: "Client has no email." };
  }
  if (!smtpConfigured()) {
    return { ok: false, skipped: true, reason: "SMTP not configured." };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    return { ok: false, error: "nodemailer package is not installed." };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const subject =
    newStatus === "Ready"
      ? `Order ${order.orderId} is ready${order.fulfillmentType === "Pickup" ? " for pickup" : ""}`
      : `Order ${order.orderId} — ${newStatus}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text: buildClientEmailText({ order, client, oldStatus, newStatus, trackUrl }),
  });

  return { ok: true, to };
}

module.exports = { sendClientStatusEmail, statusMessage, NOTIFY_STATUSES };
