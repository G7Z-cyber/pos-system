console.log("admin loaded");

(() => {
  let editingSupplierId = null;
  let editingIngredientId = null;
  let currentSupplierDetailsId = null;
  let cachedSuppliers = [];

  async function ensureAccessToken() {
    if (window.ACCESS_TOKEN) return window.ACCESS_TOKEN;

    if (!window.sb) throw new Error("Supabase client not found");

    const { data, error } = await window.sb.auth.getSession();
    if (error) throw error;

    const token = data?.session?.access_token || null;
    if (!token) throw new Error("Missing ACCESS_TOKEN (not logged in)");

    window.ACCESS_TOKEN = token;
    return token;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showTableMessage(tbodyId, colspan, message) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = `
      <tr>
        <td colspan="${colspan}" class="empty-cell">${escapeHtml(message)}</td>
      </tr>
    `;
  }

  async function fetchSuppliers() {
    await ensureAccessToken();

    const { data, error } = await window.sb
      .from("Suppliers")
      .select("id, name, is_active, address, contact_person, phone, email, notes")
      .eq("is_active", true)
      .order("id", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function renderSuppliersTable(rows) {
    const tbody = document.getElementById("suppliersTableBody");
    if (!tbody) return;

    if (!rows.length) {
      showTableMessage("suppliersTableBody", 3, "No suppliers yet");
      return;
    }

    tbody.innerHTML = rows.map(row => `
      <tr>
        <td>
          <button
            type="button"
            class="link-btn supplier-name-btn"
            data-supplier-view="${row.id}"
          >
            ${escapeHtml(row.name)}
          </button>
        </td>
        <td>${row.is_active ? "Active" : "Inactive"}</td>
        <td>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button
              type="button"
              class="secondary-btn supplier-edit-btn"
              data-id="${row.id}"
              data-name="${escapeHtml(row.name)}"
            >
              Edit
            </button>

            <button
              type="button"
              class="danger-btn supplier-delete-btn"
              data-id="${row.id}"
              data-name="${escapeHtml(row.name)}"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  function renderIngredientSupplierOptions(rows) {
    const select = document.getElementById("ingredientSupplier");
    if (!select) return;

    select.innerHTML = `
      <option value="">— Select Supplier —</option>
      ${rows.map(row => `
        <option value="${row.id}">${escapeHtml(row.name)}</option>
      `).join("")}
    `;
  }

  async function loadSuppliersSection() {
    try {
      const rows = await fetchSuppliers();
      cachedSuppliers = rows;
      renderSuppliersTable(rows);
      renderIngredientSupplierOptions(rows);
    } catch (err) {
      console.error("Failed to load suppliers:", err);
      showTableMessage("suppliersTableBody", 3, "Failed to load suppliers");
    }
  }

  async function saveSupplier() {
    const input = document.getElementById("supplierName");
    const saveBtn = document.getElementById("saveSupplierBtn");
    if (!input || !saveBtn) return;

    const name = input.value.trim();
    if (!name) {
      alert("Please enter a supplier name.");
      return;
    }

    try {
      await ensureAccessToken();

      if (editingSupplierId) {
        const { error } = await window.sb
          .from("Suppliers")
          .update({ name })
          .eq("id", editingSupplierId);

        if (error) throw error;

        input.value = "";
        editingSupplierId = null;
        saveBtn.textContent = "Save Supplier";

        await loadSuppliersSection();
        alert("Supplier updated successfully.");
        return;
      }

      const { error } = await window.sb
        .from("Suppliers")
        .insert([{
          name,
          is_active: true
        }]);

      if (error) throw error;

      input.value = "";
      await loadSuppliersSection();
      alert("Supplier saved successfully.");
    } catch (err) {
      console.error("Failed to save supplier:", err);
      alert(err.message || "Failed to save supplier.");
    }
  }

  function openSupplierModal(row) {
    const modal = document.getElementById("supplierModal");
    if (!modal || !row) return;

    currentSupplierDetailsId = row.id;

    document.getElementById("modalSupplierName").value = row.name || "";
    document.getElementById("modalSupplierContact").value = row.contact_person || "";
    document.getElementById("modalSupplierPhone").value = row.phone || "";
    document.getElementById("modalSupplierEmail").value = row.email || "";
    document.getElementById("modalSupplierAddress").value = row.address || "";
    document.getElementById("modalSupplierNotes").value = row.notes || "";

    modal.classList.remove("hidden");
  }

  function closeSupplierModal() {
    const modal = document.getElementById("supplierModal");
    if (!modal) return;

    modal.classList.add("hidden");
    currentSupplierDetailsId = null;
  }

  async function saveSupplierDetails() {
    if (!currentSupplierDetailsId) return;

    try {
      await ensureAccessToken();

      const payload = {
        name: document.getElementById("modalSupplierName").value.trim(),
        contact_person: document.getElementById("modalSupplierContact").value.trim(),
        phone: document.getElementById("modalSupplierPhone").value.trim(),
        email: document.getElementById("modalSupplierEmail").value.trim(),
        address: document.getElementById("modalSupplierAddress").value.trim(),
        notes: document.getElementById("modalSupplierNotes").value.trim()
      };

      const { error } = await window.sb
        .from("Suppliers")
        .update(payload)
        .eq("id", currentSupplierDetailsId);

      if (error) throw error;

      closeSupplierModal();
      await loadSuppliersSection();
      alert("Supplier details updated successfully.");
    } catch (err) {
      console.error("Failed to save supplier details:", err);
      alert(err.message || "Failed to save supplier details.");
    }
  }

  function bindSupplierTableClicks() {
    const tbody = document.getElementById("suppliersTableBody");
    if (!tbody) return;

    tbody.addEventListener("click", async (e) => {
      const viewBtn = e.target.closest(".supplier-name-btn");
      if (viewBtn) {
        const id = Number(viewBtn.getAttribute("data-supplier-view"));
        const row = cachedSuppliers.find(s => Number(s.id) === id);
        if (!row) return;

        openSupplierModal(row);
        return;
      }

      const editBtn = e.target.closest(".supplier-edit-btn");
      if (editBtn) {
        const id = Number(editBtn.dataset.id);
        const name = editBtn.dataset.name || "";

        const input = document.getElementById("supplierName");
        const saveBtn = document.getElementById("saveSupplierBtn");

        if (input) input.value = name;
        editingSupplierId = id;

        if (saveBtn) saveBtn.textContent = "Update Supplier";
        return;
      }

      const deleteBtn = e.target.closest(".supplier-delete-btn");
      if (deleteBtn) {
        const id = Number(deleteBtn.dataset.id);
        const name = deleteBtn.dataset.name || "this supplier";

        const confirmed = confirm(`Delete ${name}?`);
        if (!confirmed) return;

        try {
          await ensureAccessToken();

          const { error } = await window.sb
            .from("Suppliers")
            .update({ is_active: false })
            .eq("id", id);

          if (error) throw error;

          if (editingSupplierId === id) {
            editingSupplierId = null;
            const input = document.getElementById("supplierName");
            const saveBtn = document.getElementById("saveSupplierBtn");
            if (input) input.value = "";
            if (saveBtn) saveBtn.textContent = "Save Supplier";
          }

          await loadSuppliersSection();
          alert("Supplier deleted successfully.");
        } catch (err) {
          console.error("Failed to delete supplier:", err);
          alert(err.message || "Failed to delete supplier.");
        }
      }
    });
  }

  async function fetchIngredients() {
    await ensureAccessToken();

    const { data, error } = await window.sb
      .from("inventory_items")
      .select("id, name, supplier_id, unit, is_active")
      .eq("is_active", true)
      .order("id", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function renderIngredientsTable() {
    const tbody = document.getElementById("ingredientsTableBody");
    if (!tbody) return;

    try {
      const [ingredients, suppliers] = await Promise.all([
        fetchIngredients(),
        fetchSuppliers()
      ]);

      const supplierMap = new Map(suppliers.map(s => [Number(s.id), s.name]));

      if (!ingredients.length) {
        showTableMessage("ingredientsTableBody", 5, "No ingredients yet");
        return;
      }

      tbody.innerHTML = ingredients.map(row => `
        <tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(supplierMap.get(Number(row.supplier_id)) || "-")}</td>
          <td>${escapeHtml(row.unit || "-")}</td>
          <td>${row.is_active ? "Active" : "Inactive"}</td>
          <td>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button
                type="button"
                class="secondary-btn ingredient-edit-btn"
                data-id="${row.id}"
                data-name="${escapeHtml(row.name)}"
                data-supplier="${row.supplier_id ?? ""}"
                data-unit="${escapeHtml(row.unit || "")}"
              >
                Edit
              </button>

              <button
                type="button"
                class="danger-btn ingredient-delete-btn"
                data-id="${row.id}"
                data-name="${escapeHtml(row.name)}"
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
      `).join("");
    } catch (err) {
      console.error("Failed to load ingredients:", err);
      showTableMessage("ingredientsTableBody", 5, "Failed to load ingredients");
    }
  }

  async function loadIngredientsSection() {
    await renderIngredientsTable();
  }

  function resetIngredientForm() {
    const nameInput = document.getElementById("ingredientName");
    const supplierSelect = document.getElementById("ingredientSupplier");
    const unitSelect = document.getElementById("ingredientUnit");
    const saveBtn = document.getElementById("saveIngredientBtn");

    if (nameInput) nameInput.value = "";
    if (supplierSelect) supplierSelect.value = "";
    if (unitSelect) unitSelect.value = "";

    editingIngredientId = null;

    if (saveBtn) saveBtn.textContent = "Save Ingredient";
  }

  async function saveIngredient() {
    const nameInput = document.getElementById("ingredientName");
    const supplierSelect = document.getElementById("ingredientSupplier");
    const unitSelect = document.getElementById("ingredientUnit");
    const saveBtn = document.getElementById("saveIngredientBtn");

    if (!nameInput || !supplierSelect || !unitSelect || !saveBtn) {
      alert("Ingredient form is missing fields.");
      return;
    }

    const name = nameInput.value.trim();
    const supplierId = supplierSelect.value ? Number(supplierSelect.value) : null;
    const unit = unitSelect.value;

    if (!name) {
      alert("Please enter an ingredient name.");
      return;
    }

    if (!supplierId) {
      alert("Please select a supplier.");
      return;
    }

    if (!unit) {
      alert("Please select a unit.");
      return;
    }

    try {
      await ensureAccessToken();

      if (editingIngredientId) {
        const { error } = await window.sb
          .from("inventory_items")
          .update({
            name,
            supplier_id: supplierId,
            unit
          })
          .eq("id", editingIngredientId);

        if (error) throw error;

        resetIngredientForm();
        await loadIngredientsSection();
        alert("Ingredient updated successfully.");
      } else {
        const { error } = await window.sb
          .from("inventory_items")
          .insert([{
            name,
            supplier_id: supplierId,
            unit,
            is_active: true
          }]);

        if (error) throw error;

        resetIngredientForm();
        await loadIngredientsSection();
        alert("Ingredient saved successfully.");
      }
    } catch (err) {
      console.error("Failed to save ingredient:", err);
      alert(err.message || "Failed to save ingredient.");
    }
  }

  function bindIngredientTableClicks() {
    const tbody = document.getElementById("ingredientsTableBody");
    if (!tbody) return;

    tbody.addEventListener("click", async (e) => {
      const editBtn = e.target.closest(".ingredient-edit-btn");
      if (editBtn) {
        const id = Number(editBtn.dataset.id);
        const name = editBtn.dataset.name || "";
        const supplier = editBtn.dataset.supplier || "";
        const unit = editBtn.dataset.unit || "";

        const nameInput = document.getElementById("ingredientName");
        const supplierSelect = document.getElementById("ingredientSupplier");
        const unitSelect = document.getElementById("ingredientUnit");
        const saveBtn = document.getElementById("saveIngredientBtn");

        if (nameInput) nameInput.value = name;
        if (supplierSelect) supplierSelect.value = supplier;
        if (unitSelect) unitSelect.value = unit;

        editingIngredientId = id;

        if (saveBtn) saveBtn.textContent = "Update Ingredient";
        return;
      }

      const deleteBtn = e.target.closest(".ingredient-delete-btn");
      if (deleteBtn) {
        const id = Number(deleteBtn.dataset.id);
        const name = deleteBtn.dataset.name || "this ingredient";

        const confirmed = confirm(`Delete ${name}?`);
        if (!confirmed) return;

        try {
          await ensureAccessToken();

          const { error } = await window.sb
            .from("inventory_items")
            .update({ is_active: false })
            .eq("id", id);

          if (error) throw error;

          if (editingIngredientId === id) {
            resetIngredientForm();
          }

          await loadIngredientsSection();
          alert("Ingredient deleted successfully.");
        } catch (err) {
          console.error("Failed to delete ingredient:", err);
          alert(err.message || "Failed to delete ingredient.");
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      bindSupplierTableClicks();
      bindIngredientTableClicks();

      const saveSupplierBtn = document.getElementById("saveSupplierBtn");
      if (saveSupplierBtn) {
        saveSupplierBtn.addEventListener("click", saveSupplier);
      }

      const saveIngredientBtn = document.getElementById("saveIngredientBtn");
      if (saveIngredientBtn) {
        saveIngredientBtn.addEventListener("click", saveIngredient);
      }

      await loadSuppliersSection();
      await loadIngredientsSection();
    } catch (err) {
      console.error("Admin page startup failed:", err);
      alert(err.message || "Admin page failed to load.");
    }

    const closeSupplierModalBtn = document.getElementById("closeSupplierModalBtn");
    if (closeSupplierModalBtn) {
      closeSupplierModalBtn.addEventListener("click", closeSupplierModal);
    }

    const saveSupplierDetailsBtn = document.getElementById("saveSupplierDetailsBtn");
    if (saveSupplierDetailsBtn) {
      saveSupplierDetailsBtn.addEventListener("click", saveSupplierDetails);
    }
  });
})();