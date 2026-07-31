import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

// supabase-js, js/vendor/supabase.js içinde yerel olarak yükleniyor
// (bkz. index.html) — bir CDN'e bağımlı kalmamak için bilerek böyle.
if (!window.supabase || !window.supabase.createClient) {
  document.body.innerHTML = `
    <div style="padding:40px;font-family:sans-serif;color:#e2584a;max-width:520px;margin:60px auto;line-height:1.6">
      <strong>Uygulama başlatılamadı.</strong><br />
      <code>js/vendor/supabase.js</code> yüklenemedi. Dosyanın repo içinde
      <code>js/vendor/supabase.js</code> konumunda olduğundan emin ol.
    </div>`;
  throw new Error("supabase-js bulunamadı (js/vendor/supabase.js)");
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log(`cemizgezek-helper ${APP_VERSION}`);

/* =========================================================
   DOM referansları
   ========================================================= */
const $ = (id) => document.getElementById(id);

const loginScreen = $("login-screen");
const appScreen = $("app-screen");
const loginForm = $("login-form");
const loginError = $("login-error");
const loginSubmit = $("login-submit");

const userEmailEl = $("user-email");
const logoutBtn = $("logout-btn");

const adminToggleWrap = $("admin-toggle-wrap");
const adminToggle = $("admin-toggle");
const sidebarAdmin = $("sidebar-admin");

const searchInput = $("search-input");
const categoryNav = $("category-nav");
const addCategoryBtn = $("add-category-btn");
const addConditionBtn = $("add-condition-btn");

const listView = $("condition-list-view");
const listTitle = $("list-title");
const listCount = $("list-count");
const conditionGrid = $("condition-grid");
const emptyState = $("empty-state");

const detailView = $("condition-detail-view");
const backBtn = $("back-btn");
const detailCategory = $("detail-category");
const detailName = $("detail-name");
const detailSummary = $("detail-summary");
const detailAdminActions = $("detail-admin-actions");
const editConditionBtn = $("edit-condition-btn");
const deleteConditionBtn = $("delete-condition-btn");

const tipList = $("tip-list");
const tipEmpty = $("tip-empty");
const prescriptionList = $("prescription-list");
const prescriptionEmpty = $("prescription-empty");
const emergencyList = $("emergency-list");
const emergencyEmpty = $("emergency-empty");

const modalOverlay = $("modal-overlay");
const modalTitle = $("modal-title");
const modalForm = $("modal-form");
const modalFields = $("modal-fields");
const modalError = $("modal-error");
const modalClose = $("modal-close");
const modalCancel = $("modal-cancel");
const modalSubmit = $("modal-submit");

const toastEl = $("toast");

/* =========================================================
   Durum (state)
   ========================================================= */
const state = {
  session: null,
  profile: null,
  categories: [],
  conditions: [],
  activeCategoryId: "all",
  searchTerm: "",
  activeCondition: null,
  adminMode: false,
};

let modalOnSubmit = null;

/* =========================================================
   Yardımcılar
   ========================================================= */
function showToast(message, type = "") {
  toastEl.textContent = message;
  toastEl.className = "toast" + (type ? ` toast-${type}` : "");
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* =========================================================
   AUTH
   ========================================================= */
async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await onLoggedIn(session);
  } else {
    showLogin();
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) {
      await onLoggedIn(session);
    } else if (event === "SIGNED_OUT") {
      showLogin();
    }
  });
}

function showLogin() {
  state.session = null;
  state.profile = null;
  loginScreen.hidden = false;
  appScreen.hidden = true;
}

async function onLoggedIn(session) {
  state.session = session;
  loginScreen.hidden = true;
  appScreen.hidden = false;
  userEmailEl.textContent = session.user.email;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, is_admin")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error(error);
  }
  state.profile = profile || { is_admin: false };

  adminToggleWrap.hidden = !state.profile.is_admin;
  if (!state.profile.is_admin) {
    state.adminMode = false;
    adminToggle.checked = false;
  }
  applyAdminModeUI();

  await loadCategories();
  await loadConditions();
  renderCategoryNav();
  renderConditionGrid();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const email = $("login-email").value.trim();
  const password = $("login-password").value;

  loginSubmit.disabled = true;
  loginSubmit.querySelector(".btn-label").textContent = "Giriş yapılıyor…";
  loginSubmit.querySelector(".btn-spinner").hidden = false;

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      loginError.textContent = "Giriş başarısız: " + (error.message || "e-posta veya şifre hatalı.");
      loginError.hidden = false;
    }
  } catch (err) {
    console.error(err);
    loginError.textContent = "Beklenmeyen bir hata oluştu: " + (err.message || err);
    loginError.hidden = false;
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.querySelector(".btn-label").textContent = "Giriş yap";
    loginSubmit.querySelector(".btn-spinner").hidden = true;
  }
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

