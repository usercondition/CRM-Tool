const US_STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];

function emptyAddressParts() {
  return { addressLine1: "", addressLine2: "", city: "", state: "", zip: "" };
}

function formatAddress(parts) {
  const line1 = String(parts.addressLine1 || "").trim();
  const line2 = String(parts.addressLine2 || "").trim();
  const city = String(parts.city || "").trim();
  const state = String(parts.state || "").trim();
  const zip = String(parts.zip || "").trim();
  const street = [line1, line2].filter(Boolean).join(", ");
  const cityLine = [city, state].filter(Boolean).join(", ");
  const cityZip = [cityLine, zip].filter(Boolean).join(" ");
  return [street, cityZip].filter(Boolean).join(", ");
}

function normalizeAddressParts(raw, existing = null) {
  const base = existing ? pickAddressParts(existing) : emptyAddressParts();
  if (!raw || typeof raw !== "object") return base;
  const next = { ...base };
  for (const key of Object.keys(emptyAddressParts())) {
    if (raw[key] !== undefined) next[key] = String(raw[key] || "").trim();
  }
  if (next.state) next.state = next.state.toUpperCase().slice(0, 2);
  return next;
}

function pickAddressParts(client) {
  return {
    addressLine1: client?.addressLine1 || "",
    addressLine2: client?.addressLine2 || "",
    city: client?.city || "",
    state: client?.state || "",
    zip: client?.zip || "",
  };
}

function clientAddressForForm(client) {
  const parts = pickAddressParts(client);
  if (parts.addressLine1 || parts.city || parts.state || parts.zip) return parts;
  if (client?.address) return { ...parts, addressLine1: client.address };
  return parts;
}

function parseNominatimResult(item) {
  const a = item.address || {};
  const house = a.house_number ? `${a.house_number} ` : "";
  const road = a.road || a.pedestrian || a.path || "";
  const addressLine1 = `${house}${road}`.trim() || item.display_name?.split(",")[0] || "";
  const city = a.city || a.town || a.village || a.hamlet || a.municipality || "";
  const state = (a.state || "").slice(0, 2).toUpperCase();
  return {
    label: item.display_name,
    addressLine1,
    addressLine2: a.unit || a.apartment || "",
    city,
    state: US_STATES.some(([code]) => code === state) ? state : "",
    zip: a.postcode || "",
  };
}

function parseGooglePlace(place) {
  const parts = emptyAddressParts();
  const byType = (type) => place.address_components?.find((c) => c.types.includes(type));
  const streetNumber = byType("street_number")?.long_name || "";
  const route = byType("route")?.long_name || "";
  parts.addressLine1 = [streetNumber, route].filter(Boolean).join(" ").trim();
  parts.addressLine2 = byType("subpremise")?.long_name || "";
  parts.city =
    byType("locality")?.long_name ||
    byType("postal_town")?.long_name ||
    byType("sublocality")?.long_name ||
    "";
  parts.state = byType("administrative_area_level_1")?.short_name || "";
  parts.zip = byType("postal_code")?.long_name || "";
  return {
    label: place.formatted_address || formatAddress(parts),
    ...parts,
  };
}

async function fetchAddressSuggestions(query) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", q);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "SimpleCRM/1.0 (contact@example.com)" },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map(parseNominatimResult).filter((r) => r.addressLine1 || r.city);
}

module.exports = {
  US_STATES,
  emptyAddressParts,
  formatAddress,
  normalizeAddressParts,
  pickAddressParts,
  clientAddressForForm,
  parseGooglePlace,
  fetchAddressSuggestions,
};
