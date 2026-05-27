const crypto = require("crypto");

const SESSION_COOKIE = "crm_session";
const SESSION_DAYS = 14;

function getSessionSecret() {
  return String(process.env.CRM_SESSION_SECRET || process.env.CRM_PASSWORD || "dev-insecure-secret").trim();
}

function isAuthEnabled() {
  return Boolean(String(process.env.CRM_PASSWORD || "").trim());
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function signPayload(payload) {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function createSessionToken() {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = signPayload(payload);
  return `${payload}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = signPayload(payload);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || Date.now() > data.exp) return false;
    return true;
  } catch {
    return false;
  }
}

function getSessionCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] || null;
}

function isAuthenticated(req) {
  if (!isAuthEnabled()) return true;
  return verifySessionToken(getSessionCookie(req));
}

function buildSessionCookie(token, req) {
  const secure = process.env.NODE_ENV === "production" || String(req.headers["x-forwarded-proto"] || "") === "https";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function buildClearSessionCookie(req) {
  const secure = process.env.NODE_ENV === "production" || String(req.headers["x-forwarded-proto"] || "") === "https";
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function verifyPassword(password) {
  const expected = String(process.env.CRM_PASSWORD || "").trim();
  if (!expected) return true;
  const a = Buffer.from(String(password || ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isPublicApiPath(pathname, method) {
  if (pathname === "/api/health" && method === "GET") return true;
  if (pathname === "/api/auth/status" && method === "GET") return true;
  if (pathname === "/api/auth/login" && method === "POST") return true;
  if (/^\/api\/public\/orders\/[^/]+$/.test(pathname) && method === "GET") return true;
  return false;
}

module.exports = {
  SESSION_COOKIE,
  isAuthEnabled,
  isAuthenticated,
  isPublicApiPath,
  verifyPassword,
  createSessionToken,
  buildSessionCookie,
  buildClearSessionCookie,
};