/* =========================================================
   Yönetici modu
   ========================================================= */
adminToggle.addEventListener("change", () => {
  state.adminMode = adminToggle.checked;
  applyAdminModeUI();
});

function applyAdminModeUI() {
  const on = state.adminMode;
  sidebarAdmin.hidden = !on;
  detailAdminActions.hidden = !on || !state.activeCondition;
  document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !on; });
}

/* =========================================================
   VERİ ÇEKME
   ========================================================= */
async function loadCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });
  if (error) { console.error(error); showToast("Kategoriler yüklenemedi.", "error"); return; }
  state.categories = data || [];
}

async function loadConditions() {
  const { data, error } = await supabase
    .from("conditions")
    .select("id, category_id, name, summary, sort_order")
    .order("sort_order", { ascending: true });
  if (error) { console.error(error); showToast("Durumlar yüklenemedi.", "error"); return; }
  state.conditions = data || [];
}

async function loadConditionDetail(conditionId) {
  const [tipsRes, rxRes, erRes] = await Promise.all([
    supabase.from("tips").select("id, content, sort_order").eq("condition_id", conditionId).order("sort_order"),
    supabase.from("prescriptions").select("id, title, content, sort_order").eq("condition_id", conditionId).order("sort_order"),
    supabase.from("emergency_orders").select("id, title, content, sort_order").eq("condition_id", conditionId).order("sort_order"),
  ]);
  return {
    tips: tipsRes.data || [],
    prescriptions: rxRes.data || [],
    emergencyOrders: erRes.data || [],
  };
}

/* =========================================================
   RENDER: sidebar / kategori navigasyonu
   ========================================================= */
function renderCategoryNav() {
  const counts = new Map();
  state.conditions.forEach((c) => {
    counts.set(c.category_id, (counts.get(c.category_id) || 0) + 1);
  });

  const allItem = `
    <button class="category-item ${state.activeCategoryId === "all" ? "active" : ""}" data-cat="all">
      <span>Tüm durumlar</span>
      <span class="category-count">${state.conditions.length}</span>
    </button>`;

  const items = state.categories.map((cat) => `
    <button class="category-item ${state.activeCategoryId === cat.id ? "active" : ""}" data-cat="${cat.id}">
      <span>${escapeHtml(cat.name)}</span>
      <span class="category-count">${counts.get(cat.id) || 0}</span>
    </button>`).join("");

  categoryNav.innerHTML = allItem + items;

  categoryNav.querySelectorAll(".category-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.cat;
      state.activeCategoryId = val === "all" ? "all" : Number(val);
      renderCategoryNav();
      renderConditionGrid();
    });
  });
}

/* =========================================================
   RENDER: liste görünümü
   ========================================================= */
function getFilteredConditions() {
  return state.conditions.filter((c) => {
    const matchesCat = state.activeCategoryId === "all" || c.category_id === state.activeCategoryId;
    const matchesSearch = !state.searchTerm || c.name.toLowerCase().includes(state.searchTerm) || (c.summary || "").toLowerCase().includes(state.searchTerm);
    return matchesCat && matchesSearch;
  });
}

function categoryName(id) {
  return state.categories.find((c) => c.id === id)?.name || "Kategorisiz";
}

function renderConditionGrid() {
  const filtered = getFilteredConditions();
  const activeCat = state.activeCategoryId === "all" ? "Tüm durumlar" : categoryName(state.activeCategoryId);
  listTitle.textContent = activeCat;
  listCount.textContent = filtered.length ? `${filtered.length} kayıt` : "";

  conditionGrid.innerHTML = filtered.map((c) => `
    <button class="condition-card" data-id="${c.id}">
      <span class="cat-tag">${escapeHtml(categoryName(c.category_id))}</span>
      <h3>${escapeHtml(c.name)}</h3>
      <p>${escapeHtml(c.summary || "")}</p>
    </button>
  `).join("");

  emptyState.hidden = filtered.length !== 0;

  conditionGrid.querySelectorAll(".condition-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(Number(card.dataset.id)));
  });
}

searchInput.addEventListener("input", () => {
  state.searchTerm = searchInput.value.trim().toLowerCase();
  renderConditionGrid();
});

/* =========================================================
   RENDER: detay görünümü
   ========================================================= */
