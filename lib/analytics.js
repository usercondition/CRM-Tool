const STALE_DAYS = Number(process.env.STALE_ORDER_DAYS || 7);
const ORDER_TAG_PRESETS = ["rush", "repeat", "warranty"];

function parseDay(str) {
  if (!str) return null;
  const d = new Date(str.length === 10 ? `${str}T12:00:00` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

function todayKey() {
  return dayKey(new Date());
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(12, 0, 0, 0);
  return d;
}

function endOfWeek(date) {
  return addDays(startOfWeek(date), 6);
}

function isInRange(dayStr, start, end) {
  const d = parseDay(dayStr);
  if (!d) return false;
  return d >= start && d <= end;
}

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function tagsToString(tags) {
  return parseTags(tags).join(", ");
}

function enrichOrderMetrics(order, clientsById, lastActivityByOrder = {}) {
  const client = clientsById[order.clientId] || null;
  const due = parseDay(order.dueDate);
  const now = new Date();
  let daysUntilDue = null;
  if (due && order.status !== "Delivered") {
    daysUntilDue = Math.floor((due - now) / (86400000));
  }
  const daysOverdue =
    order.dueDate && order.status !== "Delivered" && due && now > due
      ? Math.floor((now - due) / 86400000)
      : 0;
  const lastTouch = lastActivityByOrder[order.id] || order.updatedAt || order.createdAt;
  const lastTouchDate = new Date(lastTouch);
  const daysSinceUpdate = Math.floor((now - lastTouchDate) / 86400000);
  const isStale =
    order.status !== "Delivered" &&
    ["New", "In Progress"].includes(order.status) &&
    daysSinceUpdate >= STALE_DAYS;
  return {
    ...order,
    tags: parseTags(order.tags),
    tagsLabel: tagsToString(order.tags),
    clientName: client ? client.name : "Unknown client",
    daysOverdue,
    daysUntilDue,
    daysSinceUpdate,
    isStale,
    isOpen: order.status !== "Delivered" ? 1 : 0,
  };
}

function enrichClientHealth(client, orders, lastActivityByOrder = {}) {
  const clientOrders = orders.filter((o) => o.clientId === client.id);
  const openOrders = clientOrders.filter((o) => o.status !== "Delivered");
  const openValue = openOrders.reduce((sum, o) => sum + (Number(o.totalCost) || 0), 0);
  const hasOverdue = openOrders.some((o) => o.daysOverdue > 0);
  const hasUnpaid = openOrders.some((o) => o.paymentStatus === "Unpaid" || o.paymentStatus === "Partial");
  let lastActivity = client.updatedAt;
  for (const o of clientOrders) {
    const t = lastActivityByOrder[o.id] || o.updatedAt;
    if (t > lastActivity) lastActivity = t;
  }
  const daysSinceActivity = Math.floor((Date.now() - new Date(lastActivity)) / 86400000);
  const inactive = openOrders.length === 0 ? daysSinceActivity >= 30 : daysSinceActivity >= 14 && hasOverdue;
  const flags = [];
  if (hasOverdue) flags.push("Overdue");
  if (hasUnpaid) flags.push("Unpaid");
  if (inactive) flags.push("Needs follow-up");
  if (openOrders.length > 0) flags.push(`${openOrders.length} open`);
  return {
    ...client,
    totalOpenOrders: openOrders.length,
    totalOpenValue: openValue,
    orderCount: clientOrders.length,
    hasOverdue,
    hasUnpaid,
    daysSinceActivity,
    healthFlags: flags,
    needsAttention: hasOverdue || hasUnpaid || inactive,
  };
}

function buildDashboardAnalytics(clients, orders, activity) {
  const now = new Date();
  const today = todayKey();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const openOrders = orders.filter((o) => o.isOpen);
  const overdue = openOrders.filter((o) => o.daysOverdue > 0);
  const unpaidOpen = openOrders.filter((o) => o.paymentStatus === "Unpaid" || o.paymentStatus === "Partial");
  const stale = openOrders.filter((o) => o.isStale);

  const dueToday = openOrders.filter((o) => o.dueDate === today);
  const dueThisWeek = openOrders.filter((o) => isInRange(o.dueDate, weekStart, weekEnd));
  const receivedThisWeek = orders.filter((o) => isInRange(o.dateReceived, weekStart, weekEnd));
  const shippedThisWeek = orders.filter(
    (o) => o.status === "Shipped" && isInRange((o.updatedAt || "").slice(0, 10), weekStart, weekEnd)
  );

  const pipelineValue = {};
  const pipelineCount = {};
  for (const s of ["New", "In Progress", "Shipped", "Delivered"]) {
    const list = orders.filter((o) => o.status === s);
    pipelineCount[s] = list.length;
    pipelineValue[s] = list.reduce((sum, o) => sum + (Number(o.totalCost) || 0), 0);
  }

  const paymentSnapshot = {
    unpaid: { count: 0, value: 0 },
    partial: { count: 0, value: 0 },
    paidOpen: { count: 0, value: 0 },
    paidThisMonth: { count: 0, value: 0 },
    outstanding: { count: unpaidOpen.length, value: unpaidOpen.reduce((s, o) => s + (Number(o.totalCost) || 0), 0) },
  };
  for (const o of openOrders) {
    if (o.paymentStatus === "Unpaid") {
      paymentSnapshot.unpaid.count += 1;
      paymentSnapshot.unpaid.value += Number(o.totalCost) || 0;
    } else if (o.paymentStatus === "Partial") {
      paymentSnapshot.partial.count += 1;
      paymentSnapshot.partial.value += Number(o.totalCost) || 0;
    } else if (o.paymentStatus === "Paid") {
      paymentSnapshot.paidOpen.count += 1;
      paymentSnapshot.paidOpen.value += Number(o.totalCost) || 0;
    }
  }
  for (const o of orders) {
    if (o.paymentStatus !== "Paid") continue;
    const u = new Date(o.updatedAt || o.createdAt);
    if (u >= monthStart) {
      paymentSnapshot.paidThisMonth.count += 1;
      paymentSnapshot.paidThisMonth.value += Number(o.totalCost) || 0;
    }
  }

  const calendarDays = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(now, i);
    const key = dayKey(d);
    const due = openOrders.filter((o) => o.dueDate === key);
    calendarDays.push({
      date: key,
      label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      count: due.length,
      value: due.reduce((s, o) => s + (Number(o.totalCost) || 0), 0),
      orders: due.slice(0, 3).map((o) => ({ id: o.id, orderId: o.orderId, clientName: o.clientName })),
    });
  }

  const delivered = orders.filter((o) => o.status === "Delivered");
  const deliveryDays = delivered
    .map((o) => {
      const start = parseDay(o.dateReceived);
      const end = parseDay((o.updatedAt || "").slice(0, 10));
      if (!start || !end) return null;
      return Math.max(0, Math.floor((end - start) / 86400000));
    })
    .filter((n) => n !== null);
  const avgDaysToDeliver =
    deliveryDays.length > 0 ? Math.round(deliveryDays.reduce((a, b) => a + b, 0) / deliveryDays.length) : null;

  const revenueChart = [];
  for (let i = 89; i >= 0; i--) {
    const d = addDays(now, -i);
    const key = dayKey(d);
    const dayOrders = orders.filter((o) => o.dateReceived === key);
    revenueChart.push({
      date: key,
      count: dayOrders.length,
      value: dayOrders.reduce((s, o) => s + (Number(o.totalCost) || 0), 0),
    });
  }

  const ordersById = Object.fromEntries(orders.map((o) => [o.id, o]));
  const recentActivity = activity.slice(0, 12).map((a) => ({
    ...a,
    orderLabel: ordersById[a.orderId]?.orderId || a.orderId,
    clientName: ordersById[a.orderId]?.clientName || "",
  }));

  const clientHealth = clients
    .map((c) => enrichClientHealth(c, orders))
    .filter((c) => c.needsAttention)
    .sort((a, b) => b.totalOpenValue - a.totalOpenValue)
    .slice(0, 8);

  return {
    totalClients: clients.length,
    totalOrders: orders.length,
    openOrders: openOrders.length,
    overdueOrders: overdue.length,
    unpaidOrders: unpaidOpen.length,
    staleOrders: stale.length,
    openValue: openOrders.reduce((sum, o) => sum + (Number(o.totalCost) || 0), 0),
    unpaidValue: paymentSnapshot.outstanding.value,
    avgDaysToDeliver,
    todayStrip: {
      dueToday: dueToday.length,
      dueThisWeek: dueThisWeek.length,
      receivedThisWeek: receivedThisWeek.length,
      shippedThisWeek: shippedThisWeek.length,
      dueTodayValue: dueToday.reduce((s, o) => s + (Number(o.totalCost) || 0), 0),
    },
    pipelineCount,
    pipelineValue,
    paymentSnapshot,
    calendarDays,
    revenueChart,
    clientHealth,
    stale: stale.slice(0, 8),
    needsAttention: {
      overdue: [...overdue].sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 8),
      unpaid: [...unpaidOpen].sort((a, b) => (b.dateReceived || "").localeCompare(a.dateReceived || "")).slice(0, 8),
    },
    recentOrders: [...orders]
      .sort((a, b) => (b.dateReceived || "").localeCompare(a.dateReceived || ""))
      .slice(0, 5),
    recentActivity,
  };
}

