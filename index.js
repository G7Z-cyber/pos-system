
// ===============================
// RESTAURANT POS - index.js
// PROFESSIONAL UPGRADE (v5.1)
// + Reservations linked to POS tables (reserved indicator + details)
// + Submitting PAID receipt releases reservation immediately
// + Customer stats update (visits/lastVisit/lifetimeSpend/points) + fixes finalizeReceipt call
// + Customer input fields for walk-ins (name/phone) and receipt shows customer
// ===============================

// ---------- Utilities ----------
function safeParse(str, fallback) { try { return JSON.parse(str || ""); } catch { return fallback; } }
function norm(s) { return String(s || "").trim().toLowerCase(); }
function getLiveStockItems() {
  try {
    return JSON.parse(localStorage.getItem("stockItems") || "[]");
  } catch {
    return [];
  }
}
function normUnit(u) { return String(u || "").trim().toLowerCase(); }
function nowId() { return `L-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`.toUpperCase(); }
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function money(n) { return Number(n || 0).toFixed(2); }
function formatQty(qty, unit) {
  const u = normUnit(unit);
  const n = Number(qty || 0);
  if (u === "pcs") return String(Math.round(n));
  const fixed = n.toFixed(2);
  return fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed;
}
function convertQty(qty, fromUnit, toUnit) {
  const f = normUnit(fromUnit);
  const t = normUnit(toUnit);
  const q = Number(qty);

  if (!isFinite(q)) return null;
  if (f === t) return q;

  if (f === "g" && t === "kg") return q / 1000;
  if (f === "kg" && t === "g") return q * 1000;

  if (f === "ml" && t === "l") return q / 1000;
  if (f === "l" && t === "ml") return q * 1000;

  return null;
}


// ---------- POS Display Settings (currency + VAT) ----------
const POS_SETTINGS_KEY = "posSettings";
const DEFAULT_POS_SETTINGS = {
  currency: "USD",
  usdToLbp: 89500,
  vatRate: 11,
  vatMode: "included", // legal restaurant style: listed prices/total include VAT
};

function loadPosSettings() {
  const saved = safeParse(localStorage.getItem(POS_SETTINGS_KEY), {});
  const settings = { ...DEFAULT_POS_SETTINGS, ...(saved && typeof saved === "object" ? saved : {}) };

  settings.currency = settings.currency === "LBP" ? "LBP" : "USD";
  settings.usdToLbp = Number(settings.usdToLbp || DEFAULT_POS_SETTINGS.usdToLbp);
  if (!Number.isFinite(settings.usdToLbp) || settings.usdToLbp <= 0) settings.usdToLbp = DEFAULT_POS_SETTINGS.usdToLbp;

  settings.vatRate = Number(settings.vatRate ?? DEFAULT_POS_SETTINGS.vatRate);
  if (!Number.isFinite(settings.vatRate) || settings.vatRate < 0) settings.vatRate = DEFAULT_POS_SETTINGS.vatRate;

  settings.vatMode = "included";
  return settings;
}

let posSettings = loadPosSettings();

function savePosSettings() {
  localStorage.setItem(POS_SETTINGS_KEY, JSON.stringify(posSettings));
}

function sanitizePosSettings(settings) {
  const s = { ...DEFAULT_POS_SETTINGS, ...(settings || {}) };
  s.currency = s.currency === "LBP" ? "LBP" : "USD";
  s.usdToLbp = Number(s.usdToLbp || DEFAULT_POS_SETTINGS.usdToLbp);
  if (!Number.isFinite(s.usdToLbp) || s.usdToLbp <= 0) s.usdToLbp = DEFAULT_POS_SETTINGS.usdToLbp;
  s.vatRate = Number(s.vatRate ?? DEFAULT_POS_SETTINGS.vatRate);
  if (!Number.isFinite(s.vatRate) || s.vatRate < 0) s.vatRate = DEFAULT_POS_SETTINGS.vatRate;
  s.vatMode = "included";
  return s;
}

function formatCurrency(amountUsd, settings = posSettings) {
  const s = sanitizePosSettings(settings);
  const amount = Number(amountUsd || 0);

  if (s.currency === "LBP") {
    const lbp = Math.round(amount * s.usdToLbp);
    return `${lbp.toLocaleString("en-US")} LBP`;
  }

  return `$${money(amount)}`;
}

function usdToDisplayAmount(amountUsd, settings = posSettings) {
  const s = sanitizePosSettings(settings);
  const amount = Number(amountUsd || 0);
  if (s.currency === "LBP") return Math.round(amount * s.usdToLbp);
  return Number(amount.toFixed(2));
}

function displayAmountToUsd(displayAmount, settings = posSettings) {
  const s = sanitizePosSettings(settings);
  const amount = Number(displayAmount || 0);
  if (!Number.isFinite(amount)) return 0;
  if (s.currency === "LBP") return amount / s.usdToLbp;
  return amount;
}

function normalizePaymentCurrency(currency) {
  return String(currency || posSettings.currency || "USD").toUpperCase() === "LBP" ? "LBP" : "USD";
}

function paymentAmountToUsd(amount, currency) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  return normalizePaymentCurrency(currency) === "LBP" ? value / posSettings.usdToLbp : value;
}

function usdToPaymentCurrency(amountUsd, currency) {
  const amount = Number(amountUsd || 0);
  if (normalizePaymentCurrency(currency) === "LBP") return Math.round(amount * posSettings.usdToLbp);
  return Number(amount.toFixed(2));
}

function getPaymentInputAmount(payment) {
  if (!payment) return 0;
  if (payment.inputAmount !== null && payment.inputAmount !== undefined && payment.inputAmount !== "") {
    const n = Number(payment.inputAmount);
    return Number.isFinite(n) ? n : 0;
  }
  return usdToPaymentCurrency(payment.amount || 0, payment.currency || "USD");
}

function syncPaymentUsdAmount(payment) {
  if (!payment) return payment;
  payment.currency = normalizePaymentCurrency(payment.currency);
  payment.inputAmount = getPaymentInputAmount(payment);
  payment.amount = paymentAmountToUsd(payment.inputAmount, payment.currency);
  return payment;
}

function getPaymentCurrencyStep(currency) {
  return normalizePaymentCurrency(currency) === "LBP" ? "1000" : "0.01";
}

function getPaymentCurrencyPlaceholder(currency) {
  return normalizePaymentCurrency(currency) === "LBP" ? "Amount in LBP" : "Amount in USD";
}

function formatPaymentDisplay(payment) {
  if (!payment) return formatCurrency(0);
  const currency = normalizePaymentCurrency(payment.currency);
  const input = getPaymentInputAmount(payment);
  if (currency === "LBP") return `${Math.round(input).toLocaleString("en-US")} LBP`;
  return `$${money(input)}`;
}

function getPaymentStep() {
  return posSettings.currency === "LBP" ? "1000" : "0.01";
}

function getPaymentPlaceholder() {
  return posSettings.currency === "LBP" ? "Amount in LBP" : "Amount in USD";
}

function getCustomCurrencyStep(currency) {
  return normalizePaymentCurrency(currency) === "LBP" ? "1000" : "0.01";
}

function getCustomCurrencyPlaceholder(currency) {
  return normalizePaymentCurrency(currency) === "LBP" ? "Price in LBP" : "Price in USD";
}

function setCustomItemCurrency(currency, convertExisting = false) {
  const currencyEl = document.getElementById("customItemCurrency");
  const priceEl = document.getElementById("customItemPrice");
  if (!currencyEl) return;

  const previousCurrency = normalizePaymentCurrency(
    currencyEl.dataset.lastCurrency || currencyEl.value || posSettings.currency
  );
  const nextCurrency = normalizePaymentCurrency(currency || posSettings.currency);

  if (
    convertExisting &&
    priceEl &&
    String(priceEl.value || "").trim() &&
    previousCurrency !== nextCurrency
  ) {
    const previousUsdValue = paymentAmountToUsd(priceEl.value, previousCurrency);
    priceEl.value = usdToPaymentCurrency(previousUsdValue, nextCurrency);
  }

  currencyEl.value = nextCurrency;
  currencyEl.dataset.lastCurrency = nextCurrency;

  if (priceEl) {
    priceEl.step = getCustomCurrencyStep(nextCurrency);
    priceEl.placeholder = getCustomCurrencyPlaceholder(nextCurrency);
  }
}

function updateCustomItemCurrencyDefault() {
  setCustomItemCurrency(posSettings.currency, true);
}

function handleCustomItemCurrencyChange() {
  const currencyEl = document.getElementById("customItemCurrency");
  if (!currencyEl) return;
  setCustomItemCurrency(currencyEl.value, true);
}

function calcVatBreakdown(totalUsd, settings = posSettings) {
  const s = sanitizePosSettings(settings);
  const total = Math.max(0, Number(totalUsd || 0));
  const rate = Math.max(0, Number(s.vatRate || 0));

  if (rate <= 0 || total <= 0) {
    return { rate, taxable: total, amount: 0, total };
  }

  // VAT is included in the listed POS prices and final receipt total.
  // This avoids changing dashboard revenue/profit while still showing a legal VAT breakdown.
  const taxable = total / (1 + rate / 100);
  const amount = total - taxable;
  return { rate, taxable, amount, total };
}

function getReceiptSettings(rcpt) {
  return sanitizePosSettings({
    currency: rcpt?.currency || rcpt?.settings?.currency || posSettings.currency,
    usdToLbp: rcpt?.exchangeRate || rcpt?.usdToLbp || rcpt?.settings?.usdToLbp || posSettings.usdToLbp,
    vatRate: rcpt?.vatRate ?? rcpt?.vat?.rate ?? rcpt?.settings?.vatRate ?? posSettings.vatRate,
    vatMode: "included",
  });
}

function formatReceiptCurrency(amountUsd, rcpt) {
  return formatCurrency(amountUsd, getReceiptSettings(rcpt));
}

function updateVatLabels() {
  const rateText = `${Number(posSettings.vatRate || 0).toFixed(2).replace(/\.00$/, "")}%`;
  const vatRateLabelEl = document.getElementById("vatRateLabel");
  const receiptVatRateEl = document.getElementById("receiptVatRate");
  if (vatRateLabelEl) vatRateLabelEl.textContent = rateText;
  if (receiptVatRateEl) receiptVatRateEl.textContent = rateText;
}

function syncSettingsBar() {
  const currencyModeEl = document.getElementById("currencyMode");
  const usdLbpRateEl = document.getElementById("usdLbpRate");
  const vatRateEl = document.getElementById("vatRate");

  if (currencyModeEl) currencyModeEl.value = posSettings.currency;
  if (usdLbpRateEl) usdLbpRateEl.value = String(posSettings.usdToLbp);
  if (vatRateEl) vatRateEl.value = String(posSettings.vatRate);
  updateVatLabels();
  updateCustomItemCurrencyDefault();
}

function syncHeaderMeta() {
  const currencyEl = document.getElementById("headerCurrencyMode");
  const vatEl = document.getElementById("headerVatRate");

  if (currencyEl) currencyEl.textContent = posSettings.currency || "USD";
  if (vatEl) vatEl.textContent = `${Number(posSettings.vatRate || 0).toFixed(0)}%`;
}

function applySettingsChange() {
  const currencyModeEl = document.getElementById("currencyMode");
  const usdLbpRateEl = document.getElementById("usdLbpRate");
  const vatRateEl = document.getElementById("vatRate");

  posSettings = sanitizePosSettings({
    currency: currencyModeEl ? currencyModeEl.value : posSettings.currency,
    usdToLbp: usdLbpRateEl ? Number(usdLbpRateEl.value || posSettings.usdToLbp) : posSettings.usdToLbp,
    vatRate: vatRateEl ? Number(vatRateEl.value ?? posSettings.vatRate) : posSettings.vatRate,
    vatMode: "included",
  });

  savePosSettings();
  syncSettingsBar();
  syncHeaderMeta();

  if (selectedTable) {
    renderOrder();
    renderTables();
  } else {
    renderTables();
  }
}


function getSettingsDraftFromInputs() {
  const currencyModeEl = document.getElementById("currencyMode");
  const usdLbpRateEl = document.getElementById("usdLbpRate");
  const vatRateEl = document.getElementById("vatRate");

  return sanitizePosSettings({
    currency: currencyModeEl ? currencyModeEl.value : posSettings.currency,
    usdToLbp: usdLbpRateEl ? Number(usdLbpRateEl.value || posSettings.usdToLbp) : posSettings.usdToLbp,
    vatRate: vatRateEl ? Number(vatRateEl.value ?? posSettings.vatRate) : posSettings.vatRate,
    vatMode: "included",
  });
}

function updateSettingsPreview() {
  const draft = getSettingsDraftFromInputs();
  const totalEl = document.getElementById("settingsPreviewTotal");
  const vatEl = document.getElementById("settingsPreviewVat");
  const vat = calcVatBreakdown(10, draft);

  if (totalEl) totalEl.textContent = formatCurrency(10, draft);
  if (vatEl) vatEl.textContent = formatCurrency(vat.amount, draft);
}

function openSettingsModal() {
  const modal = document.getElementById("posSettingsModal");
  syncSettingsBar();
  updateSettingsPreview();
  if (modal) modal.classList.remove("hidden");
}

function closeSettingsModal() {
  const modal = document.getElementById("posSettingsModal");
  if (modal) modal.classList.add("hidden");
  syncSettingsBar();
}

function saveSettingsFromModal() {
  applySettingsChange();
  closeSettingsModal();
  showAppMessage("POS settings saved successfully", "success");
}

// ---------- Keys / Timezone ----------
const RECEIPTS_KEY = "receipts";
const RES_KEY = "reservations";
const POS_HANDOFF_KEY = "POS_RES_HANDOFF";
const TZ = "Asia/Beirut";

function beirutNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}
function pad2(n) { return String(n).padStart(2, "0"); }
function fmtBeirutTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
function fmtBeirutDateTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch { return ""; }
}
function dateKeyBeirut(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function dateKeyFromISOBeirut(iso) {
  try {
    const s = new Date(iso).toLocaleString("en-CA", { timeZone: TZ }); // YYYY-MM-DD, ...
    return String(s).slice(0, 10);
  } catch {
    return "";
  }
}

// ---------- Customers (fallback + safe wrapper) ----------
const CustomersFallback = {
  KEY: "customers",
  loadCustomers() {
    const arr = safeParse(localStorage.getItem(this.KEY), []);
    return Array.isArray(arr) ? arr : [];
  },
  saveCustomers(list) {
    localStorage.setItem(this.KEY, JSON.stringify(Array.isArray(list) ? list : []));
  },
  getCustomer(phone) {
    const p = String(phone || "").trim();
    return this.loadCustomers().find(c => String(c.phone || "").trim() === p) || null;
  },
  ensureCustomer(phone, fullName) {
    const p = String(phone || "").trim();
    const n = String(fullName || "").trim();
    if (!p) return;

    const nowISO = new Date().toISOString();
    const list = this.loadCustomers();
    const idx = list.findIndex(c => String(c.phone || "").trim() === p);

    if (idx >= 0) {
      if (n) list[idx].fullName = n;
      list[idx].updatedAtISO = nowISO;
    } else {
      list.push({
        phone: p,
        fullName: n,
        createdAtISO: nowISO,
        updatedAtISO: nowISO,
        stats: { visits: 0, lifetimeSpend: 0, lastVisitISO: "" },
        loyalty: { points: 0, eligible: false, tier: "" },
      });
    }
    this.saveCustomers(list);
  },
  finalizeReceipt({ receipt }) {
    // Only count a "visit" if fully paid
    if (!receipt || !receipt.customerPhone) return;
    const total = Number(receipt.total || 0);
    const paidTotal = Number(receipt.paidTotal ?? receipt.paid ?? 0);
    if (total <= 0) return;
    if (paidTotal + 1e-6 < total) return;

    this.ensureCustomer(receipt.customerPhone, receipt.customerName || "");
    const nowISO = new Date().toISOString();
    const list = this.loadCustomers();
    const idx = list.findIndex(c => String(c.phone || "").trim() === String(receipt.customerPhone || "").trim());
    if (idx === -1) return;

    const c = list[idx];
    c.stats = c.stats || { visits: 0, lifetimeSpend: 0, lastVisitISO: "" };
    c.loyalty = c.loyalty || { points: 0, eligible: false, tier: "" };

    c.stats.visits = Number(c.stats.visits || 0) + 1;
    c.stats.lifetimeSpend = Number(c.stats.lifetimeSpend || 0) + total;
    c.stats.lastVisitISO = nowISO;

    // Simple points model: 1 point per $1 paid (floor)
    c.loyalty.points = Number(c.loyalty.points || 0) + Math.floor(total);
    c.loyalty.eligible = true;

    list[idx] = c;
    this.saveCustomers(list);
  },
};

function CustomersLibSafe() {
  const ext = window.CustomersLib || {};
  // if your customers.js exists, we still guarantee missing methods via fallback
  return {
    loadCustomers: typeof ext.loadCustomers === "function" ? ext.loadCustomers.bind(ext) : CustomersFallback.loadCustomers.bind(CustomersFallback),
    saveCustomers: typeof ext.saveCustomers === "function" ? ext.saveCustomers.bind(ext) : CustomersFallback.saveCustomers.bind(CustomersFallback),
    getCustomer: typeof ext.getCustomer === "function" ? ext.getCustomer.bind(ext) : CustomersFallback.getCustomer.bind(CustomersFallback),
    ensureCustomer: typeof ext.ensureCustomer === "function" ? ext.ensureCustomer.bind(ext) : CustomersFallback.ensureCustomer.bind(CustomersFallback),
    finalizeReceipt: typeof ext.finalizeReceipt === "function" ? ext.finalizeReceipt.bind(ext) : CustomersFallback.finalizeReceipt.bind(CustomersFallback),
  };
}

// ---------- Reservations helpers (POS reads localStorage("reservations")) ----------
function loadReservationsRaw() {
  const arr = safeParse(localStorage.getItem(RES_KEY), []);
  return Array.isArray(arr) ? arr : [];
}
function isReservationActiveStatus(s) {
  return s === "booked" || s === "arrived" || s === "seated";
}
function isReservationTerminal(s) {
  return s === "cancelled" || s === "completed" || s === "no_show";
}
function reservationWindowMs(r) {
  const start = new Date(r.dateTimeISO).getTime();
  const dur = Number(r.durationMin || 90);
  const end = start + dur * 60 * 1000;
  return { start, end, dur };
}

// Show RESERVED only when the reservation is active soon enough for service.
// A reservation appears on the POS from 1 hour before its start time until its end time.
function findRelevantReservationForTable(tableKey) {
  const now = Date.now();

  const list = loadReservationsRaw()
    .filter(r => r && !r.deletedAtISO)
    .filter(r => r.table && String(r.table) === String(tableKey))
    .filter(r => r.dateTimeISO)
    .filter(r => isReservationActiveStatus(String(r.status || "booked")))
    .filter(r => !isReservationTerminal(String(r.status || "")))
    .filter(r => {
      const { start, end } = reservationWindowMs(r);
      const visibleFrom = start - 60 * 60 * 1000;
      return now >= visibleFrom && now <= end;
    });

  if (list.length === 0) return null;

  list.sort((a, b) => new Date(a.dateTimeISO).getTime() - new Date(b.dateTimeISO).getTime());
  const upcoming = list.find(r => new Date(r.dateTimeISO).getTime() >= now);
  return upcoming || list[0];
}

function cancelReservationById(resId) {
  if (!resId) return false;
  const list = loadReservationsRaw();
  const idx = list.findIndex(r => r && String(r.id) === String(resId));
  if (idx === -1) return false;

  list[idx] = {
    ...list[idx],
    status: "cancelled",
    deletedAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
  };

  localStorage.setItem(RES_KEY, JSON.stringify(list));
  return true;
}

function markReservationArrivedById(resId) {
  if (!resId) return false;
  const list = loadReservationsRaw();
  const idx = list.findIndex(r => r && String(r.id) === String(resId));
  if (idx === -1) return false;

  list[idx] = {
    ...list[idx],
    status: "seated",
    arrivedAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
  };

  localStorage.setItem(RES_KEY, JSON.stringify(list));
  return true;
}

function completeReservationById(resId) {
  if (!resId) return false;
  const list = loadReservationsRaw();
  const idx = list.findIndex(r => r && String(r.id) === String(resId));
  if (idx === -1) return false;
  const r = list[idx];
  if (r.deletedAtISO) return false;

  list[idx] = { ...r, status: "completed", updatedAtISO: new Date().toISOString() };
  localStorage.setItem(RES_KEY, JSON.stringify(list));
  return true;
}

function completeReservationByMatch({ tableKey, phone }) {
  const list = loadReservationsRaw();
  const now = Date.now();

  // best match: same table + same phone + active status + within 24h or ongoing
  const candidates = list
    .filter(r => r && !r.deletedAtISO)
    .filter(r => String(r.table || "") === String(tableKey))
    .filter(r => String(r.phone || "").trim() && String(r.phone || "").trim() === String(phone || "").trim())
    .filter(r => isReservationActiveStatus(String(r.status || "booked")))
    .filter(r => {
      if (!r.dateTimeISO) return false;
      const { start, end } = reservationWindowMs(r);
      const withinOneHour = start - now <= 60 * 60 * 1000 && start >= now;
      const ongoing = now <= end && now >= start - 60 * 60 * 1000;
      return withinOneHour || ongoing;
    })
    .sort((a, b) => new Date(a.dateTimeISO).getTime() - new Date(b.dateTimeISO).getTime());

  if (!candidates.length) return false;
  return completeReservationById(candidates[0].id);
}

// ---------- State ----------
let tables = safeParse(localStorage.getItem("tables"), {});
let selectedTable = null;
let refCounter = Number(localStorage.getItem("refCounter") || 1);

let dishes = safeParse(localStorage.getItem("dishes"), []);
let stockItems = safeParse(localStorage.getItem("stockItems"), []);
let currentCategory = null;

let receipts = safeParse(localStorage.getItem(RECEIPTS_KEY), []);

// ---------- DOM ----------
const tableList = document.getElementById("tableList");
const addTableBtn = document.getElementById("addTableBtn");
const orderPanel = document.getElementById("orderPanel");
const orderList = document.getElementById("orderList");

const subtotalAmountEl = document.getElementById("subtotalAmount");
const discountAmountEl = document.getElementById("discountAmount");
const totalAmountEl = document.getElementById("totalAmount");
const paidAmountDisplayEl = document.getElementById("paidAmountDisplay");
const changeAmountEl = document.getElementById("changeAmount");
const taxableAmountEl = document.getElementById("taxableAmount");
const vatAmountEl = document.getElementById("vatAmount");

const categoryList = document.getElementById("categoryList");
const menuItems = document.getElementById("menuItems");
const menuSearchEl = document.getElementById("menuSearch");

const discountTypeEl = document.getElementById("discountType");
const discountValueEl = document.getElementById("discountValue");

const paymentsListEl = document.getElementById("paymentsList");
const addPaymentBtn = document.getElementById("addPaymentBtn");

const reopenBanner = document.getElementById("reopenBanner");
const reservationBanner = document.getElementById("reservationBanner");

// Customer inputs (POS)
const posCustomerNameEl = document.getElementById("posCustomerName");
const posCustomerPhoneEl = document.getElementById("posCustomerPhone");
const posCustomersPhones = document.getElementById("posCustomersPhones");

// Receipt UI
const receiptArea = document.getElementById("receiptArea");
const receiptRef = document.getElementById("receiptRef");
const receiptTable = document.getElementById("receiptTable");
const receiptDate = document.getElementById("receiptDate");
const receiptCustomer = document.getElementById("receiptCustomer");
const receiptItems = document.getElementById("receiptItems");
const receiptSubtotal = document.getElementById("receiptSubtotal");
const receiptDiscount = document.getElementById("receiptDiscount");
const receiptTotal = document.getElementById("receiptTotal");
const receiptPayments = document.getElementById("receiptPayments");
const receiptChange = document.getElementById("receiptChange");
const receiptTaxable = document.getElementById("receiptTaxable");
const receiptVat = document.getElementById("receiptVat");

// Ingredient modal
const ingredientModal = document.getElementById("ingredientModal");
const modalDishTitle = document.getElementById("modalDishTitle");
const modalIngredientsWrap = document.getElementById("modalIngredientsWrap");
const modalNote = document.getElementById("modalNote");
const modalCloseBtn = document.getElementById("modalCloseBtn");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalAddBtn = document.getElementById("modalAddBtn");

// Split modal
const splitModal = document.getElementById("splitModal");
const splitCloseBtn = document.getElementById("splitCloseBtn");
const splitCancelBtn = document.getElementById("splitCancelBtn");
const splitApplyBtn = document.getElementById("splitApplyBtn");
const splitGuestsEl = document.getElementById("splitGuests");
const splitModeEl = document.getElementById("splitMode");
const splitItemsArea = document.getElementById("splitItemsArea");
const splitSummaryList = document.getElementById("splitSummaryList");

// Receipts modal
const receiptsBtn = document.getElementById("receiptsBtn");
const receiptsModal = document.getElementById("receiptsModal");
const receiptsCloseBtn = document.getElementById("receiptsCloseBtn");
const receiptsCancelBtn = document.getElementById("receiptsCancelBtn");
const receiptSearch = document.getElementById("receiptSearch");
const receiptsListEl = document.getElementById("receiptsList");
const receiptViewEl = document.getElementById("receiptView");

// Reservation action modal
const reservationActionModal = document.getElementById("reservationActionModal");
const reservationActionTitle = document.getElementById("reservationActionTitle");
const reservationActionDetails = document.getElementById("reservationActionDetails");
const reservationCancelBtn = document.getElementById("reservationCancelBtn");
const reservationDeleteBtn = document.getElementById("reservationDeleteBtn");
const reservationArrivedBtn = document.getElementById("reservationArrivedBtn");
let pendingReservationAction = null;

// ---------- Modal temp state ----------
let modalDish = null;
let modalEditContext = null; // { tableKey, lineId }
let splitAssignments = {};    // lineId -> guestIndex(1..n)
let selectedReceiptId = null;

// ---------- Backend Products -> Local Dishes (bridge) ----------
const API_BASE = "https://pos-backend-m2yf.onrender.com";

// converts backend products into the dish format your UI already expects
// IMPORTANT: this only READS product stock from /products. It does not write to the database.
function mapProductsToDishes(products) {
  return (products || [])
    .filter((p) => p && p.is_active !== false)
    .map((p) => ({
      name: p.name,
      price: Number(p.price || 0),
      category: String(p.category || "All").trim() || "All",
      ingredients: [],
      product_id: p.id,
      sku: p.sku || null,

      // stock status support
      stockQty: readBackendProductStockQty(p),
      stockUnit: readBackendProductStockUnit(p) || "pcs",
    }));
}
function readNumericField(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value === null || value === undefined || value === "") continue;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readStringField(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
    }
  }
  return "";
}

function readBackendProductStockQty(product) {
  const direct = readNumericField(product, [
    "quantity",
    "qty",
    "stock",
    "stock_qty",
    "stockQty",
    "stock_quantity",
    "stockQuantity",
    "current_stock",
    "currentStock",
    "available_stock",
    "availableStock",
    "on_hand",
    "onHand",
  ]);
  if (direct !== null) return direct;

  const nestedObjects = [product?.stock, product?.inventory, product?.stockItem, product?.stock_item];
  for (const nested of nestedObjects) {
    const nestedQty = readNumericField(nested, [
      "quantity",
      "qty",
      "stock",
      "stock_qty",
      "stockQty",
      "stock_quantity",
      "stockQuantity",
      "current_stock",
      "currentStock",
      "available_stock",
      "availableStock",
      "on_hand",
      "onHand",
    ]);
    if (nestedQty !== null) return nestedQty;
  }

  return null;
}

