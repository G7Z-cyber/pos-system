(function () {
  "use strict";

  // ---------------- KEYS ----------------
  const KEY_RES = "reservations";
  const KEY_SET = "reservationSettings";
  const KEY_TABLES = "tables";
  const KEY_POS_HANDOFF = "POS_RES_HANDOFF";
  const KEY_FILTERS = "reservationFilters";
  const TZ = "Asia/Beirut";

  // ---------------- HELPERS ----------------
  const el = (id) => document.getElementById(id);
  const trim = (s) => String(s ?? "").trim();
  const pad2 = (n) => String(n).padStart(2, "0");
  const safeNum = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  };

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function storageOk() {
    try {
      localStorage.setItem("__RES_TEST__", "1");
      const v = localStorage.getItem("__RES_TEST__");
      localStorage.removeItem("__RES_TEST__");
      return v === "1";
    } catch {
      return false;
    }
  }

  const nowISO = () => new Date().toISOString();

  // ---------------- TIMEZONE (BEIRUT) ----------------
  function beirutNow() {
    // Creates a Date whose fields match Beirut wall-clock right now
    return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  }

  function dateKeyFromDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function fmtBeirut(iso) {
    try {
      return new Date(iso).toLocaleString("en-GB", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "—";
    }
  }

  function tzOffsetMinutes(date, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(date);
    const map = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;

    const asUTC = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second)
    );
    return (asUTC - date.getTime()) / 60000;
  }

  // Convert Beirut wall-clock date+time to ISO (DST safe)
  function beirutWallToISO(dateStr, timeStr) {
    const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
    const [hh, mm] = timeStr.split(":").map((x) => parseInt(x, 10));

    const guessUTC = new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0));
    const offMin = tzOffsetMinutes(guessUTC, TZ);
    const corrected = new Date(guessUTC.getTime() - offMin * 60000);
    return corrected.toISOString();
  }

  // ---------------- PHONE VALIDATION ----------------
  function validPhone(phone) {
    const p = trim(phone);
    if (!p) return false;
    const normalized = p.startsWith("+") ? "+" + p.slice(1).replace(/\D/g, "") : p.replace(/\D/g, "");
    const digits = normalized.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return false;
    return /^\+?\d{8,15}$/.test(normalized);
  }

  // ---------------- CUSTOMERS (fallback) ----------------
  const CustomersFallback = {
    KEY: "customers",
    loadCustomers() {
      try {
        const arr = JSON.parse(localStorage.getItem(this.KEY) || "[]");
        return Array.isArray(arr) ? arr : [];
      } catch { return []; }
    },
    saveCustomers(list) {
      localStorage.setItem(this.KEY, JSON.stringify(list));
    },
    getCustomer(phone) {
      const p = trim(phone);
      return this.loadCustomers().find((c) => trim(c.phone) === p) || null;
    },
    ensureCustomer(phone, fullName) {
      const p = trim(phone);
      const n = trim(fullName);
      if (!p || !n) return;

      const list = this.loadCustomers();
      const idx = list.findIndex((c) => trim(c.phone) === p);

      if (idx >= 0) {
        if (n && trim(list[idx].fullName) !== n) list[idx].fullName = n;
      } else {
        list.push({ phone: p, fullName: n });
      }
      this.saveCustomers(list);
    },
  };

  function CustomersLib() {
    return window.CustomersLib && typeof window.CustomersLib.loadCustomers === "function"
      ? window.CustomersLib
      : CustomersFallback;
  }

  // ---------------- SETTINGS ----------------
  function defaultSettings() {
    return { defaultDurationMin: 90, bufferMin: 10 };
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_SET) || "null");
      const d = defaultSettings();
      if (!raw) return d;
      return {
        defaultDurationMin: Math.max(15, safeNum(raw.defaultDurationMin ?? d.defaultDurationMin)),
        bufferMin: Math.max(0, safeNum(raw.bufferMin ?? d.bufferMin)),
      };
    } catch {
      return defaultSettings();
    }
  }

  function saveSettings(s) {
    localStorage.setItem(KEY_SET, JSON.stringify(s));
  }

  // ---------------- RESERVATIONS ----------------
  function newId() {
    return `RES-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
  }

  function loadReservations() {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY_RES) || "[]");
      if (!Array.isArray(arr)) return [];
      return arr
        .map((r) => ({
          id: String(r.id || ""),
          name: trim(r.name),
          phone: trim(r.phone),
          date: String(r.date || ""),
          time: String(r.time || ""),
          dateTimeISO: String(r.dateTimeISO || ""),
          party: Math.max(1, Math.floor(safeNum(r.party || 1))),
          table: String(r.table || ""),
          durationMin: Math.max(15, safeNum(r.durationMin || 0)),
          status: String(r.status || "booked"),
          notes: String(r.notes || ""),
          cancelReason: String(r.cancelReason || ""),
          createdAtISO: String(r.createdAtISO || nowISO()),
          updatedAtISO: String(r.updatedAtISO || nowISO()),
          deletedAtISO: String(r.deletedAtISO || ""),
        }))
        .filter((r) => r.id && r.name && r.phone && r.date && r.time && r.dateTimeISO);
    } catch {
      return [];
    }
  }

  function saveReservations(list) {
    localStorage.setItem(KEY_RES, JSON.stringify(list));
  }

  function activeReservations(list) {
    return list.filter((r) => !r.deletedAtISO);
  }

  // ---------------- TABLES ----------------
  function loadTableIds() {
    let tablesObj = {};
    try { tablesObj = JSON.parse(localStorage.getItem(KEY_TABLES) || "{}") || {}; } catch { tablesObj = {}; }
    const keys = Object.keys(tablesObj);
    const list = keys.length
      ? keys.sort((a, b) => Number(a) - Number(b))
      : Array.from({ length: 10 }, (_, i) => String(i + 1));
    return list.map(String);
  }

  function populateTableSelect() {
    const select = el("resTable");
    if (!select) return;
    const ids = loadTableIds();
    select.innerHTML = `<option value="">Any Table</option>`;
    ids.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = `Table ${t}`;
      select.appendChild(opt);
    });
  }

  // ---------------- CONFLICTS ----------------
  function isActiveForConflicts(status) {
    return status === "booked" || status === "arrived" || status === "seated";
  }

  function reservationWindow(r, settings) {
    const start = new Date(r.dateTimeISO).getTime();
    const dur = r.durationMin || settings.defaultDurationMin;
    const end = start + dur * 60 * 1000;
    return { start, end };
  }

  function overlapsWithBuffer(aStart, aEnd, bStart, bEnd, bufferMin) {
    const buf = bufferMin * 60 * 1000;
    const A1 = aStart - buf, A2 = aEnd + buf;
    const B1 = bStart - buf, B2 = bEnd + buf;
    return A1 < B2 && A2 > B1;
  }

  function findConflict(candidate, list, settings) {
    if (!candidate.table) return null;
    const { start: cStart, end: cEnd } = reservationWindow(candidate, settings);
    const buffer = settings.bufferMin || 0;

    for (const r of list) {
      if (r.deletedAtISO) continue;
      if (!r.table) continue;
      if (r.table !== candidate.table) continue;
      if (!isActiveForConflicts(r.status)) continue;
      if (candidate.id && r.id === candidate.id) continue;

      const { start: rStart, end: rEnd } = reservationWindow(r, settings);
      if (overlapsWithBuffer(cStart, cEnd, rStart, rEnd, buffer)) return r;
    }
    return null;
  }

  function findFreeTable(candidate, list, settings, allTables) {
    for (const t of allTables) {
      const test = { ...candidate, table: String(t) };
      if (!findConflict(test, list, settings)) return String(t);
    }
    return "";
  }

  // ---------------- UI BADGES ----------------
  function statusBadge(status) {
    const map = {
      booked: ["b-booked", "Booked"],
      arrived: ["b-arrived", "Arrived"],
      seated: ["b-seated", "Seated"],
      completed: ["b-completed", "Completed"],
      cancelled: ["b-cancelled", "Cancelled"],
      no_show: ["b-no_show", "No-Show"],
    };
    const [cls, label] = map[status] || ["b-booked", "Booked"];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  // ---------------- DOM ----------------
  const formTitle = el("formTitle");
  const formMsg = el("formMsg");
  const beirutClock = el("beirutClock");

  const editId = el("editId");
  const resName = el("resName");
  const resPhone = el("resPhone");
  const resDate = el("resDate");
  const resTime = el("resTime");
  const resParty = el("resParty");
  const resTable = el("resTable");
  const resDuration = el("resDuration");
  const resStatus = el("resStatus");
  const resNotes = el("resNotes");

  const autoAssignMode = el("autoAssignMode");
  const autoAssignBtn = el("autoAssignBtn");

  const saveResBtn = el("saveResBtn");
  const seatOpenBtn = el("seatOpenBtn");
  const clearResBtn = el("clearResBtn");

  const qbToday = el("qbToday");
  const qbTomorrow = el("qbTomorrow");
  const qbNextHour = el("qbNextHour");
  const qbClear = el("qbClear");

  const setDefaultDuration = el("setDefaultDuration");
  const setBuffer = el("setBuffer");
  const saveSettingsBtn = el("saveSettingsBtn");
  const resetSettingsBtn = el("resetSettingsBtn");

  const searchBox = el("searchBox");
  const dateView = el("dateView");
  const pickDate = el("pickDate");
  const statusFilter = el("statusFilter");

  const exportBtn = el("exportBtn");
  const restoreInput = el("restoreInput");

  const resBody = el("resBody");

  const statShown = el("statShown");
  const statBooked = el("statBooked");
  const statArrived = el("statArrived");
  const statSeated = el("statSeated");

  const viewDialog = el("viewDialog");
  const viewCloseBtn = el("viewCloseBtn");
  const viewOkBtn = el("viewOkBtn");
  const viewEditBtn = el("viewEditBtn");
  const viewDeleteBtn = el("viewDeleteBtn");

  const viewTitle = el("viewTitle");
  const vCustomer = el("vCustomer");
  const vPhone = el("vPhone");
  const vParty = el("vParty");
  const vDateTime = el("vDateTime");
  const vTable = el("vTable");
  const vStatus = el("vStatus");
  const vNotes = el("vNotes");

  const qaArrived = el("qaArrived");
  const qaSeatOpen = el("qaSeatOpen");
  const qaComplete = el("qaComplete");
  const qaCancel = el("qaCancel");
  const qaNoShow = el("qaNoShow");

  const cancelReason = el("cancelReason");
  const openPosLink = el("openPosLink");

  const customersPhones = el("customersPhones");

  // ---------------- MESSAGES ----------------
  function showMsg(type, text) {
    if (!formMsg) return;
    formMsg.className = "msg " + (type === "ok" ? "ok" : "err");
    formMsg.textContent = text;
    formMsg.style.display = "block";
  }
  function hideMsg() {
    if (!formMsg) return;
    formMsg.style.display = "none";
    formMsg.textContent = "";
  }

  // ---------------- FILTERS PERSIST ----------------
  function saveFilters() {
    try {
      localStorage.setItem(KEY_FILTERS, JSON.stringify({
        q: searchBox?.value || "",
        dv: dateView?.value || "upcoming",
        pd: pickDate?.value || "",
        sf: statusFilter?.value || "all"
      }));
    } catch {}
  }

  function loadFilters() {
    try {
      const f = JSON.parse(localStorage.getItem(KEY_FILTERS) || "null");
      if (!f) return;
      if (searchBox && typeof f.q === "string") searchBox.value = f.q;
      if (dateView && typeof f.dv === "string") dateView.value = f.dv;
      if (pickDate && typeof f.pd === "string") pickDate.value = f.pd;
      if (statusFilter && typeof f.sf === "string") statusFilter.value = f.sf;
    } catch {}
  }

  function syncPickDate() {
    if (!pickDate || !dateView) return;
    const on = dateView.value === "date";
    pickDate.disabled = !on;
    pickDate.style.opacity = on ? "1" : "0.6";
  }

  // ---------------- CUSTOMERS DATALIST ----------------
  function loadCustomersDatalist() {
    if (!customersPhones) return;
    customersPhones.innerHTML = "";
    const lib = CustomersLib();
    const list = lib.loadCustomers ? lib.loadCustomers() : [];
    list.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = trim(c.phone);
      opt.label = c.fullName ? `${c.fullName} (${c.phone})` : c.phone;
      customersPhones.appendChild(opt);
    });
  }

  function autofillNameByPhone(phone) {
    const lib = CustomersLib();
    if (!lib.getCustomer) return;
    const c = lib.getCustomer(phone);
    if (c && c.fullName && resName && !trim(resName.value)) resName.value = c.fullName;
  }

  function ensureCustomer(phone, name) {
    const lib = CustomersLib();
    if (lib.ensureCustomer) lib.ensureCustomer(phone, name);
    loadCustomersDatalist();
  }

  // ---------------- SETTINGS UI ----------------
  function applySettingsUI() {
    const s = loadSettings();
    if (setDefaultDuration) setDefaultDuration.value = String(s.defaultDurationMin);
    if (setBuffer) setBuffer.value = String(s.bufferMin);
  }

  // ---------------- FORM DEFAULTS (EXACT BEIRUT TIME) ----------------
  function setFormToBeirutNow() {
    const d = beirutNow();
    if (resDate) resDate.value = dateKeyFromDate(d);
    if (resTime) resTime.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function setFormToBeirutNextHour() {
    // EXACT: Beirut now + 1 hour, keep minutes (no rounding)
    const d = beirutNow();
    d.setHours(d.getHours() + 1);
    if (resDate) resDate.value = dateKeyFromDate(d);
    if (resTime) resTime.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function clearForm() {
    if (editId) editId.value = "";
    if (formTitle) formTitle.textContent = "New Reservation";
    if (saveResBtn) saveResBtn.textContent = "Save Reservation";

    if (resName) resName.value = "";
    if (resPhone) resPhone.value = "";
    if (resParty) resParty.value = "";
    if (resTable) resTable.value = "";
    if (resDuration) resDuration.value = "";
    if (resStatus) resStatus.value = "booked";
    if (resNotes) resNotes.value = "";

    // ✅ default is Beirut actual time (not next hour)
    setFormToBeirutNow();
    hideMsg();
  }

  // ---------------- READ FORM ----------------
  function normalizeFromForm() {
    const name = trim(resName?.value);
    const phone = trim(resPhone?.value);
    const date = trim(resDate?.value);
    const time = trim(resTime?.value);
    const party = Math.max(1, Math.floor(safeNum(resParty?.value)));
    const table = trim(resTable?.value);
    const status = trim(resStatus?.value) || "booked";
    const notes = String(resNotes?.value || "");

    const settings = loadSettings();
    const durationMin = resDuration?.value
      ? Math.max(15, safeNum(resDuration.value))
      : settings.defaultDurationMin;

    if (!name) throw new Error("Full name is required.");
    if (!phone) throw new Error("Phone number is required.");
    if (!validPhone(phone)) throw new Error("Phone format is invalid. Example: +96170123456");
    if (!date) throw new Error("Date is required.");
    if (!time) throw new Error("Time is required.");
    if (!party || party < 1) throw new Error("Party size must be an integer ≥ 1.");
    if (durationMin < 15) throw new Error("Duration must be at least 15 minutes.");

    const dateTimeISO = beirutWallToISO(date, time);
    const id = editId?.value ? String(editId.value) : newId();

    return { id, name, phone, date, time, dateTimeISO, party, table, durationMin, status, notes };
  }

  // ---------------- FILTER + STATS ----------------
  function getFilteredList() {
    const all = activeReservations(loadReservations());
    const q = trim(searchBox?.value).toLowerCase();
    const s = statusFilter?.value || "all";
    const view = dateView?.value || "upcoming";
    const pick = pickDate?.value || "";

    const todayKey = dateKeyFromDate(beirutNow());
    let out = all;

    if (view === "today") {
      out = out.filter((r) => r.date === todayKey);
    } else if (view === "upcoming") {
      const now = Date.now();
      out = out.filter((r) => new Date(r.dateTimeISO).getTime() >= now - 60 * 60 * 1000);
    } else if (view === "date") {
      const use = pick || todayKey;
      out = out.filter((r) => r.date === use);
    }

    if (s !== "all") out = out.filter((r) => r.status === s);

    if (q) {
      out = out.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        (r.notes || "").toLowerCase().includes(q) ||
        (r.cancelReason || "").toLowerCase().includes(q) ||
        (r.table ? `table ${r.table}` : "any table").includes(q)
      );
    }

    out.sort((a, b) => new Date(a.dateTimeISO).getTime() - new Date(b.dateTimeISO).getTime());
    return out;
  }

  function refreshStats(list) {
    if (statShown) statShown.textContent = String(list.length);
    if (statBooked) statBooked.textContent = String(list.filter((r) => r.status === "booked").length);
    if (statArrived) statArrived.textContent = String(list.filter((r) => r.status === "arrived").length);
    if (statSeated) statSeated.textContent = String(list.filter((r) => r.status === "seated").length);
  }

  // ---------------- RENDER ----------------
  function render() {
    if (!resBody) return;
    saveFilters();
    syncPickDate();

    const list = getFilteredList();
    resBody.innerHTML = "";

    if (!list.length) {
      resBody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#7f8c8d;">No reservations found</td></tr>`;
      refreshStats([]);
      return;
    }

    list.forEach((r) => {
      const tr = document.createElement("tr");
      const tableText = r.table ? `Table ${r.table}` : "Any";
      const noteText =
        trim(r.notes) ? esc(r.notes)
          : trim(r.cancelReason) ? `<span style="color:#c0392b;font-weight:900;">Cancel:</span> ${esc(r.cancelReason)}`
          : "—";

      tr.innerHTML = `
        <td><strong>${esc(fmtBeirut(r.dateTimeISO))}</strong><div style="color:#7f8c8d;font-size:.82rem;margin-top:4px;">Dur: ${r.durationMin}m</div></td>
        <td><div><strong>${esc(r.name)}</strong></div><div style="color:#7f8c8d;font-size:.82rem;">${esc(r.phone)}</div></td>
        <td>${r.party}</td>
        <td>${esc(tableText)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${noteText}</td>
        <td>
          <div class="actions">
            <button class="abtn view" data-act="view" data-id="${esc(r.id)}">View</button>
            <button class="abtn edit" data-act="edit" data-id="${esc(r.id)}">Edit</button>
            <button class="abtn seat" data-act="seat" data-id="${esc(r.id)}">Seat</button>
            <button class="abtn cancel" data-act="cancel" data-id="${esc(r.id)}">Cancel</button>
            <button class="abtn del" data-act="del" data-id="${esc(r.id)}">Delete</button>
          </div>
        </td>
      `;
      resBody.appendChild(tr);
    });

    resBody.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-act");
        const id = btn.getAttribute("data-id");
        if (!id) return;

        if (act === "view") openView(id);
        if (act === "edit") loadIntoForm(id);
        if (act === "seat") seatAndOpenPOS(id);
        if (act === "cancel") {
          const reason = prompt("Cancel reason (optional):", "") || "";
          cancelReservation(id, reason);
        }
        if (act === "del") softDeleteReservation(id);
      });
    });

    refreshStats(list);
  }

  // ---------------- UPSERT ----------------
  function upsertReservation({ forceSeat = false } = {}) {
    if (!storageOk()) {
      showMsg("err", "Storage is blocked. Use VS Code Live Server (http://localhost/...) not file://.");
      return;
    }

    try {
      const settings = loadSettings();
      const list = loadReservations();
      const allTables = loadTableIds();

      let r = normalizeFromForm();

      // Customers: must be added/updated when saved
      ensureCustomer(r.phone, r.name);

      const mode = autoAssignMode?.value || "save";
      const autoOnSave = mode === "save" || mode === "both";

      if (!r.table && autoOnSave) {
        const free = findFreeTable(r, list, settings, allTables);
        if (free) r.table = free;
      }

      if (r.table) {
        const conflict = findConflict(r, list, settings);
        if (conflict) {
          throw new Error(`Conflict: Table ${r.table} overlaps with ${conflict.name} at ${fmtBeirut(conflict.dateTimeISO)}.`);
        }
      }

      const now = nowISO();
      const idx = list.findIndex((x) => x.id === r.id);

      if (idx >= 0) {
        const keepCreated = list[idx].createdAtISO || now;
        const keepCancel = list[idx].cancelReason || "";
        const keepDeleted = list[idx].deletedAtISO || "";
        list[idx] = { ...list[idx], ...r, createdAtISO: keepCreated, updatedAtISO: now, cancelReason: keepCancel, deletedAtISO: keepDeleted };
        showMsg("ok", "Reservation updated.");
      } else {
        list.push({ ...r, cancelReason: "", createdAtISO: now, updatedAtISO: now, deletedAtISO: "" });
        showMsg("ok", "Reservation saved.");
      }

      saveReservations(list);
      render();

      if (forceSeat) {
        seatAndOpenPOS(r.id);
        return;
      }

      clearForm();
    } catch (e) {
      showMsg("err", e?.message || "Failed to save reservation.");
    }
  }

  // ---------------- LOAD INTO FORM ----------------
  function loadIntoForm(id) {
    const r = activeReservations(loadReservations()).find((x) => x.id === id);
    if (!r) return alert("Reservation not found.");

    editId.value = r.id;
    formTitle.textContent = "Edit Reservation";
    saveResBtn.textContent = "Update Reservation";

    resName.value = r.name;
    resPhone.value = r.phone;
    resDate.value = r.date;
    resTime.value = r.time;
    resParty.value = String(r.party);
    resTable.value = r.table || "";
    resDuration.value = String(r.durationMin || "");
    resStatus.value = r.status || "booked";
    resNotes.value = r.notes || "";

    showMsg("ok", "Editing reservation. Update fields then press Update.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------------- STATUS / CANCEL / DELETE ----------------
  function setStatus(id, status, extra = {}) {
    const list = loadReservations();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return;

    const keepCancel = status === "cancelled" ? String(extra.cancelReason || "") : (list[idx].cancelReason || "");
    list[idx] = { ...list[idx], status, cancelReason: keepCancel, updatedAtISO: nowISO(), ...extra };

    saveReservations(list);
    render();
  }

  function cancelReservation(id, reason) {
    const r = activeReservations(loadReservations()).find((x) => x.id === id);
    if (!r) return;
    if (!confirm(`Cancel reservation for ${r.name} (${r.phone})?`)) return;
    setStatus(id, "cancelled", { cancelReason: trim(reason) || "" });
  }

  function softDeleteReservation(id) {
    const list = loadReservations();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return;

    const r = list[idx];
    if (!confirm(`Delete reservation for ${r.name} (${r.phone})?\nThis is a soft delete (audit-friendly).`)) return;

    list[idx] = { ...r, deletedAtISO: nowISO(), updatedAtISO: nowISO() };
    saveReservations(list);
    render();
  }

  // ---------------- AUTO ASSIGN NOW BUTTON ----------------
  function autoAssignNow() {
    try {
      const settings = loadSettings();
      const list = loadReservations();
      const allTables = loadTableIds();

      const r = normalizeFromForm();
      if (r.table) {
        showMsg("ok", `Table already selected (Table ${r.table}).`);
        return;
      }

      const free = findFreeTable(r, list, settings, allTables);
      if (!free) {
        showMsg("err", "No free table found for this time. Change time or keep “Any Table”.");
        return;
      }

      resTable.value = free;
      showMsg("ok", `Assigned Table ${free}.`);
    } catch (e) {
      showMsg("err", e?.message || "Auto-assign failed.");
    }
  }

  // ---------------- POS HANDOFF ----------------
  function seatAndOpenPOS(id) {
    const settings = loadSettings();
    const list = loadReservations();
    const allTables = loadTableIds();

    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return alert("Reservation not found.");

    const r = list[idx];

    if (r.deletedAtISO) return alert("This reservation is deleted.");
    if (r.status === "cancelled" || r.status === "completed" || r.status === "no_show") {
      return alert("This reservation cannot be seated due to its status.");
    }

    const mode = autoAssignMode?.value || "save";
    const autoOnSeat = mode === "seat" || mode === "both";

    let table = r.table;

    if (!table) {
      if (!autoOnSeat) {
        showMsg("err", "No table assigned. Set Auto-assign to On Seat (or pick a table) to seat.");
        return;
      }
      const free = findFreeTable(r, list, settings, allTables);
      if (!free) {
        showMsg("err", "No free table available right now. Change time or free a table.");
        return;
      }
      table = free;
      r.table = free;
    }

    const conflict = findConflict({ ...r, table }, list, settings);
    if (conflict && conflict.id !== r.id) {
      showMsg("err", `Cannot seat: Table ${table} conflicts with ${conflict.name} at ${fmtBeirut(conflict.dateTimeISO)}.`);
      return;
    }

    list[idx] = { ...r, table: String(table), status: "seated", updatedAtISO: nowISO() };
    saveReservations(list);

    ensureCustomer(r.phone, r.name);

    const handoff = {
      reservationId: r.id,
      phone: r.phone,
      name: r.name,
      party: r.party,
      notes: r.notes || "",
      table: String(table),
      datetimeISO: r.dateTimeISO,
      datetimeBeirut: fmtBeirut(r.dateTimeISO),
      source: "reservations",
      createdAtISO: nowISO(),
    };
    localStorage.setItem(KEY_POS_HANDOFF, JSON.stringify(handoff));

    // ✅ still linked to index.html
    window.location.href = `index.html?table=${encodeURIComponent(String(table))}&phone=${encodeURIComponent(r.phone)}&res=${encodeURIComponent(r.id)}`;
  }

  // ---------------- VIEW DIALOG ----------------
  let currentViewId = null;

  function openView(id) {
    const r = activeReservations(loadReservations()).find((x) => x.id === id);
    if (!r) return alert("Reservation not found.");

    currentViewId = id;

    viewTitle.textContent = `Reservation: ${r.name}`;
    vCustomer.textContent = r.name;
    vPhone.textContent = r.phone;
    vParty.textContent = String(r.party);
    vDateTime.textContent = fmtBeirut(r.dateTimeISO);
    vTable.textContent = r.table ? `Table ${r.table}` : "Any";
    vStatus.innerHTML = statusBadge(r.status);

    const notesText = trim(r.notes) ? r.notes : (trim(r.cancelReason) ? `CANCEL: ${r.cancelReason}` : "—");
    vNotes.textContent = notesText;
    cancelReason.value = "";

    openPosLink.href = r.table
      ? `index.html?table=${encodeURIComponent(r.table)}&phone=${encodeURIComponent(r.phone)}&res=${encodeURIComponent(r.id)}`
      : `index.html?phone=${encodeURIComponent(r.phone)}&res=${encodeURIComponent(r.id)}`;

    viewDialog.showModal();
  }

  function closeView() {
    currentViewId = null;
    viewDialog.close();
  }

  // ---------------- BACKUP / RESTORE ----------------
  function backup() {
    const payload = {
      exportedAtISO: nowISO(),
      settings: loadSettings(),
      reservations: loadReservations(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `reservations-backup-${dateKeyFromDate(beirutNow())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  function cleanRestoredReservations(arr) {
    const settings = loadSettings();
    return arr
      .filter((r) => r && r.id && r.name && r.phone && r.date && r.time && r.dateTimeISO)
      .map((r) => ({
        id: String(r.id),
        name: trim(r.name),
        phone: trim(r.phone),
        date: String(r.date),
        time: String(r.time),
        dateTimeISO: String(r.dateTimeISO),
        party: Math.max(1, Math.floor(safeNum(r.party || 1))),
        table: String(r.table || ""),
        durationMin: Math.max(15, safeNum(r.durationMin || settings.defaultDurationMin)),
        status: String(r.status || "booked"),
        notes: String(r.notes || ""),
        cancelReason: String(r.cancelReason || ""),
        createdAtISO: String(r.createdAtISO || nowISO()),
        updatedAtISO: String(r.updatedAtISO || nowISO()),
        deletedAtISO: String(r.deletedAtISO || ""),
      }));
  }

  function restoreFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"));
        if (!data || !Array.isArray(data.reservations)) throw new Error("Invalid backup format.");

        const incoming = cleanRestoredReservations(data.reservations);
        const existing = loadReservations();

        const merge = confirm("Restore mode:\n\nOK = MERGE\nCancel = REPLACE");

        let finalList = [];
        if (merge) {
          const map = new Map(existing.map((r) => [r.id, r]));
          for (const r of incoming) map.set(r.id, r);
          finalList = Array.from(map.values());
        } else {
          finalList = incoming;
        }

        saveReservations(finalList);

        if (data.settings && typeof data.settings === "object") {
          saveSettings({
            defaultDurationMin: Math.max(15, safeNum(data.settings.defaultDurationMin || 90)),
            bufferMin: Math.max(0, safeNum(data.settings.bufferMin || 10)),
          });
        }

        applySettingsUI();
        populateTableSelect();
        loadCustomersDatalist();
        render();

        alert("Restore completed successfully.");
      } catch (e) {
        alert(e?.message || "Restore failed.");
      }
    };
    reader.readAsText(file);
  }

  // ---------------- CLOCK ----------------
  function tickClock() {
    if (!beirutClock) return;
    const d = beirutNow();
    beirutClock.textContent = `Beirut: ${dateKeyFromDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // ---------------- INIT ----------------
  function init() {
    if (!storageOk()) {
      showMsg("err", "Storage is blocked. Use VS Code Live Server (http://localhost/...) not file://.");
    }

    populateTableSelect();
    applySettingsUI();
    loadCustomersDatalist();

    loadFilters();
    if (pickDate && !pickDate.value) pickDate.value = dateKeyFromDate(beirutNow());
    syncPickDate();

    // ✅ default: Beirut actual time
    setFormToBeirutNow();

    render();

    tickClock();
    setInterval(tickClock, 15000);
  }

  // ---------------- EVENTS ----------------
  saveResBtn.addEventListener("click", () => upsertReservation({ forceSeat: false }));
  seatOpenBtn.addEventListener("click", () => upsertReservation({ forceSeat: true }));
  clearResBtn.addEventListener("click", clearForm);

  qbToday.addEventListener("click", () => { resDate.value = dateKeyFromDate(beirutNow()); hideMsg(); });
  qbTomorrow.addEventListener("click", () => { const d = beirutNow(); d.setDate(d.getDate() + 1); resDate.value = dateKeyFromDate(d); hideMsg(); });

  // ✅ Next Hour = Beirut now + 1 hour (exact)
  qbNextHour.addEventListener("click", () => { setFormToBeirutNextHour(); hideMsg(); });

  qbClear.addEventListener("click", () => { clearForm(); hideMsg(); });

  autoAssignBtn.addEventListener("click", autoAssignNow);

  saveSettingsBtn.addEventListener("click", () => {
    const s = {
      defaultDurationMin: Math.max(15, safeNum(setDefaultDuration.value)),
      bufferMin: Math.max(0, safeNum(setBuffer.value)),
    };
    saveSettings(s);
    showMsg("ok", "Settings saved.");
  });

  resetSettingsBtn.addEventListener("click", () => {
    saveSettings(defaultSettings());
    applySettingsUI();
    showMsg("ok", "Settings reset.");
  });

  [searchBox, dateView, pickDate, statusFilter].forEach((x) => {
    x.addEventListener("input", () => { saveFilters(); render(); });
    x.addEventListener("change", () => { saveFilters(); render(); });
  });

  resPhone.addEventListener("input", () => autofillNameByPhone(resPhone.value));

  exportBtn.addEventListener("click", backup);

  restoreInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    restoreFromFile(file);
    restoreInput.value = "";
  });

  // Dialog buttons
  viewCloseBtn.addEventListener("click", closeView);
  viewOkBtn.addEventListener("click", closeView);

  viewEditBtn.addEventListener("click", () => {
    if (!currentViewId) return;
    const id = currentViewId;
    closeView();
    loadIntoForm(id);
  });

  viewDeleteBtn.addEventListener("click", () => {
    if (!currentViewId) return;
    const id = currentViewId;
    closeView();
    softDeleteReservation(id);
  });

  qaArrived.addEventListener("click", () => currentViewId && setStatus(currentViewId, "arrived"));
  qaSeatOpen.addEventListener("click", () => currentViewId && seatAndOpenPOS(currentViewId));
  qaComplete.addEventListener("click", () => currentViewId && confirm("Mark as Completed?") && setStatus(currentViewId, "completed"));
  qaNoShow.addEventListener("click", () => currentViewId && confirm("Mark as No-Show?") && setStatus(currentViewId, "no_show"));

  qaCancel.addEventListener("click", () => {
    if (!currentViewId) return;
    cancelReservation(currentViewId, cancelReason.value);
    closeView();
  });

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