async function openDetail(conditionId) {
  const condition = state.conditions.find((c) => c.id === conditionId);
  if (!condition) return;
  state.activeCondition = condition;

  listView.hidden = true;
  detailView.hidden = false;
  detailAdminActions.hidden = !state.adminMode;

  detailCategory.textContent = categoryName(condition.category_id);
  detailName.textContent = condition.name;
  detailSummary.textContent = condition.summary || "";

  tipList.innerHTML = "";
  prescriptionList.innerHTML = "";
  emergencyList.innerHTML = "";

  const { tips, prescriptions, emergencyOrders } = await loadConditionDetail(conditionId);
  state.activeCondition.tips = tips;
  state.activeCondition.prescriptions = prescriptions;
  state.activeCondition.emergencyOrders = emergencyOrders;

  renderTips(tips);
  renderPrescriptions(prescriptions);
  renderEmergencyOrders(emergencyOrders);
  applyAdminModeUI();
}

function renderTips(tips) {
  tipEmpty.hidden = tips.length !== 0;
  tipList.innerHTML = tips.map((t) => `
    <li data-id="${t.id}">
      <div class="item-text">${escapeHtml(t.content)}</div>
      <div class="item-admin-row admin-only" ${state.adminMode ? "" : "hidden"}>
        <button class="btn btn-outline btn-xs" data-action="edit-tip" data-id="${t.id}">Düzenle</button>
        <button class="btn btn-danger-outline btn-xs" data-action="delete-tip" data-id="${t.id}">Sil</button>
      </div>
    </li>
  `).join("");
  bindItemAdminActions();
}

function renderPrescriptions(items) {
  prescriptionEmpty.hidden = items.length !== 0;
  prescriptionList.innerHTML = items.map((p) => `
    <div class="rx-card" data-id="${p.id}">
      <div class="rx-card-title">${escapeHtml(p.title || "Reçete")}</div>
      <div class="rx-card-content">${escapeHtml(p.content)}</div>
      <div class="item-admin-row admin-only" ${state.adminMode ? "" : "hidden"}>
        <button class="btn btn-outline btn-xs" data-action="edit-prescription" data-id="${p.id}">Düzenle</button>
        <button class="btn btn-danger-outline btn-xs" data-action="delete-prescription" data-id="${p.id}">Sil</button>
      </div>
    </div>
  `).join("");
  bindItemAdminActions();
}

function renderEmergencyOrders(items) {
  emergencyEmpty.hidden = items.length !== 0;
  emergencyList.innerHTML = items.map((o) => `
    <div class="emergency-card" data-id="${o.id}">
      <div class="emergency-card-title">${escapeHtml(o.title || "Acil order")}</div>
      <div class="emergency-card-content">${escapeHtml(o.content)}</div>
      <div class="item-admin-row admin-only" ${state.adminMode ? "" : "hidden"}>
        <button class="btn btn-outline btn-xs" data-action="edit-emergency" data-id="${o.id}">Düzenle</button>
        <button class="btn btn-danger-outline btn-xs" data-action="delete-emergency" data-id="${o.id}">Sil</button>
      </div>
    </div>
  `).join("");
  bindItemAdminActions();
}

function bindItemAdminActions() {
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.onclick = () => handleItemAction(btn.dataset.action, Number(btn.dataset.id));
  });
}

backBtn.addEventListener("click", () => {
  state.activeCondition = null;
  detailView.hidden = true;
  listView.hidden = false;
});

/* =========================================================
   MODAL sistemi
   ========================================================= */