function readBackendProductStockUnit(product) {
  const direct = readStringField(product, ["unit", "stock_unit", "stockUnit", "uom"]);
  if (direct) return direct;

  const nestedObjects = [product?.stock, product?.inventory, product?.stockItem, product?.stock_item];
  for (const nested of nestedObjects) {
    const nestedUnit = readStringField(nested, ["unit", "stock_unit", "stockUnit", "uom"]);
    if (nestedUnit) return nestedUnit;
  }

  return "pcs";
}

// alert message 
function showAppMessage(message, type = "error") {
  const box = document.getElementById("appMessage");
  if (!box) return;

  box.textContent = message;
  box.className = "";
  box.classList.add(type);
}

function clearAppMessage() {
  const box = document.getElementById("appMessage");
  if (!box) return;

  box.textContent = "";
  box.className = "hidden";
}

async function ensureAccessToken(options = {}) {
  const forceRefresh = !!options.forceRefresh;

  if (!window.sb) throw new Error("Supabase client not found");

  if (!forceRefresh && window.ACCESS_TOKEN) {
    const exp = getJwtExpiry(window.ACCESS_TOKEN);
    if (!exp || exp > Math.floor(Date.now() / 1000) + 60) {
      return window.ACCESS_TOKEN;
    }
  }

  let sessionData = null;
  let sessionError = null;

  if (forceRefresh && typeof window.sb.auth.refreshSession === "function") {
    const refreshed = await window.sb.auth.refreshSession();
    sessionData = refreshed.data;
    sessionError = refreshed.error;
  } else {
    const session = await window.sb.auth.getSession();
    sessionData = session.data;
    sessionError = session.error;
  }

  if (sessionError) {
    window.ACCESS_TOKEN = null;
    throw sessionError;
  }

  let token = sessionData?.session?.access_token || null;

  if (!token && !forceRefresh && typeof window.sb.auth.refreshSession === "function") {
    const refreshed = await window.sb.auth.refreshSession();
    if (refreshed.error) {
      window.ACCESS_TOKEN = null;
      throw refreshed.error;
    }
    token = refreshed.data?.session?.access_token || null;
  }

  if (!token) {
    window.ACCESS_TOKEN = null;
    throw new Error("Missing ACCESS_TOKEN (not logged in)");
  }

  window.ACCESS_TOKEN = token;
  return token;
}

function getJwtExpiry(token) {
  try {
    const payload = JSON.parse(atob(String(token).split(".")[1] || ""));
    return Number(payload.exp || 0) || null;
  } catch {
    return null;
  }
}

function isInvalidTokenMessage(message) {
  return /invalid\s+token|jwt|expired|unauthorized|auth/i.test(String(message || ""));
}

async function requestJsonWithAuth(url, options = {}, retry = true) {
  const token = await ensureAccessToken({ forceRefresh: false });
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...options, headers });
  const json = await res.json().catch(() => ({}));

  const message = json?.error || json?.message || "";
  if (retry && (res.status === 401 || res.status === 403 || isInvalidTokenMessage(message))) {
    window.ACCESS_TOKEN = null;
    await ensureAccessToken({ forceRefresh: true });
    return requestJsonWithAuth(url, options, false);
  }

  return { res, json };
}

async function refreshDishesFromSupabase() {
  await ensureAccessToken({ forceRefresh: false });

  if (!window.sb) throw new Error("Supabase client not found");

  const { data, error } = await window.sb
    .from("products")
    .select("id, name, category, price, is_active")
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;

  const mapped = mapProductsToDishes(data || []);
  localStorage.setItem("dishes", JSON.stringify(mapped));
  dishes = mapped;
}

async function refreshDishesFromBackend() {
  await ensureAccessToken({ forceRefresh: false });

  if (!window.sb) throw new Error("Supabase client not found");

  const { data: products, error: productError } = await window.sb
    .from("products")
    .select("id, name, category, price, is_active")
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (productError) throw productError;

  const { data: recipeRows, error: recipeError } = await window.sb
    .from("recipe_items")
    .select(`
      id,
      product_id,
      inventory_item_id,
      quantity_required,
      unit,
      inventory_items:inventory_item_id ( id, name )
    `)
    .order("id", { ascending: true });

  if (recipeError) throw recipeError;

  const grouped = new Map();

  (recipeRows || []).forEach((row) => {
    const key = Number(row.product_id);
    if (!grouped.has(key)) grouped.set(key, []);

    grouped.get(key).push({
      inventory_item_id: Number(row.inventory_item_id),
      name: row.inventory_items?.name || "Unknown Ingredient",
      qty: Number(row.quantity_required || 0),
      unit: row.unit || ""
    });
  });

  const mapped = (products || []).map((p) => ({
    name: p.name,
    price: Number(p.price || 0),
    category: String(p.category || "All").trim() || "All",
    ingredients: grouped.get(Number(p.id)) || [],
    product_id: p.id,
    sku: null,
    stockQty: null,
    stockUnit: "pcs",
  }));

  localStorage.setItem("dishes", JSON.stringify(mapped));
  dishes = mapped;
}

async function refreshProductsForStockCheck() {
  try {
    await Promise.all([
      refreshDishesFromBackend(),
      refreshStockItemsFromSupabase()
    ]);
  } catch (err) {
    console.warn("Could not refresh products/stock before stock check:", err.message);
  } finally {
    syncDishesAndStock();
  }
}

async function saveSaleToBackend(orderLines) {
  if (!Array.isArray(orderLines) || orderLines.length === 0) return;

  await ensureAccessToken({ forceRefresh: false });
  await refreshStockItemsFromSupabase();
  syncDishesAndStock();

  const ingredientNeedMap = new Map();
  const lineCogsMap = new Map();

  for (const line of orderLines) {
    if (!line || line.type !== "dish") continue;

    const dish = (dishes || []).find((d) =>
      (line.product_id && d.product_id && String(d.product_id) === String(line.product_id)) ||
      norm(d.name) === norm(line.dishName)
    );

    if (!dish) {
      throw new Error(`Dish not found for ${line.dishName || "item"}`);
    }

    const effectiveIngredients = getEffectiveIngredients(dish, line.removedIngredients || []);
    const lineQty = Number(line.qty || 0);
    let lineCogs = 0;

    for (const ing of effectiveIngredients) {
      const stock = findStockByName(ing.name);
      if (!stock) {
        throw new Error(`Ingredient "${ing.name}" is not stocked.`);
      }

      const requiredRaw = Number(ing.qty || 0) * lineQty;
      const requiredInStockUnit = convertQty(requiredRaw, ing.unit, stock.unit);

      if (requiredInStockUnit === null) {
        throw new Error(`Unit mismatch for ${ing.name}: recipe uses ${ing.unit}, stock uses ${stock.unit}.`);
      }

      const avgCost = Number(stock.avg_cost || 0);
      lineCogs += requiredInStockUnit * avgCost;

      const inventoryItemId = Number(stock.inventory_item_id || stock.item_id || 0);
      if (!inventoryItemId) {
        throw new Error(`Ingredient "${stock.name}" is missing inventory_item_id.`);
      }

      const key = String(inventoryItemId);
      const current = ingredientNeedMap.get(key) || {
        inventory_item_id: inventoryItemId,
        ingredient_name: stock.name,
        unit: stock.unit,
        required: 0,
        stockRow: stock
      };

      current.required += requiredInStockUnit;
      ingredientNeedMap.set(key, current);
    }
    lineCogsMap.set(line.lineId, lineCogs);
  }

  // validate
  for (const entry of ingredientNeedMap.values()) {
    const available = Number(entry.stockRow.quantity || 0);

    if (entry.required - available > 1e-9) {
      throw new Error(
        `Insufficient stock for ${entry.ingredient_name}. Needed ${formatQty(entry.required, entry.unit)} ${entry.unit}, available ${formatQty(available, entry.unit)} ${entry.unit}.`
      );
    }
  }

  // deduct from Supabase inventory_stock
  for (const entry of ingredientNeedMap.values()) {
    const stockRow = entry.stockRow;
    const newQty = Math.max(0, Number(stockRow.quantity || 0) - entry.required);

    const { error: stockError } = await window.sb
      .from("inventory_stock")
      .update({
        quantity: newQty,
        updated_at: new Date().toISOString()
      })
      .eq("inventory_item_id", entry.inventory_item_id);

    if (stockError) throw stockError;
  }

  // refresh local stock snapshot so POS updates immediately
  await refreshStockItemsFromSupabase();
  syncDishesAndStock();

}

// ---------- Sync ----------
function syncDishesAndStock() {
  dishes = safeParse(localStorage.getItem("dishes"), dishes || []);
  stockItems = safeParse(localStorage.getItem("stockItems"), stockItems || []);
}
function saveTablesNow() {
  localStorage.setItem("tables", JSON.stringify(tables));
  localStorage.setItem("refCounter", String(refCounter));
}
function saveReceiptsNow() {
  localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts));
}
function saveSalesHistoryFromReceipt(rcpt) {
  const history = safeParse(localStorage.getItem("salesHistory"), []);
  history.push({
    ref: rcpt.ref,
    date: new Date(rcpt.createdAt).toLocaleString(),
    total: Number(rcpt.total || 0),
    cogs: Number(rcpt.cogs || 0),
    profit: Number(rcpt.profit || 0),
    table: rcpt.table,
    customerName: rcpt.customerName || "",
    customerPhone: rcpt.customerPhone || "",
  });
  localStorage.setItem("salesHistory", JSON.stringify(history));
}
// ---------- Customer datalist in POS ----------
function loadPosCustomersDatalist() {
  if (!posCustomersPhones) return;
  const lib = CustomersLibSafe();
  const list = lib.loadCustomers() || [];
  posCustomersPhones.innerHTML = "";
  list.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.phone || "");
    opt.label = c.fullName ? `${c.fullName} (${c.phone})` : String(c.phone || "");
    posCustomersPhones.appendChild(opt);
  });
}
function autofillPosNameByPhone(phone) {
  const lib = CustomersLibSafe();
  const c = lib.getCustomer(String(phone || "").trim());
  if (c && c.fullName && posCustomerNameEl && !String(posCustomerNameEl.value || "").trim()) {
    posCustomerNameEl.value = c.fullName;
  }
}
function syncCustomerInputsFromTable(table) {
  if (!table) return;
  if (posCustomerNameEl) posCustomerNameEl.value = table.customerName || "";
  if (posCustomerPhoneEl) posCustomerPhoneEl.value = table.customerPhone || "";
}

// ---------- Defaults ----------
function ensureDefaultDishes() {
  if (!Array.isArray(dishes) || dishes.length === 0) {
    const defaultDishes = [
      { name: "Coke", price: 2.5, category: "Drinks", ingredients: [] },
      { name: "Water", price: 1.0, category: "Drinks", ingredients: [] },
      { name: "Burger", price: 8.5, category: "Mains", ingredients: [] },
      { name: "Pizza", price: 10.0, category: "Mains", ingredients: [] },
      { name: "Pasta", price: 9.0, category: "Mains", ingredients: [] },
    ];
    localStorage.setItem("dishes", JSON.stringify(defaultDishes));
    dishes = defaultDishes;
  }
}

// ---------- Tables init + migration ----------
function ensureTables() {
  if (!tables || typeof tables !== "object" || Object.keys(tables).length === 0) {
    tables = {};
    for (let i = 1; i <= 5; i++) {
      tables[i] = {
        order: [],
        total: 0,
        ref: null,
        status: "empty",
        discount: { type: "none", value: 0 },
        payments: [],
        reopenedFrom: null,
        // new fields
        customerName: "",
        customerPhone: "",
        reservationId: null,
      };
    }
    saveTablesNow();
    return;
  }

  Object.keys(tables).forEach((k) => {
    const t = tables[k] || {};
    if (!Array.isArray(t.order)) t.order = [];
    if (!t.discount) t.discount = { type: "none", value: 0 };
    if (!Array.isArray(t.payments)) t.payments = [];
    if (typeof t.reopenedFrom === "undefined") t.reopenedFrom = null;
    if (!t.status) t.status = t.order.length ? "open" : "empty";

    // migrate customer/reservation fields safely
    if (typeof t.customerName !== "string") t.customerName = "";
    if (typeof t.customerPhone !== "string") t.customerPhone = "";
    if (typeof t.reservationId === "undefined") t.reservationId = null;

    // migrate old order lines
    t.order = t.order.map((x) => {
      if (!x) return null;

      // new format
      if (x.lineId && (x.type === "dish" || x.type === "custom")) {
        if (!Array.isArray(x.removedIngredients)) x.removedIngredients = [];
        if (typeof x.note !== "string") x.note = "";
        if (typeof x.qty !== "number") x.qty = Number(x.qty || 1);
        if (!x.status) x.status = "new";
        return x;
      }

      // old format {name, price, qty}
      if (x.name && (x.price != null)) {
        return {
          lineId: nowId(),
          type: "dish",
          dishName: x.name,
          unitPrice: Number(x.price || 0),
          qty: Number(x.qty || 1),
          removedIngredients: [],
          note: "",
          status: "new",
        };
      }
      return null;
    }).filter(Boolean);

    t.total = t.order.reduce((acc, li) => acc + Number(li.unitPrice || 0) * Number(li.qty || 0), 0);
    if (t.order.length === 0) t.status = "empty";
    if (t.status === "closed") t.status = "empty"; // avoid locked tables

    tables[k] = t;
  });

  saveTablesNow();
}

