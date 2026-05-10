// ===============================
// STOCK MANAGEMENT - PROFESSIONAL FRONTEND UPDATE
// Keeps existing Supabase/backend/database structure intact.
// Uses existing tables: inventory_items, inventory_stock, Suppliers.
// Adds frontend UX: tabs, cards, batch receive, reorder, count, export, alerts.
// ===============================
(() => {
  const STORAGE = {
    restockHistory: "restockHistory",
    wasteHistory: "wasteHistory",
    supplierTemplates: "supplierTemplates_v2",
    prepItems: "prepItems",
    backup: "posStockFrontendBackup_v2"
  };

  const state = {
    items: [],
    suppliers: [],
    rows: [],
    filteredRows: [],
    sortKey: "item",
    sortDir: "asc",
    activeReorderItemId: null,
    activeCountItemId: null,
    activeDetailItemId: null,
    loading: false
  };

  const $ = (id) => document.getElementById(id);
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const qtyFmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const safeNum = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const norm = (s) => String(s || "").trim().toLowerCase();
  const escapeHtml = (s) => String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function safeParse(key, fallback = []) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function showMessage(message, type = "info") {
    const box = $("stockMessage");
    if (!box) return;
    box.textContent = message;
    box.className = `app-message ${type}`;
    window.clearTimeout(showMessage._t);
    showMessage._t = window.setTimeout(() => box.classList.add("hidden"), 4500);
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      btn.dataset.oldText = btn.textContent;
      btn.textContent = label || "Working...";
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.oldText || btn.textContent;
      btn.disabled = false;
    }
  }

  async function ensureAccessToken() {
    if (!window.sb) throw new Error("Supabase client not found");
    const { data, error } = await window.sb.auth.getSession();
    if (error) throw error;
    const token = data?.session?.access_token || null;
    if (!token) throw new Error("Missing access token. Please log in again.");
    window.ACCESS_TOKEN = token;
    return token;
  }

  function lowThresholdForUnit(unit) {
    const u = norm(unit);
    if (u === "pcs") return 5;
    if (u === "kg" || u === "l") return 1;
    if (u === "g" || u === "ml") return 500;
    return 5;
  }

  function getStatus(row) {
    const qty = safeNum(row.quantity);
    if (qty <= 0) return { key: "out", text: "Out of Stock", cls: "status-out", rowClass: "out-of-stock" };
    if (safeNum(row.avgCost) <= 0) return { key: "missingCost", text: "Missing Cost", cls: "status-missing", rowClass: "missing-cost" };
    if (qty <= lowThresholdForUnit(row.baseUnit)) return { key: "low", text: "Low Stock", cls: "status-low", rowClass: "low-stock" };
    return { key: "healthy", text: "Healthy", cls: "status-ok", rowClass: "" };
  }

  async function fetchInventoryData() {
    await ensureAccessToken();

    const { data: items, error: itemsError } = await window.sb
      .from("inventory_items")
      .select("id, name, supplier_id, base_unit, purchase_unit, conversion_to_base, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (itemsError) throw itemsError;

    const { data: stock, error: stockError } = await window.sb
      .from("inventory_stock")
      .select("id, inventory_item_id, quantity, avg_cost, updated_at");
    if (stockError) throw stockError;

    const { data: suppliers, error: suppliersError } = await window.sb
      .from("Suppliers")
      .select("id, name, is_active")
      .order("name", { ascending: true });
    if (suppliersError) throw suppliersError;

    const activeSuppliers = (suppliers || []).filter(s => s.is_active !== false);
    const supplierMap = new Map(activeSuppliers.map(s => [Number(s.id), s.name]));
    const stockMap = new Map((stock || []).map(s => [Number(s.inventory_item_id), s]));

    state.items = (items || []).map(item => ({
      id: Number(item.id),
      name: item.name,
      supplierId: item.supplier_id == null ? null : Number(item.supplier_id),
      supplier: supplierMap.get(Number(item.supplier_id)) || "-",
      baseUnit: item.base_unit || "-",
      purchaseUnit: item.purchase_unit || item.base_unit || "-",
      conversion: Number(item.conversion_to_base || 1) || 1,
      isActive: item.is_active !== false
    }));

    state.suppliers = activeSuppliers.map(s => ({ id: Number(s.id), name: s.name }));

    state.rows = state.items.map(item => {
      const stockRow = stockMap.get(Number(item.id)) || {};
      const quantity = safeNum(stockRow.quantity);
      const avgCost = safeNum(stockRow.avg_cost);
      return {
        ...item,
        stockId: stockRow.id || null,
        quantity,
        avgCost,
        totalValue: quantity * avgCost,
        updatedAt: stockRow.updated_at || ""
      };
    });

    window.currentBackendInventoryRows = state.rows;
    mirrorBackendRowsForPrep();
    populateControls();
    renderAll();
  }

  async function addStockToBackend(itemId, qtyToAdd, costPerPurchaseUnit, meta = {}) {
    await ensureAccessToken();

    const inventoryItemId = Number(itemId);
    const qtyPurchase = Number(qtyToAdd);
    const purchaseCost = Number(costPerPurchaseUnit || 0);

    if (!inventoryItemId || qtyPurchase <= 0) throw new Error("Please select an item and enter a valid quantity.");
    if (!Number.isFinite(purchaseCost) || purchaseCost <= 0) throw new Error("Please enter a valid cost per purchase unit.");

    const { data: itemRow, error: itemErr } = await window.sb
      .from("inventory_items")
      .select("id, name, purchase_unit, base_unit, conversion_to_base")
      .eq("id", inventoryItemId)
      .single();
    if (itemErr) throw itemErr;

    const conversion = Number(itemRow.conversion_to_base || 0);
    if (conversion <= 0) throw new Error(`Invalid conversion value for ${itemRow.name}.`);

    const qtyBase = qtyPurchase * conversion;
    const costPerBaseUnit = purchaseCost / conversion;

    const { data: existingRow, error: fetchErr } = await window.sb
      .from("inventory_stock")
      .select("id, inventory_item_id, quantity, avg_cost")
      .eq("inventory_item_id", inventoryItemId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    if (existingRow) {
      const oldQty = safeNum(existingRow.quantity);
      const oldAvgCost = safeNum(existingRow.avg_cost);
      const newQty = oldQty + qtyBase;
      const oldValue = oldQty * oldAvgCost;
      const addedValue = qtyBase * costPerBaseUnit;
      const newAvgCost = newQty > 0 ? (oldValue + addedValue) / newQty : costPerBaseUnit;

      const { error: updateErr } = await window.sb
        .from("inventory_stock")
        .update({ quantity: newQty, avg_cost: newAvgCost, updated_at: new Date().toISOString() })
        .eq("id", existingRow.id);
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await window.sb
        .from("inventory_stock")
        .insert({ inventory_item_id: inventoryItemId, quantity: qtyBase, avg_cost: costPerBaseUnit, updated_at: new Date().toISOString() });
      if (insertErr) throw insertErr;
    }

    const history = safeParse(STORAGE.restockHistory, []);
    history.push({
      date: new Date().toLocaleString(),
      createdAt: new Date().toISOString(),
      product: itemRow.name,
      itemId: inventoryItemId,
      supplier: meta.supplierName || meta.supplier || "-",
      qty: qtyPurchase,
      purchaseUnit: itemRow.purchase_unit || "-",
      baseQty: qtyBase,
      baseUnit: itemRow.base_unit || "-",
      cost: purchaseCost,
      invoice: meta.invoice || "",
      source: meta.source || "Receive Stock"
    });
    saveJSON(STORAGE.restockHistory, history);
  }

  async function subtractStockFromBackend(itemId, qtyBase, reason, note = "") {
    await ensureAccessToken();
    const inventoryItemId = Number(itemId);
    const qty = Number(qtyBase);
    if (!inventoryItemId || qty <= 0) throw new Error("Please select an item and enter a valid quantity.");

    const { data: stockRow, error: fetchErr } = await window.sb
      .from("inventory_stock")
      .select("id, inventory_item_id, quantity")
      .eq("inventory_item_id", inventoryItemId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!stockRow) throw new Error("This item has no inventory row.");

    const currentQty = safeNum(stockRow.quantity);
    if (qty > currentQty + 1e-9) throw new Error("Cannot remove more than current stock.");
    const newQty = Math.max(0, currentQty - qty);

    const { error: updateErr } = await window.sb
      .from("inventory_stock")
      .update({ quantity: newQty, updated_at: new Date().toISOString() })
      .eq("id", stockRow.id);
    if (updateErr) throw updateErr;

    const item = state.items.find(x => Number(x.id) === inventoryItemId);
    const waste = safeParse(STORAGE.wasteHistory, []);
    waste.push({
      date: new Date().toLocaleString(),
      createdAt: new Date().toISOString(),
      product: item?.name || "Unknown Item",
      itemId: inventoryItemId,
      reason: reason || "Stock removal",
      note,
      qty,
      unit: item?.baseUnit || "-",
      estimatedValue: qty * safeNum(state.rows.find(r => r.id === inventoryItemId)?.avgCost)
    });
    saveJSON(STORAGE.wasteHistory, waste);
  }

  async function fetchSupplierTemplatesFromDb() {
    await ensureAccessToken();

    const { data, error } = await window.sb
      .from("inventory_receive_templates")
      .select("id, name, supplier_id, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function fetchSupplierTemplateLinesFromDb(templateId) {
    await ensureAccessToken();

    const { data, error } = await window.sb
      .from("inventory_receive_template_lines")
      .select("inventory_item_id, purchase_unit, qty_default, cost_default")
      .eq("template_id", templateId);

    if (error) throw error;
    return data || [];
  }

  function populateControls() {
    const supplierOptions = [`<option value="">All suppliers</option>`]
      .concat(state.suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)).join("");
    ["batchSupplier", "supplierFilter"].forEach(id => { if ($(id)) $(id).innerHTML = supplierOptions; });

    const itemOptions = [`<option value="">— Select Item —</option>`]
      .concat(state.items.map(item => `<option value="${item.id}" data-name="${escapeHtml(item.name)}" data-supplier-id="${item.supplierId || ""}" data-purchase-unit="${escapeHtml(item.purchaseUnit)}" data-base-unit="${escapeHtml(item.baseUnit)}" data-conversion="${item.conversion}">${escapeHtml(item.name)}</option>`)).join("");

    if ($("addStockItem")) $("addStockItem").innerHTML = itemOptions;
    if ($("addStockItemList")) {
      $("addStockItemList").innerHTML = state.items.map(item => `<option value="${escapeHtml(item.name)}"></option>`).join("");
    }
    if ($("wasteItem")) $("wasteItem").innerHTML = itemOptions;
    populateTemplateSelect().catch(err => {
      console.error(err);
      showMessage(err.message || "Failed to load templates.", "error");
    });
  }

  function syncQuickAddItem() {
    const input = $("addStockItemInput");
    const select = $("addStockItem");
    const unit = $("addStockPurchaseUnit");
    if (!input || !select) return;
    const typed = norm(input.value);
    const match = state.items.find(item => norm(item.name) === typed);
    select.value = match ? String(match.id) : "";
    if (unit) unit.innerHTML = match ? `<option value="${escapeHtml(match.purchaseUnit)}">${escapeHtml(match.purchaseUnit)}</option>` : `<option value="">— Auto —</option>`;
  }

  function renderAll() {
    renderSummaryCards();
    renderOverview();
    renderInventoryTable();
    renderHistory();
    renderWasteSummary();
  }

  function renderSummaryCards() {
    const totalValue = state.rows.reduce((sum, r) => sum + safeNum(r.totalValue), 0);
    const low = state.rows.filter(r => getStatus(r).key === "low").length;
    const out = state.rows.filter(r => getStatus(r).key === "out").length;
    const missingCost = state.rows.filter(r => safeNum(r.avgCost) <= 0).length;
    const issueCount = low + out + missingCost;
    const health = state.rows.length ? Math.max(0, Math.round(100 - (issueCount / state.rows.length) * 100)) : 100;

    setText("cardTotalValue", money(totalValue));
    setText("cardLowStock", String(low));
    setText("cardOutStock", String(out));
    setText("cardMissingCost", String(missingCost));
    setText("cardHealth", `${health}%`);
    setText("cardHealthNote", issueCount ? `${issueCount} issue(s) to review` : "All clear");
    setText("lowStockCount", String(low));
    setText("totalStockValue", money(totalValue));
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function renderOverview() {
    const alerts = [];
    const out = state.rows.filter(r => getStatus(r).key === "out");
    const low = state.rows.filter(r => getStatus(r).key === "low");
    const missingCost = state.rows.filter(r => safeNum(r.avgCost) <= 0);
    const missingSupplier = state.rows.filter(r => !r.supplier || r.supplier === "-");

    if (out.length) alerts.push({ type: "danger", title: `${out.length} item(s) out of stock`, text: out.slice(0, 5).map(x => x.name).join(", ") });
    if (low.length) alerts.push({ type: "warning", title: `${low.length} item(s) low stock`, text: low.slice(0, 5).map(x => x.name).join(", ") });
    if (missingCost.length) alerts.push({ type: "warning", title: `${missingCost.length} item(s) missing cost`, text: "Fix avg cost to improve COGS and dashboard profit accuracy." });
    if (missingSupplier.length) alerts.push({ type: "warning", title: `${missingSupplier.length} item(s) missing supplier`, text: missingSupplier.slice(0, 5).map(x => x.name).join(", ") });
    if (!alerts.length) alerts.push({ type: "good", title: "Inventory looks healthy", text: "No urgent stock issues found." });

    const alertsEl = $("stockAlerts");
    if (alertsEl) alertsEl.innerHTML = alerts.map(a => `
      <div class="alert-item ${a.type}">
        <div class="alert-main"><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.text)}</small></div>
      </div>
    `).join("");

    const suggestions = state.rows
      .filter(r => ["out", "low"].includes(getStatus(r).key))
      .slice()
      .sort((a, b) => safeNum(a.quantity) - safeNum(b.quantity))
      .slice(0, 8);
    const sugEl = $("reorderSuggestions");
    if (sugEl) {
      sugEl.innerHTML = suggestions.length ? suggestions.map(r => {
        const suggested = suggestedReorderQty(r);
        return `<div class="suggestion-item">
          <div class="suggestion-main"><strong>${escapeHtml(r.name)}</strong><small>${qtyFmt(r.quantity)} ${escapeHtml(r.baseUnit)} in stock • suggest ${qtyFmt(suggested)} ${escapeHtml(r.purchaseUnit)}</small></div>
          <button type="button" class="btn-small btn-reorder" data-reorder-id="${r.id}">Reorder</button>
        </div>`;
      }).join("") : `<div class="alert-item good"><div class="alert-main"><strong>No reorder suggestions</strong><small>All stock levels look acceptable.</small></div></div>`;
      sugEl.querySelectorAll("[data-reorder-id]").forEach(btn => btn.addEventListener("click", () => openReorder(Number(btn.dataset.reorderId))));
    }

    const groups = new Map();
    for (const row of state.rows) {
      const key = row.supplier || "-";
      if (!groups.has(key)) groups.set(key, { value: 0, count: 0, low: 0 });
      const g = groups.get(key);
      g.value += safeNum(row.totalValue);
      g.count += 1;
      if (["low", "out"].includes(getStatus(row).key)) g.low += 1;
    }
    const supplierEl = $("supplierSnapshot");
    if (supplierEl) {
      const cards = Array.from(groups.entries()).sort((a, b) => b[1].value - a[1].value).slice(0, 8);
      supplierEl.innerHTML = cards.length ? cards.map(([name, g]) => `<div class="supplier-card"><strong>${escapeHtml(name)}</strong><small>${g.count} item(s)</small><small>${money(g.value)} stock value</small><small>${g.low} low/out item(s)</small></div>`).join("") : `<p class="hint">No supplier data available.</p>`;
    }
  }

  function suggestedReorderQty(row) {
    const thresholdBase = lowThresholdForUnit(row.baseUnit);
    const targetBase = thresholdBase * 4;
    const neededBase = Math.max(row.conversion || 1, targetBase - safeNum(row.quantity));
    return Math.ceil(neededBase / (row.conversion || 1));
  }

  function renderInventoryTable() {
    const tbody = $("stockTableBody");
    if (!tbody) return;
    const q = norm($("inventorySearch")?.value);
    const supplierId = $("supplierFilter")?.value || "";
    const status = $("statusFilter")?.value || "";
    const lowOnly = !!$("lowStockOnly")?.checked;

    let rows = state.rows.slice();
    if (q) rows = rows.filter(r => norm(r.name).includes(q) || norm(r.supplier).includes(q) || norm(r.baseUnit).includes(q));
    if (supplierId) rows = rows.filter(r => String(r.supplierId || "") === String(supplierId));
    if (status) rows = rows.filter(r => getStatus(r).key === status || (status === "missingCost" && safeNum(r.avgCost) <= 0));
    if (lowOnly) rows = rows.filter(r => ["low", "out"].includes(getStatus(r).key));

    rows.sort((a, b) => {
      const key = state.sortKey;
      const av = typeof a[key] === "number" ? a[key] : String(a[key] || "").toLowerCase();
      const bv = typeof b[key] === "number" ? b[key] : String(b[key] || "").toLowerCase();
      if (av < bv) return state.sortDir === "asc" ? -1 : 1;
      if (av > bv) return state.sortDir === "asc" ? 1 : -1;
      return 0;
    });

    state.filteredRows = rows;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No inventory items found</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const st = getStatus(row);
      return `<tr class="${st.rowClass}">
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td>${escapeHtml(row.supplier)}</td>
        <td>${escapeHtml(row.baseUnit)}</td>
        <td>${qtyFmt(row.quantity)}</td>
        <td>${money(row.avgCost)}</td>
        <td>${money(row.totalValue)}</td>
        <td><span class="status-badge ${st.cls}">${st.text}</span></td>
        <td>
          <div class="action-buttons">
            <button type="button" class="btn-small btn-reorder" data-action="reorder" data-id="${row.id}">Reorder</button>
            <button type="button" class="btn-small btn-count" data-action="count" data-id="${row.id}">Count</button>
            <button type="button" class="btn-small btn-view" data-action="view" data-id="${row.id}">View</button>
          </div>
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll("button[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;
        if (action === "reorder") openReorder(id);
        if (action === "count") openCount(id);
        if (action === "view") openDetail(id);
      });
    });
  }

  function createBatchLine(prefill = {}) {
    const tbody = $("batchLinesBody");
    if (!tbody) return;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><select class="batch-item"></select></td><td class="batch-unit">—</td><td><input class="batch-qty" type="number" min="0.01" step="0.01" placeholder="0" value="${prefill.qty || ""}"></td><td><input class="batch-cost" type="number" min="0.01" step="0.01" placeholder="0.00" value="${prefill.cost || ""}"></td><td class="batch-total">$0.00</td><td><button type="button" class="btn-small btn-danger-small batch-remove">×</button></td>`;
    tbody.appendChild(tr);
    populateBatchLineSelect(tr.querySelector(".batch-item"), prefill.itemId);

    const recalc = () => {
      const qty = safeNum(tr.querySelector(".batch-qty")?.value);
      const cost = safeNum(tr.querySelector(".batch-cost")?.value);
      tr.querySelector(".batch-total").textContent = money(qty * cost);
      recalcBatchTotals();
    };
    tr.querySelector(".batch-item").addEventListener("change", () => {
      const item = getSelectedItemFromSelect(tr.querySelector(".batch-item"));
      tr.querySelector(".batch-unit").textContent = item ? item.purchaseUnit : "—";
      if (item && !tr.querySelector(".batch-cost").value && item.lastCost) tr.querySelector(".batch-cost").value = item.lastCost;
      recalc();
    });
    tr.querySelector(".batch-qty").addEventListener("input", recalc);
    tr.querySelector(".batch-cost").addEventListener("input", recalc);
    tr.querySelector(".batch-remove").addEventListener("click", () => { tr.remove(); recalcBatchTotals(); });
    tr.querySelector(".batch-item").dispatchEvent(new Event("change"));
  }

  function populateBatchLineSelect(select, selectedId = "") {
    if (!select) return;
    const supplierId = $("batchSupplier")?.value || "";
    const items = supplierId ? state.items.filter(i => String(i.supplierId || "") === String(supplierId)) : state.items;
    select.innerHTML = `<option value="">— Select Item —</option>` + items.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");
    if (selectedId) select.value = String(selectedId);
  }

  function refreshBatchLineSelects() {
    document.querySelectorAll(".batch-item").forEach(sel => {
      const old = sel.value;
      populateBatchLineSelect(sel, old);
      sel.dispatchEvent(new Event("change"));
    });
  }

  function getSelectedItemFromSelect(select) {
    const id = Number(select?.value);
    return state.items.find(i => Number(i.id) === id) || null;
  }

  function recalcBatchTotals() {
    const rows = [...document.querySelectorAll("#batchLinesBody tr")];
    let count = 0;
    let total = 0;
    for (const tr of rows) {
      const itemId = Number(tr.querySelector(".batch-item")?.value);
      const qty = safeNum(tr.querySelector(".batch-qty")?.value);
      const cost = safeNum(tr.querySelector(".batch-cost")?.value);
      if (itemId) count += 1;
      total += qty * cost;
    }
    setText("batchLineCount", String(count));
    setText("batchTotalValue", money(total));
  }

  async function receiveBatch() {
    const btn = $("confirmBatchReceiveBtn");
    const supplierId = $("batchSupplier")?.value || "";
    const supplierName = state.suppliers.find(s => String(s.id) === String(supplierId))?.name || "-";
    const invoice = $("batchInvoice")?.value || "";
    const lines = [...document.querySelectorAll("#batchLinesBody tr")].map(tr => ({
      itemId: Number(tr.querySelector(".batch-item")?.value),
      qty: safeNum(tr.querySelector(".batch-qty")?.value),
      cost: safeNum(tr.querySelector(".batch-cost")?.value)
    })).filter(l => l.itemId || l.qty || l.cost);

    if (!lines.length) return alert("Add at least one line.");
    for (const line of lines) {
      if (!line.itemId) return alert("Each line must have an item.");
      if (line.qty <= 0) return alert("Each line must have a valid quantity.");
      if (line.cost <= 0) return alert("Each line must have a valid cost.");
    }
    if (!confirm(`Receive ${lines.length} line(s)?\nTotal: ${$("batchTotalValue")?.textContent || ""}`)) return;

    try {
      setBusy(btn, true, "Receiving...");
      for (const line of lines) {
        await addStockToBackend(line.itemId, line.qty, line.cost, { supplierName, invoice, source: "Batch Receive" });
      }
      clearBatchDraft(true);
      await fetchInventoryData();
      showMessage("Batch received successfully.", "success");
    } catch (err) {
      console.error(err);
      showMessage(err.message || "Failed to receive batch.", "error");
    } finally {
      setBusy(btn, false);
    }
  }

  function clearBatchDraft(keepSupplier = true) {
    if (!keepSupplier && $("batchSupplier")) $("batchSupplier").value = "";
    if ($("batchInvoice")) $("batchInvoice").value = "";
    const body = $("batchLinesBody");
    if (body) body.innerHTML = "";
    createBatchLine();
    recalcBatchTotals();
  }

  async function populateTemplateSelect() {
    const select = $("templateSelect");
    if (!select) return;

    const templates = await fetchSupplierTemplatesFromDb();

    const supplierMap = new Map(state.suppliers.map(s => [Number(s.id), s.name]));

    select.innerHTML =
      `<option value="">— Select Template —</option>` +
      templates.map(t => {
        const supplierName = supplierMap.get(Number(t.supplier_id)) || "All suppliers";
        return `<option value="${t.id}">${escapeHtml(t.name)} — ${escapeHtml(supplierName)}</option>`;
      }).join("");
  }

  async function saveTemplate() {
    const supplierId = Number($("batchSupplier")?.value || 0) || null;
    const supplierName = state.suppliers.find(s => Number(s.id) === Number(supplierId))?.name || "All suppliers";

    const lines = [...document.querySelectorAll("#batchLinesBody tr")].map(tr => ({
      inventory_item_id: Number(tr.querySelector(".batch-item")?.value),
      qty_default: safeNum(tr.querySelector(".batch-qty")?.value),
      cost_default: safeNum(tr.querySelector(".batch-cost")?.value)
    })).filter(l => l.inventory_item_id);

    if (!lines.length) return alert("Add at least one item before saving a template.");

    const name = prompt("Template name:", `${supplierName} usual order`);
    if (!name || !name.trim()) return;

    await ensureAccessToken();

    const { data: templateRow, error: templateError } = await window.sb
      .from("inventory_receive_templates")
      .insert({
        name: name.trim(),
        supplier_id: supplierId,
        is_active: true
      })
      .select("id")
      .single();

    if (templateError) throw templateError;

    const linePayload = lines.map(line => {
      const item = state.items.find(i => Number(i.id) === Number(line.inventory_item_id));
      return {
        template_id: templateRow.id,
        inventory_item_id: line.inventory_item_id,
        purchase_unit: item?.purchaseUnit || item?.baseUnit || "",
        qty_default: line.qty_default,
        cost_default: line.cost_default
      };
    });

    const { error: lineError } = await window.sb
      .from("inventory_receive_template_lines")
      .insert(linePayload);

    if (lineError) throw lineError;

    await populateTemplateSelect();
    showMessage("Template saved to database.", "success");
  }

  async function useTemplate() {
    const id = $("templateSelect")?.value;
    if (!id) return alert("Select a template first.");

    const templates = await fetchSupplierTemplatesFromDb();
    const tpl = templates.find(t => String(t.id) === String(id));
    if (!tpl) return alert("Template not found.");

    if ($("batchSupplier")) $("batchSupplier").value = tpl.supplier_id || "";

    const lines = await fetchSupplierTemplateLinesFromDb(id);

    const body = $("batchLinesBody");
    if (body) body.innerHTML = "";

    (lines || []).forEach(line => {
      createBatchLine({
        itemId: line.inventory_item_id,
        qty: line.qty_default,
        cost: line.cost_default
      });
    });

    if (!(lines || []).length) createBatchLine();

    recalcBatchTotals();
  }

  async function deleteSelectedTemplate() {
  const id = $("templateSelect")?.value;
  if (!id) return alert("Select a template first.");

  const select = $("templateSelect");
  const label = select.options[select.selectedIndex]?.textContent || "this template";

  if (!confirm(`Delete template "${label}"?`)) return;

  await ensureAccessToken();

  const { error } = await window.sb
    .from("inventory_receive_templates")
    .delete()
    .eq("id", id);

  if (error) throw error;

  await populateTemplateSelect();
  showMessage("Template deleted.", "success");
}

  function openReorder(itemId) {
    const row = state.rows.find(r => Number(r.id) === Number(itemId));
    if (!row) return;
    state.activeReorderItemId = itemId;
    setText("reorderTitle", `Reorder: ${row.name}`);
    const suggested = suggestedReorderQty(row);
    if ($("reorderQty")) $("reorderQty").value = suggested;
    if ($("reorderCost")) $("reorderCost").value = row.avgCost > 0 ? (row.avgCost * (row.conversion || 1)).toFixed(2) : "";
    setText("reorderHint", `Enter quantity in ${row.purchaseUnit}. It will convert to ${row.baseUnit} using ${row.conversion} ${row.baseUnit} per ${row.purchaseUnit}.`);
    $("reorderDialog")?.showModal();
  }

  async function confirmReorder() {
    const id = state.activeReorderItemId;
    const row = state.rows.find(r => Number(r.id) === Number(id));
    if (!row) return;
    const qty = safeNum($("reorderQty")?.value);
    const cost = safeNum($("reorderCost")?.value);
    if (qty <= 0) return alert("Enter a valid quantity.");
    if (cost <= 0) return alert("Enter a valid cost.");
    const btn = $("reorderConfirmBtn");
    try {
      setBusy(btn, true, "Receiving...");
      await addStockToBackend(id, qty, cost, { supplierName: row.supplier, source: "Reorder" });
      closeDialog("reorderDialog");
      await fetchInventoryData();
      showMessage(`${row.name} reordered successfully.`, "success");
    } catch (err) {
      console.error(err);
      showMessage(err.message || "Failed to reorder item.", "error");
    } finally {
      setBusy(btn, false);
    }
  }

  function openCount(itemId) {
    const row = state.rows.find(r => Number(r.id) === Number(itemId));
    if (!row) return;
    state.activeCountItemId = itemId;
    setText("countTitle", `Stock Count: ${row.name}`);
    setText("countCurrent", `System quantity: ${qtyFmt(row.quantity)} ${row.baseUnit}`);
    if ($("countQty")) $("countQty").value = row.quantity.toFixed(2);
    updateCountDiff();
    $("countDialog")?.showModal();
  }

  function updateCountDiff() {
    const row = state.rows.find(r => Number(r.id) === Number(state.activeCountItemId));
    if (!row) return;
    const counted = safeNum($("countQty")?.value);
    const diff = counted - safeNum(row.quantity);
    const text = diff === 0 ? "No difference." : diff > 0 ? `Will add ${qtyFmt(diff)} ${row.baseUnit}.` : `Will remove ${qtyFmt(Math.abs(diff))} ${row.baseUnit}.`;
    setText("countDiff", text);
  }

  async function applyCount() {
    const row = state.rows.find(r => Number(r.id) === Number(state.activeCountItemId));
    if (!row) return;
    const counted = safeNum($("countQty")?.value);
    if (counted < 0) return alert("Counted quantity cannot be negative.");
    const diff = counted - safeNum(row.quantity);
    if (Math.abs(diff) < 1e-9) { closeDialog("countDialog"); return; }
    const reason = $("countReason")?.value || "Physical count correction";
    const btn = $("countApplyBtn");
    try {
      setBusy(btn, true, "Applying...");
      if (diff > 0) {
        const purchaseQty = diff / (row.conversion || 1);
        const purchaseCost = row.avgCost > 0 ? row.avgCost * (row.conversion || 1) : 0.01;
        await addStockToBackend(row.id, purchaseQty, purchaseCost, { supplierName: row.supplier, source: reason });
      } else {
        await subtractStockFromBackend(row.id, Math.abs(diff), reason);
      }
      closeDialog("countDialog");
      await fetchInventoryData();
      showMessage("Stock count applied.", "success");
    } catch (err) {
      console.error(err);
      showMessage(err.message || "Failed to apply count.", "error");
    } finally {
      setBusy(btn, false);
    }
  }

  function openDetail(itemId) {
    const row = state.rows.find(r => Number(r.id) === Number(itemId));
    if (!row) return;
    state.activeDetailItemId = itemId;
    setText("detailTitle", row.name);
    const status = getStatus(row);
    const body = $("detailBody");
    if (body) body.innerHTML = `
      <div class="detail-pill"><span>Supplier</span><strong>${escapeHtml(row.supplier)}</strong></div>
      <div class="detail-pill"><span>Status</span><strong>${escapeHtml(status.text)}</strong></div>
      <div class="detail-pill"><span>Quantity</span><strong>${qtyFmt(row.quantity)} ${escapeHtml(row.baseUnit)}</strong></div>
      <div class="detail-pill"><span>Purchase Unit</span><strong>${escapeHtml(row.purchaseUnit)}</strong></div>
      <div class="detail-pill"><span>Conversion</span><strong>${qtyFmt(row.conversion)} ${escapeHtml(row.baseUnit)} / ${escapeHtml(row.purchaseUnit)}</strong></div>
      <div class="detail-pill"><span>Average Cost</span><strong>${money(row.avgCost)} / ${escapeHtml(row.baseUnit)}</strong></div>
      <div class="detail-pill"><span>Total Value</span><strong>${money(row.totalValue)}</strong></div>
      <div class="detail-pill"><span>Last Updated</span><strong>${row.updatedAt ? escapeHtml(new Date(row.updatedAt).toLocaleString()) : "—"}</strong></div>`;
    $("itemDetailDialog")?.showModal();
  }

  function closeDialog(id) {
    const dlg = $(id);
    if (dlg && dlg.open) dlg.close();
  }

  async function handleQuickAdd() {
    syncQuickAddItem();
    const itemId = $("addStockItem")?.value;
    const qty = safeNum($("addStockQty")?.value);
    const cost = safeNum($("addStockCost")?.value);
    if (!itemId) return alert("Please select an item.");
    if (qty <= 0) return alert("Please enter a valid quantity.");
    if (cost <= 0) return alert("Please enter a valid cost per purchase unit.");
    const item = state.items.find(i => String(i.id) === String(itemId));
    const btn = $("addStockBtn");
    try {
      setBusy(btn, true, "Adding...");
      await addStockToBackend(itemId, qty, cost, { supplierName: item?.supplier || "-", source: "Quick Add" });
      if ($("addStockQty")) $("addStockQty").value = "";
      if ($("addStockCost")) $("addStockCost").value = "";
      await fetchInventoryData();
      showMessage("Stock added successfully.", "success");
    } catch (err) {
      console.error(err);
      showMessage(err.message || "Failed to add stock.", "error");
    } finally {
      setBusy(btn, false);
    }
  }

  async function handleWaste() {
    const itemId = Number($("wasteItem")?.value);
    const qty = safeNum($("wasteQty")?.value);
    const reason = $("wasteReason")?.value || "Waste";
    const note = $("wasteNote")?.value || "";
    if (!itemId) return alert("Please select an item.");
    if (qty <= 0) return alert("Enter a valid quantity.");
    const btn = $("wasteStockBtn");
    try {
      setBusy(btn, true, "Removing...");
      await subtractStockFromBackend(itemId, qty, reason, note);
      if ($("wasteQty")) $("wasteQty").value = "";
      if ($("wasteReason")) $("wasteReason").value = "";
      if ($("wasteNote")) $("wasteNote").value = "";
      await fetchInventoryData();
      showMessage("Waste recorded and stock updated.", "success");
    } catch (err) {
      console.error(err);
      showMessage(err.message || "Failed to remove stock.", "error");
    } finally {
      setBusy(btn, false);
    }
  }

  function renderHistory() {
    const restock = safeParse(STORAGE.restockHistory, []);
    const restockBody = $("restockHistoryBody");
    if (restockBody) {
      restockBody.innerHTML = restock.length ? restock.slice().reverse().slice(0, 80).map(item => `<tr><td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.product)}</td><td>${escapeHtml(item.supplier || "-")}</td><td>+${qtyFmt(item.qty)} ${escapeHtml(item.purchaseUnit || "")}</td><td>${item.cost ? money(item.cost) : "-"}</td><td>${escapeHtml(item.invoice || "-")}</td></tr>`).join("") : `<tr><td colspan="6" style="text-align:center;">No stock activity yet</td></tr>`;
    }
    const waste = safeParse(STORAGE.wasteHistory, []);
    const wasteBody = $("wasteHistoryBody");
    if (wasteBody) {
      wasteBody.innerHTML = waste.length ? waste.slice().reverse().slice(0, 80).map(item => `<tr><td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.product)}</td><td>${escapeHtml(item.reason || "-")}</td><td>-${qtyFmt(item.qty)}</td><td>${escapeHtml(item.unit || "")}</td></tr>`).join("") : `<tr><td colspan="5" style="text-align:center;">No waste activity yet</td></tr>`;
    }
  }

  function renderWasteSummary() {
    const waste = safeParse(STORAGE.wasteHistory, []);
    const totalValue = waste.reduce((sum, x) => sum + safeNum(x.estimatedValue), 0);
    const reasonCount = new Map();
    waste.forEach(x => reasonCount.set(x.reason || "Other", (reasonCount.get(x.reason || "Other") || 0) + 1));
    const top = Array.from(reasonCount.entries()).sort((a, b) => b[1] - a[1])[0];
    setText("wasteCount", String(waste.length));
    setText("wasteValue", money(totalValue));
    setText("topWasteReason", top ? `${top[0]} (${top[1]})` : "—");
  }

  function exportStockCsv() {
    const headers = ["item", "supplier", "base_unit", "quantity", "avg_cost_usd", "total_value_usd", "status", "purchase_unit", "conversion_to_base", "updated_at"];
    const lines = [headers.join(",")];
    for (const r of state.filteredRows.length ? state.filteredRows : state.rows) {
      const s = getStatus(r).text;
      lines.push([r.name, r.supplier, r.baseUnit, r.quantity, r.avgCost, r.totalValue, s, r.purchaseUnit, r.conversion, r.updatedAt].map(csv).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock_report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csv(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }

  function backupFrontendData() {
    const payload = {
      version: 2,
      createdAt: new Date().toISOString(),
      note: "Frontend stock backup only. It does not export database tables.",
      data: {
        restockHistory: safeParse(STORAGE.restockHistory, []),
        wasteHistory: safeParse(STORAGE.wasteHistory, []),
        supplierTemplates: safeParse(STORAGE.supplierTemplates, []),
        prepItems: safeParse(STORAGE.prepItems, [])
      }
    };
    saveJSON(STORAGE.backup, payload);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos_stock_frontend_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function restoreFrontendData(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const data = json?.data || {};
      if (Array.isArray(data.restockHistory)) saveJSON(STORAGE.restockHistory, data.restockHistory);
      if (Array.isArray(data.wasteHistory)) saveJSON(STORAGE.wasteHistory, data.wasteHistory);
      if (Array.isArray(data.supplierTemplates)) saveJSON(STORAGE.supplierTemplates, data.supplierTemplates);
      if (Array.isArray(data.prepItems)) saveJSON(STORAGE.prepItems, data.prepItems);
      populateTemplateSelect();
      renderAll();
      showMessage("Frontend backup restored.", "success");
    } catch (err) {
      console.error(err);
      showMessage("Restore failed. Please select a valid JSON backup.", "error");
    }
  }

  function mirrorBackendRowsForPrep() {
    const localStock = state.rows.map(r => ({
      name: r.name,
      category: "Inventory",
      supplier: r.supplier,
      unit: r.baseUnit,
      quantity: r.quantity,
      costPrice: r.avgCost,
      lowStockThreshold: lowThresholdForUnit(r.baseUnit)
    }));
    localStorage.setItem("stockItems", JSON.stringify(localStock));
  }

  function initTabs() {
    document.querySelectorAll(".stock-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".stock-tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        $(`tab-${btn.dataset.tab}`)?.classList.add("active");
      });
    });
  }

  function bindEvents() {
    initTabs();
    $("refreshStockBtn")?.addEventListener("click", () => fetchInventoryData().catch(err => showMessage(err.message, "error")));
    $("addStockItemInput")?.addEventListener("input", syncQuickAddItem);
    $("addStockItemInput")?.addEventListener("change", syncQuickAddItem);
    $("addStockBtn")?.addEventListener("click", handleQuickAdd);
    $("addBatchLineBtn")?.addEventListener("click", () => createBatchLine());
    $("confirmBatchReceiveBtn")?.addEventListener("click", receiveBatch);
    $("batchSupplier")?.addEventListener("change", refreshBatchLineSelects);
    $("saveTemplateBtn")?.addEventListener("click", async () => {
      try {
        await saveTemplate();
      } catch (err) {
        console.error(err);
        showMessage(err.message || "Failed to save template.", "error");
      }
    });

    $("useTemplateBtn")?.addEventListener("click", async () => {
      try {
        await useTemplate();
      } catch (err) {
        console.error(err);
        showMessage(err.message || "Failed to load template.", "error");
      }
    });

    $("deleteTemplateBtn")?.addEventListener("click", async () => {
  try {
    await deleteSelectedTemplate();
  } catch (err) {
    console.error(err);
    showMessage(err.message || "Failed to delete template.", "error");
  }
});

    ["inventorySearch", "supplierFilter", "statusFilter", "lowStockOnly"].forEach(id => $(id)?.addEventListener("input", renderInventoryTable));
    ["supplierFilter", "statusFilter", "lowStockOnly"].forEach(id => $(id)?.addEventListener("change", renderInventoryTable));
    document.querySelectorAll("#inventoryTable th[data-sort]").forEach(th => th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = "asc"; }
      renderInventoryTable();
    }));
    $("wasteItem")?.addEventListener("change", () => {
      const item = state.items.find(i => String(i.id) === String($("wasteItem")?.value));
      if ($("wasteUnit")) $("wasteUnit").innerHTML = item ? `<option value="${escapeHtml(item.baseUnit)}">${escapeHtml(item.baseUnit)}</option>` : `<option value="">— Auto —</option>`;
    });
    $("wasteStockBtn")?.addEventListener("click", handleWaste);
    $("exportStockBtn")?.addEventListener("click", exportStockCsv);
    $("backupBtn")?.addEventListener("click", backupFrontendData);
    $("restoreInput")?.addEventListener("change", e => restoreFrontendData(e.target.files?.[0]).finally(() => { e.target.value = ""; }));
    $("reorderCloseBtn")?.addEventListener("click", () => closeDialog("reorderDialog"));
    $("reorderCancelBtn")?.addEventListener("click", () => closeDialog("reorderDialog"));
    $("reorderConfirmBtn")?.addEventListener("click", confirmReorder);
    $("countCloseBtn")?.addEventListener("click", () => closeDialog("countDialog"));
    $("countCancelBtn")?.addEventListener("click", () => closeDialog("countDialog"));
    $("countApplyBtn")?.addEventListener("click", applyCount);
    $("countQty")?.addEventListener("input", updateCountDiff);
    $("detailCloseBtn")?.addEventListener("click", () => closeDialog("itemDetailDialog"));
    $("detailOkBtn")?.addEventListener("click", () => closeDialog("itemDetailDialog"));
    $("detailReorderBtn")?.addEventListener("click", () => { const id = state.activeDetailItemId; closeDialog("itemDetailDialog"); openReorder(id); });
  }

  // ---------- Prep module retained as frontend workspace ----------
  function initPrepModule() {
    const prepBtn = $("prepBtn"), modal = $("prepModal"), closeBtn = $("prepCloseBtn");
    if (!prepBtn || !modal || !closeBtn) return;
    const PREP_KEY = STORAGE.prepItems;
    let prepItems = safeParse(PREP_KEY, []);
    let editIndex = null;
    const stockKey = (it) => `${norm(it.name)}|${norm(it.unit)}`;
    const loadStock = () => safeParse("stockItems", []);
    const savePrep = () => saveJSON(PREP_KEY, prepItems);
    const compatibleUnitsFor = (u) => { const x = norm(u); if (x === "kg" || x === "g") return ["g", "kg"]; if (x === "l" || x === "ml") return ["ml", "L"]; return ["pcs"]; };
    const convertQty = (qty, from, to) => {
      const q = Number(qty), f = norm(from), t = norm(to);
      if (!Number.isFinite(q)) return NaN;
      if (f === t) return q;
      if (f === "kg" && t === "g") return q * 1000;
      if (f === "g" && t === "kg") return q / 1000;
      if (f === "l" && t === "ml") return q * 1000;
      if (f === "ml" && t === "l") return q / 1000;
      return NaN;
    };
    const openModal = () => { modal.classList.remove("hidden"); modal.setAttribute("aria-hidden", "false"); switchPrepTab("manage"); refreshPrep(); };
    const closeModal = () => { modal.classList.add("hidden"); modal.setAttribute("aria-hidden", "true"); };
    prepBtn.addEventListener("click", openModal);
    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
    $("prepTabManage")?.addEventListener("click", () => switchPrepTab("manage"));
    $("prepTabProduce")?.addEventListener("click", () => switchPrepTab("produce"));
    function switchPrepTab(which) {
      $("prepTabManage")?.classList.toggle("active", which === "manage");
      $("prepTabProduce")?.classList.toggle("active", which === "produce");
      $("prepPanelManage")?.classList.toggle("hidden", which !== "manage");
      $("prepPanelProduce")?.classList.toggle("hidden", which !== "produce");
    }
    function addRecipeRow(prefill = {}) {
      const rows = $("prepRecipeRows"); if (!rows) return;
      const stock = loadStock();
      const row = document.createElement("div"); row.className = "prep-row";
      const sel = document.createElement("select"), qty = document.createElement("input"), unit = document.createElement("select"), rm = document.createElement("button");
      qty.type = "number"; qty.min = "0.01"; qty.step = "0.01"; qty.placeholder = "Qty"; qty.value = prefill.qty || "";
      rm.type = "button"; rm.className = "prep-remove"; rm.textContent = "×"; rm.onclick = () => row.remove();
      sel.innerHTML = stock.length ? stock.map(s => `<option value="${escapeHtml(stockKey(s))}">${escapeHtml(s.name)} (${escapeHtml(s.unit)})</option>`).join("") : `<option value="">No stock items available</option>`;
      function fillUnits() { const s = stock.find(x => stockKey(x) === sel.value); unit.innerHTML = s ? compatibleUnitsFor(s.unit).map(u => `<option value="${u}">${u}</option>`).join("") : ""; if (prefill.unit) unit.value = prefill.unit; }
      sel.addEventListener("change", fillUnits); if (prefill.stockKey) sel.value = prefill.stockKey; fillUnits();
      row.append(sel, qty, unit, rm); rows.appendChild(row);
    }
    function clearPrepForm() {
      editIndex = null; setText("prepFormTitle", "Create Prep Item");
      ["prepName", "prepCategory", "prepYieldQty", "prepProduceQty"].forEach(id => { if ($(id)) $(id).value = ""; });
      if ($("prepUnit")) $("prepUnit").value = "g";
      if ($("prepRecipeRows")) $("prepRecipeRows").innerHTML = "";
      addRecipeRow(); $("prepCancelEditBtn")?.classList.add("hidden");
    }
    function buildRecipe() {
      const stock = loadStock(); const recipe = [];
      [...document.querySelectorAll("#prepRecipeRows .prep-row")].forEach(row => {
        const [sel, qty, unit] = row.children; const s = stock.find(x => stockKey(x) === sel.value); const q = Number(qty.value);
        if (s && q > 0) recipe.push({ stockKey: stockKey(s), stockName: s.name, stockUnit: s.unit, qty: q, unit: unit.value });
      });
      return recipe;
    }
    $("prepAddRowBtn")?.addEventListener("click", () => addRecipeRow());
    $("prepCancelEditBtn")?.addEventListener("click", clearPrepForm);
    $("prepSaveBtn")?.addEventListener("click", () => {
      const name = $("prepName")?.value.trim(); const category = $("prepCategory")?.value.trim(); const unit = $("prepUnit")?.value; const yieldQty = Number($("prepYieldQty")?.value); const recipe = buildRecipe();
      if (!name) return alert("Prep item name is required."); if (!(yieldQty > 0)) return alert("Yield quantity must be greater than 0."); if (!recipe.length) return alert("Add at least one valid ingredient.");
      const payload = { name, category, unit, yieldQty, recipe, quantity: editIndex === null ? 0 : safeNum(prepItems[editIndex]?.quantity), unitCost: editIndex === null ? 0 : safeNum(prepItems[editIndex]?.unitCost) };
      if (editIndex === null) prepItems.push(payload); else prepItems[editIndex] = payload;
      savePrep(); refreshPrep(); clearPrepForm(); alert("Prep item saved.");
    });
    $("prepSearch")?.addEventListener("input", renderPrepTable);
    function renderPrepTable() {
      const body = $("prepTableBody"); if (!body) return;
      const q = norm($("prepSearch")?.value); const list = prepItems.filter(p => !q || norm(p.name).includes(q) || norm(p.category).includes(q));
      body.innerHTML = list.length ? list.map((p, i) => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category || "-")}</td><td>${qtyFmt(p.quantity)}</td><td>${escapeHtml(p.unit)}</td><td>${money(p.unitCost)}</td><td><div class="prep-actions"><button type="button" class="prep-edit" data-prep-edit="${i}">Edit</button><button type="button" class="prep-del" data-prep-del="${i}">Delete</button></div></td></tr>`).join("") : `<tr><td colspan="6" style="text-align:center;">No prep items yet</td></tr>`;
      body.querySelectorAll("[data-prep-edit]").forEach(b => b.onclick = () => loadPrepForEdit(Number(b.dataset.prepEdit)));
      body.querySelectorAll("[data-prep-del]").forEach(b => b.onclick = () => { const i = Number(b.dataset.prepDel); if (confirm(`Delete ${prepItems[i].name}?`)) { prepItems.splice(i, 1); savePrep(); refreshPrep(); } });
    }
    function loadPrepForEdit(i) {
      const p = prepItems[i]; if (!p) return; editIndex = i;
      setText("prepFormTitle", "Edit Prep Item"); $("prepName").value = p.name; $("prepCategory").value = p.category || ""; $("prepUnit").value = p.unit; $("prepYieldQty").value = p.yieldQty; $("prepRecipeRows").innerHTML = ""; (p.recipe || []).forEach(addRecipeRow); $("prepCancelEditBtn")?.classList.remove("hidden"); switchPrepTab("manage");
    }
    function renderProduceSelect() { const sel = $("prepProduceSelect"); if (!sel) return; sel.innerHTML = prepItems.length ? prepItems.map((p, i) => `<option value="${i}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`).join("") : `<option value="">No prep items available</option>`; }
    function computeRequirements(p, amount) {
      const stock = loadStock(); const factor = amount / safeNum(p.yieldQty); const lines = []; let totalCost = 0;
      for (const ing of p.recipe || []) { const s = stock.find(x => stockKey(x) === ing.stockKey); if (!s) return { ok: false, msg: `Missing stock item: ${ing.stockName}` }; const reqIng = safeNum(ing.qty) * factor; const reqStock = convertQty(reqIng, ing.unit, s.unit); if (!Number.isFinite(reqStock)) return { ok: false, msg: `Unit mismatch for ${s.name}` }; const available = safeNum(s.quantity); const cost = reqStock * safeNum(s.costPrice); totalCost += cost; lines.push({ name: s.name, unit: s.unit, required: reqStock, available, shortage: Math.max(0, reqStock - available), cost }); }
      return { ok: true, lines, totalCost };
    }
    $("prepPreviewBtn")?.addEventListener("click", () => { const p = prepItems[Number($("prepProduceSelect")?.value)]; const amount = Number($("prepProduceQty")?.value); if (!p || !(amount > 0)) return alert("Select prep item and quantity."); const res = computeRequirements(p, amount); if (!res.ok) return alert(res.msg); const text = res.lines.map(l => `- ${l.name}: need ${qtyFmt(l.required)} ${l.unit} | stock ${qtyFmt(l.available)} ${l.unit}${l.shortage > 0 ? ` | shortage ${qtyFmt(l.shortage)}` : " | OK"}`).join("\n"); $("prepPreviewBox").textContent = `${text}\n\nBatch cost: ${money(res.totalCost)}\nUnit cost: ${money(res.totalCost / amount)} / ${p.unit}`; });
    $("prepProduceBtn")?.addEventListener("click", () => alert("Prep production preview is available. Database stock is not changed by this frontend prep workspace."));
    function refreshPrep() { prepItems = safeParse(PREP_KEY, []); renderPrepTable(); renderProduceSelect(); }
    clearPrepForm(); refreshPrep();
  }

  async function init() {
    bindEvents();
    createBatchLine();
    initPrepModule();
    try {
      showMessage("Loading inventory...", "info");
      await fetchInventoryData();
      $("stockMessage")?.classList.add("hidden");
    } catch (err) {
      console.error(err);
      showMessage(err.message || "Failed to load inventory.", "error");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
