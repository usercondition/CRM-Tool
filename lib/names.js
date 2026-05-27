function splitLegacyName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function formatClientName(client) {
  if (!client) return "";
  const first = String(client.firstName || "").trim();
  const last = String(client.lastName || "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  if (combined) return combined;
  return String(client.name || "").trim();
}

function normalizeClientNames(body, existing = null) {
  let firstName =
    body.firstName !== undefined ? String(body.firstName).trim() : existing?.firstName || "";
  let lastName = body.lastName !== undefined ? String(body.lastName).trim() : existing?.lastName || "";

  if (!firstName && !lastName && body.name !== undefined) {
    const split = splitLegacyName(body.name);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  if (!firstName && !lastName && existing) {
    firstName = existing.firstName || splitLegacyName(existing.name).firstName;
    lastName = existing.lastName || splitLegacyName(existing.name).lastName;
  }

  const name = formatClientName({ firstName, lastName }) || (existing ? existing.name : "");
  return { firstName, lastName, name };
}

function clientNamesForForm(client) {
  if (!client) return { firstName: "", lastName: "" };
  if (client.firstName || client.lastName) {
    return { firstName: client.firstName || "", lastName: client.lastName || "" };
  }
  return splitLegacyName(client.name);
}

module.exports = { splitLegacyName, formatClientName, normalizeClientNames, clientNamesForForm };