// ---------- Stock helpers ----------
function findStockByName(name) {
  const n = norm(name);
  return (stockItems || []).find((s) => norm(s.name) === n);
}
function isTableActiveForReservation(t) {
  return t && t.status !== "closed";
}
function getEffectiveIngredients(dish, removedIngredients) {
  const removedSet = new Set((removedIngredients || []).map(norm));
  return (dish.ingredients || []).filter((ing) => ing && ing.name && !removedSet.has(norm(ing.name)));
}
function computeReservedForIngredient(ingredientName, stockUnit, override) {
  const targetIng = norm(ingredientName);
  let reserved = 0;

  for (const tKey of Object.keys(tables)) {
    const t = tables[tKey];
    if (!isTableActiveForReservation(t)) continue;
    if (!t || !Array.isArray(t.order) || t.order.length === 0) continue;

    for (const line of t.order) {
      if (!line || line.type !== "dish") continue;

      const dish = (dishes || []).find((d) => d && d.name === line.dishName);
      if (!dish || !Array.isArray(dish.ingredients) || dish.ingredients.length === 0) continue;

      let lineQty = Number(line.qty || 0);

      if (override && String(tKey) === String(override.tableKey) && line.lineId === override.lineId) {
        lineQty = Number(override.desiredQty || 0);
      }

      if (lineQty <= 0) continue;

      const effective = getEffectiveIngredients(dish, line.removedIngredients);

      for (const ing of effective) {
        if (!ing || !ing.name) continue;
        if (norm(ing.name) !== targetIng) continue;

        const perLineInStockUnit = convertQty(ing.qty, ing.unit, stockUnit);
        if (perLineInStockUnit === null) return { reserved, unitMismatch: true };

        reserved += perLineInStockUnit * lineQty;
      }
    }
  }
  return { reserved };
}
function getFreshDishForStockCheck(dish) {
  if (!dish) return null;
  syncDishesAndStock();

  const byId = (dishes || []).find((d) =>
    d?.product_id != null && dish?.product_id != null && String(d.product_id) === String(dish.product_id)
  );
  if (byId) return byId;

  const byName = (dishes || []).find((d) => norm(d?.name) === norm(dish?.name));
  return byName || dish;
}

function getDishProductStockQty(dish) {
  if (!dish) return null;
  const qty = readNumericField(dish, [
    "stockQty",
    "stock_qty",
    "stock_quantity",
    "stockQuantity",
    "quantity",
    "qty",
    "stock",
    "current_stock",
    "currentStock",
    "available_stock",
    "availableStock",
  ]);
  return qty === null ? null : Math.max(0, qty);
}

function getDishProductStockUnit(dish) {
  return readStringField(dish, ["stockUnit", "stock_unit", "unit", "uom"]) || "pcs";
}

function orderLineMatchesDishProduct(line, dish) {
  if (!line || line.type !== "dish" || !dish) return false;

  if (line.product_id != null && dish.product_id != null) {
    return String(line.product_id) === String(dish.product_id);
  }

  return norm(line.dishName) === norm(dish.name);
}

function computeReservedForProductStock(dish, override) {
  let reserved = 0;
  let foundOverrideLine = false;

  for (const tKey of Object.keys(tables)) {
    const t = tables[tKey];
    if (!isTableActiveForReservation(t)) continue;
    if (!t || !Array.isArray(t.order) || t.order.length === 0) continue;

    for (const line of t.order) {
      if (!orderLineMatchesDishProduct(line, dish)) continue;

      let lineQty = Number(line.qty || 0);
      if (override && String(tKey) === String(override.tableKey) && line.lineId === override.lineId) {
        lineQty = Number(override.desiredQty || 0);
        foundOverrideLine = true;
      }

      if (lineQty > 0) reserved += lineQty;
    }
  }

  // New lines are not in tables yet, so include the desired quantity manually.
  if (override && !foundOverrideLine) {
    const desired = Number(override.desiredQty || 0);
    if (desired > 0) reserved += desired;
  }

  return reserved;
}

function canSetDishLineQtyByProductStock(dish, tableKey, lineId, desiredQty) {
  const freshDish = getFreshDishForStockCheck(dish);
  const available = getDishProductStockQty(freshDish);

  // If the /products response has no stock field, skip product-level guard
  // and let the existing submit backend validation remain the final authority.
  if (available === null) return { ok: true };

  const reserved = computeReservedForProductStock(freshDish, { tableKey, lineId, desiredQty });

  if (reserved - available > 1e-9) {
    const unit = getDishProductStockUnit(freshDish);
    const name = freshDish?.name || dish?.name || "this item";
    return {
      ok: false,
      message: `Only ${formatQty(available, unit)} ${name} available in stock. Open-table total would become ${formatQty(reserved, unit)}.`,
    };
  }

  return { ok: true };
}

function canSetDishLineQtyByStock(dish, removedIngredients, tableKey, lineId, desiredQty) {
  syncDishesAndStock();


  if (!dish || !Array.isArray(dish.ingredients) || dish.ingredients.length === 0) return { ok: true };

  const effective = getEffectiveIngredients(dish, removedIngredients);
  for (const ing of effective) {
    if (!ing || !ing.name) continue;

    const stock = findStockByName(ing.name);
    if (!stock) continue;

    const inStock = Number(stock.quantity || 0);
    const stockUnit = normUnit(stock.unit);

    const { reserved, unitMismatch } = computeReservedForIngredient(ing.name, stockUnit, {
      tableKey,
      lineId,
      desiredQty,
    });

    if (unitMismatch) {
      return { ok: false, message: `Unit mismatch for ${stock.name}: stock is in ${stock.unit}, recipe uses ${ing.unit}.` };
    }

    if (reserved - inStock > 1e-9) {
      return { ok: false, message: `Stock of ${stock.name} is only at ${formatQty(inStock, stock.unit)} ${stock.unit}.` };
    }
  }
  return { ok: true };
}

async function refreshStockItemsFromSupabase() {
  await ensureAccessToken({ forceRefresh: false });

  const { data: items, error: itemsError } = await window.sb
    .from("inventory_items")
    .select("id, name, base_unit, purchase_unit, conversion_to_base, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (itemsError) throw itemsError;

  const { data: stock, error: stockError } = await window.sb
    .from("inventory_stock")
    .select("id, inventory_item_id, quantity, avg_cost, updated_at");

  if (stockError) throw stockError;

  const stockMap = new Map((stock || []).map(row => [Number(row.inventory_item_id), row]));

  const mapped = (items || []).map(item => {
    const row = stockMap.get(Number(item.id)) || {};
    return {
      id: row.id || null,
      inventory_item_id: Number(item.id),
      item_id: Number(item.id),
      name: item.name,
      unit: item.base_unit || "pcs",
      purchase_unit: item.purchase_unit || item.base_unit || "pcs",
      conversion_to_base: Number(item.conversion_to_base || 1),
      quantity: Number(row.quantity || 0),
      avg_cost: Number(row.avg_cost || 0),
      updated_at: row.updated_at || null
    };
  });

  localStorage.removeItem("stockItems");
  localStorage.setItem("stockItems", JSON.stringify(mapped));
  stockItems = mapped;
}

// ---------- Calculations (Discount + Payments) ----------
function getTable(tableKey) {
  return tables[String(tableKey)];
}
function calcSubtotal(table) {
  return (table.order || []).reduce((acc, li) => acc + Number(li.unitPrice || 0) * Number(li.qty || 0), 0);
}
function calcDiscountAmount(subtotal, discount) {
  const type = discount?.type || "none";
  const val = Number(discount?.value || 0);

  if (type === "percent") {
    const pct = Math.max(0, Math.min(100, val));
    return subtotal * (pct / 100);
  }
  if (type === "fixed") {
    return Math.min(subtotal, Math.max(0, val));
  }
  return 0;
}
function calcPaid(table) {
  return (table.payments || []).reduce((acc, p) => {
    syncPaymentUsdAmount(p);
    return acc + Number(p.amount || 0);
  }, 0);
}
function calcTotals(table) {
  const subtotal = calcSubtotal(table);
  const discAmt = calcDiscountAmount(subtotal, table.discount);
  const total = Math.max(0, subtotal - discAmt);
  const paid = calcPaid(table);
  const change = Math.max(0, paid - total);
  const balance = Math.max(0, total - paid);
  return { subtotal, discAmt, total, paid, change, balance };
}

// ---------- UI Rendering ----------
function renderTables() {
  tableList.innerHTML = "";

  Object.keys(tables).forEach((num) => {
    const t = tables[num];
    const totals = calcTotals(t);
    const resv = findRelevantReservationForTable(num);
    const orderCount = Array.isArray(t?.order) ? t.order.length : 0;
    const isSelected = String(selectedTable) === String(num);

    let statusLabel = "Empty";
    let statusClass = "empty";

    if (resv) {
      statusLabel = `Reserved ${fmtBeirutTime(resv.dateTimeISO)}`;
      statusClass = "reserved";
    }

    if (orderCount > 0) {
      statusLabel = "Open";
      statusClass = "open";
    }

    if (isSelected) {
      statusLabel = "Selected";
      statusClass = "selected";
    }

    const btn = document.createElement("button");
    btn.className = `table-card ${isSelected ? "active" : ""} ${resv ? "reserved" : ""}`;
    btn.innerHTML = `
      <span class="table-card-main">
        <strong>Table ${escapeHtml(num)}</strong>
        <span>${formatCurrency(totals.total)}</span>
      </span>
      <span class="table-card-meta">
        <span class="table-status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
        ${orderCount ? `<span>${orderCount} item${orderCount === 1 ? "" : "s"}</span>` : `<span>Ready</span>`}
      </span>
    `;
    btn.onclick = () => selectTable(num);
    tableList.appendChild(btn);
  });
}

function loadCategories() {
  syncDishesAndStock();
  categoryList.innerHTML = "";

  const rawCategories = [...new Set(
    (dishes || [])
      .map((d) => String(d.category || "").trim())
      .filter(Boolean)
  )];

  const categories = ["All", ...rawCategories.filter((c) => c !== "All")];

  if (categories.length === 0) {
    categoryList.innerHTML = "<p>No categories available.</p>";
    return;
  }

  if (!currentCategory || !categories.includes(currentCategory)) {
    currentCategory = "All";
  }

  categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = cat;
    btn.className = cat === currentCategory ? "active" : "";
    btn.addEventListener("click", () => {
      currentCategory = cat;
      loadCategories();
      loadMenuItems(cat);
    });
    categoryList.appendChild(btn);
  });

  loadMenuItems(currentCategory);
}

function getDishStockStatus(dish) {
  const qty = getDishProductStockQty(dish);
  const unit = getDishProductStockUnit(dish);

  if (qty === null) {
    return { label: "Stock synced", className: "unknown" };
  }

  if (qty <= 0) {
    return { label: "Out of stock", className: "out" };
  }

  const lowThreshold = normUnit(unit) === "pcs" ? 5 : 1;
  if (qty <= lowThreshold) {
    return { label: `Low: ${formatQty(qty, unit)} ${unit}`, className: "low" };
  }

  return { label: `Stock: ${formatQty(qty, unit)} ${unit}`, className: "ok" };
}

function loadMenuItems(category) {
  syncDishesAndStock();
  currentCategory = category || currentCategory || "All";

  menuItems.innerHTML = "";

  const searchTerm = norm(menuSearchEl?.value || "");

  const filtered = (dishes || []).filter((d) => {
    const dishCategory = String(d.category || "All").trim();
    const categoryMatch = currentCategory === "All" || dishCategory === currentCategory;

    const searchMatch =
      !searchTerm ||
      norm(d.name).includes(searchTerm) ||
      norm(dishCategory).includes(searchTerm);

    return categoryMatch && searchMatch;
  });

  console.log("Filtered dishes:", filtered);

  if (filtered.length === 0) {
    menuItems.innerHTML = `<div class="menu-empty-state">No items found. Try another category or search.</div>`;
    return;
  }

  filtered.forEach((dish) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-btn menu-product-card";
    btn.innerHTML = `
      <span class="menu-product-top">
        <strong>${escapeHtml(dish.name)}</strong>
        <span>${formatCurrency(dish.price)}</span>
      </span>
      <span class="menu-product-bottom">
        <span>${escapeHtml(String(dish.category || "All"))}</span>
      </span>
    `;
    btn.addEventListener("click", () => openIngredientModalForAdd(dish));
    menuItems.appendChild(btn);
  });
}

function lineLabel(line) {
  if (line.type === "custom") return line.customName || "Custom";
  return line.dishName || "Item";
}
function buildModifiersText(line) {
  const parts = [];
  if (Array.isArray(line.removedIngredients) && line.removedIngredients.length > 0) {
    parts.push(`No: ${line.removedIngredients.join(", ")}`);
  }
  if (line.note && String(line.note).trim()) {
    parts.push(`Note: ${String(line.note).trim()}`);
  }
  return parts.join(" • ");
}

function renderOrder() {
  if (!selectedTable) return;

  const tableKey = String(selectedTable);
  const table = getTable(tableKey);
  if (!table) return;

  orderList.innerHTML = "";

  table.order.forEach((line, idx) => {
    const li = document.createElement("li");
    const mods = buildModifiersText(line);

    li.innerHTML = `
      <div style="flex:1; padding-right:10px;">
        <span><strong>${escapeHtml(lineLabel(line))}</strong> - ${formatCurrency(line.unitPrice)} × ${Number(line.qty || 0)}</span>
        ${mods ? `<span class="order-modifiers">${escapeHtml(mods)}</span>` : ``}
      </div>
      <div class="order-buttons">
        ${line.type === "dish" ? `<button onclick="editLine(${idx})">Edit</button>` : ``}
        <button onclick="changeQty(${idx},1)">+</button>
        <button onclick="changeQty(${idx},-1)">-</button>
        <button onclick="removeItem(${idx})">X</button>
      </div>
    `;
    orderList.appendChild(li);
  });

  // Header status
  document.getElementById("orderTitle").textContent = `Current Order - Table ${selectedTable}`;
  document.getElementById("tableInfo").textContent = `Status: ${table.status}`;

  // Reservation banner (realistic)
  const resv = findRelevantReservationForTable(tableKey);
  if (resv) {
    reservationBanner.classList.remove("hidden");
    reservationBanner.textContent =
      `RESERVED: ${resv.name} (${resv.phone}) • ${fmtBeirutDateTime(resv.dateTimeISO)} • Party: ${resv.party}` +
      (resv.notes ? ` • Notes: ${resv.notes}` : "");
  } else {
    reservationBanner.classList.add("hidden");
    reservationBanner.textContent = "";
  }

  // Reopened banner
  if (table.reopenedFrom) {
    reopenBanner.classList.remove("hidden");
    reopenBanner.textContent = `Reopened from receipt: ${table.reopenedFrom}. Edit items and submit to create a new receipt.`;
  } else {
    reopenBanner.classList.add("hidden");
    reopenBanner.textContent = "";
  }

  // Discount UI sync
  discountTypeEl.value = table.discount?.type || "none";
  discountValueEl.value = Number(table.discount?.value || 0) || "";

  // Sync customer inputs
  syncCustomerInputsFromTable(table);

  renderPaymentsUI();
  renderTotalsUI();

  saveTablesNow();
}