function openModal({ title, fields, initialValues = {}, onSubmit }) {
  modalTitle.textContent = title;
  modalError.hidden = true;
  modalFields.innerHTML = fields.map((f) => {
    const val = initialValues[f.name] ?? "";
    if (f.type === "textarea") {
      return `
        <label class="field">
          <span class="field-label">${f.label}</span>
          <textarea name="${f.name}" ${f.required ? "required" : ""} placeholder="${f.placeholder || ""}">${escapeHtml(val)}</textarea>
        </label>`;
    }
    if (f.type === "select") {
      const opts = f.options.map((o) => `<option value="${o.value}" ${String(o.value) === String(val) ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
      return `
        <label class="field">
          <span class="field-label">${f.label}</span>
          <select name="${f.name}">${opts}</select>
        </label>`;
    }
    return `
      <label class="field">
        <span class="field-label">${f.label}</span>
        <input type="text" name="${f.name}" value="${escapeHtml(val)}" ${f.required ? "required" : ""} placeholder="${f.placeholder || ""}" />
      </label>`;
  }).join("");

  modalOnSubmit = onSubmit;
  modalOverlay.hidden = false;
  const firstField = modalFields.querySelector("input, textarea, select");
  if (firstField) firstField.focus();
}

function closeModal() {
  modalOverlay.hidden = true;
  modalOnSubmit = null;
  modalForm.reset();
}

modalClose.addEventListener("click", closeModal);
modalCancel.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

modalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!modalOnSubmit) return;
  const formData = new FormData(modalForm);
  const values = Object.fromEntries(formData.entries());

  modalSubmit.disabled = true;
  modalError.hidden = true;
  try {
    await modalOnSubmit(values);
    closeModal();
  } catch (err) {
    console.error(err);
    modalError.textContent = err.message || "Bir hata oluştu.";
    modalError.hidden = false;
  } finally {
    modalSubmit.disabled = false;
  }
});

/* =========================================================
   ADMIN CRUD — kategori
   ========================================================= */
addCategoryBtn.addEventListener("click", () => {
  openModal({
    title: "Yeni kategori",
    fields: [{ name: "name", label: "Kategori adı", required: true }],
    onSubmit: async (values) => {
      const { error } = await supabase.from("categories").insert({ name: values.name.trim() });
      if (error) throw error;
      await loadCategories();
      renderCategoryNav();
      showToast("Kategori eklendi.", "success");
    },
  });
});

/* =========================================================
   ADMIN CRUD — durum (condition)
   ========================================================= */
function categoryOptions(selectedId) {
  return [
    { value: "", label: "Kategori seç…" },
    ...state.categories.map((c) => ({ value: c.id, label: c.name })),
  ];
}

addConditionBtn.addEventListener("click", () => {
  openModal({
    title: "Yeni durum",
    fields: [
      { name: "name", label: "Durum adı", required: true },
      { name: "category_id", label: "Kategori", type: "select", options: categoryOptions() },
      { name: "summary", label: "Kısa özet", type: "textarea", placeholder: "Bir-iki cümlelik özet…" },
    ],
    onSubmit: async (values) => {
      const { error } = await supabase.from("conditions").insert({
        name: values.name.trim(),
        category_id: values.category_id ? Number(values.category_id) : null,
        summary: values.summary?.trim() || null,
      });
      if (error) throw error;
      await loadConditions();
      renderCategoryNav();
      renderConditionGrid();
      showToast("Durum eklendi.", "success");
    },
  });
});

editConditionBtn.addEventListener("click", () => {
  const c = state.activeCondition;
  openModal({
    title: "Durumu düzenle",
    fields: [
      { name: "name", label: "Durum adı", required: true },
      { name: "category_id", label: "Kategori", type: "select", options: categoryOptions() },
      { name: "summary", label: "Kısa özet", type: "textarea" },
    ],
    initialValues: { name: c.name, category_id: c.category_id ?? "", summary: c.summary ?? "" },
    onSubmit: async (values) => {
      const { error } = await supabase.from("conditions").update({
        name: values.name.trim(),
        category_id: values.category_id ? Number(values.category_id) : null,
        summary: values.summary?.trim() || null,
      }).eq("id", c.id);
      if (error) throw error;
      await loadConditions();
      renderCategoryNav();
      renderConditionGrid();
      await openDetail(c.id);
      showToast("Durum güncellendi.", "success");
    },
  });
});

deleteConditionBtn.addEventListener("click", async () => {
  const c = state.activeCondition;
  if (!confirm(`"${c.name}" durumunu ve tüm bağlı kayıtlarını (tüyolar, reçeteler, acil orderlar) silmek istediğine emin misin?`)) return;
  const { error } = await supabase.from("conditions").delete().eq("id", c.id);
  if (error) { showToast("Silinemedi: " + error.message, "error"); return; }
  await loadConditions();
  renderCategoryNav();
  backBtn.click();
  renderConditionGrid();
  showToast("Durum silindi.", "success");
});

/* =========================================================
   ADMIN CRUD — tüyo / reçete / acil order (ekle)
   ========================================================= */
document.querySelectorAll("[data-add]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.add;
    const conditionId = state.activeCondition.id;

    if (kind === "tip") {
      openModal({
        title: "Yeni tüyo",
        fields: [{ name: "content", label: "İçerik", type: "textarea", required: true }],
        onSubmit: async (values) => {
          const { error } = await supabase.from("tips").insert({ condition_id: conditionId, content: values.content.trim() });
          if (error) throw error;
          await refreshDetail();
          showToast("Tüyo eklendi.", "success");
        },
      });
    } else if (kind === "prescription") {
      openModal({
        title: "Yeni reçete örneği",
        fields: [
          { name: "title", label: "Başlık (opsiyonel)", placeholder: "örn. İlk basamak" },
          { name: "content", label: "Reçete içeriği", type: "textarea", required: true },
        ],
        onSubmit: async (values) => {
          const { error } = await supabase.from("prescriptions").insert({
            condition_id: conditionId, title: values.title?.trim() || null, content: values.content.trim(),
          });
          if (error) throw error;
          await refreshDetail();
          showToast("Reçete örneği eklendi.", "success");
        },
      });
    } else if (kind === "emergency") {
      openModal({
        title: "Yeni acil order",
        fields: [
          { name: "title", label: "Başlık (opsiyonel)", placeholder: "örn. İlk 10 dakika" },
          { name: "content", label: "İçerik", type: "textarea", required: true },
        ],
        onSubmit: async (values) => {
          const { error } = await supabase.from("emergency_orders").insert({
            condition_id: conditionId, title: values.title?.trim() || null, content: values.content.trim(),
          });
          if (error) throw error;
          await refreshDetail();
          showToast("Acil order eklendi.", "success");
        },
      });
    }
  });
});

async function refreshDetail() {
  await openDetail(state.activeCondition.id);
}

/* =========================================================
   ADMIN CRUD — tüyo / reçete / acil order (düzenle / sil)
   ========================================================= */
async function handleItemAction(action, id) {
  const conditionId = state.activeCondition.id;

  if (action === "edit-tip") {
    const item = state.activeCondition.tips.find((t) => t.id === id);
    openModal({
      title: "Tüyoyu düzenle",
      fields: [{ name: "content", label: "İçerik", type: "textarea", required: true }],
      initialValues: { content: item.content },
      onSubmit: async (values) => {
        const { error } = await supabase.from("tips").update({ content: values.content.trim() }).eq("id", id);
        if (error) throw error;
        await refreshDetail();
        showToast("Tüyo güncellendi.", "success");
      },
    });
  } else if (action === "delete-tip") {
    if (!confirm("Bu tüyoyu silmek istediğine emin misin?")) return;
    const { error } = await supabase.from("tips").delete().eq("id", id);
    if (error) { showToast("Silinemedi: " + error.message, "error"); return; }
    await refreshDetail();
    showToast("Tüyo silindi.", "success");
  }

  else if (action === "edit-prescription") {
    const item = state.activeCondition.prescriptions.find((p) => p.id === id);
    openModal({
      title: "Reçete örneğini düzenle",
      fields: [
        { name: "title", label: "Başlık (opsiyonel)" },
        { name: "content", label: "Reçete içeriği", type: "textarea", required: true },
      ],
      initialValues: { title: item.title || "", content: item.content },
      onSubmit: async (values) => {
        const { error } = await supabase.from("prescriptions").update({
          title: values.title?.trim() || null, content: values.content.trim(),
        }).eq("id", id);
        if (error) throw error;
        await refreshDetail();
        showToast("Reçete örneği güncellendi.", "success");
      },
    });
  } else if (action === "delete-prescription") {
    if (!confirm("Bu reçete örneğini silmek istediğine emin misin?")) return;
    const { error } = await supabase.from("prescriptions").delete().eq("id", id);
    if (error) { showToast("Silinemedi: " + error.message, "error"); return; }
    await refreshDetail();
    showToast("Reçete örneği silindi.", "success");
  }

  else if (action === "edit-emergency") {
    const item = state.activeCondition.emergencyOrders.find((o) => o.id === id);
    openModal({
      title: "Acil orderı düzenle",
      fields: [
        { name: "title", label: "Başlık (opsiyonel)" },
        { name: "content", label: "İçerik", type: "textarea", required: true },
      ],
      initialValues: { title: item.title || "", content: item.content },
      onSubmit: async (values) => {
        const { error } = await supabase.from("emergency_orders").update({
          title: values.title?.trim() || null, content: values.content.trim(),
        }).eq("id", id);
        if (error) throw error;
        await refreshDetail();
        showToast("Acil order güncellendi.", "success");
      },
    });
  } else if (action === "delete-emergency") {
    if (!confirm("Bu acil orderı silmek istediğine emin misin?")) return;
    const { error } = await supabase.from("emergency_orders").delete().eq("id", id);
    if (error) { showToast("Silinemedi: " + error.message, "error"); return; }
    await refreshDetail();
    showToast("Acil order silindi.", "success");
  }
}

/* =========================================================
   BAŞLAT
   ========================================================= */
initAuth();