function searchAll(clients, orders, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return { clients: [], orders: [] };
  const clientHits = clients
    .filter((c) =>
      [c.name, c.email, c.phone, c.address, c.addressLine1, c.city, c.state, c.zip, c.notes]
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
    .slice(0, 8);
  const orderHits = orders
    .filter((o) =>
      [o.orderId, o.clientName, o.items, o.notes, o.invoiceNumber, o.poNumber, o.tagsLabel, ...(o.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
    .slice(0, 12);
  return { clients: clientHits, orders: orderHits, query: q };
}

function buildDigestText(analytics) {
  const lines = [
    "CRM Daily Digest",
    "================",
    `Due today: ${analytics.todayStrip.dueToday}`,
    `Due this week: ${analytics.todayStrip.dueThisWeek}`,
    `Overdue: ${analytics.overdueOrders}`,
    `Unpaid open: ${analytics.unpaidOrders} ($${analytics.unpaidValue.toFixed(2)})`,
    `Stale orders: ${analytics.staleOrders}`,
    "",
    "Top overdue:",
  ];
  for (const o of analytics.needsAttention.overdue.slice(0, 5)) {
    lines.push(`- ${o.orderId} (${o.clientName}) ${o.daysOverdue}d late`);
  }
  if (!analytics.needsAttention.overdue.length) lines.push("- None");
  return lines.join("\n");
}

module.exports = {
  STALE_DAYS,
  ORDER_TAG_PRESETS,
  parseTags,
  tagsToString,
  enrichOrderMetrics,
  enrichClientHealth,
  buildDashboardAnalytics,
  searchAll,
  buildDigestText,
};
