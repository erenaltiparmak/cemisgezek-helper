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
const listAdminActions = $("list-admin-actions");

const functionNav = $("function-nav");

/* Hastalıklar görünümü */
const searchInput = $("search-input");
const addCategoryBtn = $("add-category-btn");
const addConditionBtn = $("add-condition-btn");

const listView = $("condition-list-view");
const listTitle = $("list-title");
const listCount = $("list-count");
const conditionGrid = $("condition-grid");
const emptyState = $("empty-state");

/* Tanılar görünümü */
const diagnosisView = $("diagnosis-view");
const diagnosisTitle = $("diagnosis-title");
const diagnosisCount = $("diagnosis-count");
const diagnosisGrid = $("diagnosis-grid");
const diagnosisHint = $("diagnosis-hint");
const diagnosisEmpty = $("diagnosis-empty");
const symptomSearchInput = $("symptom-search-input");
const symptomSuggestions = $("symptom-suggestions");
const symptomChips = $("symptom-chips");

/* Detay görünümü */
const detailView = $("condition-detail-view");
const backBtn = $("back-btn");
const detailCategory = $("detail-category");
const detailName = $("detail-name");
const detailSummary = $("detail-summary");
const detailAdminActions = $("detail-admin-actions");
const editConditionBtn = $("edit-condition-btn");
const deleteConditionBtn = $("delete-condition-btn");

const prescriptionList = $("prescription-list");
const prescriptionEmpty = $("prescription-empty");
const emergencyList = $("emergency-list");
const emergencyEmpty = $("emergency-empty");
const linkList = $("link-list");
const linkEmpty = $("link-empty");
const symptomTagList = $("symptom-tag-list");
const symptomTagEmpty = $("symptom-tag-empty");
const addSymptomBtn = $("add-symptom-btn");
const spotList = $("spot-list");
const spotEmpty = $("spot-empty");

/* Modal / toast */
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
  symptoms: [],                       // { id, name }[]
  conditionSymptomsMap: new Map(),    // conditionId -> Set(symptomId)
  searchTerm: "",                     // Hastalıklar aramasi
  selectedSymptomIds: [],             // Tanılar seçili bulgular (sıralı)
  activeCondition: null,
  activeView: "hastaliklar",          // 'hastaliklar' | 'tanilar'
  detailReturnView: "hastaliklar",
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

function normalizeUrl(raw) {
  let url = (raw || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url;
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

  await Promise.all([
    loadCategories(),
    loadConditions(),
    loadSymptoms(),
    loadConditionSymptoms(),
  ]);

  renderConditionGrid();
  setActiveView("hastaliklar");
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
  listAdminActions.hidden = !on;
  detailAdminActions.hidden = !on || !state.activeCondition;
  document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !on; });
}

/* =========================================================
   SOL MENÜ (fonksiyonlar arası geçiş)
   ========================================================= */
functionNav.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});

function setActiveView(view) {
  state.activeView = view;
  functionNav.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));

  state.activeCondition = null;
  detailView.hidden = true;

  if (view === "tanilar") {
    listView.hidden = true;
    diagnosisView.hidden = false;
    renderSymptomChips();
    renderDiagnosisResults();
  } else {
    diagnosisView.hidden = true;
    listView.hidden = false;
  }
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
  if (error) { console.error(error); showToast("Hastalıklar yüklenemedi.", "error"); return; }
  state.conditions = data || [];
}

async function loadSymptoms() {
  const { data, error } = await supabase
    .from("symptoms")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) { console.error(error); showToast("Semptomlar yüklenemedi.", "error"); return; }
  state.symptoms = data || [];
}

async function loadConditionSymptoms() {
  const { data, error } = await supabase
    .from("condition_symptoms")
    .select("condition_id, symptom_id");
  if (error) { console.error(error); return; }
  const map = new Map();
  (data || []).forEach((row) => {
    if (!map.has(row.condition_id)) map.set(row.condition_id, new Set());
    map.get(row.condition_id).add(row.symptom_id);
  });
  state.conditionSymptomsMap = map;
}

