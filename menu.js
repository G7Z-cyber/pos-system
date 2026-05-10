console.log("menu loaded");

(() => {
  let dishes = [];
  let ingredientOptions = [];
  let editingDishId = null;

  const dishName = document.getElementById("dishName");
  const dishCategory = document.getElementById("dishCategory");
  const dishPrice = document.getElementById("dishPrice");

  // Optional metric fields — if you add them in HTML, they will auto-fill.
  const dishRecipeCost = document.getElementById("dishRecipeCost");
  const dishProfit = document.getElementById("dishProfit");
  const dishMarkup = document.getElementById("dishMarkup");
  const dishMargin = document.getElementById("dishMargin");

  const ingredientsList = document.getElementById("ingredientsList");
  const addIngredientBtn = document.getElementById("addIngredientBtn");
  const saveDishBtn = document.getElementById("saveDishBtn");
  const menuBody = document.getElementById("menuBody");
  const searchDish = document.getElementById("searchDish");
  const formTitle = document.getElementById("formTitle");

  const UNITS = ["g", "kg", "ml", "L", "pcs"];

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

  function formatMoney(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function safeNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function convertToBaseUnit(qty, fromUnit, toUnit) {
    const q = safeNum(qty);
    const from = String(fromUnit || "").trim().toLowerCase();
    const to = String(toUnit || "").trim().toLowerCase();

    if (!q || !from || !to || from === to) return q;

    if (from === "kg" && to === "g") return q * 1000;
    if (from === "g" && to === "kg") return q / 1000;

    if ((from === "l" || from === "lt") && to === "ml") return q * 1000;
    if (from === "ml" && (to === "l" || to === "lt")) return q / 1000;

    // pcs stays pcs
    return q;
  }

  async function fetchInventoryItems() {
    await ensureAccessToken();

    const { data, error } = await window.sb
      .from("inventory_items")
      .select(`
        id,
        name,
        unit,
        base_unit,
        is_active,
        inventory_stock (
          avg_cost
        )
      `)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    return (data || []).map((item) => ({
      id: item.id,
      name: item.name,
      // use base_unit first because stock cost is stored per base unit
      unit: item.base_unit || item.unit || "",
      avg_cost: safeNum(item.inventory_stock?.avg_cost ?? item.inventory_stock?.[0]?.avg_cost ?? 0)
    }));
  }

  async function fetchDishes() {
    await ensureAccessToken();

    const { data: products, error: productError } = await window.sb
      .from("products")
      .select("id, name, category, price, is_active")
      .eq("is_active", true)
      .order("id", { ascending: true });

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
      const productId = Number(row.product_id);
      if (!grouped.has(productId)) grouped.set(productId, []);

      grouped.get(productId).push({
        inventory_item_id: Number(row.inventory_item_id),
        name: row.inventory_items?.name || "Unknown Ingredient",
        qty: safeNum(row.quantity_required),
        unit: row.unit || ""
      });
    });

    return (products || []).map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      price: safeNum(p.price),
      ingredients: grouped.get(Number(p.id)) || []
    }));
  }

  function buildIngredientOptionsHtml(selectedId = "") {
    return `
      <option value="">— Select Ingredient —</option>
      ${ingredientOptions.map((item) => `
        <option
          value="${item.id}"
          data-unit="${escapeHtml(item.unit || "")}"
          data-avg-cost="${safeNum(item.avg_cost)}"
          ${String(item.id) === String(selectedId) ? "selected" : ""}
        >
          ${escapeHtml(item.name)}
        </option>
      `).join("")}
    `;
  }

  function getRecipeMetrics() {
    const rows = [...document.querySelectorAll(".ingredient-row")];
    let recipeCost = 0;

    rows.forEach((row) => {
      const ingredientSelect = row.children[0];
      const qtyInput = row.children[1];
      const unitSelect = row.children[2];

      const ingredientId = Number(ingredientSelect?.value || 0);
      const usedQty = safeNum(qtyInput?.value);
      const usedUnit = unitSelect?.value || "";

      if (!ingredientId || !usedQty || !usedUnit) return;

      const ingredient = ingredientOptions.find((x) => Number(x.id) === ingredientId);
      if (!ingredient) return;

      const baseQty = convertToBaseUnit(usedQty, usedUnit, ingredient.unit);
      const lineCost = baseQty * safeNum(ingredient.avg_cost);

      recipeCost += lineCost;
    });

    const sellingPrice = safeNum(dishPrice?.value);
    const profit = sellingPrice - recipeCost;
    const markup = recipeCost > 0 ? ((profit / recipeCost) * 100) : 0;
    const margin = sellingPrice > 0 ? ((profit / sellingPrice) * 100) : 0;

    return {
      recipeCost,
      sellingPrice,
      profit,
      markup,
      margin
    };
  }

  function updateRecipeMetricsUI() {
    const metrics = getRecipeMetrics();

    if (dishRecipeCost) dishRecipeCost.value = formatMoney(metrics.recipeCost);
    if (dishProfit) dishProfit.value = formatMoney(metrics.profit);
    if (dishMarkup) dishMarkup.value = `${metrics.markup.toFixed(1)}%`;
    if (dishMargin) dishMargin.value = `${metrics.margin.toFixed(1)}%`;

    return metrics;
  }

  function addIngredientRow(prefill = { inventory_item_id: "", qty: "", unit: "" }) {
    const row = document.createElement("div");
    row.className = "ingredient-row";

    const ingredientSelect = document.createElement("select");
    ingredientSelect.innerHTML = buildIngredientOptionsHtml(prefill.inventory_item_id);

    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "0.01";
    qtyInput.step = "0.01";
    qtyInput.placeholder = "Qty";
    qtyInput.value = prefill.qty ?? "";

    const unitSelect = document.createElement("select");
    UNITS.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      if (u === prefill.unit) opt.selected = true;
      unitSelect.appendChild(opt);
    });

    ingredientSelect.addEventListener("change", () => {
      const selected = ingredientSelect.options[ingredientSelect.selectedIndex];
      const defaultUnit = selected?.dataset?.unit || "";

      if (defaultUnit) {
        unitSelect.value = defaultUnit;
      }

      updateRecipeMetricsUI();
    });

    qtyInput.addEventListener("input", updateRecipeMetricsUI);
    unitSelect.addEventListener("change", updateRecipeMetricsUI);

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-ing";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.onclick = () => {
      row.remove();
      updateRecipeMetricsUI();
    };

    row.append(ingredientSelect, qtyInput, unitSelect, removeBtn);
    ingredientsList.appendChild(row);

    updateRecipeMetricsUI();
  }

  function clearMetricFields() {
    if (dishRecipeCost) dishRecipeCost.value = "$0.00";
    if (dishProfit) dishProfit.value = "$0.00";
    if (dishMarkup) dishMarkup.value = "0.0%";
    if (dishMargin) dishMargin.value = "0.0%";
  }

  function clearForm() {
    if (dishName) dishName.value = "";
    if (dishPrice) dishPrice.value = "";
    if (dishCategory) dishCategory.value = "";
    if (ingredientsList) ingredientsList.innerHTML = "";

    clearMetricFields();

    editingDishId = null;

    if (formTitle) formTitle.textContent = "Add New Dish";
    if (saveDishBtn) {
      saveDishBtn.textContent = "Add Dish";
      saveDishBtn.style.backgroundColor = "";
    }

    addIngredientRow();
  }

  function calculateStoredDishCost(dish) {
    let totalCost = 0;

    (dish.ingredients || []).forEach((ing) => {
      const item = ingredientOptions.find((x) => Number(x.id) === Number(ing.inventory_item_id));
      if (!item) return;

      const baseQty = convertToBaseUnit(ing.qty, ing.unit, item.unit);
      totalCost += baseQty * safeNum(item.avg_cost);
    });

    return totalCost;
  }

  function renderMenu(filtered = null) {
    if (!menuBody) return;

    menuBody.innerHTML = "";
    const list = filtered || dishes;

    if (!list.length) {
      menuBody.innerHTML = `<tr><td colspan="5">No dishes found.</td></tr>`;
      return;
    }

    list.forEach((dish) => {
      const tr = document.createElement("tr");

      const ingList = (dish.ingredients || [])
        .map((x) => `${x.name} (${x.qty}${x.unit})`)
        .join(", ");

      tr.innerHTML = `
        <td>${escapeHtml(dish.name)}</td>
        <td>${escapeHtml(dish.category)}</td>
        <td>$${safeNum(dish.price).toFixed(2)}</td>
        <td>${escapeHtml(ingList)}</td>
        <td class="action-buttons">
          <button class="edit-btn" type="button" data-edit-dish="${dish.id}">✏️</button>
          <button class="delete-btn" type="button" data-delete-dish="${dish.id}">🗑️</button>
        </td>
      `;

      menuBody.appendChild(tr);
    });
  }

  async function loadMenuPage() {
    try {
      ingredientOptions = await fetchInventoryItems();
      dishes = await fetchDishes();
      renderMenu();
      clearForm();
    } catch (err) {
      console.error("Failed to load menu page:", err);
      alert(err.message || "Failed to load menu page.");
    }
  }

  function collectValidIngredients() {
    const rows = [...document.querySelectorAll(".ingredient-row")];
    const ingredients = [];

    rows.forEach((row) => {
      const ingredientSelect = row.children[0];
      const qtyInput = row.children[1];
      const unitSelect = row.children[2];

      const ingredientId = Number(ingredientSelect?.value || 0);
      const ingredientLabel =
        ingredientSelect?.options?.[ingredientSelect.selectedIndex]?.text || "";
      const ingQty = safeNum(qtyInput?.value);
      const ingUnit = unitSelect?.value || "";

      if (ingredientId && ingQty > 0 && ingUnit) {
        ingredients.push({
          inventory_item_id: ingredientId,
          name: ingredientLabel,
          qty: ingQty,
          unit: ingUnit
        });
      }
    });

    return ingredients;
  }

  async function saveDish() {
    const name = String(dishName?.value || "").trim();
    const category = dishCategory?.value || "";
    const price = safeNum(dishPrice?.value);

    if (!name || !category || price <= 0) {
      alert("Please enter a valid dish name, category, and price.");
      return;
    }

    const ingredients = collectValidIngredients();

    if (!ingredients.length) {
      alert("Please add at least one valid ingredient.");
      return;
    }

    try {
      await ensureAccessToken();

      let productId = editingDishId;

      if (editingDishId) {
        const { error: updateError } = await window.sb
          .from("products")
          .update({
            name,
            category,
            price
          })
          .eq("id", editingDishId);

        if (updateError) throw updateError;

        const { error: deleteRecipeError } = await window.sb
          .from("recipe_items")
          .delete()
          .eq("product_id", editingDishId);

        if (deleteRecipeError) throw deleteRecipeError;
      } else {
        const { data: inserted, error: insertError } = await window.sb
          .from("products")
          .insert([{
            name,
            category,
            price,
            is_active: true
          }])
          .select("id")
          .single();

        if (insertError) throw insertError;
        productId = inserted.id;
      }

      const recipePayload = ingredients.map((ing) => ({
        product_id: productId,
        inventory_item_id: ing.inventory_item_id,
        quantity_required: ing.qty,
        unit: ing.unit
      }));

      const { error: recipeInsertError } = await window.sb
        .from("recipe_items")
        .insert(recipePayload);

      if (recipeInsertError) throw recipeInsertError;

      await loadMenuPage();
      alert(editingDishId ? "Dish updated successfully." : "Dish added successfully.");
    } catch (err) {
      console.error("Failed to save dish:", err);
      alert(err.message || "Failed to save dish.");
    }
  }

  function editDishById(id) {
    const dish = dishes.find((d) => Number(d.id) === Number(id));
    if (!dish) return;

    editingDishId = dish.id;

    if (dishName) dishName.value = dish.name || "";
    if (dishCategory) dishCategory.value = dish.category || "";
    if (dishPrice) dishPrice.value = dish.price ?? "";

    if (ingredientsList) ingredientsList.innerHTML = "";

    (dish.ingredients || []).forEach((ing) => {
      addIngredientRow({
        inventory_item_id: ing.inventory_item_id,
        qty: ing.qty,
        unit: ing.unit
      });
    });

    if (!dish.ingredients?.length) addIngredientRow();

    if (formTitle) formTitle.textContent = "Edit Dish";
    if (saveDishBtn) {
      saveDishBtn.textContent = "Update Dish";
      saveDishBtn.style.backgroundColor = "#ffeaa7";
    }

    updateRecipeMetricsUI();
  }

  async function deleteDishById(id) {
    const confirmed = confirm("Are you sure you want to delete this dish?");
    if (!confirmed) return;

    try {
      await ensureAccessToken();

      const { error } = await window.sb
        .from("products")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;

      await loadMenuPage();
      alert("Dish deleted successfully.");
    } catch (err) {
      console.error("Failed to delete dish:", err);
      alert(err.message || "Failed to delete dish.");
    }
  }

  if (addIngredientBtn) {
    addIngredientBtn.addEventListener("click", () => addIngredientRow());
  }

  if (saveDishBtn) {
    saveDishBtn.addEventListener("click", saveDish);
  }

  if (dishPrice) {
    dishPrice.addEventListener("input", updateRecipeMetricsUI);
  }

  if (searchDish) {
    searchDish.addEventListener("input", () => {
      const keyword = String(searchDish.value || "").toLowerCase();
      const filtered = dishes.filter((dish) =>
        String(dish.name || "").toLowerCase().includes(keyword)
      );
      renderMenu(filtered);
    });
  }

  if (menuBody) {
    menuBody.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-edit-dish]");
      if (editBtn) {
        editDishById(Number(editBtn.getAttribute("data-edit-dish")));
        return;
      }

      const deleteBtn = e.target.closest("[data-delete-dish]");
      if (deleteBtn) {
        deleteDishById(Number(deleteBtn.getAttribute("data-delete-dish")));
      }
    });
  }

  document.addEventListener("DOMContentLoaded", loadMenuPage);
})();