function renderTotalsUI() {
  const table = getTable(selectedTable);
  const { subtotal, discAmt, total, paid, change, balance } = calcTotals(table);
  const vat = calcVatBreakdown(total);

  subtotalAmountEl.textContent = formatCurrency(subtotal);
  discountAmountEl.textContent = formatCurrency(discAmt);
  totalAmountEl.textContent = formatCurrency(total);
  paidAmountDisplayEl.textContent = formatCurrency(paid);

  if (taxableAmountEl) taxableAmountEl.textContent = formatCurrency(vat.taxable);
  if (vatAmountEl) vatAmountEl.textContent = formatCurrency(vat.amount);
  updateVatLabels();

  // Show change if overpaid, else show balance
  const value = change > 0 ? change : balance;
  changeAmountEl.textContent = formatCurrency(value);

  table.total = total; // for table button
}

function renderPaymentsUI() {
  const table = getTable(selectedTable);
  paymentsListEl.innerHTML = "";

  (table.payments || []).forEach((p, idx) => {
    syncPaymentUsdAmount(p);

    const row = document.createElement("div");
    row.className = "payment-row-ui";

    const currency = normalizePaymentCurrency(p.currency);
    const inputAmount = getPaymentInputAmount(p);

    row.innerHTML = `
      <select data-pay-idx="${idx}" data-pay-field="method" title="Payment method">
        <option value="cash" ${p.method === "cash" ? "selected" : ""}>Cash</option>
        <option value="card" ${p.method === "card" ? "selected" : ""}>Card</option>
      </select>
      <select data-pay-idx="${idx}" data-pay-field="currency" title="Paid currency">
        <option value="USD" ${currency === "USD" ? "selected" : ""}>USD</option>
        <option value="LBP" ${currency === "LBP" ? "selected" : ""}>LBP</option>
      </select>
      <input data-pay-idx="${idx}" data-pay-field="amount" type="number" min="0" step="${getPaymentCurrencyStep(currency)}" placeholder="${getPaymentCurrencyPlaceholder(currency)}" value="${inputAmount}" />
      <button class="payment-remove" data-pay-remove="${idx}">×</button>
    `;
    paymentsListEl.appendChild(row);
  });

  // bind
  paymentsListEl.querySelectorAll("[data-pay-field]").forEach((el) => {
    el.addEventListener("input", () => {
      const i = Number(el.dataset.payIdx);
      const field = el.dataset.payField;
      if (!table.payments[i]) return;

      const payment = table.payments[i];

      if (field === "amount") {
        payment.inputAmount = Number(el.value || 0);
        syncPaymentUsdAmount(payment);
      }

      if (field === "method") {
        payment.method = el.value;
      }

      if (field === "currency") {
        const previousUsd = Number(payment.amount || 0);
        payment.currency = normalizePaymentCurrency(el.value);
        payment.inputAmount = usdToPaymentCurrency(previousUsd, payment.currency);
        syncPaymentUsdAmount(payment);
        renderPaymentsUI();
      }

      saveTablesNow();
      renderTotalsUI();
    });

    el.addEventListener("change", () => {
      if (el.dataset.payField !== "currency") return;
      const i = Number(el.dataset.payIdx);
      const payment = table.payments[i];
      if (!payment) return;
      const previousUsd = Number(payment.amount || 0);
      payment.currency = normalizePaymentCurrency(el.value);
      payment.inputAmount = usdToPaymentCurrency(previousUsd, payment.currency);
      syncPaymentUsdAmount(payment);
      saveTablesNow();
      renderPaymentsUI();
      renderTotalsUI();
    });
  });

  paymentsListEl.querySelectorAll("[data-pay-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.payRemove);
      table.payments.splice(i, 1);
      saveTablesNow();
      renderPaymentsUI();
      renderTotalsUI();
    });
  });
}


function openReservationActionModal(tableKey, reservation) {
  pendingReservationAction = { tableKey: String(tableKey), reservation };

  if (reservationActionTitle) {
    reservationActionTitle.textContent = `Table ${tableKey} Reservation`;
  }

  if (reservationActionDetails) {
    reservationActionDetails.innerHTML = `
      <div class="reservation-summary-card">
        <strong>${escapeHtml(reservation.name || "Guest")}</strong>
        <span>${escapeHtml(reservation.phone || "No phone")}</span>
        <span>${escapeHtml(fmtBeirutDateTime(reservation.dateTimeISO))}</span>
        <span>Party: ${escapeHtml(String(reservation.party || "—"))}</span>
        ${reservation.notes ? `<span>Notes: ${escapeHtml(reservation.notes)}</span>` : ""}
      </div>
    `;
  }

  if (reservationActionModal) reservationActionModal.classList.remove("hidden");
}

function closeReservationActionModal() {
  if (reservationActionModal) reservationActionModal.classList.add("hidden");
  pendingReservationAction = null;
}

function openTableAfterReservationDecision(tableKey, reservation, markArrived) {
  const table = getTable(tableKey);
  if (!table) return;

  if (reservation) {
    table.reservationId = reservation.id || null;
    if (!table.customerPhone) table.customerPhone = reservation.phone || "";
    if (!table.customerName) table.customerName = reservation.name || "";

    if (markArrived && reservation.id) {
      markReservationArrivedById(reservation.id);
    }

    const lib = CustomersLibSafe();
    if (table.customerPhone) lib.ensureCustomer(table.customerPhone, table.customerName || "");
    loadPosCustomersDatalist();
  }

  saveTablesNow();
  orderPanel.classList.remove("hidden");
  hideReceipt();
  renderOrder();
  renderTables();
  loadCategories();
  if (currentCategory) loadMenuItems(currentCategory);
}

if (reservationCancelBtn) reservationCancelBtn.addEventListener("click", closeReservationActionModal);
if (reservationActionModal) {
  reservationActionModal.addEventListener("click", (e) => {
    if (e.target === reservationActionModal) closeReservationActionModal();
  });
}
if (reservationDeleteBtn) {
  reservationDeleteBtn.addEventListener("click", () => {
    if (!pendingReservationAction) return;
    const { tableKey, reservation } = pendingReservationAction;
    if (reservation?.id) cancelReservationById(reservation.id);
    closeReservationActionModal();
    selectedTable = String(tableKey);
    openTableAfterReservationDecision(tableKey, null, false);
  });
}
if (reservationArrivedBtn) {
  reservationArrivedBtn.addEventListener("click", () => {
    if (!pendingReservationAction) return;
    const { tableKey, reservation } = pendingReservationAction;
    closeReservationActionModal();
    selectedTable = String(tableKey);
    openTableAfterReservationDecision(tableKey, reservation, true);
  });
}

// ---------- Table selection ----------
function selectTable(num) {
  syncDishesAndStock();
  selectedTable = String(num);

  const table = getTable(selectedTable);
  if (!table) return;

  // Never lock user out
  if (table.status === "closed") {
    table.status = "empty";
    table.ref = null;
    table.order = [];
    table.total = 0;
    table.discount = { type: "none", value: 0 };
    table.payments = [];
    table.reopenedFrom = null;
    table.customerName = "";
    table.customerPhone = "";
    table.reservationId = null;
    saveTablesNow();
  }

  const resv = findRelevantReservationForTable(selectedTable);
  const orderCount = Array.isArray(table.order) ? table.order.length : 0;
  const alreadySeated = resv && table.reservationId && String(table.reservationId) === String(resv.id || "");

  if (resv && orderCount === 0 && !alreadySeated) {
    renderTables();
    openReservationActionModal(selectedTable, resv);
    return;
  }

  if (resv) {
    table.reservationId = table.reservationId || resv.id || null;
    if (!table.customerPhone) table.customerPhone = resv.phone || "";
    if (!table.customerName) table.customerName = resv.name || "";
    saveTablesNow();
    const lib = CustomersLibSafe();
    if (table.customerPhone) lib.ensureCustomer(table.customerPhone, table.customerName || "");
    loadPosCustomersDatalist();
  }

  orderPanel.classList.remove("hidden");
  hideReceipt();

  renderOrder();
  renderTables();
  loadCategories();
  if (currentCategory) loadMenuItems(currentCategory);
}

// ---------- Add table ----------
addTableBtn.onclick = () => {
  const newNum = Object.keys(tables).length + 1;
  tables[newNum] = {
    order: [],
    total: 0,
    ref: null,
    status: "empty",
    discount: { type: "none", value: 0 },
    payments: [],
    reopenedFrom: null,
    customerName: "",
    customerPhone: "",
    reservationId: null,
  };
  saveTablesNow();
  renderTables();
};

// ---------- Ingredient Modal ----------
function closeIngredientModal() {
  ingredientModal.classList.add("hidden");
  modalDish = null;
  modalEditContext = null;
  modalIngredientsWrap.innerHTML = "";
  modalNote.value = "";
}
modalCloseBtn.addEventListener("click", closeIngredientModal);
modalCancelBtn.addEventListener("click", closeIngredientModal);
ingredientModal.addEventListener("click", (e) => { if (e.target === ingredientModal) closeIngredientModal(); });

function showIngredientModal(dish, removedIngredients, note) {
  modalDishTitle.textContent = `Customize: ${dish.name}`;
  modalIngredientsWrap.innerHTML = "";
  modalNote.value = note || "";

  const ingredients = Array.isArray(dish.ingredients) ? dish.ingredients : [];
  if (ingredients.length === 0) {
    modalIngredientsWrap.innerHTML = `<p class="hint">No ingredients found for this dish (Menu recipe is empty). You can still add it.</p>`;
  } else {
    const removedSet = new Set((removedIngredients || []).map(norm));
    ingredients.forEach((ing) => {
      const row = document.createElement("div");
      row.className = "ing-row";
      row.innerHTML = `
        <div class="ing-left">
          <input type="checkbox" data-ing-name="${escapeHtml(ing.name)}" ${removedSet.has(norm(ing.name)) ? "" : "checked"} />
          <div>
            <div class="ing-name">${escapeHtml(ing.name)}</div>
            <div class="ing-meta">${escapeHtml(String(ing.qty))}${escapeHtml(String(ing.unit))}</div>
          </div>
        </div>
      `;
      modalIngredientsWrap.appendChild(row);
    });
  }

  ingredientModal.classList.remove("hidden");
}

function openIngredientModalForAdd(dish) {
  if (!selectedTable) return alert("Select a table first!");
  syncDishesAndStock();
  modalDish = dish;
  modalEditContext = null;
  showIngredientModal(dish, [], "");
}

window.editLine = function editLine(index) {
  if (!selectedTable) return;
  const table = getTable(selectedTable);
  const line = table?.order?.[index];
  if (!line || line.type !== "dish") return;

  const dish = (dishes || []).find((d) => d && d.name === line.dishName);
  if (!dish) return alert("Dish not found in Menu. Please re-save it in Menu.");

  modalDish = dish;
  modalEditContext = { tableKey: String(selectedTable), lineId: line.lineId };
  showIngredientModal(dish, line.removedIngredients || [], line.note || "");
};

modalAddBtn.addEventListener("click", async () => {
  if (!selectedTable) return alert("Select a table first!");
  const tableKey = String(selectedTable);
  const table = getTable(tableKey);
  if (!table) return alert("Invalid table.");
  if (!modalDish) return;

  await refreshProductsForStockCheck();

  const removed = [];
  modalIngredientsWrap.querySelectorAll("input[type='checkbox'][data-ing-name]").forEach((cb) => {
    const name = cb.dataset.ingName;
    if (!cb.checked) removed.push(name);
  });
  const note = String(modalNote.value || "").trim();

  // Editing existing line
  if (modalEditContext && modalEditContext.tableKey === tableKey) {
    const line = table.order.find((x) => x.lineId === modalEditContext.lineId);
    if (!line) return alert("Line not found.");

    const check = canSetDishLineQtyByStock(modalDish, removed, tableKey, line.lineId, Number(line.qty || 1));
    if (!check.ok) return alert(check.message || "Not enough stock.");

    line.removedIngredients = removed;
    line.note = note;

    table.status = table.order.length ? "open" : "empty";
    saveTablesNow();
    renderOrder();
    renderTables();
    closeIngredientModal();
    return;
  }

  // Add/increment identical line
  const removedKey = removed.map(norm).sort().join("|");
  const noteKey = norm(note);

  const match = table.order.find((li) => {
    if (!li || li.type !== "dish") return false;
    if (li.dishName !== modalDish.name) return false;
    const rk = (li.removedIngredients || []).map(norm).sort().join("|");
    const nk = norm(li.note || "");
    return rk === removedKey && nk === noteKey;
  });

  if (match) {
    const desiredQty = Number(match.qty || 0) + 1;
    const check = canSetDishLineQtyByStock(modalDish, match.removedIngredients || [], tableKey, match.lineId, desiredQty);
    if (!check.ok) return alert(check.message || "Not enough stock.");
    match.qty = desiredQty;
  } else {
    const lineId = nowId();
    const check = canSetDishLineQtyByStock(modalDish, removed, tableKey, lineId, 1);
    if (!check.ok) return alert(check.message || "Not enough stock.");

    table.order.push({
      lineId,
      type: "dish",
      dishName: modalDish.name,
      product_id: modalDish.product_id || null,
      unitPrice: Number(modalDish.price || 0),
      qty: 1,
      removedIngredients: removed,
      note,
      status: "new",
    });
  }

  table.status = "open";
  saveTablesNow();
  renderOrder();
  renderTables();
  closeIngredientModal();
});