async function loadConditionDetail(conditionId) {
  const [rxRes, erRes, linkRes, spotRes] = await Promise.all([
    supabase.from("prescriptions").select("id, title, content, sort_order").eq("condition_id", conditionId).order("sort_order"),
    supabase.from("emergency_orders").select("id, title, content, sort_order").eq("condition_id", conditionId).order("sort_order"),
    supabase.from("useful_links").select("id, title, url, sort_order").eq("condition_id", conditionId).order("sort_order"),
    supabase.from("spot_info").select("id, content, sort_order").eq("condition_id", conditionId).order("sort_order"),
  ]);
  return {
    prescriptions: rxRes.data || [],
    emergencyOrders: erRes.data || [],
    links: linkRes.data || [],
    spotInfo: spotRes.data || [],
  };
}

/* =========================================================
   RENDER: ortak hastalık kartı
   ========================================================= */
function categoryName(id) {
  return state.categories.find((c) => c.id === id)?.name || "Kategorisiz";
}

function renderConditionCard(c) {
  return `
    <button class="condition-card" data-id="${c.id}">
      <span class="cat-tag">${escapeHtml(categoryName(c.category_id))}</span>
      <h3>${escapeHtml(c.name)}</h3>
      <p>${escapeHtml(c.summary || "")}</p>
    </button>`;
}

function bindConditionCards(container) {
  container.querySelectorAll(".condition-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(Number(card.dataset.id)));
  });
}

/* =========================================================
   RENDER: Hastalıklar listesi (sadece arama)
   ========================================================= */
function getFilteredConditions() {
  const term = state.searchTerm;
  if (!term) return state.conditions;
  return state.conditions.filter((c) =>
    c.name.toLowerCase().includes(term) || (c.summary || "").toLowerCase().includes(term)
  );
}

function renderConditionGrid() {
  const filtered = getFilteredConditions();
  listTitle.textContent = "Tüm hastalıklar";
  listCount.textContent = filtered.length ? `${filtered.length} kayıt` : "";

  conditionGrid.innerHTML = filtered.map(renderConditionCard).join("");
  emptyState.hidden = filtered.length !== 0;
  bindConditionCards(conditionGrid);
}

searchInput.addEventListener("input", () => {
  state.searchTerm = searchInput.value.trim().toLowerCase();
  renderConditionGrid();
});

/* =========================================================
   RENDER: Tanılar (bulgu bazlı filtreleme)
   ========================================================= */
function renderSymptomChips() {
  symptomChips.innerHTML = state.selectedSymptomIds.map((id) => {
    const s = state.symptoms.find((sy) => sy.id === id);
    if (!s) return "";
    return `<span class="chip active chip-removable">${escapeHtml(s.name)} <button type="button" class="chip-remove" data-id="${id}" aria-label="Kaldır">&times;</button></span>`;
  }).join("");

  symptomChips.querySelectorAll(".chip-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      state.selectedSymptomIds = state.selectedSymptomIds.filter((x) => x !== id);
      renderSymptomChips();
      renderDiagnosisResults();
    });
  });
}

function renderDiagnosisResults() {
  const selected = state.selectedSymptomIds;

  if (selected.length === 0) {
    diagnosisHint.hidden = false;
    diagnosisEmpty.hidden = true;
    diagnosisGrid.innerHTML = "";
    diagnosisTitle.textContent = "Bulgu seçerek arayın";
    diagnosisCount.textContent = "";
    return;
  }

  diagnosisHint.hidden = true;
  const matches = state.conditions.filter((c) => {
    const set = state.conditionSymptomsMap.get(c.id);
    if (!set) return false;
    return selected.every((sid) => set.has(sid));
  });

  diagnosisTitle.textContent = `${selected.length} bulguya uyan hastalıklar`;
  diagnosisCount.textContent = matches.length ? `${matches.length} kayıt` : "";
  diagnosisGrid.innerHTML = matches.map(renderConditionCard).join("");
  diagnosisEmpty.hidden = matches.length !== 0;
  bindConditionCards(diagnosisGrid);
}

