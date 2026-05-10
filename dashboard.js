// dashboard.js
// Professional POS Business Dashboard
// Database safety:
// - This dashboard never sends POST, PUT, PATCH, or DELETE to your backend.
// - It keeps Supabase/auth scripts connected when present.
// - It only attempts read-only GET requests for products/sales when available.
// - Fixed costs and dashboard display currency are stored locally; USD/LBP rate is read from POS settings when available.

(() => {
  const API_BASE = "https://pos-backend-m2yf.onrender.com";
  const $ = (id) => document.getElementById(id);

  const dom = {
    rangePreset: $("rangePreset"), customRange: $("customRange"), startDate: $("startDate"), endDate: $("endDate"), applyRangeBtn: $("applyRangeBtn"),
    dashboardCurrency: $("dashboardCurrency"), refreshDashboardBtn: $("refreshDashboardBtn"), fixedCostsBtn: $("fixedCostsBtn"), exportBtn: $("exportBtn"), exportMode: $("exportMode"),
    itemSearch: $("itemSearch"), stockSeverityFilter: $("stockSeverityFilter"), dashboardMessage: $("dashboardMessage"), rangeLabel: $("rangeLabel"), alertsList: $("alertsList"),
    kpiRevenue: $("kpiRevenue"), kpiOrders: $("kpiOrders"), kpiAov: $("kpiAov"), kpiDiscounts: $("kpiDiscounts"), kpiCogs: $("kpiCogs"), kpiCogsNote: $("kpiCogsNote"),
    kpiGrossProfit: $("kpiGrossProfit"), kpiGrossMargin: $("kpiGrossMargin"), kpiFixedCosts: $("kpiFixedCosts"), kpiMonthlyRunRate: $("kpiMonthlyRunRate"), kpiNetProfit: $("kpiNetProfit"), kpiNetMargin: $("kpiNetMargin"),
    kpiRevenueNote: $("kpiRevenueNote"), kpiOrdersNote: $("kpiOrdersNote"), kpiAovNote: $("kpiAovNote"), kpiLowStock: $("kpiLowStock"), kpiLowStockNote: $("kpiLowStockNote"),
    paidReceipts: $("paidReceipts"), activeTables: $("activeTables"), unpaidTables: $("unpaidTables"),
    breakEven: $("breakEven"), breakEvenRemaining: $("breakEvenRemaining"), projectedMonthlyRevenue: $("projectedMonthlyRevenue"), projectedMonthlyNetProfit: $("projectedMonthlyNetProfit"),
    topIngredient: $("topIngredient"), topDiscountItem: $("topDiscountItem"), bestPaymentMethod: $("bestPaymentMethod"), bestSalesHour: $("bestSalesHour"),
    openTablesBody: $("openTablesBody"), receiptsTableBody: $("receiptsTableBody"), itemsTableBody: $("itemsTableBody"), missingCostBody: $("missingCostBody"), paymentsTableBody: $("paymentsTableBody"),
    closingTotalSales: $("closingTotalSales"), closingCashUsd: $("closingCashUsd"), closingCashLbp: $("closingCashLbp"), closingCard: $("closingCard"), closingDiscounts: $("closingDiscounts"), closingOpenBalance: $("closingOpenBalance"),
    stockValueCost: $("stockValueCost"), stockValueSale: $("stockValueSale"), stockPotentialProfit: $("stockPotentialProfit"), stockOutCount: $("stockOutCount"), lowStockList: $("lowStockList"), stockTableBody: $("stockTableBody"),
    costsRangeCard: $("costsRangeCard"), costsMonthlyCard: $("costsMonthlyCard"), costsYearlyCard: $("costsYearlyCard"), costsRevenuePct: $("costsRevenuePct"), costsTablePreviewBody: $("costsTablePreviewBody"), openCostsFromTab: $("openCostsFromTab"),
    customerCount: $("customerCount"), customersInRange: $("customersInRange"), returningCustomers: $("returningCustomers"), reservationsToday: $("reservationsToday"), reservationsNoShow: $("reservationsNoShow"), avgPartySize: $("avgPartySize"), customersTableBody: $("customersTableBody"), reservationsTableBody: $("reservationsTableBody"),
    exportFullBtn: $("exportFullBtn"), exportSalesBtn: $("exportSalesBtn"), exportStockBtn: $("exportStockBtn"), exportCostsBtn: $("exportCostsBtn"), exportClosingBtn: $("exportClosingBtn"), exportSheetsBody: $("exportSheetsBody"),
    costsDialog: $("costsDialog"), costsCloseBtn: $("costsCloseBtn"), costsBody: $("costsBody"), costsRangeLabel: $("costsRangeLabel"), costsTotalRange: $("costsTotalRange"), costsMonthlyRunRate: $("costsMonthlyRunRate"), addCostBtn: $("addCostBtn"),
    costFormDialog: $("costFormDialog"), costFormTitle: $("costFormTitle"), costFormCloseBtn: $("costFormCloseBtn"), costFormCancelBtn: $("costFormCancelBtn"), costFormSaveBtn: $("costFormSaveBtn"),
    costName: $("costName"), costGroup: $("costGroup"), costAmount: $("costAmount"), costFreq: $("costFreq"), costStart: $("costStart"), costEnd: $("costEnd"), costEnabled: $("costEnabled"), costNotes: $("costNotes"),
  };

  const canvas = {
    revenue: $("revenueChart"), payments: $("paymentsChart"), topItems: $("topItemsChart"), hourly: $("hourlyChart"), profit: $("profitChart"), category: $("categoryChart"), discount: $("discountChart"), heatmap: $("heatmapChart"),
    topProfitItems: $("topProfitItemsChart"), lowMargin: $("lowMarginChart"), costGroup: $("costGroupChart"), costRunRate: $("costRunRateChart"),
  };

  let charts = {};
  let fixedCosts = loadFixedCosts();
  let editingCostId = null;
  let range = getRangeFromPreset("today");
  let latestModel = null;
  let backendProducts = [];
  let backendReceipts = [];
  let backendSaleItems = [];
  let backendInventoryItems = [];
  let backendInventoryStock = [];
  let dashboardSettings = loadDashboardSettings();

  function safeNum(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  function titleCase(s) { return String(s || "other").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }
  function escapeHtml(str) { return String(str || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  function safeJsonArray(raw) { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }
  function safeJsonObject(raw) { try { const v = JSON.parse(raw || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } }
  function cryptoId(prefix = "id") { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
  function parseAnyDate(input) { if (!input) return null; if (input instanceof Date && !Number.isNaN(input.getTime())) return input; const d = new Date(input); if (!Number.isNaN(d.getTime())) return d; const t = Date.parse(input); return Number.isNaN(t) ? null : new Date(t); }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
  function toISODate(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; }
  function toTimeLabel(d) { const x = parseAnyDate(d); if (!x) return ""; return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; }
  function daysBetweenInclusive(a, b) { const s = startOfDay(a).getTime(); const e = startOfDay(b).getTime(); return Math.round((e - s) / 86400000) + 1; }
  function eachDateKey(start, end) { const keys = []; const cur = startOfDay(start); const last = startOfDay(end); while (cur <= last) { keys.push(toISODate(cur)); cur.setDate(cur.getDate() + 1); } return keys; }
  function monthDays(year, monthIndex0) { return new Date(year, monthIndex0 + 1, 0).getDate(); }
  function isOverlap(aStart, aEnd, bStart, bEnd) { return aStart <= bEnd && bStart <= aEnd; }
  function overlapRange(aStart, aEnd, bStart, bEnd) { if (!isOverlap(aStart, aEnd, bStart, bEnd)) return null; return { start: aStart > bStart ? aStart : bStart, end: aEnd < bEnd ? aEnd : bEnd }; }
  function pct(n) { return `${safeNum(n).toFixed(1)}%`; }
  function usdToLbp(n) { return safeNum(n) * safeNum(dashboardSettings.usdToLbpRate || 89500); }
  function displayAmount(n) { return dashboardSettings.currency === "LBP" ? `${Math.round(usdToLbp(n)).toLocaleString()} LBP` : `$${safeNum(n).toFixed(2)}`; }
  function displayUsdAndLbp(n) { return `$${safeNum(n).toFixed(2)} / ${Math.round(usdToLbp(n)).toLocaleString()} LBP`; }

  function loadDashboardSettings() {
    const fallback = { currency: "USD", usdToLbpRate: 89500 };

    // Display currency is dashboard-specific, but the USD -> LBP rate is shared with index.html POS Settings.
    // This keeps one source of truth for the rate and avoids dashboard/POS mismatches.
    const dashboardObj = safeJsonObject(localStorage.getItem("dashboardSettings"));
    const dashboardCurrency = String(localStorage.getItem("dashboardCurrency") || dashboardObj.currency || "").toUpperCase();

    const posObj = safeJsonObject(localStorage.getItem("posSettings"));
    const posCurrency = String(posObj.currency || "").toUpperCase();
    const posRate = safeNum(posObj.usdToLbp ?? posObj.usdToLbpRate ?? posObj.usd_lbp_rate ?? posObj.exchangeRate ?? posObj.rate);

    const legacyRate = safeNum(localStorage.getItem("usdToLbpRate") || localStorage.getItem("usd_lbp_rate") || localStorage.getItem("exchangeRate"));
    const rate = posRate > 0 ? posRate : (legacyRate > 0 ? legacyRate : fallback.usdToLbpRate);

    const currency = dashboardCurrency === "LBP"
      ? "LBP"
      : dashboardCurrency === "USD"
        ? "USD"
        : posCurrency === "LBP"
          ? "LBP"
          : fallback.currency;

    return { currency, usdToLbpRate: rate };
  }

  function saveDashboardSettings() {
    // Save only dashboard display preference. The exchange rate belongs to POS Settings on index.html.
    const payload = { currency: dashboardSettings.currency };
    localStorage.setItem("dashboardSettings", JSON.stringify(payload));
    localStorage.setItem("dashboardCurrency", dashboardSettings.currency);
  }

  function getRangeFromPreset(preset) {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    if (preset === "today") return { start: todayStart, end: todayEnd, label: "Today" };
    if (preset === "yesterday") { const y = new Date(todayStart); y.setDate(y.getDate() - 1); return { start: startOfDay(y), end: endOfDay(y), label: "Yesterday" }; }
    if (preset === "last7") { const s = new Date(todayStart); s.setDate(s.getDate() - 6); return { start: startOfDay(s), end: todayEnd, label: "Last 7 Days" }; }
    if (preset === "last30") { const s = new Date(todayStart); s.setDate(s.getDate() - 29); return { start: startOfDay(s), end: todayEnd, label: "Last 30 Days" }; }
    if (preset === "mtd") { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { start: startOfDay(s), end: todayEnd, label: "Month to Date" }; }
    if (preset === "ytd") { const s = new Date(now.getFullYear(), 0, 1); return { start: startOfDay(s), end: todayEnd, label: "Year to Date" }; }
    if (preset === "all") return { start: startOfDay(new Date(2000, 0, 1)), end: todayEnd, label: "All Time" };
    return { start: todayStart, end: todayEnd, label: "Custom" };
  }

  function syncCustomInputsWithRange() { if (dom.startDate) dom.startDate.value = toISODate(range.start); if (dom.endDate) dom.endDate.value = toISODate(range.end); }
  function setCustomVisibility() { if (dom.customRange && dom.rangePreset) dom.customRange.classList.toggle("hidden", dom.rangePreset.value !== "custom"); }
  function setMessage(message, type = "info") { if (!dom.dashboardMessage) return; if (!message) { dom.dashboardMessage.classList.add("hidden"); dom.dashboardMessage.textContent = ""; return; } dom.dashboardMessage.textContent = message; dom.dashboardMessage.className = `dashboard-message ${type}`; }
  function setText(el, value) { if (el) el.textContent = value; }

  async function ensureAccessTokenReadOnly() {
    if (window.ACCESS_TOKEN) return window.ACCESS_TOKEN;
    if (!window.sb || !window.sb.auth) return null;
    const { data } = await window.sb.auth.getSession();
    const token = data?.session?.access_token || null;
    if (token) window.ACCESS_TOKEN = token;
    return token;
  }

  async function fetchReadOnly(path) {
    const token = await ensureAccessTokenReadOnly();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}${path}`, { method: "GET", headers });
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return await res.json();
  }

  async function refreshBackendCaches() {
    const token = await ensureAccessTokenReadOnly();
    if (!window.sb) throw new Error("Supabase client not found.");

    const [
      productsRes,
      salesRes,
      saleItemsRes,
      inventoryItemsRes,
      inventoryStockRes
    ] = await Promise.all([
      window.sb.from("products").select("*"),
      window.sb.from("sales").select("*"),
      window.sb.from("sale_items").select("*"),
      window.sb.from("inventory_items").select("*"),
      window.sb.from("inventory_stock").select("*")
    ]);

    if (productsRes.error) throw productsRes.error;
    if (salesRes.error) throw salesRes.error;
    if (saleItemsRes.error) throw saleItemsRes.error;
    if (inventoryItemsRes.error) throw inventoryItemsRes.error;
    if (inventoryStockRes.error) throw inventoryStockRes.error;

    backendProducts = Array.isArray(productsRes.data) ? productsRes.data : [];
    backendSaleItems = Array.isArray(saleItemsRes.data) ? saleItemsRes.data : [];
    backendInventoryItems = Array.isArray(inventoryItemsRes.data) ? inventoryItemsRes.data : [];
    backendInventoryStock = Array.isArray(inventoryStockRes.data) ? inventoryStockRes.data : [];

    backendReceipts = normalizeSupabaseSales(
      Array.isArray(salesRes.data) ? salesRes.data : [],
      backendSaleItems
    );
  }

  function normalizeSupabaseSales(salesRows, saleItemRows) {
    const itemsBySaleId = new Map();

    for (const row of saleItemRows || []) {
      const saleId = String(row.sale_id ?? row.sales_id ?? row.receipt_id ?? "");
      if (!saleId) continue;
      if (!itemsBySaleId.has(saleId)) itemsBySaleId.set(saleId, []);
      itemsBySaleId.get(saleId).push(row);
    }

    return (salesRows || []).map((sale) => {
      const saleId = String(sale.id ?? sale.sale_id ?? "");
      const linkedItems = itemsBySaleId.get(saleId) || [];

      const lines = linkedItems.map((line, idx) => {
        const qty = safeNum(line.qty ?? line.quantity ?? 0);
        const unitPrice = safeNum(line.unit_price ?? line.price ?? 0);
        const total = safeNum(line.line_total ?? line.total ?? qty * unitPrice);
        const discount = safeNum(line.discount ?? 0);
        const cogs = safeNum(line.cogs ?? 0);

        return {
          line_id: line.id ?? `${saleId}_${idx}`,
          type: "dish",
          product_id: line.product_id ?? "",
          sku: line.sku || "",
          item_name: line.product_name || line.name || line.item_name || "Item",
          category: line.category || "Uncategorized",
          qty,
          unit_price: unitPrice,
          line_revenue_before_discount: total,
          line_discount: discount,
          line_revenue: total - discount,
          line_cogs: cogs,
          cogs_source: cogs > 0 ? "sale_item" : "missing",
          line_profit: (total - discount) - cogs,
          removed_ingredients: "",
          note: ""
        };
      });

      const subtotalFromLines = lines.reduce((a, l) => a + safeNum(l.line_revenue_before_discount), 0);
      const totalFromLines = lines.reduce((a, l) => a + safeNum(l.line_revenue), 0);
      const cogsFromLines = lines.reduce((a, l) => a + safeNum(l.line_cogs), 0);

      const subtotal = safeNum(sale.subtotal ?? subtotalFromLines);
      const discountTotal = safeNum(sale.discount_total ?? sale.discount ?? 0);
      const total = safeNum(sale.total ?? totalFromLines);
      const paid = safeNum(sale.paid ?? sale.amount_paid ?? total);
      const balance = safeNum(sale.balance ?? Math.max(0, total - paid));
      const cogs = safeNum(sale.cogs ?? cogsFromLines);

      return {
        id: String(sale.id ?? cryptoId("receipt")),
        ref: String(sale.reference || sale.ref || sale.id || "").trim(),
        createdAt: sale.created_at || sale.date || new Date().toISOString(),
        date: toISODate(parseAnyDate(sale.created_at || sale.date || new Date()) || new Date()),
        time: toTimeLabel(sale.created_at || sale.date || new Date()),
        table: sale.table_number || sale.table || "",
        customerName: sale.customer_name || "",
        customerPhone: sale.customer_phone || "",
        status: String(sale.status || "paid").toLowerCase(),
        subtotal,
        discountTotal,
        total,
        paid,
        balance,
        cogs,
        grossProfit: total - cogs,
        payments: [
          {
            method: String(sale.payment_method || "other").toLowerCase(),
            currency: String(sale.payment_currency || "USD").toUpperCase(),
            amount_usd: String(sale.payment_currency || "USD").toUpperCase() === "LBP"
              ? safeNum(paid) / safeNum(dashboardSettings.usdToLbpRate || 89500)
              : safeNum(paid),
            amount_lbp: String(sale.payment_currency || "USD").toUpperCase() === "LBP"
              ? safeNum(paid)
              : usdToLbp(safeNum(paid)),
            original_amount: safeNum(paid)
          }
        ],
        lines,
        reopenedFrom: "",
        source: "supabase"
      };
    });
  }

  function normalizeBackendSales(data) {
    const raw = Array.isArray(data) ? data : Array.isArray(data?.sales) ? data.sales : Array.isArray(data?.items) ? data.items : [];
    return raw.map(sale => normalizeReceipt({ ...sale, ref: sale.ref || sale.reference || sale.id, createdAt: sale.createdAt || sale.created_at || sale.date || sale.timestamp, lines: sale.lines || sale.items || sale.sale_items || sale.order_lines || [], payments: sale.payments || [] }, "backend")).filter(r => r.ref);
  }

  function readNumericField(obj, keys) { if (!obj || typeof obj !== "object") return null; for (const key of keys) { if (Object.prototype.hasOwnProperty.call(obj, key)) { const n = Number(obj[key]); if (Number.isFinite(n)) return n; } } return null; }
  function readStringField(obj, keys) { if (!obj || typeof obj !== "object") return ""; for (const key of keys) { if (Object.prototype.hasOwnProperty.call(obj, key) && String(obj[key] ?? "").trim()) return String(obj[key]).trim(); } return ""; }
  function getCostFromObject(obj) { const keys = ["cost", "costPrice", "cost_price", "purchasePrice", "purchase_price", "buyPrice", "buy_price", "buyingPrice", "buying_price", "unitCost", "unit_cost", "averageCost", "average_cost", "avgCost", "avg_cost", "supplierCost", "supplier_cost", "baseCost", "base_cost"]; const direct = readNumericField(obj, keys); if (direct !== null && direct > 0) return direct; for (const nested of [obj?.stock, obj?.inventory, obj?.stockItem, obj?.stock_item, obj?.product]) { const n = readNumericField(nested, keys); if (n !== null && n > 0) return n; } return 0; }
  function getPriceFromObject(obj) { const keys = ["price", "sellingPrice", "selling_price", "salePrice", "sale_price", "unitPrice", "unit_price"]; const direct = readNumericField(obj, keys); return direct !== null ? direct : 0; }
  function getBackendStockQty(product) { const direct = readNumericField(product, ["quantity", "qty", "stock", "stock_qty", "stockQty", "stock_quantity", "stockQuantity", "current_stock", "currentStock", "available_stock", "availableStock", "on_hand", "onHand"]); if (direct !== null) return direct; for (const nested of [product?.stock, product?.inventory, product?.stockItem, product?.stock_item]) { const n = readNumericField(nested, ["quantity", "qty", "stock", "current_stock", "available_stock", "on_hand"]); if (n !== null) return n; } return null; }
  function getBackendUnit(product) { return readStringField(product, ["unit", "stock_unit", "stockUnit", "uom"]) || readStringField(product?.stock, ["unit", "stock_unit", "stockUnit", "uom"]) || "pcs"; }
  function getBackendCategory(product) { return readStringField(product, ["category", "category_name", "group", "type"]) || "Uncategorized"; }

  function loadDishes() {
    const dishes = safeJsonArray(localStorage.getItem("dishes"));
    const byProductId = new Map(); const byName = new Map();
    for (const d of dishes) { if (d?.product_id != null) byProductId.set(String(d.product_id), d); if (d?.name) byName.set(norm(d.name), d); }
    return { list: dishes, byProductId, byName };
  }

  function buildProductIndex() {
    const byId = new Map(), byName = new Map(), bySku = new Map();
    const localDishes = loadDishes().list;
    const all = [
      ...backendProducts.map(p => ({ raw: p, source: "backend" })),
      ...localDishes.map(d => ({ raw: d, source: "local_dishes" })),
      ...safeJsonArray(localStorage.getItem("stockItems")).map(s => ({ raw: s, source: "local_stock" })),
    ];
    for (const row of all) {
      const p = row.raw || {};
      const normalized = {
        id: p.id ?? p.product_id ?? p.productId ?? "",
        sku: p.sku || p.code || "",
        name: p.name || p.product_name || p.item_name || "Product",
        category: getBackendCategory(p),
        quantity: getBackendStockQty(p) ?? safeNum(p.quantity ?? p.qty ?? 0),
        unit: getBackendUnit(p) || p.unit || "pcs",
        cost: getCostFromObject(p),
        price: getPriceFromObject(p),
        source: row.source,
        raw: p,
      };
      if (normalized.id !== "") byId.set(String(normalized.id), normalized);
      if (normalized.sku) bySku.set(norm(normalized.sku), normalized);
      if (normalized.name) byName.set(norm(normalized.name), normalized);
    }
    return { byId, byName, bySku };
  }

  function normalizeReceipt(r, source = "local") {
    const createdAt = r.createdAt || r.created_at || r.timestampISO || r.timestamp || r.date || new Date().toISOString();
    const rawLines = Array.isArray(r.lines) ? r.lines : Array.isArray(r.items) ? r.items : Array.isArray(r.order) ? r.order : [];
    const normalizedLines = rawLines.map((line, idx) => normalizeLine(line, idx)).filter(line => line.item_name);
    const subtotalFromLines = normalizedLines.reduce((acc, line) => acc + safeNum(line.line_revenue_before_discount), 0);
    let discountTotal = 0;
    if (r.discount && typeof r.discount === "object") discountTotal = safeNum(r.discount.amount ?? r.discount.value ?? 0);
    else discountTotal = safeNum(r.discountTotal ?? r.discount_total ?? r.discount ?? 0);
    const lineDiscounts = normalizedLines.reduce((acc, line) => acc + safeNum(line.line_discount), 0);
    if (!discountTotal && lineDiscounts) discountTotal = lineDiscounts;
    const subtotal = safeNum(r.subtotal ?? r.sub_total ?? subtotalFromLines);
    const total = safeNum(r.total ?? r.total_amount ?? Math.max(0, subtotal - discountTotal));
    const payments = normalizePayments(r, total);
    const paid = safeNum(r.paid ?? r.paidTotal ?? r.paid_total ?? payments.reduce((a, p) => a + safeNum(p.amount_usd), 0));
    const balance = safeNum(r.balance ?? Math.max(0, total - paid));
    const cogs = safeNum(r.cogs ?? r.cost_of_goods ?? r.total_cogs ?? normalizedLines.reduce((a, line) => a + safeNum(line.line_cogs), 0));
    return {
      id: String(r.id || r.receipt_id || r.ref || r.reference || cryptoId("receipt")),
      ref: String(r.ref || r.reference || r.order_ref || r.id || "REF").trim(),
      createdAt,
      date: toISODate(parseAnyDate(createdAt) || new Date()),
      time: toTimeLabel(createdAt),
      table: r.table ?? r.tableNumber ?? r.table_number ?? "",
      customerName: r.customerName || r.customer_name || r.customer?.name || "",
      customerPhone: r.customerPhone || r.customer_phone || r.customer?.phone || "",
      status: String(r.status || (paid + 0.0001 >= total ? "paid" : "open")).toLowerCase(),
      subtotal,
      discountTotal,
      total,
      paid,
      balance,
      cogs,
      grossProfit: total - cogs,
      payments,
      lines: normalizedLines,
      reopenedFrom: r.reopenedFrom || r.reopened_from || "",
      source,
    };
  }

  function normalizeLine(line, idx) {
    const productIndex = buildProductIndex();
    const dishes = loadDishes();
    const productId = line.product_id ?? line.productId ?? line.product?.id ?? "";
    const sku = line.sku || line.product?.sku || "";
    const product = productId !== "" ? productIndex.byId.get(String(productId)) : sku ? productIndex.bySku.get(norm(sku)) : null;
    const name = line.dishName || line.customName || line.name || line.itemName || line.item_name || line.product_name || line.product?.name || product?.name || "";
    const dish = productId !== "" ? dishes.byProductId.get(String(productId)) : dishes.byName.get(norm(name));
    const qty = safeNum(line.qty ?? line.quantity ?? 1);
    const unitPrice = safeNum(line.unitPrice ?? line.unit_price ?? line.price ?? line.product?.price ?? product?.price ?? 0);
    const discount = safeNum(line.discount ?? line.discount_amount ?? 0);
    const beforeDiscount = safeNum(line.lineTotalBeforeDiscount ?? line.line_total_before_discount ?? unitPrice * qty);
    const lineRevenue = safeNum(line.lineTotal ?? line.line_total ?? line.total ?? Math.max(0, beforeDiscount - discount));
    const category = line.category || dish?.category || product?.category || (line.type === "custom" ? "Custom" : "Uncategorized");
    let cogs = safeNum(line.cogs ?? line.line_cogs ?? line.cost_total ?? 0);
    let cogsSource = cogs > 0 ? "receipt_line" : "missing";
    if (!cogs) {
      const approx = approximateLineCogs({ line, dish, product, productIndex, qty, itemName: name, sku });
      cogs = approx.value;
      cogsSource = approx.source;
    }
    return {
      line_id: line.lineId || line.line_id || `${name || "line"}_${idx}`,
      type: line.type || (line.customName ? "custom" : "dish"),
      product_id: productId,
      sku: sku || product?.sku || "",
      item_name: name,
      category,
      qty,
      unit_price: unitPrice,
      line_revenue_before_discount: beforeDiscount,
      line_discount: discount,
      line_revenue: lineRevenue,
      line_cogs: cogs,
      cogs_source: cogsSource,
      line_profit: lineRevenue - cogs,
      removed_ingredients: Array.isArray(line.removedIngredients) ? line.removedIngredients.join(" | ") : "",
      note: line.note || "",
    };
  }

  function approximateLineCogs({ line, dish, product, productIndex, qty, itemName, sku }) {
    const directCost = getCostFromObject(line);
    if (directCost > 0) return { value: directCost * qty, source: "line_unit_cost" };
    if (product && product.cost > 0) return { value: product.cost * qty, source: product.source === "local_stock" ? "stock_product_cost" : "backend_product_cost" };
    const byName = productIndex.byName.get(norm(itemName));
    if (byName && byName.cost > 0) return { value: byName.cost * qty, source: byName.source === "local_stock" ? "stock_name_cost" : "product_name_cost" };
    if (sku) {
      const bySku = productIndex.bySku.get(norm(sku));
      if (bySku && bySku.cost > 0) return { value: bySku.cost * qty, source: "sku_cost" };
    }
    const recipe = approximateRecipeCogs({ line, dish, qty });
    if (recipe > 0) return { value: recipe, source: "recipe_cost" };
    return { value: 0, source: "missing" };
  }

  function approximateRecipeCogs({ line, dish, qty }) {
    if (!dish || !Array.isArray(dish.ingredients) || dish.ingredients.length === 0) return 0;
    const stockItems = safeJsonArray(localStorage.getItem("stockItems"));
    const prepItems = safeJsonArray(localStorage.getItem("prepItems"));
    const stockIndex = new Map(stockItems.map(s => [norm(s.name), s]));
    const prepIndex = new Map(prepItems.map(p => [norm(p.name), p]));
    const removed = new Set(Array.isArray(line.removedIngredients) ? line.removedIngredients.map(norm) : []);
    let total = 0;
    for (const ing of dish.ingredients) {
      const ingName = norm(ing.name);
      if (!ingName || removed.has(ingName)) continue;
      const usedQty = safeNum(ing.qty) * qty;
      const ingUnit = norm(ing.unit);
      if (prepIndex.has(ingName)) {
        const p = prepIndex.get(ingName);
        total += usedQty * getCostFromObject(p);
        continue;
      }
      const stock = stockIndex.get(ingName);
      if (!stock) continue;
      const stockUnit = norm(stock.unit);
      total += convertQty(usedQty, ingUnit, stockUnit) * getCostFromObject(stock);
    }
    return total;
  }

  function convertQty(qty, fromUnit, toUnit) {
    const f = norm(fromUnit), t = norm(toUnit), q = safeNum(qty);
    if (!f || !t || f === t) return q;
    if (f === "g" && t === "kg") return q / 1000;
    if (f === "kg" && t === "g") return q * 1000;
    if (f === "ml" && t === "l") return q / 1000;
    if (f === "l" && t === "ml") return q * 1000;
    return q;
  }

  function normalizePayments(r, total) {
    const rawPayments = Array.isArray(r.payments) ? r.payments : [];
    if (!rawPayments.length) {
      const method = String(r.paymentType || r.payment || r.method || "other").toLowerCase() || "other";
      return safeNum(r.paid ?? total) > 0 ? [{ method, currency: "USD", amount_usd: safeNum(r.paid ?? total), amount_lbp: usdToLbp(safeNum(r.paid ?? total)), original_amount: safeNum(r.paid ?? total) }] : [];
    }
    return rawPayments.map(p => {
      const method = String(p.method || p.payment_method || p.type || "other").toLowerCase();
      const currency = String(p.currency || p.paidCurrency || p.paymentCurrency || "USD").toUpperCase() === "LBP" ? "LBP" : "USD";
      const amountUsdExplicit = readNumericField(p, ["amount_usd", "amountUsd", "usdAmount", "amountInUsd", "amountUSD"]);
      const amountLbpExplicit = readNumericField(p, ["amount_lbp", "amountLbp", "lbpAmount", "amountInLbp", "amountLBP"]);
      const entered = readNumericField(p, ["enteredAmount", "amountOriginal", "originalAmount", "paidAmount", "amount"]);
      let amountUsd = 0;
      let amountLbp = 0;
      if (amountUsdExplicit !== null) {
        amountUsd = amountUsdExplicit;
        amountLbp = amountLbpExplicit !== null ? amountLbpExplicit : usdToLbp(amountUsd);
      } else if (amountLbpExplicit !== null) {
        amountLbp = amountLbpExplicit;
        amountUsd = amountLbp / safeNum(dashboardSettings.usdToLbpRate || 89500);
      } else if (currency === "LBP" && p.amountOriginal != null) {
        amountLbp = safeNum(p.amountOriginal);
        amountUsd = amountLbp / safeNum(dashboardSettings.usdToLbpRate || 89500);
      } else {
        amountUsd = safeNum(entered);
        amountLbp = usdToLbp(amountUsd);
      }
      return { method, currency, amount_usd: amountUsd, amount_lbp: amountLbp, original_amount: entered ?? amountUsd };
    });
  }

  function loadReceipts() {
    const localReceipts = safeJsonArray(localStorage.getItem("receipts")).map(r => normalizeReceipt(r, "local"));
    const fallbackHistory = localReceipts.length ? [] : safeJsonArray(localStorage.getItem("salesHistory")).map(h => normalizeReceipt({ ref: h.ref || h.reference, createdAt: h.timestampISO || h.date, table: h.table, total: h.total, paid: h.total, status: "paid", items: h.items || [] }, "salesHistory"));
    const combined = [...localReceipts, ...fallbackHistory, ...backendReceipts];
    const seen = new Set(), deduped = [];
    for (const r of combined) {
      const key = `${r.ref}_${r.createdAt}_${safeNum(r.total).toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    return deduped;
  }

  function receiptDateInRange(receipt) { const d = parseAnyDate(receipt.createdAt); return !!d && d >= startOfDay(range.start) && d <= endOfDay(range.end); }
  function isRevenueIncluded(receipt) { return receipt.status !== "voided" && receipt.status !== "cancelled"; }

  function buildAggregates(receipts) {
    const aggs = {
      revenue: 0, orders: 0, discounts: 0, cogs: 0, paidReceipts: 0,
      itemQty: new Map(), itemRevenue: new Map(), itemCogs: new Map(), itemProfit: new Map(), itemDiscount: new Map(), itemCategory: new Map(), itemMissingCost: new Map(), itemCogsSource: new Map(),
      paymentAmount: new Map(), paymentBreakdown: new Map(), categoryRevenue: new Map(), hourlyRevenue: new Array(24).fill(0), hourlyOrders: new Array(24).fill(0), weekdayHour: Array.from({ length: 7 }, () => new Array(24).fill(0)),
    };
    for (const r of receipts) {
      if (!isRevenueIncluded(r)) continue;
      const date = parseAnyDate(r.createdAt);
      const total = safeNum(r.total);
      aggs.revenue += total;
      aggs.orders += 1;
      aggs.discounts += safeNum(r.discountTotal);
      aggs.cogs += safeNum(r.cogs);
      if (r.status === "paid" || safeNum(r.paid) + 0.0001 >= total) aggs.paidReceipts += 1;
      if (date) { aggs.hourlyRevenue[date.getHours()] += total; aggs.hourlyOrders[date.getHours()] += 1; aggs.weekdayHour[date.getDay()][date.getHours()] += total; }
      for (const p of r.payments || []) {
        const method = p.method || "other";
        aggs.paymentAmount.set(method, (aggs.paymentAmount.get(method) || 0) + safeNum(p.amount_usd));
        const key = `${method}|${p.currency || "USD"}`;
        const old = aggs.paymentBreakdown.get(key) || { method, currency: p.currency || "USD", amount_usd: 0, amount_lbp: 0, count: 0 };
        old.amount_usd += safeNum(p.amount_usd);
        old.amount_lbp += safeNum(p.amount_lbp);
        old.count += 1;
        aggs.paymentBreakdown.set(key, old);
      }
      for (const line of r.lines || []) {
        const item = line.item_name;
        const category = line.category || "Uncategorized";
        const qty = safeNum(line.qty);
        const rev = safeNum(line.line_revenue);
        const cogs = safeNum(line.line_cogs);
        const profit = rev - cogs;
        aggs.itemQty.set(item, (aggs.itemQty.get(item) || 0) + qty);
        aggs.itemRevenue.set(item, (aggs.itemRevenue.get(item) || 0) + rev);
        aggs.itemCogs.set(item, (aggs.itemCogs.get(item) || 0) + cogs);
        aggs.itemProfit.set(item, (aggs.itemProfit.get(item) || 0) + profit);
        aggs.itemDiscount.set(item, (aggs.itemDiscount.get(item) || 0) + safeNum(line.line_discount));
        aggs.itemCategory.set(item, category);
        if (rev > 0 && cogs <= 0 && line.type !== "custom") aggs.itemMissingCost.set(item, (aggs.itemMissingCost.get(item) || 0) + rev);
        if (!aggs.itemCogsSource.has(item) || aggs.itemCogsSource.get(item) === "missing") aggs.itemCogsSource.set(item, line.cogs_source || "missing");
        aggs.categoryRevenue.set(category, (aggs.categoryRevenue.get(category) || 0) + rev);
      }
    }
    return aggs;
  }

  function groupByDay(receipts, fixedCostTotal) {
    const keys = eachDateKey(range.start, range.end);
    const map = new Map(keys.map(k => [k, { revenue: 0, orders: 0, discounts: 0, cogs: 0, grossProfit: 0, fixedCosts: 0, netProfit: 0 }]));
    const totalDays = Math.max(1, keys.length);
    const fixedPerDay = fixedCostTotal / totalDays;
    for (const k of keys) map.get(k).fixedCosts = fixedPerDay;
    for (const r of receipts) {
      if (!isRevenueIncluded(r)) continue;
      const d = parseAnyDate(r.createdAt);
      if (!d) continue;
      const key = toISODate(d);
      if (!map.has(key)) continue;
      const row = map.get(key);
      row.revenue += safeNum(r.total);
      row.orders += 1;
      row.discounts += safeNum(r.discountTotal);
      row.cogs += safeNum(r.cogs);
    }
    for (const row of map.values()) { row.grossProfit = row.revenue - row.cogs; row.netProfit = row.grossProfit - row.fixedCosts; }
    return { labels: keys, rows: keys.map(k => map.get(k)) };
  }

  function loadFixedCosts() {
    const raw = safeJsonArray(localStorage.getItem("fixedCosts"));
    return raw.map(c => ({
      id: c.id || cryptoId("fc"), name: String(c.name || "").trim(), group: String(c.group || "").trim(), amount: safeNum(c.amount), frequency: c.frequency || "monthly", startDate: c.startDate || toISODate(new Date()), endDate: c.endDate || "", enabled: c.enabled !== false, notes: String(c.notes || "").trim(),
    })).filter(c => c.name && c.amount >= 0);
  }
  function saveFixedCosts() { localStorage.setItem("fixedCosts", JSON.stringify(fixedCosts)); }
  function getCostActiveWindow(cost) { const start = parseAnyDate(cost.startDate) ? startOfDay(parseAnyDate(cost.startDate)) : startOfDay(new Date(0)); const end = cost.endDate ? endOfDay(parseAnyDate(cost.endDate) || new Date(8640000000000000)) : endOfDay(new Date(8640000000000000)); return { start, end }; }

  function fixedCostForRange(cost, rangeStart, rangeEnd) {
    if (!cost || cost.enabled === false) return 0;
    const amount = safeNum(cost.amount);
    if (amount <= 0) return 0;
    const rS = startOfDay(rangeStart), rE = endOfDay(rangeEnd);
    const { start: cStart, end: cEnd } = getCostActiveWindow(cost);
    const ov = overlapRange(cStart, cEnd, rS, rE);
    if (!ov) return 0;
    const freq = String(cost.frequency || "monthly").toLowerCase();
    if (freq === "one_time") return cStart >= rS && cStart <= rE ? amount : 0;
    const days = daysBetweenInclusive(ov.start, ov.end);
    if (freq === "daily") return amount * days;
    if (freq === "weekly") return amount * (days / 7);
    if (freq === "yearly") {
      let total = 0;
      let cursor = startOfDay(ov.start);
      while (cursor <= ov.end) {
        const y = cursor.getFullYear();
        const yearEnd = endOfDay(new Date(y, 11, 31));
        const segmentEnd = yearEnd < ov.end ? yearEnd : ov.end;
        const segDays = daysBetweenInclusive(cursor, segmentEnd);
        const daysInYear = Math.round((new Date(y + 1, 0, 1) - new Date(y, 0, 1)) / 86400000);
        total += amount * (segDays / daysInYear);
        cursor = startOfDay(new Date(segmentEnd));
        cursor.setDate(cursor.getDate() + 1);
      }
      return total;
    }
    let total = 0;
    let cursor = startOfDay(ov.start);
    while (cursor <= ov.end) {
      const y = cursor.getFullYear(), m = cursor.getMonth(), daysInMonth = monthDays(y, m);
      const monthEnd = endOfDay(new Date(y, m, daysInMonth));
      const segmentEnd = monthEnd < ov.end ? monthEnd : ov.end;
      const segDays = daysBetweenInclusive(cursor, segmentEnd);
      total += amount * (segDays / daysInMonth);
      cursor = startOfDay(new Date(segmentEnd));
      cursor.setDate(cursor.getDate() + 1);
    }
    return total;
  }

  function fixedCostMonthlyRunRate(cost, rangeStart, rangeEnd) {
    if (!cost || cost.enabled === false) return 0;
    const amount = safeNum(cost.amount);
    if (amount <= 0) return 0;
    const rS = startOfDay(rangeStart), rE = endOfDay(rangeEnd);
    const { start: cStart, end: cEnd } = getCostActiveWindow(cost);
    if (!isOverlap(cStart, cEnd, rS, rE)) return 0;
    const freq = String(cost.frequency || "monthly").toLowerCase();
    if (freq === "daily") return amount * (365 / 12);
    if (freq === "weekly") return amount * (52 / 12);
    if (freq === "yearly") return amount / 12;
    if (freq === "one_time") return 0;
    return amount;
  }

  function fixedCostYearlyRunRate(cost, rangeStart, rangeEnd) {
    return fixedCostMonthlyRunRate(cost, rangeStart, rangeEnd) * 12;
  }
  function totalFixedCostsForRange() { return fixedCosts.reduce((acc, c) => acc + fixedCostForRange(c, range.start, range.end), 0); }
  function totalFixedCostsMonthlyRunRate() { return fixedCosts.reduce((acc, c) => acc + fixedCostMonthlyRunRate(c, range.start, range.end), 0); }
  function totalFixedCostsYearlyRunRate() { return fixedCosts.reduce((acc, c) => acc + fixedCostYearlyRunRate(c, range.start, range.end), 0); }

  function calcTableDiscount(subtotal, discount) { if (!discount) return 0; const type = discount.type || "none"; const val = safeNum(discount.value); if (type === "percent") return subtotal * Math.max(0, Math.min(100, val)) / 100; if (type === "fixed") return Math.min(subtotal, Math.max(0, val)); return 0; }
  function getTablesSnapshot() {
    const tables = safeJsonObject(localStorage.getItem("tables"));
    const rows = [];
    let active = 0, unpaid = 0;
    for (const key of Object.keys(tables)) {
      const t = tables[key] || {};
      const order = Array.isArray(t.order) ? t.order : [];
      const subtotal = order.reduce((acc, line) => acc + safeNum(line.unitPrice ?? line.price) * safeNum(line.qty ?? 1), 0);
      const discount = calcTableDiscount(subtotal, t.discount);
      const total = safeNum(t.total || Math.max(0, subtotal - discount));
      const paid = Array.isArray(t.payments) ? t.payments.reduce((acc, p) => acc + safeNum(p.amount_usd ?? p.amount), 0) : 0;
      const balance = Math.max(0, total - paid);
      if (order.length > 0) active += 1;
      if (order.length > 0 && balance > 0.0001) unpaid += 1;
      if (order.length > 0 || String(t.status || "").toLowerCase() !== "empty") rows.push({ table: key, status: t.status || "open", items: order.reduce((a, l) => a + safeNum(l.qty || 1), 0), total, paid, balance });
    }
    return { rows, active, unpaid };
  }

  function thresholdForUnit(unit) { const u = norm(unit); if (["pcs", "piece", "pieces"].includes(u)) return 5; if (u === "kg") return 1; if (u === "g") return 500; if (u === "l") return 1; if (u === "ml") return 500; return 5; }

  function getStockSignals() {
    const productIndex = buildProductIndex();
    const rowsMap = new Map();
    for (const p of productIndex.byName.values()) {
      if (!p.name) continue;
      rowsMap.set(norm(p.name), {
        name: p.name,
        sku: p.sku,
        category: p.category,
        qty: safeNum(p.quantity),
        unit: p.unit || "pcs",
        cost: safeNum(p.cost),
        price: safeNum(p.price),
      });
    }
    const rows = Array.from(rowsMap.values()).map(item => {
      const threshold = thresholdForUnit(item.unit);
      const qty = safeNum(item.qty);
      const severity = qty <= 0 ? "out" : qty <= threshold * 0.35 ? "critical" : qty <= threshold ? "low" : "ok";
      const valueCost = qty * safeNum(item.cost);
      const valueSale = qty * safeNum(item.price);
      return { ...item, qty, threshold, severity, low: severity !== "ok", valueCost, valueSale, potentialProfit: valueSale - valueCost };
    }).sort((a, b) => {
      const order = { out: 0, critical: 1, low: 2, ok: 3 };
      return order[a.severity] - order[b.severity] || a.qty - b.qty;
    });
    return rows;
  }

  function loadCustomers() { return safeJsonArray(localStorage.getItem("customers")); }
  function loadReservations() { return safeJsonArray(localStorage.getItem("reservations")); }

  function buildCustomerReservationAnalytics(receiptsInRange) {
    const customers = loadCustomers();
    const customerMap = new Map();
    for (const r of receiptsInRange) {
      const phone = String(r.customerPhone || "").trim();
      const name = String(r.customerName || "").trim();
      if (!phone && !name) continue;
      const key = phone || name;
      const row = customerMap.get(key) || { name, phone, receipts: 0, spend: 0 };
      if (!row.name && name) row.name = name;
      if (!row.phone && phone) row.phone = phone;
      row.receipts += 1;
      row.spend += safeNum(r.total);
      customerMap.set(key, row);
    }
    const todayKey = toISODate(new Date());
    const reservations = loadReservations();
    const reservationsInRange = reservations.filter(r => {
      const d = parseAnyDate(r.dateTimeISO || r.date || r.createdAtISO || r.createdAt);
      return d && d >= startOfDay(range.start) && d <= endOfDay(range.end);
    });
    const reservationsToday = reservations.filter(r => {
      const d = parseAnyDate(r.dateTimeISO || r.date || r.createdAtISO || r.createdAt);
      const status = String(r.status || "booked").toLowerCase();
      return d && toISODate(d) === todayKey && !["cancelled", "completed", "no_show"].includes(status);
    });
    const noShows = reservationsInRange.filter(r => String(r.status || "").toLowerCase() === "no_show").length;
    const partyRows = reservationsInRange.filter(r => safeNum(r.party || r.guests || r.people) > 0);
    const avgParty = partyRows.length ? partyRows.reduce((a, r) => a + safeNum(r.party || r.guests || r.people), 0) / partyRows.length : 0;
    return { customers, customerRows: Array.from(customerMap.values()).sort((a, b) => b.spend - a.spend), reservationsInRange, reservationsToday, noShows, avgParty, returning: Array.from(customerMap.values()).filter(c => c.receipts > 1).length };
  }

  function calcAvgItemsPerOrder(receipts) { let totalItems = 0, orders = 0; for (const r of receipts) { if (!isRevenueIncluded(r)) continue; orders += 1; totalItems += (r.lines || []).reduce((a, l) => a + safeNum(l.qty), 0); } return orders ? totalItems / orders : 0; }

  function buildModel() {
    fixedCosts = loadFixedCosts();
    const receipts = loadReceipts();
    const receiptsInRange = receipts.filter(receiptDateInRange);
    const aggs = buildAggregates(receiptsInRange);
    const fixedCostsRange = totalFixedCostsForRange();
    const fixedCostsMonthlyRunRate = totalFixedCostsMonthlyRunRate();
    const fixedCostsYearlyRunRate = totalFixedCostsYearlyRunRate();
    const grossProfit = aggs.revenue - aggs.cogs;
    const netProfit = grossProfit - fixedCostsRange;
    const grossMargin = aggs.revenue ? (grossProfit / aggs.revenue) * 100 : 0;
    const netMargin = aggs.revenue ? (netProfit / aggs.revenue) * 100 : 0;
    const daily = groupByDay(receiptsInRange, fixedCostsRange);
    const stockRows = getStockSignals();
    const itemRows = Array.from(aggs.itemQty.keys()).map(item => {
      const revenue = aggs.itemRevenue.get(item) || 0;
      const cogs = aggs.itemCogs.get(item) || 0;
      const profit = aggs.itemProfit.get(item) || 0;
      const qty = aggs.itemQty.get(item) || 0;
      return { item_name: item, category: aggs.itemCategory.get(item) || "Uncategorized", qty, revenue, cogs, profit, margin: revenue ? (profit / revenue) * 100 : 0, discount: aggs.itemDiscount.get(item) || 0, missingCost: revenue > 0 && cogs <= 0 && (aggs.itemMissingCost.get(item) || 0) > 0, cogsSource: aggs.itemCogsSource.get(item) || "missing" };
    }).sort((a, b) => b.revenue - a.revenue);
    const tables = getTablesSnapshot();
    const customerAnalytics = buildCustomerReservationAnalytics(receiptsInRange);
    const closing = buildClosingReport(receiptsInRange, tables, aggs);
    const forecast = buildForecast({ aggs, grossMargin, fixedCostsMonthlyRunRate });
    return { receipts, receiptsInRange, aggs, fixedCostsRange, fixedCostsMonthlyRunRate, fixedCostsYearlyRunRate, grossProfit, netProfit, grossMargin, netMargin, daily, stockRows, itemRows, tables, customerAnalytics, closing, forecast };
  }

  function buildClosingReport(receiptsInRange, tables, aggs) {
    const paymentBreakdown = Array.from(aggs.paymentBreakdown.values()).sort((a, b) => b.amount_usd - a.amount_usd);
    const cashUsd = paymentBreakdown.filter(p => p.method === "cash" && p.currency === "USD").reduce((a, p) => a + p.amount_usd, 0);
    const cashLbp = paymentBreakdown.filter(p => p.method === "cash" && p.currency === "LBP").reduce((a, p) => a + p.amount_lbp, 0);
    const card = paymentBreakdown.filter(p => p.method === "card").reduce((a, p) => a + p.amount_usd, 0);
    const openBalance = tables.rows.reduce((a, t) => a + safeNum(t.balance), 0);
    return { paymentBreakdown, cashUsd, cashLbp, card, openBalance, receipts: receiptsInRange.length };
  }

  function buildForecast({ aggs, grossMargin, fixedCostsMonthlyRunRate }) {
    const now = new Date();
    const daysInMonth = monthDays(now.getFullYear(), now.getMonth());
    const today = now.getDate();
    const selectedDays = Math.max(1, daysBetweenInclusive(range.start, range.end));
    const revenuePerDay = aggs.revenue / selectedDays;
    const projectedMonthlyRevenue = revenuePerDay * daysInMonth;
    const projectedMonthlyGross = projectedMonthlyRevenue * (grossMargin / 100);
    const projectedMonthlyNet = projectedMonthlyGross - fixedCostsMonthlyRunRate;
    return { daysInMonth, elapsedDays: today, selectedDays, projectedMonthlyRevenue, projectedMonthlyNet };
  }

  function chartOptions({ legend = false, stacked = false, currency = true } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: legend, position: "bottom", labels: { boxWidth: 10, padding: 10 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label || ctx.label}: ${typeof ctx.raw === "number" && currency ? displayAmount(ctx.raw) : ctx.raw}` } },
      },
      scales: {
        x: { stacked, ticks: { maxRotation: 0, autoSkip: true } },
        y: { stacked, beginAtZero: true, ticks: { callback: (v) => currency ? compactMoney(v) : v } },
      },
    };
  }
  function compactMoney(n) { const v = dashboardSettings.currency === "LBP" ? usdToLbp(n) : safeNum(n); if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(1)}M`; if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}K`; return dashboardSettings.currency === "LBP" ? String(Math.round(v)) : `$${safeNum(n).toFixed(0)}`; }
  function destroyCharts() { for (const ch of Object.values(charts)) { if (ch && typeof ch.destroy === "function") ch.destroy(); } charts = {}; }

  function renderCharts(model) {
    destroyCharts();
    if (!window.Chart) return;
    const daily = model.daily;
    const topQty = model.itemRows.slice().sort((a, b) => b.qty - a.qty).slice(0, 8);
    const topProfit = model.itemRows.slice().sort((a, b) => b.profit - a.profit).slice(0, 8);
    const lowMargin = model.itemRows.filter(r => r.revenue > 0).slice().sort((a, b) => a.margin - b.margin).slice(0, 8);
    const categories = Array.from(model.aggs.categoryRevenue.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const payments = Array.from(model.aggs.paymentAmount.entries()).sort((a, b) => b[1] - a[1]);

    if (canvas.revenue) charts.revenue = new Chart(canvas.revenue, { type: "line", data: { labels: daily.labels, datasets: [{ label: "Revenue", data: daily.rows.map(r => r.revenue), tension: 0.3 }, { label: "Gross Profit", data: daily.rows.map(r => r.grossProfit), tension: 0.3 }, { label: "Net Profit", data: daily.rows.map(r => r.netProfit), tension: 0.3 }] }, options: chartOptions({ legend: true }) });
    if (canvas.payments) charts.payments = new Chart(canvas.payments, { type: "doughnut", data: { labels: payments.map(p => titleCase(p[0])), datasets: [{ data: payments.map(p => p[1]) }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${displayAmount(ctx.raw)}` } } } } });
    if (canvas.topItems) charts.topItems = new Chart(canvas.topItems, { type: "bar", data: { labels: topQty.map(r => r.item_name), datasets: [{ label: "Qty", data: topQty.map(r => r.qty) }] }, options: { ...chartOptions({ currency: false }), indexAxis: "y" } });
    if (canvas.hourly) charts.hourly = new Chart(canvas.hourly, { type: "bar", data: { labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`), datasets: [{ label: "Revenue", data: model.aggs.hourlyRevenue }] }, options: chartOptions() });
    if (canvas.profit) charts.profit = new Chart(canvas.profit, { type: "bar", data: { labels: daily.labels, datasets: [{ label: "Revenue", data: daily.rows.map(r => r.revenue) }, { label: "COGS", data: daily.rows.map(r => r.cogs) }] }, options: chartOptions({ legend: true }) });
    if (canvas.category) charts.category = new Chart(canvas.category, { type: "doughnut", data: { labels: categories.map(c => c[0]), datasets: [{ data: categories.map(c => c[1]) }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${displayAmount(ctx.raw)}` } } } } });
    if (canvas.discount) charts.discount = new Chart(canvas.discount, { type: "line", data: { labels: daily.labels, datasets: [{ label: "Discounts", data: daily.rows.map(r => r.discounts), tension: 0.3 }] }, options: chartOptions() });
    if (canvas.heatmap) charts.heatmap = new Chart(canvas.heatmap, { type: "bar", data: { labels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], datasets: Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, data: model.aggs.weekdayHour.map(day => day[hour]), stack: "hours" })) }, options: { ...chartOptions({ stacked: true, legend: false }), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${displayAmount(ctx.raw)}` } } } } });
    if (canvas.topProfitItems) charts.topProfitItems = new Chart(canvas.topProfitItems, { type: "bar", data: { labels: topProfit.map(r => r.item_name), datasets: [{ label: "Profit", data: topProfit.map(r => r.profit) }] }, options: { ...chartOptions(), indexAxis: "y" } });
    if (canvas.lowMargin) charts.lowMargin = new Chart(canvas.lowMargin, { type: "bar", data: { labels: lowMargin.map(r => r.item_name), datasets: [{ label: "Margin %", data: lowMargin.map(r => r.margin) }] }, options: { ...chartOptions({ currency: false }), indexAxis: "y" } });

    const costGroup = groupFixedCostsBy("range");
    if (canvas.costGroup) charts.costGroup = new Chart(canvas.costGroup, { type: "doughnut", data: { labels: costGroup.map(x => x.group), datasets: [{ data: costGroup.map(x => x.amount) }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${displayAmount(ctx.raw)}` } } } } });
    const costRunRate = groupFixedCostsBy("monthly");
    if (canvas.costRunRate) charts.costRunRate = new Chart(canvas.costRunRate, { type: "bar", data: { labels: costRunRate.map(x => x.group), datasets: [{ label: "Monthly", data: costRunRate.map(x => x.amount) }] }, options: chartOptions() });
  }

  function groupFixedCostsBy(type) {
    const map = new Map();
    for (const c of fixedCosts) {
      const group = c.group || "Other";
      const amount = type === "monthly" ? fixedCostMonthlyRunRate(c, range.start, range.end) : fixedCostForRange(c, range.start, range.end);
      map.set(group, (map.get(group) || 0) + amount);
    }
    return Array.from(map.entries()).map(([group, amount]) => ({ group, amount })).filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
  }

  function renderKPIs(model) {
    setText(dom.kpiRevenue, displayAmount(model.aggs.revenue));
    setText(dom.kpiOrders, String(model.aggs.orders));
    setText(dom.kpiAov, displayAmount(model.aggs.orders ? model.aggs.revenue / model.aggs.orders : 0));
    setText(dom.kpiDiscounts, displayAmount(model.aggs.discounts));
    setText(dom.kpiCogs, displayAmount(model.aggs.cogs));
    setText(dom.kpiGrossProfit, displayAmount(model.grossProfit));
    setText(dom.kpiFixedCosts, displayAmount(model.fixedCostsRange));
    setText(dom.kpiMonthlyRunRate, displayAmount(model.fixedCostsMonthlyRunRate));
    setText(dom.kpiNetProfit, displayAmount(model.netProfit));
    setText(dom.kpiGrossMargin, `Margin: ${model.aggs.revenue ? pct(model.grossMargin) : "—"}`);
    setText(dom.kpiNetMargin, `Net margin: ${model.aggs.revenue ? pct(model.netMargin) : "—"}`);
    setText(dom.kpiRevenueNote, `${toISODate(range.start)} to ${toISODate(range.end)}`);
    setText(dom.kpiOrdersNote, model.aggs.orders ? `Avg items/order: ${calcAvgItemsPerOrder(model.receiptsInRange).toFixed(2)}` : "No orders in range");
    setText(dom.kpiAovNote, model.aggs.orders ? `${model.aggs.paidReceipts} paid receipts` : "—");
    setText(dom.paidReceipts, String(model.aggs.paidReceipts));
    setText(dom.activeTables, String(model.tables.active));
    setText(dom.unpaidTables, String(model.tables.unpaid));
    const lowCount = model.stockRows.filter(s => s.low).length;
    const criticalCount = model.stockRows.filter(s => s.severity === "critical" || s.severity === "out").length;
    setText(dom.kpiLowStock, String(lowCount));
    setText(dom.kpiLowStockNote, criticalCount ? `${criticalCount} critical/out` : "No critical items");
    const missingCostCount = model.itemRows.filter(r => r.missingCost).length;
    setText(dom.kpiCogsNote, missingCostCount ? `${missingCostCount} sold items missing cost data` : "Cost data found where available");
    const breakEven = model.grossMargin > 0 ? model.fixedCostsRange / (model.grossMargin / 100) : 0;
    setText(dom.breakEven, breakEven ? displayAmount(breakEven) : "—");
    setText(dom.breakEvenRemaining, breakEven ? displayAmount(Math.max(0, breakEven - model.aggs.revenue)) : "—");
    setText(dom.projectedMonthlyRevenue, displayAmount(model.forecast.projectedMonthlyRevenue));
    setText(dom.projectedMonthlyNetProfit, displayAmount(model.forecast.projectedMonthlyNet));
    const topQty = model.itemRows.slice().sort((a, b) => b.qty - a.qty)[0];
    const topDiscount = model.itemRows.slice().sort((a, b) => b.discount - a.discount)[0];
    const bestPayment = Array.from(model.aggs.paymentAmount.entries()).sort((a, b) => b[1] - a[1])[0];
    const bestHourIdx = model.aggs.hourlyRevenue.indexOf(Math.max(...model.aggs.hourlyRevenue));
    setText(dom.topIngredient, topQty ? `${topQty.item_name} (${topQty.qty.toFixed(0)})` : "—");
    setText(dom.topDiscountItem, topDiscount && topDiscount.discount > 0 ? `${topDiscount.item_name} (${displayAmount(topDiscount.discount)})` : "—");
    setText(dom.bestPaymentMethod, bestPayment ? `${titleCase(bestPayment[0])} (${displayAmount(bestPayment[1])})` : "—");
    setText(dom.bestSalesHour, model.aggs.hourlyRevenue[bestHourIdx] > 0 ? `${String(bestHourIdx).padStart(2, "0")}:00` : "—");
    setText(dom.costsRangeCard, displayAmount(model.fixedCostsRange));
    setText(dom.costsMonthlyCard, displayAmount(model.fixedCostsMonthlyRunRate));
    setText(dom.costsYearlyCard, displayAmount(model.fixedCostsYearlyRunRate));
    setText(dom.costsRevenuePct, model.aggs.revenue ? pct((model.fixedCostsRange / model.aggs.revenue) * 100) : "—");
    dom.closingTotalSales && (dom.closingTotalSales.textContent = displayAmount(model.aggs.revenue));
    dom.closingCashUsd && (dom.closingCashUsd.textContent = `$${model.closing.cashUsd.toFixed(2)}`);
    dom.closingCashLbp && (dom.closingCashLbp.textContent = `${Math.round(model.closing.cashLbp || usdToLbp(model.closing.cashUsd)).toLocaleString()} LBP`);
    dom.closingCard && (dom.closingCard.textContent = displayAmount(model.closing.card));
    dom.closingDiscounts && (dom.closingDiscounts.textContent = displayAmount(model.aggs.discounts));
    dom.closingOpenBalance && (dom.closingOpenBalance.textContent = displayAmount(model.closing.openBalance));
    const stockCost = model.stockRows.reduce((a, s) => a + safeNum(s.valueCost), 0);
    const stockSale = model.stockRows.reduce((a, s) => a + safeNum(s.valueSale), 0);
    setText(dom.stockValueCost, displayAmount(stockCost));
    setText(dom.stockValueSale, displayAmount(stockSale));
    setText(dom.stockPotentialProfit, displayAmount(stockSale - stockCost));
    setText(dom.stockOutCount, String(model.stockRows.filter(s => s.severity === "out").length));
    setText(dom.customerCount, String(model.customerAnalytics.customers.length));
    setText(dom.customersInRange, String(model.customerAnalytics.customerRows.length));
    setText(dom.returningCustomers, String(model.customerAnalytics.returning));
    setText(dom.reservationsToday, String(model.customerAnalytics.reservationsToday.length));
    setText(dom.reservationsNoShow, String(model.customerAnalytics.noShows));
    setText(dom.avgPartySize, model.customerAnalytics.avgParty ? model.customerAnalytics.avgParty.toFixed(1) : "—");
  }

  function renderAlerts(model) {
    if (!dom.alertsList) return;
    const alerts = [];
    const missingCostCount = model.itemRows.filter(r => r.missingCost).length;
    const criticalStock = model.stockRows.filter(s => s.severity === "critical" || s.severity === "out").length;
    if (missingCostCount) alerts.push({ type: "danger", title: `${missingCostCount} sold items missing cost`, text: "COGS and profit are incomplete until these costs are fixed.", tab: "items" });
    if (criticalStock) alerts.push({ type: "danger", title: `${criticalStock} critical/out-of-stock items`, text: "Review stock before service continues.", tab: "stock" });
    if (model.tables.unpaid) alerts.push({ type: "warning", title: `${model.tables.unpaid} unpaid open tables`, text: "Cashier closing will not be final until open balances are handled.", tab: "payments" });
    if (model.netProfit < 0 && model.aggs.revenue > 0) alerts.push({ type: "warning", title: "Net profit is negative", text: "Fixed costs or COGS exceed gross profit in this range.", tab: "costs" });
    const dueSoon = model.customerAnalytics.reservationsToday.length;
    if (dueSoon) alerts.push({ type: "good", title: `${dueSoon} upcoming reservations today`, text: "Prepare reserved tables and staffing.", tab: "customers" });
    if (!alerts.length) alerts.push({ type: "good", title: "No urgent dashboard warnings", text: "Sales, stock, and costs look clean for the current data.", tab: "overview" });
    dom.alertsList.innerHTML = alerts.map(a => `<div class="alert-item ${a.type}" data-target-tab="${a.tab}"><span class="alert-dot"></span><div><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.text)}</span></div></div>`).join("");
    dom.alertsList.querySelectorAll("[data-target-tab]").forEach(el => el.addEventListener("click", () => switchTab(el.dataset.targetTab)));
  }

  function renderOpenTables(model) {
    if (!dom.openTablesBody) return;
    if (!model.tables.rows.length) { dom.openTablesBody.innerHTML = `<tr><td colspan="6" class="muted">No open tables.</td></tr>`; return; }
    dom.openTablesBody.innerHTML = model.tables.rows.map(r => `<tr><td>Table ${escapeHtml(r.table)}</td><td><span class="badge ${r.balance > 0 ? "warn" : "good"}">${escapeHtml(r.status)}</span></td><td>${r.items}</td><td>${displayAmount(r.total)}</td><td>${displayAmount(r.paid)}</td><td>${displayAmount(r.balance)}</td></tr>`).join("");
  }

  function renderReceiptTable(model) {
    if (!dom.receiptsTableBody) return;
    const rows = model.receiptsInRange.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 250);
    if (!rows.length) { dom.receiptsTableBody.innerHTML = `<tr><td colspan="10" class="muted">No receipts in selected range.</td></tr>`; return; }
    dom.receiptsTableBody.innerHTML = rows.map(r => `<tr><td>${escapeHtml(r.date)} ${escapeHtml(r.time)}</td><td>${escapeHtml(r.ref)}</td><td>${escapeHtml(r.table)}</td><td>${escapeHtml(r.customerName || r.customerPhone || "-")}</td><td><span class="badge ${r.balance > 0 ? "warn" : "good"}">${escapeHtml(r.status)}</span></td><td>${displayAmount(r.total)}</td><td>${displayAmount(r.cogs)}</td><td class="${r.grossProfit >= 0 ? "positive" : "negative"}">${displayAmount(r.grossProfit)}</td><td>${displayAmount(r.paid)}</td><td>${displayAmount(r.balance)}</td></tr>`).join("");
  }

  function renderItemTable(model) {
    if (!dom.itemsTableBody) return;
    const q = norm(dom.itemSearch?.value || "");
    const rows = model.itemRows.filter(r => !q || norm(`${r.item_name} ${r.category}`).includes(q)).slice(0, 250);
    if (!rows.length) { dom.itemsTableBody.innerHTML = `<tr><td colspan="8" class="muted">No item data found.</td></tr>`; return; }
    dom.itemsTableBody.innerHTML = rows.map(r => `<tr><td>${escapeHtml(r.item_name)}</td><td>${escapeHtml(r.category)}</td><td>${r.qty.toFixed(2).replace(/\.00$/, "")}</td><td>${displayAmount(r.revenue)}</td><td>${displayAmount(r.cogs)}</td><td class="${r.profit >= 0 ? "positive" : "negative"}">${displayAmount(r.profit)}</td><td>${r.revenue ? pct(r.margin) : "—"}</td><td>${r.missingCost ? `<span class="badge danger">Missing</span>` : `<span class="badge good">${escapeHtml(r.cogsSource)}</span>`}</td></tr>`).join("");
  }

  function renderMissingCostTable(model) {
    if (!dom.missingCostBody) return;
    const rows = model.itemRows.filter(r => r.missingCost).sort((a, b) => b.revenue - a.revenue);
    if (!rows.length) { dom.missingCostBody.innerHTML = `<tr><td colspan="4" class="muted">No missing COGS issues found in this range.</td></tr>`; return; }
    dom.missingCostBody.innerHTML = rows.map(r => `<tr><td>${escapeHtml(r.item_name)}</td><td>${displayAmount(r.revenue)}</td><td>${r.qty.toFixed(2).replace(/\.00$/, "")}</td><td>Add/fix product or stock cost.</td></tr>`).join("");
  }

  function renderLowStock(model) {
    if (!dom.lowStockList) return;
    const filter = dom.stockSeverityFilter?.value || "all";
    let rows = model.stockRows;
    if (filter === "critical") rows = rows.filter(s => s.severity === "critical" || s.severity === "out");
    if (filter === "low") rows = rows.filter(s => s.low);
    if (filter === "out") rows = rows.filter(s => s.severity === "out");
    rows = rows.slice(0, 80);
    if (!rows.length) { dom.lowStockList.innerHTML = `<li><div><div class="stock-name">No matching stock alerts</div><div class="stock-meta">Try another filter.</div></div><span class="stock-badge ok">OK</span></li>`; return; }
    dom.lowStockList.innerHTML = rows.map(s => `<li><div><div class="stock-name">${escapeHtml(s.name)}</div><div class="stock-meta">Qty: ${s.qty.toFixed(2).replace(/\.00$/, "")} ${escapeHtml(s.unit)} • Threshold: ${s.threshold} • ${escapeHtml(s.category || "-")}</div></div><span class="stock-badge ${s.severity}">${s.severity.toUpperCase()}</span></li>`).join("");
  }

  function renderStockTable(model) {
    if (!dom.stockTableBody) return;
    const rows = model.stockRows.slice(0, 250);
    if (!rows.length) { dom.stockTableBody.innerHTML = `<tr><td colspan="9" class="muted">No stock data available.</td></tr>`; return; }
    dom.stockTableBody.innerHTML = rows.map(s => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.category || "-")}</td><td>${s.qty.toFixed(2).replace(/\.00$/, "")}</td><td>${escapeHtml(s.unit)}</td><td>${displayAmount(s.cost)}</td><td>${displayAmount(s.price)}</td><td>${displayAmount(s.valueCost)}</td><td>${displayAmount(s.valueSale)}</td><td><span class="badge ${s.severity === "ok" ? "good" : s.severity === "low" ? "warn" : "danger"}">${escapeHtml(s.severity)}</span></td></tr>`).join("");
  }

  function renderPaymentsTable(model) {
    if (!dom.paymentsTableBody) return;
    const rows = model.closing.paymentBreakdown;
    if (!rows.length) { dom.paymentsTableBody.innerHTML = `<tr><td colspan="5" class="muted">No payments in selected range.</td></tr>`; return; }
    dom.paymentsTableBody.innerHTML = rows.map(p => `<tr><td>${titleCase(p.method)}</td><td>${escapeHtml(p.currency)}</td><td>$${p.amount_usd.toFixed(2)}</td><td>${Math.round(p.amount_lbp).toLocaleString()} LBP</td><td>${p.count}</td></tr>`).join("");
  }

  function renderCostsPreview(model) {
    if (!dom.costsTablePreviewBody) return;
    if (!fixedCosts.length) { dom.costsTablePreviewBody.innerHTML = `<tr><td colspan="8" class="muted">No fixed costs yet.</td></tr>`; return; }
    dom.costsTablePreviewBody.innerHTML = fixedCosts.map(c => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.group || "-")}</td><td>${displayAmount(c.amount)}</td><td>${titleCase(c.frequency)}</td><td>${displayAmount(fixedCostForRange(c, range.start, range.end))}</td><td>${displayAmount(fixedCostMonthlyRunRate(c, range.start, range.end))}</td><td>${displayAmount(fixedCostYearlyRunRate(c, range.start, range.end))}</td><td>${c.enabled ? `<span class="badge good">Yes</span>` : `<span class="badge danger">No</span>`}</td></tr>`).join("");
  }

  function renderCustomersReservations(model) {
    if (dom.customersTableBody) {
      const rows = model.customerAnalytics.customerRows.slice(0, 100);
      dom.customersTableBody.innerHTML = rows.length ? rows.map(c => `<tr><td>${escapeHtml(c.name || "-")}</td><td>${escapeHtml(c.phone || "-")}</td><td>${c.receipts}</td><td>${displayAmount(c.spend)}</td></tr>`).join("") : `<tr><td colspan="4" class="muted">No customer data in range.</td></tr>`;
    }
    if (dom.reservationsTableBody) {
      const rows = model.customerAnalytics.reservationsInRange.concat(model.customerAnalytics.reservationsToday).filter((r, i, arr) => arr.findIndex(x => (x.id || x.dateTimeISO) === (r.id || r.dateTimeISO)) === i).slice(0, 100);
      dom.reservationsTableBody.innerHTML = rows.length ? rows.map(r => { const d = parseAnyDate(r.dateTimeISO || r.date || r.createdAtISO || r.createdAt); return `<tr><td>${d ? `${toISODate(d)} ${toTimeLabel(d)}` : "-"}</td><td>${escapeHtml(r.name || r.customerName || "-")}</td><td>${escapeHtml(r.phone || "-")}</td><td>${escapeHtml(r.table || "-")}</td><td>${escapeHtml(r.party || r.guests || "-")}</td><td><span class="badge info">${escapeHtml(r.status || "booked")}</span></td></tr>`; }).join("") : `<tr><td colspan="6" class="muted">No reservations found.</td></tr>`;
    }
  }

  function renderExportSheetsInfo() {
    if (!dom.exportSheetsBody) return;
    const rows = [
      ["summary", "High-level KPIs with USD/LBP values and exchange rate"], ["fact_receipts", "Receipt-level sales facts"], ["fact_order_lines", "Line-level item sales and COGS"], ["fact_payments", "Payment method and currency details"], ["daily_summary", "Date-level revenue, COGS, profit, and fixed costs"], ["dim_items", "Item performance summary"], ["fact_fixed_costs", "Fixed cost definitions and range amounts"], ["dim_stock", "Stock snapshot and valuation"], ["table_snapshot", "Open table balances"], ["customers", "Customer spend summary"], ["reservations", "Reservations snapshot"], ["settings_snapshot", "Currency/rate/date range metadata"]
    ];
    dom.exportSheetsBody.innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("");
  }

  function openCostsDialog() { dom.costsDialog?.showModal(); renderCostsTable(); }
  function closeDialogSafe(dlg) { if (dlg && typeof dlg.close === "function") dlg.close(); }
  function renderCostsTable() {
    if (!dom.costsBody) return;
    dom.costsRangeLabel.textContent = `${toISODate(range.start)} to ${toISODate(range.end)}`;
    dom.costsTotalRange.textContent = displayAmount(totalFixedCostsForRange());
    dom.costsMonthlyRunRate.textContent = displayAmount(totalFixedCostsMonthlyRunRate());
    if (!fixedCosts.length) { dom.costsBody.innerHTML = `<tr><td colspan="12" class="muted">No fixed costs yet.</td></tr>`; return; }
    dom.costsBody.innerHTML = fixedCosts.map(c => `<tr><td><input type="checkbox" data-action="toggle" data-id="${c.id}" ${c.enabled ? "checked" : ""}></td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.group || "-")}</td><td>${displayAmount(c.amount)}</td><td>${titleCase(c.frequency)}</td><td>${escapeHtml(c.startDate)}</td><td>${escapeHtml(c.endDate || "-")}</td><td>${displayAmount(fixedCostForRange(c, range.start, range.end))}</td><td>${displayAmount(fixedCostMonthlyRunRate(c, range.start, range.end))}</td><td>${displayAmount(fixedCostYearlyRunRate(c, range.start, range.end))}</td><td>${escapeHtml(c.notes || "-")}</td><td><button class="btn secondary small" data-action="edit" data-id="${c.id}">Edit</button> <button class="btn secondary small" data-action="delete" data-id="${c.id}">Delete</button></td></tr>`).join("");
    dom.costsBody.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", e => { const id = e.currentTarget.getAttribute("data-id"); const act = e.currentTarget.getAttribute("data-action"); if (act === "edit") openCostFormForEdit(id); if (act === "delete") deleteCost(id); }));
    dom.costsBody.querySelectorAll('input[type="checkbox"][data-action="toggle"]').forEach(cb => cb.addEventListener("change", e => toggleCost(e.currentTarget.getAttribute("data-id"), e.currentTarget.checked)));
  }

  function openCostFormForAdd() {
    editingCostId = null;
    dom.costFormTitle.textContent = "Add Fixed Cost";
    dom.costName.value = ""; dom.costGroup.value = ""; dom.costAmount.value = ""; dom.costFreq.value = "monthly"; dom.costStart.value = toISODate(new Date()); dom.costEnd.value = ""; dom.costEnabled.value = "true"; dom.costNotes.value = "";
    dom.costFormDialog?.showModal();
  }
  function openCostFormForEdit(id) {
    const c = fixedCosts.find(x => x.id === id); if (!c) return;
    editingCostId = id;
    dom.costFormTitle.textContent = "Edit Fixed Cost";
    dom.costName.value = c.name; dom.costGroup.value = c.group || ""; dom.costAmount.value = String(c.amount || 0); dom.costFreq.value = c.frequency || "monthly"; dom.costStart.value = c.startDate || toISODate(new Date()); dom.costEnd.value = c.endDate || ""; dom.costEnabled.value = c.enabled ? "true" : "false"; dom.costNotes.value = c.notes || "";
    dom.costFormDialog?.showModal();
  }
  function upsertCostFromForm() {
    const name = String(dom.costName.value || "").trim();
    const group = String(dom.costGroup.value || "").trim();
    const amount = safeNum(dom.costAmount.value);
    const frequency = String(dom.costFreq.value || "monthly").toLowerCase();
    const startDate = String(dom.costStart.value || "").trim();
    const endDate = String(dom.costEnd.value || "").trim();
    const enabled = String(dom.costEnabled.value) === "true";
    const notes = String(dom.costNotes.value || "").trim();
    if (!name) return alert("Cost name is required.");
    if (!(amount >= 0)) return alert("Enter a valid amount.");
    if (!startDate) return alert("Start date is required.");
    if (endDate && parseAnyDate(endDate) < parseAnyDate(startDate)) return alert("End date must be after start date.");
    const payload = { id: editingCostId || cryptoId("fc"), name, group, amount, frequency, startDate, endDate, enabled, notes };
    if (editingCostId) { const idx = fixedCosts.findIndex(x => x.id === editingCostId); if (idx >= 0) fixedCosts[idx] = payload; } else fixedCosts.push(payload);
    saveFixedCosts();
    closeDialogSafe(dom.costFormDialog);
    renderAll();
    renderCostsTable();
  }
  function deleteCost(id) { const c = fixedCosts.find(x => x.id === id); if (!c) return; if (!confirm(`Delete fixed cost "${c.name}"?`)) return; fixedCosts = fixedCosts.filter(x => x.id !== id); saveFixedCosts(); renderAll(); renderCostsTable(); }
  function toggleCost(id, enabled) { const c = fixedCosts.find(x => x.id === id); if (!c) return; c.enabled = !!enabled; saveFixedCosts(); renderAll(); renderCostsTable(); }

  function addCurrencyColumns(row, keys) {
    const out = { ...row };
    for (const key of keys) {
      const value = safeNum(row[key]);
      out[`${key}_usd`] = value;
      out[`${key}_lbp`] = Math.round(usdToLbp(value));
      delete out[key];
    }
    return out;
  }

  function buildExportTables(model) {
    const moneyKeysSummary = [];
    const summary = [
      { metric: "range_start", value: toISODate(range.start) }, { metric: "range_end", value: toISODate(range.end) }, { metric: "generated_at", value: new Date().toISOString() }, { metric: "display_currency", value: dashboardSettings.currency }, { metric: "usd_lbp_rate", value: dashboardSettings.usdToLbpRate },
      { metric: "revenue_usd", value: model.aggs.revenue }, { metric: "revenue_lbp", value: Math.round(usdToLbp(model.aggs.revenue)) }, { metric: "orders", value: model.aggs.orders }, { metric: "average_order_value_usd", value: model.aggs.orders ? model.aggs.revenue / model.aggs.orders : 0 }, { metric: "average_order_value_lbp", value: Math.round(usdToLbp(model.aggs.orders ? model.aggs.revenue / model.aggs.orders : 0)) },
      { metric: "discounts_usd", value: model.aggs.discounts }, { metric: "discounts_lbp", value: Math.round(usdToLbp(model.aggs.discounts)) }, { metric: "cogs_usd", value: model.aggs.cogs }, { metric: "cogs_lbp", value: Math.round(usdToLbp(model.aggs.cogs)) }, { metric: "gross_profit_usd", value: model.grossProfit }, { metric: "gross_profit_lbp", value: Math.round(usdToLbp(model.grossProfit)) }, { metric: "gross_margin_pct", value: model.grossMargin },
      { metric: "fixed_costs_selected_range_usd", value: model.fixedCostsRange }, { metric: "fixed_costs_selected_range_lbp", value: Math.round(usdToLbp(model.fixedCostsRange)) }, { metric: "fixed_costs_monthly_run_rate_usd", value: model.fixedCostsMonthlyRunRate }, { metric: "fixed_costs_monthly_run_rate_lbp", value: Math.round(usdToLbp(model.fixedCostsMonthlyRunRate)) }, { metric: "net_profit_usd", value: model.netProfit }, { metric: "net_profit_lbp", value: Math.round(usdToLbp(model.netProfit)) }, { metric: "net_margin_pct", value: model.netMargin },
    ];

    const fact_receipts = model.receiptsInRange.map(r => ({ receipt_id: r.id, receipt_ref: r.ref, created_at: new Date(r.createdAt).toISOString(), date: r.date, time: r.time, table_number: r.table, customer_name: r.customerName, customer_phone: r.customerPhone, status: r.status, subtotal_usd: r.subtotal, subtotal_lbp: Math.round(usdToLbp(r.subtotal)), discount_total_usd: r.discountTotal, discount_total_lbp: Math.round(usdToLbp(r.discountTotal)), total_usd: r.total, total_lbp: Math.round(usdToLbp(r.total)), paid_usd: r.paid, paid_lbp: Math.round(usdToLbp(r.paid)), balance_usd: r.balance, balance_lbp: Math.round(usdToLbp(r.balance)), cogs_usd: r.cogs, cogs_lbp: Math.round(usdToLbp(r.cogs)), gross_profit_usd: r.grossProfit, gross_profit_lbp: Math.round(usdToLbp(r.grossProfit)), reopened_from: r.reopenedFrom, source: r.source }));

    const fact_order_lines = [];
    for (const r of model.receiptsInRange) for (const line of r.lines || []) fact_order_lines.push({ receipt_ref: r.ref, receipt_id: r.id, created_at: new Date(r.createdAt).toISOString(), date: r.date, time: r.time, table_number: r.table, line_id: line.line_id, type: line.type, product_id: line.product_id, sku: line.sku, item_name: line.item_name, category: line.category, qty: line.qty, unit_price_usd: line.unit_price, unit_price_lbp: Math.round(usdToLbp(line.unit_price)), line_revenue_before_discount_usd: line.line_revenue_before_discount, line_revenue_before_discount_lbp: Math.round(usdToLbp(line.line_revenue_before_discount)), line_discount_usd: line.line_discount, line_discount_lbp: Math.round(usdToLbp(line.line_discount)), line_revenue_usd: line.line_revenue, line_revenue_lbp: Math.round(usdToLbp(line.line_revenue)), line_cogs_usd: line.line_cogs, line_cogs_lbp: Math.round(usdToLbp(line.line_cogs)), line_profit_usd: line.line_profit, line_profit_lbp: Math.round(usdToLbp(line.line_profit)), cogs_source: line.cogs_source, removed_ingredients: line.removed_ingredients, note: line.note });

    const fact_payments = [];
    for (const r of model.receiptsInRange) for (const p of r.payments || []) fact_payments.push({ receipt_ref: r.ref, receipt_id: r.id, created_at: new Date(r.createdAt).toISOString(), date: r.date, method: p.method, payment_currency: p.currency, amount_usd: p.amount_usd, amount_lbp: Math.round(p.amount_lbp), exchange_rate: dashboardSettings.usdToLbpRate });

    const daily_summary = model.daily.labels.map((date, idx) => { const row = model.daily.rows[idx]; return { date, revenue_usd: row.revenue, revenue_lbp: Math.round(usdToLbp(row.revenue)), orders: row.orders, discounts_usd: row.discounts, discounts_lbp: Math.round(usdToLbp(row.discounts)), cogs_usd: row.cogs, cogs_lbp: Math.round(usdToLbp(row.cogs)), gross_profit_usd: row.grossProfit, gross_profit_lbp: Math.round(usdToLbp(row.grossProfit)), fixed_costs_usd: row.fixedCosts, fixed_costs_lbp: Math.round(usdToLbp(row.fixedCosts)), net_profit_usd: row.netProfit, net_profit_lbp: Math.round(usdToLbp(row.netProfit)), aov_usd: row.orders ? row.revenue / row.orders : 0, aov_lbp: Math.round(usdToLbp(row.orders ? row.revenue / row.orders : 0)) }; });
    const dim_items = model.itemRows.map(r => ({ item_name: r.item_name, category: r.category, total_qty: r.qty, total_revenue_usd: r.revenue, total_revenue_lbp: Math.round(usdToLbp(r.revenue)), total_cogs_usd: r.cogs, total_cogs_lbp: Math.round(usdToLbp(r.cogs)), total_profit_usd: r.profit, total_profit_lbp: Math.round(usdToLbp(r.profit)), margin_pct: r.margin, total_discount_usd: r.discount, total_discount_lbp: Math.round(usdToLbp(r.discount)), missing_cost_flag: r.missingCost ? 1 : 0, cogs_source: r.cogsSource }));
    const fact_fixed_costs = fixedCosts.map(c => ({ fixed_cost_id: c.id, name: c.name, group: c.group, amount_usd: c.amount, amount_lbp: Math.round(usdToLbp(c.amount)), frequency: c.frequency, start_date: c.startDate, end_date: c.endDate, enabled: c.enabled, selected_range_amount_usd: fixedCostForRange(c, range.start, range.end), selected_range_amount_lbp: Math.round(usdToLbp(fixedCostForRange(c, range.start, range.end))), monthly_equivalent_usd: fixedCostMonthlyRunRate(c, range.start, range.end), monthly_equivalent_lbp: Math.round(usdToLbp(fixedCostMonthlyRunRate(c, range.start, range.end))), yearly_equivalent_usd: fixedCostYearlyRunRate(c, range.start, range.end), yearly_equivalent_lbp: Math.round(usdToLbp(fixedCostYearlyRunRate(c, range.start, range.end))), notes: c.notes }));
    const dim_stock = model.stockRows.map(s => ({ item_name: s.name, sku: s.sku, category: s.category, quantity: s.qty, unit: s.unit, cost_usd: s.cost, cost_lbp: Math.round(usdToLbp(s.cost)), price_usd: s.price, price_lbp: Math.round(usdToLbp(s.price)), value_cost_usd: s.valueCost, value_cost_lbp: Math.round(usdToLbp(s.valueCost)), value_sale_usd: s.valueSale, value_sale_lbp: Math.round(usdToLbp(s.valueSale)), potential_profit_usd: s.potentialProfit, potential_profit_lbp: Math.round(usdToLbp(s.potentialProfit)), threshold: s.threshold, severity: s.severity, low_stock_flag: s.low ? 1 : 0 }));
    const table_snapshot = model.tables.rows.map(r => ({ table_number: r.table, status: r.status, items: r.items, total_usd: r.total, total_lbp: Math.round(usdToLbp(r.total)), paid_usd: r.paid, paid_lbp: Math.round(usdToLbp(r.paid)), balance_usd: r.balance, balance_lbp: Math.round(usdToLbp(r.balance)) }));
    const customers = model.customerAnalytics.customerRows.map(c => ({ customer_name: c.name, phone: c.phone, receipts: c.receipts, spend_usd: c.spend, spend_lbp: Math.round(usdToLbp(c.spend)) }));
    const reservations = model.customerAnalytics.reservationsInRange.map(r => ({ reservation_id: r.id || "", datetime: r.dateTimeISO || r.date || "", name: r.name || r.customerName || "", phone: r.phone || "", table_number: r.table || "", party: r.party || r.guests || "", status: r.status || "booked" }));
    const closing_report = model.closing.paymentBreakdown.map(p => ({ method: p.method, currency: p.currency, amount_usd: p.amount_usd, amount_lbp: Math.round(p.amount_lbp), receipt_count: p.count }));
    const settings_snapshot = [{ range_start: toISODate(range.start), range_end: toISODate(range.end), display_currency: dashboardSettings.currency, usd_lbp_rate: dashboardSettings.usdToLbpRate, generated_at: new Date().toISOString(), database_write_behavior: "read_only_dashboard_no_sales_database_writes" }];
    return { summary, fact_receipts, fact_order_lines, fact_payments, daily_summary, dim_items, fact_fixed_costs, dim_stock, table_snapshot, customers, reservations, closing_report, settings_snapshot };
  }

  function exportWorkbook(mode = null) {
    const model = latestModel || buildModel();
    const tables = buildExportTables(model);
    const selectedMode = mode || dom.exportMode?.value || "full";
    const sheetSets = {
      full: Object.keys(tables),
      sales: ["summary", "fact_receipts", "fact_order_lines", "daily_summary", "dim_items", "settings_snapshot"],
      stock: ["dim_stock", "settings_snapshot"],
      costs: ["summary", "fact_fixed_costs", "daily_summary", "settings_snapshot"],
      closing: ["summary", "closing_report", "fact_payments", "table_snapshot", "settings_snapshot"],
    };
    const sheetNames = sheetSets[selectedMode] || sheetSets.full;
    const filename = `pos_${selectedMode}_export_${toISODate(range.start)}_${toISODate(range.end)}.xlsx`;
    if (!window.XLSX) { exportFallbackCsv(tables.fact_order_lines, filename.replace(".xlsx", "_order_lines.csv")); alert("Excel library did not load, so order lines were exported as CSV."); return; }
    const wb = XLSX.utils.book_new();
    for (const sheetName of sheetNames) { const rows = tables[sheetName] || []; const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]); XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); }
    XLSX.writeFile(wb, filename);
  }
  function exportFallbackCsv(rows, filename) { const cols = rows[0] ? Object.keys(rows[0]) : ["empty"]; const csv = [cols.join(",")].concat(rows.map(r => cols.map(c => csvValue(r[c])).join(","))).join("\n"); const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
  function csvValue(value) { const s = String(value ?? ""); return (s.includes(",") || s.includes('"') || s.includes("\n")) ? `"${s.replaceAll('"', '""')}"` : s; }

  function switchTab(name) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === `tab-${name}`));
    setTimeout(() => latestModel && renderCharts(latestModel), 50);
  }

  async function renderAll({ refreshBackend = false } = {}) {
    try {
      setMessage("Loading dashboard...", "info");
      if (refreshBackend) await refreshBackendCaches();
      dashboardSettings = loadDashboardSettings();
      if (dom.dashboardCurrency) dom.dashboardCurrency.value = dashboardSettings.currency;
      latestModel = buildModel();
      if (dom.rangeLabel) dom.rangeLabel.textContent = `${range.label || "Selected Range"}: ${toISODate(range.start)} to ${toISODate(range.end)} • Display: ${dashboardSettings.currency} • POS USD/LBP rate ${Number(dashboardSettings.usdToLbpRate).toLocaleString()}`;
      renderKPIs(latestModel);
      renderAlerts(latestModel);
      renderCharts(latestModel);
      renderOpenTables(latestModel);
      renderReceiptTable(latestModel);
      renderItemTable(latestModel);
      renderMissingCostTable(latestModel);
      renderLowStock(latestModel);
      renderStockTable(latestModel);
      renderPaymentsTable(latestModel);
      renderCostsPreview(latestModel);
      renderCustomersReservations(latestModel);
      renderExportSheetsInfo();
      const missingCostCount = latestModel.itemRows.filter(r => r.missingCost).length;
      if (missingCostCount) setMessage(`${missingCostCount} sold item(s) are missing cost data. COGS/profit are incomplete until product or stock costs are fixed.`, "warning");
      else setMessage("Dashboard loaded. Sales/database data is read-only here; fixed costs are local dashboard settings and USD/LBP rate is read from POS Settings.", "info");
    } catch (err) {
      console.error(err);
      setMessage(err.message || "Dashboard failed to load.", "error");
    }
  }

  function bindEvents() {
    dom.rangePreset?.addEventListener("change", () => { setCustomVisibility(); if (dom.rangePreset.value !== "custom") { range = getRangeFromPreset(dom.rangePreset.value); syncCustomInputsWithRange(); renderAll(); } });
    dom.applyRangeBtn?.addEventListener("click", () => { const s = parseAnyDate(dom.startDate.value); const e = parseAnyDate(dom.endDate.value); if (!s || !e) return alert("Please select a valid start and end date."); if (e < s) return alert("End date must be after start date."); range = { start: startOfDay(s), end: endOfDay(e), label: "Custom" }; renderAll(); });
    dom.dashboardCurrency?.addEventListener("change", () => { dashboardSettings.currency = dom.dashboardCurrency.value === "LBP" ? "LBP" : "USD"; saveDashboardSettings(); renderAll(); });
    dom.refreshDashboardBtn?.addEventListener("click", () => renderAll({ refreshBackend: true }));
    dom.fixedCostsBtn?.addEventListener("click", openCostsDialog);
    dom.openCostsFromTab?.addEventListener("click", openCostsDialog);
    dom.costsCloseBtn?.addEventListener("click", () => closeDialogSafe(dom.costsDialog));
    dom.addCostBtn?.addEventListener("click", openCostFormForAdd);
    dom.costFormCloseBtn?.addEventListener("click", () => closeDialogSafe(dom.costFormDialog));
    dom.costFormCancelBtn?.addEventListener("click", () => closeDialogSafe(dom.costFormDialog));
    dom.costFormSaveBtn?.addEventListener("click", upsertCostFromForm);
    dom.exportBtn?.addEventListener("click", () => exportWorkbook());
    dom.exportFullBtn?.addEventListener("click", () => exportWorkbook("full"));
    dom.exportSalesBtn?.addEventListener("click", () => exportWorkbook("sales"));
    dom.exportStockBtn?.addEventListener("click", () => exportWorkbook("stock"));
    dom.exportCostsBtn?.addEventListener("click", () => exportWorkbook("costs"));
    dom.exportClosingBtn?.addEventListener("click", () => exportWorkbook("closing"));
    dom.itemSearch?.addEventListener("input", () => latestModel && renderItemTable(latestModel));
    dom.stockSeverityFilter?.addEventListener("change", () => latestModel && renderLowStock(latestModel));
    document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
    document.querySelectorAll(".drill-card[data-target-tab]").forEach(card => card.addEventListener("click", () => switchTab(card.dataset.targetTab)));
  }

  async function init() {
    if (dom.rangePreset) dom.rangePreset.value = "today";
    range = getRangeFromPreset("today");
    syncCustomInputsWithRange();
    setCustomVisibility();
    if (dom.dashboardCurrency) dom.dashboardCurrency.value = dashboardSettings.currency;
    bindEvents();
    await renderAll({ refreshBackend: true });
  }

  init();
})();