// ---------- Qty / remove ----------
window.changeQty = async function changeQty(index, delta) {
  if (!selectedTable) return;
  if (delta > 0) await refreshProductsForStockCheck();
  syncDishesAndStock();

  const tableKey = String(selectedTable);
  const table = getTable(tableKey);
  const line = table?.order?.[index];
  if (!line) return;

  if (delta > 0) {
    if (line.type === "dish") {
      const dish = (dishes || []).find((d) => d && d.name === line.dishName);
      if (dish) {
        const desiredQty = Number(line.qty || 0) + 1;
        const check = canSetDishLineQtyByStock(dish, line.removedIngredients || [], tableKey, line.lineId, desiredQty);
        if (!check.ok) return alert(check.message || "Not enough stock.");
        line.qty = desiredQty;
      } else {
        line.qty = Number(line.qty || 0) + 1;
      }
    } else {
      line.qty = Number(line.qty || 0) + 1;
    }
  } else {
    line.qty = Number(line.qty || 0) - 1;
  }

  if (line.qty <= 0) table.order.splice(index, 1);
  table.status = table.order.length ? "open" : "empty";

  saveTablesNow();
  renderOrder();
  renderTables();
};

window.removeItem = function removeItem(index) {
  if (!selectedTable) return;
  const table = getTable(selectedTable);
  table.order.splice(index, 1);
  table.status = table.order.length ? "open" : "empty";
  saveTablesNow();
  renderOrder();
  renderTables();
};

// ---------- Custom item ----------
document.getElementById("addCustomBtn").addEventListener("click", () => {
  if (!selectedTable) return alert("Select a table first!");

  const nameInput = document.getElementById("customItemName");
  const priceInput = document.getElementById("customItemPrice");
  const currencyInput = document.getElementById("customItemCurrency");

  const name = String(nameInput.value || "").trim();
  const enteredPrice = parseFloat(priceInput.value);
  const enteredCurrency = normalizePaymentCurrency(currencyInput?.value || posSettings.currency);
  const priceUsd = paymentAmountToUsd(enteredPrice, enteredCurrency);

  if (!name) return alert("Enter a valid item name.");
  if (!Number.isFinite(enteredPrice) || enteredPrice <= 0 || priceUsd <= 0) {
    return alert(`Enter a valid price in ${enteredCurrency}.`);
  }

  const table = getTable(selectedTable);
  table.order.push({
    lineId: nowId(),
    type: "custom",
    customName: name,
    unitPrice: Number(priceUsd), // POS stores order values internally in USD
    qty: 1,
    removedIngredients: [],
    note: "",
    status: "new",
    enteredAmount: Number(enteredPrice),
    enteredCurrency,
    exchangeRate: Number(posSettings.usdToLbp || 0),
  });

  nameInput.value = "";
  priceInput.value = "";
  setCustomItemCurrency(posSettings.currency, false);

  table.status = "open";
  saveTablesNow();
  renderOrder();
  renderTables();
});

// ---------- Discount change ----------
function onDiscountChanged() {
  const table = getTable(selectedTable);
  table.discount = {
    type: discountTypeEl.value,
    value: Number(discountValueEl.value || 0),
  };
  saveTablesNow();
  renderTotalsUI();
  renderTables();
}
discountTypeEl.addEventListener("change", () => { if (selectedTable) onDiscountChanged(); });
discountValueEl.addEventListener("input", () => { if (selectedTable) onDiscountChanged(); });

// ---------- Payments ----------
addPaymentBtn.addEventListener("click", () => {
  if (!selectedTable) return alert("Select a table first!");
  const table = getTable(selectedTable);
  table.payments.push({ method: "cash", currency: posSettings.currency, inputAmount: 0, amount: 0 });
  saveTablesNow();
  renderPaymentsUI();
  renderTotalsUI();
});

function setPaymentsForSplit(amounts) {
  const table = getTable(selectedTable);
  table.payments = amounts.map((a) => ({ method: "cash", currency: "USD", inputAmount: Number(a || 0), amount: Number(a || 0) }));
  saveTablesNow();
  renderPaymentsUI();
  renderTotalsUI();
}

// ---------- Reference ----------
function generateRef() {
  const d = new Date();
  const ref = `ORD-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(refCounter).padStart(3, "0")}`;
  refCounter++;
  saveTablesNow();
  return ref;
}

// ---------- Deduct stock respecting removals ----------
function deductFromStock(orderLines) {
  stockItems = safeParse(localStorage.getItem("stockItems"), stockItems || []);

  orderLines.forEach((line) => {
    if (!line || line.type !== "dish") return;

    const dish = (dishes || []).find((d) => d && d.name === line.dishName);
    if (!dish || !Array.isArray(dish.ingredients) || dish.ingredients.length === 0) return;

    const effective = getEffectiveIngredients(dish, line.removedIngredients);

    effective.forEach((ing) => {
      const stock = findStockByName(ing.name);
      if (!stock) return;

      const sU = normUnit(stock.unit);
      const iU = normUnit(ing.unit);

      const rawUsed = Number(ing.qty || 0) * Number(line.qty || 0);
      const usedQty = convertQty(rawUsed, iU, sU);
      if (usedQty === null) return;

      stock.quantity = Math.max(0, Number(stock.quantity || 0) - usedQty);
    });
  });

  localStorage.setItem("stockItems", JSON.stringify(stockItems));
}

// ---------- Receipts storage ----------
function addReceipt(receiptObj) {
  receipts = safeParse(localStorage.getItem(RECEIPTS_KEY), receipts || []);
  receipts.unshift(receiptObj);
  if (receipts.length > 300) receipts = receipts.slice(0, 300);
  saveReceiptsNow();
  saveSalesHistoryFromReceipt(receiptObj);
}

function computeLineCogsFromCurrentStock(line) {
  if (!line || line.type !== "dish") return 0;

  const dish = (dishes || []).find((d) =>
    (line.product_id && d.product_id && String(d.product_id) === String(line.product_id)) ||
    norm(d.name) === norm(line.dishName)
  );
  if (!dish) return 0;

  const effectiveIngredients = getEffectiveIngredients(dish, line.removedIngredients || []);
  const lineQty = Number(line.qty || 0);
  let lineCogs = 0;

  for (const ing of effectiveIngredients) {
    const stock = findStockByName(ing.name);
    if (!stock) continue;

    const requiredRaw = Number(ing.qty || 0) * lineQty;
    const requiredInStockUnit = convertQty(requiredRaw, ing.unit, stock.unit);
    if (requiredInStockUnit === null) continue;

    const avgCost = Number(stock.avg_cost || 0);
    lineCogs += requiredInStockUnit * avgCost;
  }

  return Number(lineCogs || 0);
}

function computeReceiptCogs(lines) {
  return (lines || []).reduce((sum, line) => sum + computeLineCogsFromCurrentStock(line), 0);
}

function buildReceiptObject(tableKey, table, ref) {
  const createdAt = new Date().toISOString();
  const { subtotal, discAmt, total, paid, change, balance } = calcTotals(table);
  const receiptSettings = sanitizePosSettings(posSettings);
  const vat = calcVatBreakdown(total, receiptSettings);
  const cogs = computeReceiptCogs(table.order || []);
  const profit = Number(total || 0) - Number(cogs || 0);

  return {
    id: `RCPT-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`.toUpperCase(),
    ref,
    table: String(tableKey),
    customerName: table.customerName || "",
    customerPhone: table.customerPhone || "",
    createdAt,
    lines: JSON.parse(JSON.stringify(table.order || [])),
    discount: { ...(table.discount || { type: "none", value: 0 }), amount: discAmt },
    subtotal,
    total,
    cogs,
    profit,
    payments: JSON.parse(JSON.stringify(table.payments || [])),
    paid,
    change,
    balance,
    reopenedFrom: table.reopenedFrom || null,
    reservationId: table.reservationId || null,

    currency: receiptSettings.currency,
    exchangeRate: receiptSettings.usdToLbp,
    vatRate: receiptSettings.vatRate,
    vatMode: "included",
    vat: {
      rate: vat.rate,
      taxable: vat.taxable,
      amount: vat.amount,
      total: vat.total,
      mode: "included",
    },
  };
}

async function saveReceiptToSupabase(rcpt) {
  await ensureAccessToken({ forceRefresh: false });

  const { data: receiptRow, error: receiptError } = await window.sb
    .from("receipts")
    .insert({
      ref: rcpt.ref,
      table_number: rcpt.table,
      customer_name: rcpt.customerName || null,
      customer_phone: rcpt.customerPhone || null,
      subtotal: Number(rcpt.subtotal || 0),
      discount_amount: Number(rcpt.discount?.amount || 0),
      total: Number(rcpt.total || 0),
      paid: Number(rcpt.paid || 0),
      change_amount: Number(rcpt.change || 0),
      balance: Number(rcpt.balance || 0),
      cogs: Number(rcpt.cogs || 0),
      profit: Number(rcpt.profit || 0),
      currency: rcpt.currency || "USD",
      exchange_rate: Number(rcpt.exchangeRate || 1),
      vat_rate: Number(rcpt.vatRate || 0),
      vat_taxable: Number(rcpt.vat?.taxable || 0),
      vat_amount: Number(rcpt.vat?.amount || 0),
      reopened_from: rcpt.reopenedFrom || null,
      reservation_id: rcpt.reservationId || null,
      created_at: rcpt.createdAt
    })
    .select("id")
    .single();

  if (receiptError) throw receiptError;

  const receiptId = receiptRow.id;

  const receiptLines = (rcpt.lines || []).map((line) => ({
    receipt_id: receiptId,
    line_id: line.lineId || null,
    line_type: line.type || "dish",
    product_id: Number(line.product_id || 0) || null,
    item_name: line.type === "custom" ? (line.customName || "Custom") : (line.dishName || "Item"),
    quantity: Number(line.qty || 0),
    unit_price: Number(line.unitPrice || 0),
    line_total: Number(line.unitPrice || 0) * Number(line.qty || 0),
    removed_ingredients: Array.isArray(line.removedIngredients) ? line.removedIngredients : [],
    note: line.note || "",
    cogs: Number(computeLineCogsFromCurrentStock(line) || 0)
  }));

  if (receiptLines.length) {
    const { error: linesError } = await window.sb
      .from("receipt_lines")
      .insert(receiptLines);

    if (linesError) throw linesError;
  }

  const receiptPayments = (rcpt.payments || []).map((p) => ({
    receipt_id: receiptId,
    method: p.method || "cash",
    currency: p.currency || "USD",
    input_amount: Number(getPaymentInputAmount(p) || 0),
    amount_usd: Number(p.amount || 0)
  }));

  if (receiptPayments.length) {
    const { error: paymentsError } = await window.sb
      .from("receipt_payments")
      .insert(receiptPayments);

    if (paymentsError) throw paymentsError;
  }

  return receiptId;
}

// ---------- Receipt rendering ----------
function renderReceiptFromObject(rcpt, previewLabel) {
  const dt = new Date(rcpt.createdAt);
  const receiptSettings = getReceiptSettings(rcpt);
  const vat = rcpt.vat || calcVatBreakdown(rcpt.total, receiptSettings);

  // remove old preview labels
  [...receiptArea.querySelectorAll("[data-note='1']")].forEach((n) => n.remove());

  receiptRef.textContent = rcpt.ref;
  receiptTable.textContent = rcpt.table;
  receiptDate.textContent = dt.toLocaleString();

  // Customer on receipt
  const custText = (rcpt.customerName || rcpt.customerPhone)
    ? `${rcpt.customerName || ""}${rcpt.customerPhone ? ` (${rcpt.customerPhone})` : ""}`.trim()
    : "—";
  if (receiptCustomer) receiptCustomer.textContent = custText;

  receiptItems.innerHTML = "";
  rcpt.lines.forEach((line) => {
    const row = document.createElement("tr");
    const mods = buildModifiersText(line);
    const itemName = mods ? `${lineLabel(line)} (${mods})` : lineLabel(line);
    const lineTotal = Number(line.unitPrice || 0) * Number(line.qty || 0);
    row.innerHTML = `<td>${escapeHtml(itemName)}</td><td>${Number(line.qty || 0)}</td><td>${formatReceiptCurrency(lineTotal, rcpt)}</td>`;
    receiptItems.appendChild(row);
  });

  receiptSubtotal.textContent = formatReceiptCurrency(rcpt.subtotal, rcpt);
  receiptDiscount.textContent = formatReceiptCurrency(rcpt.discount?.amount || 0, rcpt);
  if (receiptTaxable) receiptTaxable.textContent = formatReceiptCurrency(vat.taxable || 0, rcpt);
  if (receiptVat) receiptVat.textContent = formatReceiptCurrency(vat.amount || 0, rcpt);
  receiptTotal.textContent = formatReceiptCurrency(rcpt.total, rcpt);

  const receiptVatRateEl = document.getElementById("receiptVatRate");
  if (receiptVatRateEl) {
    receiptVatRateEl.textContent = `${Number(vat.rate || 0).toFixed(2).replace(/\.00$/, "")}%`;
  }

  // Payments list
  receiptPayments.innerHTML = "";
  const payWrap = document.createElement("div");
  payWrap.innerHTML = `<p><strong>Payments:</strong></p>`;
  const ul = document.createElement("ul");
  ul.style.listStyle = "none";
  ul.style.padding = "0";
  ul.style.margin = "6px 0";

  if ((rcpt.payments || []).length === 0) {
    const li = document.createElement("li");
    li.textContent = `No payments recorded.`;
    ul.appendChild(li);
  } else {
    rcpt.payments.forEach((p) => {
      const li = document.createElement("li");
      const paidText = p.currency ? `${formatPaymentDisplay(p)} paid` : formatReceiptCurrency(p.amount, rcpt);
      const convertedText = formatReceiptCurrency(p.amount, rcpt);
      li.textContent = `${String(p.method || "cash").toUpperCase()}: ${paidText}${p.currency ? ` (= ${convertedText})` : ""}`;
      ul.appendChild(li);
    });
  }

  payWrap.appendChild(ul);
  payWrap.innerHTML += `<p><strong>Paid:</strong> ${formatReceiptCurrency(rcpt.paid, rcpt)} </p>`;
  receiptPayments.appendChild(payWrap);

  // Change/Balance
  const changeOrBalance = rcpt.change > 0 ? rcpt.change : rcpt.balance;
  receiptChange.textContent = `${formatReceiptCurrency(changeOrBalance, rcpt)}`;

  receiptArea.classList.remove("hidden");
  receiptArea.classList.add("visible");

  if (previewLabel) {
    const note = document.createElement("p");
    note.textContent = previewLabel;
    note.style.textAlign = "center";
    note.style.fontWeight = "bold";
    note.style.marginTop = "10px";
    note.style.color = "#e74c3c";
    note.setAttribute("data-note", "1");
    receiptArea.appendChild(note);
  }
}