function selectSymptom(id) {
  if (!state.selectedSymptomIds.includes(id)) {
    state.selectedSymptomIds.push(id);
  }
  symptomSearchInput.value = "";
  hideSymptomSuggestions();
  renderSymptomChips();
  renderDiagnosisResults();
  symptomSearchInput.focus();
}

function showSymptomSuggestions(matches) {
  if (matches.length === 0) { hideSymptomSuggestions(); return; }
  symptomSuggestions.innerHTML = matches.map((s) =>
    `<button type="button" class="suggestion-item" data-id="${s.id}">${escapeHtml(s.name)}</button>`
  ).join("");
  symptomSuggestions.hidden = false;
  symptomSuggestions.querySelectorAll(".suggestion-item").forEach((btn) => {
    btn.addEventListener("click", () => selectSymptom(Number(btn.dataset.id)));
  });
}

function hideSymptomSuggestions() {
  symptomSuggestions.hidden = true;
  symptomSuggestions.innerHTML = "";
}

symptomSearchInput.addEventListener("input", () => {
  const term = symptomSearchInput.value.trim().toLowerCase();
  if (!term) { hideSymptomSuggestions(); return; }
  const matches = state.symptoms
    .filter((s) => !state.selectedSymptomIds.includes(s.id))
    .filter((s) => s.name.toLowerCase().includes(term))
    .slice(0, 8);
  showSymptomSuggestions(matches);
});

symptomSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const first = symptomSuggestions.querySelector(".suggestion-item");
    if (first) selectSymptom(Number(first.dataset.id));
  }
});

document.addEventListener("click", (e) => {
  if (symptomSuggestions.hidden) return;
  if (!symptomSuggestions.contains(e.target) && e.target !== symptomSearchInput) {
    hideSymptomSuggestions();
  }
});

/* =========================================================
   RENDER: detay görünümü
   ========================================================= */
