// customers.js (FINAL - Stable Library + Customers Page UI)
// Rules:
// - minSubtotal is per visit to count as a loyalty visit
// - if subtotal < minSubtotal: visit does NOT count and no milestone discount applies

(function () {
  "use strict";

  // -----------------------------
  // STORAGE KEYS
  // -----------------------------
  const KEY_CUSTOMERS = "customers";
  const KEY_LOYALTY = "loyaltySettings";
  const KEY_RECEIPTS = "receipts";

  const safeNum = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v : 0;
  };

  const nowISO = () => new Date().toISOString();
  const normPhone = (p) => String(p || "").trim();
  const normName = (n) => String(n || "").trim();

  function storageOk() {
    try {
      localStorage.setItem("__POS_STORAGE_TEST__", "1");
      const v = localStorage.getItem("__POS_STORAGE_TEST__");
      localStorage.removeItem("__POS_STORAGE_TEST__");
      return v === "1";
    } catch {
      return false;
    }
  }

  // -----------------------------
  // CUSTOMERS
  // -----------------------------
  function loadCustomers() {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY_CUSTOMERS) || "[]");
      if (!Array.isArray(arr)) return [];
      return arr
        .map((c) => ({
          phone: normPhone(c.phone),
          fullName: normName(c.fullName),
          createdAtISO: c.createdAtISO || nowISO(),
          visits: safeNum(c.visits),
          totalSpent: safeNum(c.totalSpent),
          lastVisitISO: c.lastVisitISO || "",
        }))
        .filter((c) => c.phone && c.fullName);
    } catch {
      return [];
    }
  }

  function saveCustomers(list) {
    localStorage.setItem(KEY_CUSTOMERS, JSON.stringify(list));
  }

  function getCustomer(phone) {
    const p = normPhone(phone);
    return loadCustomers().find((c) => c.phone === p) || null;
  }

  function upsertCustomer({ phone, fullName }) {
    const p = normPhone(phone);
    const n = normName(fullName);

    if (!p) throw new Error("Phone is required.");
    if (!n) throw new Error("Full name is required.");

    const list = loadCustomers();
    const idx = list.findIndex((c) => c.phone === p);

    if (idx !== -1) {
      list[idx].fullName = n;
      saveCustomers(list);
      return list[idx];
    }

    const newC = {
      phone: p,
      fullName: n,
      createdAtISO: nowISO(),
      visits: 0,
      totalSpent: 0,
      lastVisitISO: "",
    };
    list.push(newC);
    saveCustomers(list);
    return newC;
  }

  // Reservation/POS helper: ensure customer exists, allow name optional
  function ensureCustomer(phone, fullNameOptional) {
    const p = normPhone(phone);
    if (!p) return null;

    const existing = getCustomer(p);
    if (existing) {
      // If we have a better name now, update it
      const newName = normName(fullNameOptional);
      if (newName && newName !== existing.fullName) {
        const list = loadCustomers();
        const idx = list.findIndex((c) => c.phone === p);
        if (idx !== -1) {
          list[idx].fullName = newName;
          saveCustomers(list);
          return list[idx];
        }
      }
      return existing;
    }

    // If not existing and name missing, create a safe placeholder (user can edit later)
    const name = normName(fullNameOptional) || `Customer ${p.slice(-4)}`;
    return upsertCustomer({ phone: p, fullName: name });
  }

  function deleteCustomer(phone) {
    const p = normPhone(phone);
    saveCustomers(loadCustomers().filter((c) => c.phone !== p));
  }

  // -----------------------------
  // LOYALTY SETTINGS
  // -----------------------------
  function defaultLoyalty() {
    return {
      enabled: true,
      everyNVisits: 5,
      discountPercent: 10,
      minSubtotal: 0, // per-visit threshold to count visit + allow milestone discount
    };
  }

  function loadLoyalty() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_LOYALTY) || "null");
      const d = defaultLoyalty();
      if (!raw) return d;

      return {
        enabled: raw.enabled !== false,
        everyNVisits: Math.max(1, safeNum(raw.everyNVisits ?? d.everyNVisits)),
        discountPercent: Math.max(0, Math.min(100, safeNum(raw.discountPercent ?? d.discountPercent))),
        minSubtotal: Math.max(0, safeNum(raw.minSubtotal ?? d.minSubtotal)),
      };
    } catch {
      return defaultLoyalty();
    }
  }

  function saveLoyalty(settings) {
    localStorage.setItem(KEY_LOYALTY, JSON.stringify(settings));
  }

  function qualifiesForVisit(subtotal) {
    const s = loadLoyalty();
    return safeNum(subtotal) >= safeNum(s.minSubtotal);
  }

  // Discount eligibility for THIS order:
  // - customer must exist
  // - subtotal must qualify for visit threshold (minSubtotal)
  // - discount triggers when (nextVisitNumber % everyNVisits == 0)
  function applyLoyaltyDiscount(phone, subtotal) {
    const p = normPhone(phone);
    const st = safeNum(subtotal);
    const s = loadLoyalty();

    if (!s.enabled) return { eligible: false, percent: 0, amount: 0, reason: "Loyalty disabled" };
    if (!p) return { eligible: false, percent: 0, amount: 0, reason: "No phone" };

    const c = getCustomer(p);
    if (!c) return { eligible: false, percent: 0, amount: 0, reason: "Customer not found" };

    if (st < safeNum(s.minSubtotal)) {
      return {
        eligible: false,
        percent: 0,
        amount: 0,
        reason: `Subtotal must be ≥ $${safeNum(s.minSubtotal).toFixed(2)} for visit to count`,
      };
    }

    const nextVisit = safeNum(c.visits) + 1;
    const N = Math.max(1, safeNum(s.everyNVisits));
    const pct = Math.max(0, Math.min(100, safeNum(s.discountPercent)));

    if (nextVisit % N === 0 && pct > 0) {
      const amount = st * (pct / 100);
      return { eligible: true, percent: pct, amount, reason: `Visit #${nextVisit} milestone → ${pct}% off` };
    }

    const remainder = nextVisit % N;
    const toGo = N - remainder;
    return { eligible: false, percent: 0, amount: 0, reason: `Next discount at visit #${nextVisit + toGo}` };
  }

  // -----------------------------
  // RECEIPTS LEDGER
  // -----------------------------
  function loadReceipts() {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY_RECEIPTS) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveReceipts(list) {
    localStorage.setItem(KEY_RECEIPTS, JSON.stringify(list));
  }

  function addReceipt(receipt) {
    const list = loadReceipts();
    list.push(receipt);
    saveReceipts(list);
    return receipt;
  }

  function getCustomerReceipts(phone) {
    const p = normPhone(phone);
    return loadReceipts()
      .filter((r) => normPhone(r.customerPhone) === p)
      .sort((a, b) => String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || "")))
      .slice(0, 20)
      .map((r) => ({
        createdAtISO: r.createdAtISO || "",
        ref: r.ref || "—",
        subtotal: safeNum(r.subtotal),
        discountTotal: safeNum(r.discountTotal),
        total: safeNum(r.total),
      }));
  }

  // Finalize a receipt:
  // - always save receipt
  // - only count visit if subtotal >= minSubtotal
  // - only increment visits & totalSpent when visit qualifies
  function finalizeReceipt({ receipt }) {
    if (!receipt || !receipt.ref) throw new Error("Invalid receipt.");
    const createdAtISO = receipt.createdAtISO || nowISO();
    receipt.createdAtISO = createdAtISO;

    addReceipt(receipt);

    const phone = normPhone(receipt.customerPhone);
    if (!phone) return { countedVisit: false, reason: "No customer phone" };

    // ensure customer exists (name optional)
    ensureCustomer(phone, receipt.customerName || "");

    // count visit?
    const st = safeNum(receipt.subtotal);
    if (!qualifiesForVisit(st)) {
      return { countedVisit: false, reason: `Subtotal below minimum; visit not counted.` };
    }

    // increment visit + spent
    const list = loadCustomers();
    const idx = list.findIndex((c) => c.phone === phone);
    if (idx === -1) return { countedVisit: false, reason: "Customer not found" };

    list[idx].visits = safeNum(list[idx].visits) + 1;
    list[idx].totalSpent = safeNum(list[idx].totalSpent) + safeNum(receipt.total);
    list[idx].lastVisitISO = createdAtISO;
    saveCustomers(list);

    return { countedVisit: true, reason: "Visit counted" };
  }

  // -----------------------------
  // EXPORT LIB
  // -----------------------------
  window.CustomersLib = {
    storageOk,
    loadCustomers,
    getCustomer,
    upsertCustomer,
    ensureCustomer,
    deleteCustomer,
    defaultLoyalty,
    loadLoyalty,
    saveLoyalty,
    qualifiesForVisit,
    applyLoyaltyDiscount,
    loadReceipts,
    addReceipt,
    getCustomerReceipts,
    finalizeReceipt,
  };

  // -----------------------------
  // CUSTOMERS PAGE UI INIT
  // -----------------------------
  function qs(id) { return document.getElementById(id); }
  function show(el, type, text) {
    if (!el) return;
    el.className = "msg " + (type === "ok" ? "ok" : "err");
    el.textContent = text;
    el.style.display = "block";
  }
  function money(n) { return `$${Number(n || 0).toFixed(2)}`; }
  function esc(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function initCustomersPage() {
    const saveCustomerBtn = qs("saveCustomerBtn");
    if (!saveCustomerBtn) return;

    const customerMsg = qs("customerMsg");
    const loyaltyMsg = qs("loyaltyMsg");

    if (!storageOk()) {
      show(customerMsg, "err", "Storage is blocked. Use VS Code Live Server (http://localhost/...) not file://.");
      show(loyaltyMsg, "err", "Storage is blocked, saving cannot work.");
      return;
    }

    const formTitle = qs("formTitle");
    const fullName = qs("fullName");
    const phone = qs("phone");
    const clearFormBtn = qs("clearFormBtn");

    const searchBar = qs("searchBar");
    const customersBody = qs("customersBody");
    const customersCount = qs("customersCount");
    const visitsCount = qs("visitsCount");

    const loyaltyEnabled = qs("loyaltyEnabled");
    const loyaltyEveryN = qs("loyaltyEveryN");
    const loyaltyPercent = qs("loyaltyPercent");
    const loyaltyMinSubtotal = qs("loyaltyMinSubtotal");
    const saveLoyaltyBtn = qs("saveLoyaltyBtn");
    const resetLoyaltyBtn = qs("resetLoyaltyBtn");
    const loyaltyPreviewText = qs("loyaltyPreviewText");

    const viewDialog = qs("viewDialog");
    const viewCloseBtn = qs("viewCloseBtn");
    const viewOkBtn = qs("viewOkBtn");
    const viewTitle = qs("viewTitle");
    const viewPhone = qs("viewPhone");
    const viewName = qs("viewName");
    const viewVisits = qs("viewVisits");
    const viewSpent = qs("viewSpent");
    const viewLast = qs("viewLast");
    const viewReceiptsBody = qs("viewReceiptsBody");

    function clearForm() {
      if (formTitle) formTitle.textContent = "Add Customer";
      saveCustomerBtn.textContent = "Save Customer";
      fullName.value = "";
      phone.value = "";
      phone.readOnly = false;
      customerMsg.style.display = "none";
    }

    function render(list) {
      const customers = list || window.CustomersLib.loadCustomers();
      customersBody.innerHTML = "";

      if (!customers.length) {
        customersBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#7f8c8d;">No customers yet</td></tr>`;
        customersCount.textContent = "0";
        visitsCount.textContent = "0";
        return;
      }

      let totalVisits = 0;

      customers.forEach((c) => {
        totalVisits += Number(c.visits || 0);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${esc(c.phone)}</strong></td>
          <td>${esc(c.fullName)}</td>
          <td>${Number(c.visits || 0)}</td>
          <td>${money(c.totalSpent || 0)}</td>
          <td>${c.lastVisitISO ? esc(new Date(c.lastVisitISO).toLocaleString()) : "—"}</td>
          <td>
            <div class="action-row">
              <button class="small-btn view" data-act="view" data-phone="${esc(c.phone)}">View</button>
              <button class="small-btn edit" data-act="edit" data-phone="${esc(c.phone)}">Edit</button>
              <button class="small-btn del"  data-act="del"  data-phone="${esc(c.phone)}">Del</button>
            </div>
          </td>
        `;
        customersBody.appendChild(tr);
      });

      customersCount.textContent = String(customers.length);
      visitsCount.textContent = String(totalVisits);

      customersBody.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const act = btn.getAttribute("data-act");
          const p = btn.getAttribute("data-phone");
          if (!p) return;

          if (act === "view") openView(p);
          if (act === "edit") openEdit(p);
          if (act === "del") doDelete(p);
        });
      });
    }

    function openEdit(p) {
      const c = window.CustomersLib.getCustomer(p);
      if (!c) return alert("Customer not found.");

      if (formTitle) formTitle.textContent = "Edit Customer";
      saveCustomerBtn.textContent = "Update Customer";

      fullName.value = c.fullName;
      phone.value = c.phone;
      phone.readOnly = true;

      show(customerMsg, "ok", "Editing customer. Update the name then press Update Customer.");
    }

    function doDelete(p) {
      const c = window.CustomersLib.getCustomer(p);
      if (!c) return;
      if (!confirm(`Delete customer "${c.fullName}" (${c.phone})?`)) return;
      window.CustomersLib.deleteCustomer(p);
      clearForm();
      render();
    }

    function openView(p) {
      const c = window.CustomersLib.getCustomer(p);
      if (!c) return alert("Customer not found.");

      if (viewTitle) viewTitle.textContent = `Customer: ${c.fullName}`;
      viewPhone.textContent = c.phone;
      viewName.textContent = c.fullName;
      viewVisits.textContent = String(c.visits || 0);
      viewSpent.textContent = money(c.totalSpent || 0);
      viewLast.textContent = c.lastVisitISO ? new Date(c.lastVisitISO).toLocaleString() : "—";

      const recs = window.CustomersLib.getCustomerReceipts(c.phone);
      viewReceiptsBody.innerHTML = "";

      if (!recs.length) {
        viewReceiptsBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#7f8c8d;">No receipts found</td></tr>`;
      } else {
        recs.forEach((r) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${r.createdAtISO ? esc(new Date(r.createdAtISO).toLocaleString()) : "—"}</td>
            <td>${esc(r.ref)}</td>
            <td>${money(r.subtotal)}</td>
            <td>${money(r.discountTotal)}</td>
            <td>${money(r.total)}</td>
          `;
          viewReceiptsBody.appendChild(tr);
        });
      }

      viewDialog.showModal();
    }

    function refreshPreview() {
      const enabled = loyaltyEnabled.checked;
      const everyN = Math.max(1, Number(loyaltyEveryN.value || 5));
      const pct = Math.max(0, Math.min(100, Number(loyaltyPercent.value || 10)));
      const min = Math.max(0, Number(loyaltyMinSubtotal.value || 0));

      loyaltyPreviewText.textContent = enabled
        ? `Every ${everyN} visits → ${pct}% off (visit counts only if subtotal ≥ $${min.toFixed(2)})`
        : `Disabled`;
    }

    function loadLoyaltyUI() {
      const s = window.CustomersLib.loadLoyalty();
      loyaltyEnabled.checked = !!s.enabled;
      loyaltyEveryN.value = String(s.everyNVisits || 5);
      loyaltyPercent.value = String(s.discountPercent || 10);
      loyaltyMinSubtotal.value = String(s.minSubtotal || 0);
      refreshPreview();
      loyaltyMsg.style.display = "none";
    }

    // Events
    saveCustomerBtn.addEventListener("click", () => {
      const n = fullName.value.trim();
      const p = phone.value.trim();
      if (!n) return show(customerMsg, "err", "Full name is required.");
      if (!p) return show(customerMsg, "err", "Phone number is required.");

      try {
        window.CustomersLib.upsertCustomer({ phone: p, fullName: n });
        render();
        show(customerMsg, "ok", "Customer saved successfully.");
        clearForm();
      } catch (e) {
        show(customerMsg, "err", e.message || "Failed to save customer.");
      }
    });

    clearFormBtn.addEventListener("click", clearForm);

    searchBar.addEventListener("input", () => {
      const k = searchBar.value.toLowerCase().trim();
      const all = window.CustomersLib.loadCustomers();
      const filtered = all.filter((c) =>
        c.fullName.toLowerCase().includes(k) || c.phone.toLowerCase().includes(k)
      );
      render(filtered);
    });

    [loyaltyEnabled, loyaltyEveryN, loyaltyPercent, loyaltyMinSubtotal].forEach((el) => {
      el.addEventListener("input", refreshPreview);
      el.addEventListener("change", refreshPreview);
    });

    saveLoyaltyBtn.addEventListener("click", () => {
      const enabled = loyaltyEnabled.checked;
      const everyN = Math.max(1, Number(loyaltyEveryN.value || 5));
      const pct = Math.max(0, Math.min(100, Number(loyaltyPercent.value || 10)));
      const min = Math.max(0, Number(loyaltyMinSubtotal.value || 0));

      window.CustomersLib.saveLoyalty({ enabled, everyNVisits: everyN, discountPercent: pct, minSubtotal: min });
      show(loyaltyMsg, "ok", "Loyalty saved successfully.");
      refreshPreview();
    });

    resetLoyaltyBtn.addEventListener("click", () => {
      window.CustomersLib.saveLoyalty(window.CustomersLib.defaultLoyalty());
      loadLoyaltyUI();
      show(loyaltyMsg, "ok", "Loyalty reset to default.");
    });

    if (viewCloseBtn) viewCloseBtn.addEventListener("click", () => viewDialog.close());
    if (viewOkBtn) viewOkBtn.addEventListener("click", () => viewDialog.close());

    // Init
    clearForm();
    loadLoyaltyUI();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCustomersPage);
  } else {
    initCustomersPage();
  }
})();