function hideReceipt() {
  receiptArea.classList.add("hidden");
  receiptArea.classList.remove("visible");
}

// ---------- Submit order (professional rule: submit = paid) ----------
let isSubmittingOrder = false;
const submitOrderBtnEl = document.getElementById("submitOrderBtn");

if (submitOrderBtnEl) {
  submitOrderBtnEl.onclick = async () => {
    if (isSubmittingOrder) return;
    if (!selectedTable) return alert("Select a table first!");

    syncDishesAndStock();

    const tableKey = String(selectedTable);
    const table = getTable(tableKey);

    if (!table || !Array.isArray(table.order) || table.order.length === 0) {
      return alert("No items in order!");
    }

    table.customerName = String(posCustomerNameEl?.value || "").trim();
    table.customerPhone = String(posCustomerPhoneEl?.value || "").trim();
    saveTablesNow();

    const { total, balance } = calcTotals(table);

    if (total <= 0) return alert("Total must be greater than 0.");

    if (balance > 0.0001) {
      return alert(
        `This bill is not fully paid. Remaining balance: ${formatCurrency(balance)}.\nAdd payments until Paid = Total, then submit.`
      );
    }

    const ok = confirm("Submit paid order and close table?");
    if (!ok) return;

    isSubmittingOrder = true;
    submitOrderBtnEl.disabled = true;
    const originalSubmitText = submitOrderBtnEl.textContent;
    submitOrderBtnEl.textContent = "Submitting...";

    try {
      clearAppMessage();

      const custLib = CustomersLibSafe();
      if (table.customerPhone) custLib.ensureCustomer(table.customerPhone, table.customerName || "");
      loadPosCustomersDatalist();

      const ref = generateRef();
      const orderSnapshot = JSON.parse(JSON.stringify(table.order || []));
      const rcpt = buildReceiptObject(tableKey, table, ref);

      await saveSaleToBackend(orderSnapshot);
      await saveReceiptToSupabase(rcpt);

      deductFromStock(orderSnapshot);
      addReceipt(rcpt);

      custLib.finalizeReceipt({
        receipt: {
          ref: rcpt.ref,
          customerPhone: rcpt.customerPhone,
          customerName: rcpt.customerName || "",
          subtotal: rcpt.subtotal,
          discountTotal: rcpt.discount?.amount || 0,
          total: rcpt.total,
          paidTotal: rcpt.paid,
          createdAtISO: rcpt.createdAt,
        },
      });

      let released = false;
      if (table.reservationId) released = completeReservationById(table.reservationId);
      if (!released && table.customerPhone) {
        released = completeReservationByMatch({ tableKey, phone: table.customerPhone });
      }

      renderReceiptFromObject(rcpt);

      table.order = [];
      table.total = 0;
      table.ref = null;
      table.status = "empty";
      table.discount = { type: "none", value: 0 };
      table.payments = [];
      table.reopenedFrom = null;
      table.customerName = "";
      table.customerPhone = "";
      table.reservationId = null;

      saveTablesNow();
      renderOrder();
      renderTables();
      showAppMessage("Sale completed successfully", "success");
    } catch (err) {
      console.error("Submit order failed:", err);
      const message = err?.message || "Submit order failed. Please try again.";
      showAppMessage(message, "error");
      alert(message);
    } finally {
      isSubmittingOrder = false;
      submitOrderBtnEl.disabled = false;
      submitOrderBtnEl.textContent = originalSubmitText || "Submit Order";
    }
  };
}

// ---------- Print (Preview) ----------
document.getElementById("printBtn").onclick = () => {
  if (!selectedTable) return alert("Select a table first!");
  const table = getTable(selectedTable);
  if (!table || !table.order || table.order.length === 0) return alert("No items in this order!");

  // take customer inputs into table for preview too
  table.customerName = String(posCustomerNameEl?.value || "").trim();
  table.customerPhone = String(posCustomerPhoneEl?.value || "").trim();
  saveTablesNow();

  const tempRef = `PREVIEW-${selectedTable}-${Date.now().toString().slice(-5)}`;
  const rcpt = buildReceiptObject(String(selectedTable), table, tempRef);

  renderReceiptFromObject(rcpt, "UNPAID BILL PREVIEW");
  setTimeout(() => window.print(), 250);
};

// ---------- Send to Kitchen (thermal ticket, no database write) ----------
function buildKitchenTicketHtml(tableKey, table) {
  const now = new Date().toLocaleString();
  const rows = (table.order || []).map((line) => {
    const mods = buildModifiersText(line);
    return `
      <div class="item">
        <div class="item-main">
          <span class="qty">${Number(line.qty || 0)}x</span>
          <span class="name">${escapeHtml(lineLabel(line))}</span>
        </div>
        ${mods ? `<div class="mods">${escapeHtml(mods)}</div>` : ""}
      </div>
    `;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Kitchen Ticket - Table ${escapeHtml(tableKey)}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    body {
      width: 72mm;
      margin: 0;
      font-family: Arial, sans-serif;
      color: #000;
      font-size: 13px;
    }
    .center { text-align: center; }
    .title { font-size: 20px; font-weight: 900; margin-bottom: 4px; }
    .meta { font-size: 12px; margin: 2px 0; }
    .line { border-top: 1px dashed #000; margin: 8px 0; }
    .item { margin: 8px 0; }
    .item-main { display: flex; gap: 7px; align-items: flex-start; }
    .qty { font-size: 18px; font-weight: 900; min-width: 34px; }
    .name { font-size: 18px; font-weight: 900; flex: 1; }
    .mods { font-size: 13px; margin-left: 42px; margin-top: 2px; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <div class="center title">KITCHEN ORDER</div>
  <div class="center meta">Table ${escapeHtml(tableKey)}</div>
  <div class="center meta">${escapeHtml(now)}</div>
  <div class="line"></div>
  ${rows}
  <div class="line"></div>
  <div class="center meta">Sent from POS</div>
</body>
</html>`;
}

function sendCurrentOrderToKitchen() {
  if (!selectedTable) return alert("Select a table first!");

  const table = getTable(selectedTable);
  if (!table || !Array.isArray(table.order) || table.order.length === 0) {
    return alert("No items in this order!");
  }

  const printWindow = window.open("", "kitchenPrintWindow", "width=380,height=650");
  if (!printWindow) {
    return alert("Popup blocked. Please allow popups so the kitchen ticket can print.");
  }

  printWindow.document.open();
  printWindow.document.write(buildKitchenTicketHtml(String(selectedTable), table));
  printWindow.document.close();
  printWindow.focus();

  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 350);
}

const sendKitchenBtn = document.getElementById("sendKitchenBtn");
if (sendKitchenBtn) {
  sendKitchenBtn.addEventListener("click", sendCurrentOrderToKitchen);
}

// ---------- Split Bill ----------
function openSplitModal() {
  if (!selectedTable) return alert("Select a table first!");
  const table = getTable(selectedTable);
  if (!table || !table.order || table.order.length === 0) return alert("No items to split!");

  splitAssignments = {};
  const guests = Math.max(2, Number(splitGuestsEl.value || 2));
  splitGuestsEl.value = String(guests);

  splitModeEl.value = "equal";
  splitItemsArea.classList.add("hidden");
  splitItemsArea.innerHTML = "";

  updateSplitUI();
  splitModal.classList.remove("hidden");
}
function closeSplitModal() {
  splitModal.classList.add("hidden");
  splitAssignments = {};
  splitItemsArea.innerHTML = "";
  splitSummaryList.innerHTML = "";
}

document.getElementById("splitBillBtn").addEventListener("click", openSplitModal);
splitCloseBtn.addEventListener("click", closeSplitModal);
splitCancelBtn.addEventListener("click", closeSplitModal);
splitModal.addEventListener("click", (e) => { if (e.target === splitModal) closeSplitModal(); });

function getSplitUnitKey(lineId, unitIndex) {
  return `${lineId}__unit_${unitIndex}`;
}

function getLineSplitUnits(line) {
  const qty = Number(line.qty || 0);
  if (!Number.isFinite(qty) || qty <= 0) return [];

  const roundedQty = Math.round(qty);
  if (Math.abs(qty - roundedQty) < 1e-9) {
    return Array.from({ length: roundedQty }, (_, i) => ({
      key: getSplitUnitKey(line.lineId, i + 1),
      label: `${lineLabel(line)} #${i + 1}`,
      qty: 1,
      amount: Number(line.unitPrice || 0),
      lineId: line.lineId,
      unitIndex: i + 1,
    }));
  }

  return [{
    key: getSplitUnitKey(line.lineId, 1),
    label: `${lineLabel(line)} × ${qty}`,
    qty,
    amount: Number(line.unitPrice || 0) * qty,
    lineId: line.lineId,
    unitIndex: 1,
  }];
}

function getAllSplitUnits(table) {
  const units = [];
  (table.order || []).forEach((line) => {
    getLineSplitUnits(line).forEach((unit) => units.push(unit));
  });
  return units;
}

function updateSplitUI() {
  const table = getTable(selectedTable);
  const guests = Math.max(2, Number(splitGuestsEl.value || 2));
  const mode = splitModeEl.value;

  if (!table) return;

  if (mode === "items") {
    splitItemsArea.classList.remove("hidden");
    splitItemsArea.innerHTML = "";

    const units = getAllSplitUnits(table);

    if (units.length === 0) {
      splitItemsArea.innerHTML = `<p class="hint">No items available to split.</p>`;
      renderSplitSummary();
      return;
    }

    units.forEach((unit) => {
      const row = document.createElement("div");
      row.className = "split-line split-unit-line";

      const label = `${unit.label} - ${formatCurrency(unit.amount)}`;
      const sel = document.createElement("select");
      sel.dataset.splitUnitKey = unit.key;

      for (let g = 1; g <= guests; g++) {
        const opt = document.createElement("option");
        opt.value = String(g);
        opt.textContent = `Guest ${g}`;
        sel.appendChild(opt);
      }

      if (!splitAssignments[unit.key]) splitAssignments[unit.key] = 1;
      sel.value = String(splitAssignments[unit.key]);

      sel.addEventListener("change", () => {
        splitAssignments[unit.key] = Number(sel.value);
        renderSplitSummary();
      });

      row.innerHTML = `<div>${escapeHtml(label)}</div>`;
      row.appendChild(sel);
      splitItemsArea.appendChild(row);
    });
  } else {
    splitItemsArea.classList.add("hidden");
    splitItemsArea.innerHTML = "";
  }

  renderSplitSummary();
}

function renderSplitSummary() {
  const table = getTable(selectedTable);
  if (!table) return;

  const { total, subtotal, discAmt } = calcTotals(table);
  const guests = Math.max(2, Number(splitGuestsEl.value || 2));
  const mode = splitModeEl.value;
  const totals = new Array(guests).fill(0);

  if (mode === "equal") {
    const per = total / guests;
    for (let i = 0; i < guests; i++) totals[i] = per;
  } else {
    const units = getAllSplitUnits(table);
    units.forEach((unit) => {
      const guestNumber = Math.max(1, Math.min(guests, Number(splitAssignments[unit.key] || 1)));
      totals[guestNumber - 1] += Number(unit.amount || 0);
    });

    if (discAmt > 0 && subtotal > 0) {
      const ratio = discAmt / subtotal;
      for (let i = 0; i < guests; i++) totals[i] = Math.max(0, totals[i] - (totals[i] * ratio));
    }
  }

  splitSummaryList.innerHTML = "";
  totals.forEach((t, i) => {
    const div = document.createElement("div");
    div.textContent = `Guest ${i + 1}: ${formatCurrency(t)}`;
    splitSummaryList.appendChild(div);
  });
}

splitGuestsEl.addEventListener("input", updateSplitUI);
splitModeEl.addEventListener("change", updateSplitUI);

splitApplyBtn.addEventListener("click", () => {
  const table = getTable(selectedTable);
  if (!table) return;

  const guests = Math.max(2, Number(splitGuestsEl.value || 2));
  const mode = splitModeEl.value;
  const totals = new Array(guests).fill(0);
  const { total, subtotal, discAmt } = calcTotals(table);

  if (mode === "equal") {
    const per = total / guests;
    for (let i = 0; i < guests; i++) totals[i] = per;
  } else {
    const units = getAllSplitUnits(table);
    units.forEach((unit) => {
      const guestNumber = Math.max(1, Math.min(guests, Number(splitAssignments[unit.key] || 1)));
      totals[guestNumber - 1] += Number(unit.amount || 0);
    });

    if (discAmt > 0 && subtotal > 0) {
      const ratio = discAmt / subtotal;
      for (let i = 0; i < guests; i++) totals[i] = Math.max(0, totals[i] - (totals[i] * ratio));
    }
  }

  setPaymentsForSplit(totals);
  closeSplitModal();
});