async function openDetail(conditionId) {
  const condition = state.conditions.find((c) => c.id === conditionId);
  if (!condition) return;

  state.detailReturnView = state.activeView;
  state.activeCondition = condition;

  listView.hidden = true;
  diagnosisView.hidden = true;
  detailView.hidden = false;
  detailAdminActions.hidden = !state.adminMode;

  detailCategory.textContent = categoryName(condition.category_id);
  detailName.textContent = condition.name;
  detailSummary.textContent = condition.summary || "";

  prescriptionList.innerHTML = "";
  emergencyList.innerHTML = "";
  linkList.innerHTML = "";
  spotList.innerHTML = "";
  symptomTagList.innerHTML = "";

  const { prescriptions, emergencyOrders, links, spotInfo } = await loadConditionDetail(conditionId);
  state.activeCondition.prescriptions = prescriptions;
  state.activeCondition.emergencyOrders = emergencyOrders;
  state.activeCondition.links = links;
  state.activeCondition.spotInfo = spotInfo;

  renderEmergencyOrders(emergencyOrders);
  renderPrescriptions(prescriptions);
  renderLinks(links);
  renderSymptomTags(condition.id);
  renderSpotInfo(spotInfo);
  applyAdminModeUI();
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
      <div class="emergency-card-title">${escapeHtml(o.title || "Acil işlem")}</div>
      <div class="emergency-card-content">${escapeHtml(o.content)}</div>
      <div class="item-admin-row admin-only" ${state.adminMode ? "" : "hidden"}>
        <button class="btn btn-outline btn-xs" data-action="edit-emergency" data-id="${o.id}">Düzenle</button>
        <button class="btn btn-danger-outline btn-xs" data-action="delete-emergency" data-id="${o.id}">Sil</button>
      </div>
    </div>
  `).join("");
  bindItemAdminActions();
}

function renderLinks(items) {
  linkEmpty.hidden = items.length !== 0;
  linkList.innerHTML = items.map((l) => `
    <div class="link-item" data-id="${l.id}">
      <a class="link-open" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
        <span class="link-icon">↗</span>
        <span class="link-title">${escapeHtml(l.title)}</span>
      </a>
      <div class="item-admin-row admin-only" ${state.adminMode ? "" : "hidden"}>
        <button class="btn btn-outline btn-xs" data-action="edit-link" data-id="${l.id}">Düzenle</button>
        <button class="btn btn-danger-outline btn-xs" data-action="delete-link" data-id="${l.id}">Sil</button>
      </div>
    </div>
  `).join("");
  bindItemAdminActions();
}

function renderSpotInfo(items) {
  spotEmpty.hidden = items.length !== 0;
  spotList.innerHTML = items.map((s) => `
    <div class="spot-item" data-id="${s.id}">
      <div>${escapeHtml(s.content)}</div>
      <div class="item-admin-row admin-only" ${state.adminMode ? "" : "hidden"}>
        <button class="btn btn-outline btn-xs" data-action="edit-spot" data-id="${s.id}">Düzenle</button>
        <button class="btn btn-danger-outline btn-xs" data-action="delete-spot" data-id="${s.id}">Sil</button>
      </div>
    </div>
  `).join("");
  bindItemAdminActions();
}

function renderSymptomTags(conditionId) {
  const set = state.conditionSymptomsMap.get(conditionId) || new Set();
  const tags = state.symptoms.filter((s) => set.has(s.id));
  symptomTagEmpty.hidden = tags.length !== 0;
  symptomTagList.innerHTML = tags.map((s) => `
    <span class="symptom-tag" data-id="${s.id}">
      ${escapeHtml(s.name)}
      <button type="button" class="tag-remove admin-only" data-action="remove-symptom" data-id="${s.id}" ${state.adminMode ? "" : "hidden"} aria-label="Kaldır">&times;</button>
    </span>
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
  if (state.detailReturnView === "tanilar") {
    diagnosisView.hidden = false;
  } else {
    listView.hidden = false;
  }
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
    if (f.type === "text-datalist") {
      const listId = `dl-${f.name}-${Math.random().toString(36).slice(2, 8)}`;
      const opts = (f.options || []).map((o) => `<option value="${escapeHtml(o)}"></option>`).join("");
      return `
        <label class="field">
          <span class="field-label">${f.label}</span>
          <input type="text" name="${f.name}" list="${listId}" value="${escapeHtml(val)}" ${f.required ? "required" : ""} placeholder="${f.placeholder || ""}" autocomplete="off" />
          <datalist id="${listId}">${opts}</datalist>
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
      showToast("Kategori eklendi.", "success");
    },
  });
});

/* =========================================================
   ADMIN CRUD — hastalık (condition)
   ========================================================= */
function categoryOptions() {
  return [
    { value: "", label: "Kategori seç…" },
    ...state.categories.map((c) => ({ value: c.id, label: c.name })),
  ];
}

addConditionBtn.addEventListener("click", () => {
  openModal({
    title: "Yeni hastalık",
    fields: [
      { name: "name", label: "Hastalık adı", required: true },
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
      renderConditionGrid();
      showToast("Hastalık eklendi.", "success");
    },
  });
});

editConditionBtn.addEventListener("click", () => {
  const c = state.activeCondition;
  openModal({
    title: "Hastalığı düzenle",
    fields: [
      { name: "name", label: "Hastalık adı", required: true },
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
      renderConditionGrid();
      await openDetail(c.id);
      showToast("Hastalık güncellendi.", "success");
    },
  });
});

deleteConditionBtn.addEventListener("click", async () => {
  const c = state.activeCondition;
  if (!confirm(`"${c.name}" hastalığını ve tüm bağlı kayıtlarını (reçeteler, acil işlemler, linkler, spot bilgiler, semptom bağlantıları) silmek istediğine emin misin?`)) return;
  const { error } = await supabase.from("conditions").delete().eq("id", c.id);
  if (error) { showToast("Silinemedi: " + error.message, "error"); return; }
  await loadConditions();
  state.conditionSymptomsMap.delete(c.id);
  backBtn.click();
  renderConditionGrid();
  showToast("Hastalık silindi.", "success");
});

/* =========================================================
   ADMIN CRUD — semptom (hastalığa bağlama)
   ========================================================= */
async function addSymptomToCondition(conditionId, rawName) {
  const name = rawName.trim();
  if (!name) throw new Error("Semptom adı boş olamaz.");

  let symptom = state.symptoms.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!symptom) {
    const { data, error } = await supabase.from("symptoms").insert({ name }).select().single();
    if (error) throw error;
    symptom = data;
    state.symptoms.push(symptom);
    state.symptoms.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }

  if (!state.conditionSymptomsMap.has(conditionId)) state.conditionSymptomsMap.set(conditionId, new Set());
  const set = state.conditionSymptomsMap.get(conditionId);
  if (set.has(symptom.id)) return false;

  const { error: linkError } = await supabase.from("condition_symptoms").insert({ condition_id: conditionId, symptom_id: symptom.id });
  if (linkError && linkError.code !== "23505") throw linkError;

  set.add(symptom.id);
  return true;
}

addSymptomBtn.addEventListener("click", () => {
  const conditionId = state.activeCondition.id;
  openModal({
    title: "Semptom ekle",
    fields: [
      { name: "name", label: "Semptom / bulgu adı", type: "text-datalist", required: true, options: state.symptoms.map((s) => s.name), placeholder: "örn. Çarpıntı" },
    ],
    onSubmit: async (values) => {
      const added = await addSymptomToCondition(conditionId, values.name);
      renderSymptomTags(conditionId);
      showToast(added ? "Semptom eklendi." : "Bu semptom zaten ekli.", added ? "success" : "");
    },
  });
});

/* =========================================================
   ADMIN CRUD — acil işlem / reçete / link / spot bilgi (ekle)
   ========================================================= */
document.querySelectorAll("[data-add]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.add;
    const conditionId = state.activeCondition.id;

    if (kind === "prescription") {
      openModal({
        title: "Yeni reçete",
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
          showToast("Reçete eklendi.", "success");
        },
      });
    } else if (kind === "emergency") {
      openModal({
        title: "Yeni acil işlem",
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
          showToast("Acil işlem eklendi.", "success");
        },
      });
    } else if (kind === "link") {
      openModal({
        title: "Yeni faydalı link",
        fields: [
          { name: "title", label: "Başlık", required: true, placeholder: "örn. CHA2DS2-VASc Hesaplayıcı" },
          { name: "url", label: "URL", required: true, placeholder: "https://…" },
        ],
        onSubmit: async (values) => {
          const { error } = await supabase.from("useful_links").insert({
            condition_id: conditionId, title: values.title.trim(), url: normalizeUrl(values.url),
          });
          if (error) throw error;
          await refreshDetail();
          showToast("Link eklendi.", "success");
        },
      });
    } else if (kind === "spot") {
      openModal({
        title: "Yeni spot bilgi",
        fields: [{ name: "content", label: "İçerik", type: "textarea", required: true }],
        onSubmit: async (values) => {
          const { error } = await supabase.from("spot_info").insert({
            condition_id: conditionId, content: values.content.trim(),
          });
          if (error) throw error;
          await refreshDetail();
          showToast("Spot bilgi eklendi.", "success");
        },
      });
    }
  });
});

async function refreshDetail() {
  await openDetail(state.activeCondition.id);
}

/* =========================================================
   ADMIN CRUD — acil işlem / reçete / link / spot bilgi / semptom (düzenle / sil)
   ========================================================= */
async function handleItemAction(action, id) {
  const conditionId = state.activeCondition.id;

  if (action === "edit-prescription") {
    const item = state.activeCondition.prescriptions.find((p) => p.id === id);
    openModal({
      title: "Reçeteyi düzenle",
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
        showToast("Reçete güncellendi.", "success");
      },
    });
  } else if (action === "delete-prescription") {
    if (!confirm("Bu reçeteyi silmek istediğine emin misin?")) return;
    const { error } = await supabase.from("prescriptions").delete().eq("id", id);
    if (error) { showToast("Silinemedi: " + error.message, "error"); return; }
    await refreshDetail();
    showToast("Reçete silindi.", "success");
  }

  else if (action === "edit-emergency") {
    const item = state.activeCondition.emergencyOrders.find((o) => o.id === id);
    openModal({
      title: "Acil işlemi düzenle",
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
        showToast("Acil işlem güncellendi.", "success");
      },
    });
  } else if (action === "delete-emergency") {
    if (!confirm("Bu acil işlemi silmek istediğine emin misin?")) return;
    const { error } = await supabase.from("emergency_orders").delete().eq("id", id);
    if (error) { showToast("Silinemedi: " + error.message, "error"); return; }
    await refreshDetail();
    showToast("Acil işlem silindi.", "success");
  }

  else if (action === "edit-link") {
    const item = state.activeCondition.links.find((l) => l.id === id);
    openModal({
      title: "Linki düzenle",
      fields: [
        { name: "title", label: "Başlık", required: true },
        { name: "url", label: "URL", required: true, placeholder: "https://…" },
      ],
      initialValues: { title: item.title, url: item.url },
      onSubmit: async (values) => {
        const { error } = await supabase.from("useful_links").update({
          title: values.title.trim(), url: normalizeUrl(values.url),
        }).eq("id", id);
        if (error) throw error;
        await refreshDetail();
        showToast("Link güncellendi.", "success");
      },
    });
  } else if (action === "delete-link") {
    if (!confirm("Bu linki silmek istediğine emin misin?")) return;
    const { error } = await supabase.from("useful_links").delete().eq("id", id);
    if (error) { showToast("Silinemedi: " + error.message, "error"); return; }
    await refreshDetail();
    showToast("Link silindi.", "success");
  }

  else if (action === "edit-spot") {
    const item = state.activeCondition.spotInfo.find((s) => s.id === id);
    openModal({
      title: "Spot bilgiyi düzenle",
      fields: [{ name: "content", label: "İçerik", type: "textarea", required: true }],
      initialValues: { content: item.content },
      onSubmit: async (values) => {
        const { error } = await supabase.from("spot_info").update({ content: values.content.trim() }).eq("id", id);
        if (error) throw error;
        await refreshDetail();
        showToast("Spot bilgi güncellendi.", "success");
      },
    });
  } else if (action === "delete-spot") {
    if (!confirm("Bu spot bilgiyi silmek istediğine emin misin?")) return;
    const { error } = await supabase.from("spot_info").delete().eq("id", id);
    if (error) { showToast("Silinemedi: " + error.message, "error"); return; }
    await refreshDetail();
    showToast("Spot bilgi silindi.", "success");
  }

  else if (action === "remove-symptom") {
    if (!confirm("Bu semptomu hastalıktan kaldırmak istediğine emin misin?")) return;
    const { error } = await supabase.from("condition_symptoms").delete()
      .eq("condition_id", conditionId).eq("symptom_id", id);
    if (error) { showToast("Kaldırılamadı: " + error.message, "error"); return; }
    state.conditionSymptomsMap.get(conditionId)?.delete(id);
    renderSymptomTags(conditionId);
    showToast("Semptom kaldırıldı.", "success");
  }
}

/* =========================================================
   BAŞLAT
   ========================================================= */
initAuth();
