const { buildDigestText } = require("./analytics");

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendDigestEmail(analytics, to) {
  const recipient = String(to || process.env.CRM_DIGEST_EMAIL || "").trim();
  if (!recipient) {
    return { ok: false, error: "No digest email configured. Set CRM_DIGEST_EMAIL or pass ?to=." };
  }
  if (!smtpConfigured()) {
    return {
      ok: false,
      error: "SMTP not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS to send email.",
      preview: buildDigestText(analytics),
    };
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

  const text = buildDigestText(analytics);
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipient,
    subject: `CRM digest — ${analytics.overdueOrders} overdue, ${analytics.unpaidOrders} unpaid`,
    text,
  });

  return { ok: true, to: recipient };
}

module.exports = { sendDigestEmail, smtpConfigured, buildDigestText };