async function fetchReceiptsFromSupabase() {
  await ensureAccessToken({ forceRefresh: false });

  const { data, error } = await window.sb
    .from("receipts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((r) => ({
    id: String(r.id),
    ref: r.ref,
    table: String(r.table_number || ""),
    customerName: r.customer_name || "",
    customerPhone: r.customer_phone || "",
    createdAt: r.created_at,
    subtotal: Number(r.subtotal || 0),
    total: Number(r.total || 0),
    paid: Number(r.paid || 0),
    change: Number(r.change_amount || 0),
    balance: Number(r.balance || 0),
    cogs: Number(r.cogs || 0),
    profit: Number(r.profit || 0),
    currency: r.currency || "USD",
    exchangeRate: Number(r.exchange_rate || 1),
    vatRate: Number(r.vat_rate || 0),
    vat: {
      taxable: Number(r.vat_taxable || 0),
      amount: Number(r.vat_amount || 0),
      total: Number(r.total || 0),
      rate: Number(r.vat_rate || 0),
      mode: "included"
    },
    discount: { amount: Number(r.discount_amount || 0) },
    reopenedFrom: r.reopened_from || null,
    reservationId: r.reservation_id || null,
    lines: [],
    payments: []
  }));
}

async function fetchReceiptDetailsFromSupabase(receiptId) {
  await ensureAccessToken({ forceRefresh: false });

  const [{ data: lines, error: linesError }, { data: payments, error: paymentsError }] =
    await Promise.all([
      window.sb
        .from("receipt_lines")
        .select("*")
        .eq("receipt_id", receiptId)
        .order("id", { ascending: true }),

      window.sb
        .from("receipt_payments")
        .select("*")
        .eq("receipt_id", receiptId)
        .order("id", { ascending: true })
    ]);

  if (linesError) throw linesError;
  if (paymentsError) throw paymentsError;

  return {
    lines: (lines || []).map((line) => ({
      lineId: line.line_id,
      type: line.line_type,
      product_id: line.product_id,
      dishName: line.item_name,
      customName: line.item_name,
      qty: Number(line.quantity || 0),
      unitPrice: Number(line.unit_price || 0),
      removedIngredients: Array.isArray(line.removed_ingredients) ? line.removed_ingredients : [],
      note: line.note || ""
    })),
    payments: (payments || []).map((p) => ({
      method: p.method || "cash",
      currency: p.currency || "USD",
      inputAmount: Number(p.input_amount || 0),
      amount: Number(p.amount_usd || 0)
    }))
  };
}

// ---------- Receipts History + Reopen ----------
async function openReceiptsModal() {
  try {
    receipts = await fetchReceiptsFromSupabase();
  } catch (err) {
    console.error("Supabase receipts load failed, using local receipts:", err);
    receipts = safeParse(localStorage.getItem(RECEIPTS_KEY), receipts || []);
  }

  selectedReceiptId = null;
  receiptSearch.value = "";
  renderReceiptsList(receipts);
  receiptViewEl.innerHTML = `<p class="hint">Select a receipt to view details.</p>`;
  receiptsModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeReceiptsModal() {
  receiptsModal.classList.add("hidden");
  document.body.style.overflow = "";
}
receiptsBtn.addEventListener("click", async () => {
  await openReceiptsModal();
});
receiptsCloseBtn.addEventListener("click", closeReceiptsModal);
receiptsCancelBtn.addEventListener("click", closeReceiptsModal);
receiptsModal.addEventListener("click", (e) => { if (e.target === receiptsModal) closeReceiptsModal(); });

function renderReceiptsList(list) {
  receiptsListEl.innerHTML = "";
  if (!Array.isArray(list) || list.length === 0) {
    receiptsListEl.innerHTML = `<div class="receipt-card"><div class="ref">No receipts yet</div></div>`;
    return;
  }

  list.forEach((r) => {
    const card = document.createElement("div");
    card.className = "receipt-card" + (r.id === selectedReceiptId ? " active" : "");
    const dt = new Date(r.createdAt).toLocaleString();

    const cust = (r.customerName || r.customerPhone)
      ? `${r.customerName || ""}${r.customerPhone ? ` (${r.customerPhone})` : ""}`.trim()
      : "";

    card.innerHTML = `
      <div class="ref">${escapeHtml(r.ref)}</div>
      <div class="hint">${escapeHtml(dt)} • Table ${escapeHtml(r.table)} • ${formatReceiptCurrency(r.total, r)}${cust ? ` • ${escapeHtml(cust)}` : ""}</div>
    `;

    card.addEventListener("click", async () => {
  selectedReceiptId = r.id;
  renderReceiptsList(list);

  try {
    const details = await fetchReceiptDetailsFromSupabase(r.id);
    renderReceiptDetails({
      ...r,
      lines: details.lines,
      payments: details.payments
    });
  } catch (err) {
    console.error("Failed to load receipt details from Supabase:", err);
    renderReceiptDetails(r);
  }
});

    receiptsListEl.appendChild(card);
  });
}

function renderReceiptDetails(r) {
  const dt = new Date(r.createdAt).toLocaleString();
  const cust = (r.customerName || r.customerPhone)
    ? `${r.customerName || ""}${r.customerPhone ? ` (${r.customerPhone})` : ""}`.trim()
    : "—";

  const linesHtml = (r.lines || []).map((line) => {
    const mods = buildModifiersText(line);
    const name = mods ? `${lineLabel(line)} (${mods})` : lineLabel(line);
    const amt = Number(line.unitPrice || 0) * Number(line.qty || 0);
    return `<li>${escapeHtml(name)} × ${Number(line.qty || 0)} — ${formatReceiptCurrency(amt, r)}</li>`;
  }).join("");

  const paysHtml = (r.payments || []).map((p) => {
    return `<li>${escapeHtml(String(p.method || "cash").toUpperCase())}: ${formatReceiptCurrency(p.amount, r)}</li>`;
  }).join("") || `<li>No payments recorded</li>`;

  receiptViewEl.innerHTML = `
    <div>
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:900; font-size:1.1rem;">${escapeHtml(r.ref)}</div>
          <div class="hint">${escapeHtml(dt)} • Table ${escapeHtml(r.table)}</div>
          <div class="hint">Customer: ${escapeHtml(cust)}</div>
          ${r.reopenedFrom ? `<div class="hint">Reopened from: ${escapeHtml(r.reopenedFrom)}</div>` : ``}
        </div>
        <div style="text-align:right;">
          <div><strong>Total:</strong> ${formatReceiptCurrency(r.total, r)}</div>
          <div class="hint">Subtotal: ${formatReceiptCurrency(r.subtotal, r)} • Discount: ${formatReceiptCurrency(r.discount?.amount || 0, r)}</div>
        </div>
      </div>

      <hr style="margin:10px 0;" />

      <div>
        <strong>Items</strong>
        <ul style="margin:6px 0 0; padding-left:18px;">${linesHtml}</ul>
      </div>

      <div style="margin-top:10px;">
        <strong>Payments</strong>
        <ul style="margin:6px 0 0; padding-left:18px;">${paysHtml}</ul>
      </div>

      <div class="receipt-actions">
        <button class="secondary" id="viewPrintBtn">Print</button>
        <button class="primary" id="reopenToSelectedBtn">Reopen to Selected Table</button>
      </div>
      <p class="hint" style="margin-top:8px;">
        Reopen loads the receipt items back into the currently selected table. You can edit and submit again to create a new receipt.
      </p>
    </div>
  `;

  document.getElementById("viewPrintBtn").addEventListener("click", () => {
    renderReceiptFromObject(r, "RECEIPT COPY");
    setTimeout(() => window.print(), 250);
  });

  document.getElementById("reopenToSelectedBtn").addEventListener("click", () => {
    if (!selectedTable) {
      alert("Select a table first on the POS, then reopen.");
      return;
    }
    const table = getTable(selectedTable);
    if (!table) return;

    table.order = JSON.parse(JSON.stringify(r.lines || []));
    table.status = "open";
    table.discount = {
      type: r.discount?.type || "none",
      value: Number(r.discount?.value || 0),
    };
    table.payments = [];
    table.reopenedFrom = r.ref;

    // keep customer info when reopening receipt
    table.customerName = r.customerName || "";
    table.customerPhone = r.customerPhone || "";
    table.reservationId = null;

    saveTablesNow();
    closeReceiptsModal();
    selectTable(selectedTable);
    alert(`Receipt ${r.ref} reopened on Table ${selectedTable}. You can edit and submit to create a new receipt.`);
  });
}

receiptSearch.addEventListener("input", () => {
  const k = norm(receiptSearch.value);

  const filtered = (receipts || []).filter((r) =>
    norm(r.ref).includes(k) ||
    norm(r.table).includes(k) ||
    norm(r.customerName).includes(k) ||
    norm(r.customerPhone).includes(k) ||
    norm(new Date(r.createdAt).toLocaleString()).includes(k)
  );

  renderReceiptsList(filtered);
});

// ---------- Customer inputs binding ----------
if (posCustomerPhoneEl) {
  posCustomerPhoneEl.addEventListener("input", () => {
    autofillPosNameByPhone(posCustomerPhoneEl.value);
    if (!selectedTable) return;
    const table = getTable(selectedTable);
    table.customerPhone = String(posCustomerPhoneEl.value || "").trim();
    saveTablesNow();
  });
}
if (posCustomerNameEl) {
  posCustomerNameEl.addEventListener("input", () => {
    if (!selectedTable) return;
    const table = getTable(selectedTable);
    table.customerName = String(posCustomerNameEl.value || "").trim();
    saveTablesNow();
  });
}

// ---------- Navigation ----------
document.getElementById("dashboardBtn").onclick = () => (window.location.href = "dashboard.html");
document.getElementById("stockBtn").onclick = () => (window.location.href = "stock.html");
document.getElementById("customersBtn").onclick = () => (window.location.href = "customers.html");
document.getElementById("reservationsBtn").onclick = () => (window.location.href = "reservations.html");
document.getElementById("logoutBtn").onclick = () => (window.location.href = "login.html");

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  syncSettingsBar();
  syncHeaderMeta();
  updateSettingsPreview();

  const settingsBtn = document.getElementById("settingsBtn");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const settingsCancelBtn = document.getElementById("settingsCancelBtn");
  const settingsSaveBtn = document.getElementById("settingsSaveBtn");
  const settingsModal = document.getElementById("posSettingsModal");

  if (settingsBtn) settingsBtn.addEventListener("click", openSettingsModal);
  if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettingsModal);
  if (settingsCancelBtn) settingsCancelBtn.addEventListener("click", closeSettingsModal);
  if (settingsSaveBtn) settingsSaveBtn.addEventListener("click", saveSettingsFromModal);
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }

  ["currencyMode", "usdLbpRate", "vatRate"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateSettingsPreview);
    if (el) el.addEventListener("change", updateSettingsPreview);
  });

  const customItemCurrencyEl = document.getElementById("customItemCurrency");
  if (customItemCurrencyEl) {
    updateCustomItemCurrencyDefault();
    customItemCurrencyEl.addEventListener("change", handleCustomItemCurrencyChange);
  }


  if (menuSearchEl) {
    menuSearchEl.addEventListener("input", () => loadMenuItems(currentCategory || "All"));
  }

  syncDishesAndStock();

  // Try backend first; fallback to local defaults if API fails
  Promise.all([
    refreshDishesFromBackend(),
    refreshStockItemsFromSupabase()
  ])
    .then(() => {
      syncDishesAndStock();
      currentCategory = "All";
      loadCategories();
    })
    .catch((e) => {
      console.warn("Backend products failed, using local menu:", e.message);
      ensureDefaultDishes();
      syncDishesAndStock();
      loadCategories();
    });
  ensureTables();
  loadPosCustomersDatalist();
  renderTables();
  loadCategories();

  // Support both: handoff object + URL params (your reservations.js uses both)
  const handoff = safeParse(localStorage.getItem(POS_HANDOFF_KEY), null);

  const params = new URLSearchParams(window.location.search);
  const qTable = params.get("table");
  const qPhone = params.get("phone");
  const qName = params.get("name");
  const qRes = params.get("res");

  const targetTable = (handoff && handoff.table) ? String(handoff.table) : (qTable ? String(qTable) : null);

  if (targetTable) {
    selectTable(targetTable);

    const table = tables[String(targetTable)];
    if (table) {
      const phone = (handoff && handoff.phone) ? handoff.phone : (qPhone || "");
      const name = (handoff && handoff.name) ? handoff.name : (qName || "");
      const resId = (handoff && handoff.reservationId) ? handoff.reservationId : (qRes || null);

      if (phone) table.customerPhone = phone;
      if (name) table.customerName = name;
      if (resId) table.reservationId = resId;

      saveTablesNow();

      const lib = CustomersLibSafe();
      if (table.customerPhone) lib.ensureCustomer(table.customerPhone, table.customerName || "");
      loadPosCustomersDatalist();
    }

    localStorage.removeItem(POS_HANDOFF_KEY);
  }
});
// === API TEST (temporary) ===


document.getElementById("testApiBtn")?.addEventListener("click", async () => {
  try {
    const { res, json } = await requestJsonWithAuth(`${API_BASE}/products`, { method: "GET" });
    document.getElementById("testApiOut").textContent =
      `status: ${res.status}\n` + JSON.stringify(json, null, 2);
  } catch (e) {
    document.getElementById("testApiOut").textContent = "ERR: " + e.message;
  }
});
