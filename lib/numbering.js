function currentYear() {
  return new Date().getFullYear();
}

function defaultNumbering() {
  return { year: currentYear(), seq: 0, bootstrapped: false };
}

function normalizeNumbering(raw) {
  const base = defaultNumbering();
  if (!raw || typeof raw !== "object") return base;
  return {
    year: Number(raw.year) || base.year,
    seq: Number(raw.seq) || 0,
    bootstrapped: Boolean(raw.bootstrapped),
  };
}

function formatOrderNumber(year, seq) {
  return `ORD-${year}-${String(seq).padStart(4, "0")}`;
}

function formatInvoiceNumber(year, seq) {
  return `INV-${year}-${String(seq).padStart(4, "0")}`;
}

function peekNextNumbers(numbering) {
  const year = currentYear();
  let n = normalizeNumbering(numbering);
  if (n.year !== year) n = { year, seq: 0, bootstrapped: n.bootstrapped };
  const nextSeq = n.seq + 1;
  return {
    orderId: formatOrderNumber(year, nextSeq),
    invoiceNumber: formatInvoiceNumber(year, nextSeq),
  };
}

function allocateNextNumbers(numbering) {
  const year = currentYear();
  let n = normalizeNumbering(numbering);
  if (n.year !== year) n = { year, seq: 0, bootstrapped: true };
  n.seq += 1;
  return {
    orderId: formatOrderNumber(year, n.seq),
    invoiceNumber: formatInvoiceNumber(year, n.seq),
    numbering: n,
  };
}

function bootstrapNumberingFromOrders(orders, numbering) {
  const year = currentYear();
  let maxSeq = normalizeNumbering(numbering).seq;
  const patterns = [/^ORD-(\d{4})-(\d+)$/i, /^INV-(\d{4})-(\d+)$/i];
  for (const o of orders) {
    for (const val of [o.orderId, o.invoiceNumber]) {
      for (const re of patterns) {
        const m = re.exec(String(val || ""));
        if (m && Number(m[1]) === year) maxSeq = Math.max(maxSeq, Number(m[2]));
      }
    }
  }
  if (maxSeq === 0 && orders.length) maxSeq = orders.length;
  return { year, seq: maxSeq, bootstrapped: true };
}

module.exports = {
  defaultNumbering,
  normalizeNumbering,
  peekNextNumbers,
  allocateNextNumbers,
  bootstrapNumberingFromOrders,
  formatOrderNumber,
  formatInvoiceNumber,
};
