const config = window.DOBBS_LABELING_CONFIG;
const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);

const labelFields = [
  "human_stance",
  "human_stance_confidence",
  "narrative_frame",
  "stance_evidence_span",
  "stance_notes",
  "is_tjst_prior_correct",
  "is_side_reversal",
  "exclude_from_bert",
  "exclude_reason",
  "row_status"
];

const overlapTarget = 200;

const state = {
  accessCode: localStorage.getItem("dobbs_access_code") || "",
  annotator: null,
  items: [],
  labels: new Map(),
  duplicateGroups: new Map(),
  currentIndex: 0,
  saveTimer: null,
  filteredIndexes: []
};

const els = {
  loginPanel: document.getElementById("loginPanel"),
  appPanel: document.getElementById("appPanel"),
  loginForm: document.getElementById("loginForm"),
  accessCode: document.getElementById("accessCode"),
  loginError: document.getElementById("loginError"),
  annotatorName: document.getElementById("annotatorName"),
  saveStatus: document.getElementById("saveStatus"),
  progressCount: document.getElementById("progressCount"),
  progressDetail: document.getElementById("progressDetail"),
  progressMeter: document.getElementById("progressMeter"),
  overlapNotice: document.getElementById("overlapNotice"),
  sidebarCurrent: document.getElementById("sidebarCurrent"),
  sidebarPrevRow: document.getElementById("sidebarPrevRow"),
  sidebarNextRow: document.getElementById("sidebarNextRow"),
  toggleRowList: document.getElementById("toggleRowList"),
  rowBrowser: document.getElementById("rowBrowser"),
  rowList: document.getElementById("rowList"),
  searchRows: document.getElementById("searchRows"),
  statusFilter: document.getElementById("statusFilter"),
  labelTab: document.getElementById("labelTab"),
  instructionsTab: document.getElementById("instructionsTab"),
  labelView: document.getElementById("labelView"),
  instructionsView: document.getElementById("instructionsView"),
  rowMeta: document.getElementById("rowMeta"),
  rowId: document.getElementById("rowId"),
  duplicateNotice: document.getElementById("duplicateNotice"),
  tweetText: document.getElementById("tweetText"),
  labelForm: document.getElementById("labelForm"),
  prevRow: document.getElementById("prevRow"),
  nextRow: document.getElementById("nextRow"),
  markDraft: document.getElementById("markDraft"),
  markComplete: document.getElementById("markComplete"),
  exportMine: document.getElementById("exportMine"),
  exportAll: document.getElementById("exportAll")
};

els.accessCode.value = state.accessCode;

function setStatus(text, mode = "") {
  els.saveStatus.textContent = text;
  els.saveStatus.className = `save-status ${mode}`.trim();
}

function localBackupKey() {
  const who = state.annotator?.annotator_name || "unknown";
  return `dobbs_labels_v2_${config.annotationBatch}_${who}`;
}

function loadLocalBackup() {
  try {
    const raw = localStorage.getItem(localBackupKey());
    if (!raw) return;
    const rows = JSON.parse(raw);
    rows.forEach((row) => {
      if (!state.labels.has(row.annotation_row_id)) {
        state.labels.set(row.annotation_row_id, row);
      }
    });
  } catch {
    setStatus("Local backup unreadable", "error");
  }
}

function writeLocalBackup() {
  const rows = Array.from(state.labels.values());
  localStorage.setItem(localBackupKey(), JSON.stringify(rows));
}

async function loadItems() {
  const response = await fetch("data/items.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load annotation items.");
  state.items = await response.json();
  buildDuplicateGroups();
}

function textKey(item) {
  return String(item.text_for_bert || item.text || "").trim().replace(/\s+/g, " ");
}

function buildDuplicateGroups() {
  const byText = new Map();
  state.items.forEach((item) => {
    const key = textKey(item);
    if (!key) return;
    if (!byText.has(key)) byText.set(key, []);
    byText.get(key).push(item);
  });

  state.duplicateGroups.clear();
  for (const group of byText.values()) {
    if (group.length < 2) continue;
    group.forEach((item) => state.duplicateGroups.set(item.annotation_row_id, group));
  }
}

async function login(accessCode) {
  const { data, error } = await client.rpc("dobbs_current_annotator", {
    p_access_code: accessCode
  });
  if (error || !data || !data.length) {
    throw new Error("Invalid access code.");
  }
  state.accessCode = accessCode;
  state.annotator = data[0];
  localStorage.setItem("dobbs_access_code", accessCode);
  els.annotatorName.textContent = `${state.annotator.annotator_name} · ${state.annotator.annotator_role}`;
  els.exportAll.classList.toggle("hidden", state.annotator.annotator_role !== "admin");
}

async function loadRemoteLabels() {
  const { data, error } = await client.rpc("dobbs_get_my_labels", {
    p_access_code: state.accessCode,
    p_annotation_batch: config.annotationBatch
  });
  if (error) throw error;
  state.labels.clear();
  data.forEach((row) => state.labels.set(row.annotation_row_id, row));
  loadLocalBackup();
  writeLocalBackup();
}

function currentItem() {
  return state.items[state.currentIndex];
}

function emptyLabel(rowId) {
  return {
    annotation_row_id: rowId,
    annotation_batch: config.annotationBatch,
    human_stance: "",
    human_stance_confidence: "",
    narrative_frame: "",
    stance_evidence_span: "",
    stance_notes: "",
    is_tjst_prior_correct: "",
    is_side_reversal: "",
    exclude_from_bert: "",
    exclude_reason: "",
    row_status: "draft"
  };
}

function getLabel(rowId) {
  if (!state.labels.has(rowId)) {
    state.labels.set(rowId, emptyLabel(rowId));
  }
  return state.labels.get(rowId);
}

function duplicateItemsFor(item) {
  return state.duplicateGroups.get(item.annotation_row_id) || [item];
}

function copyLabelToItem(sourceLabel, targetItem) {
  return {
    ...sourceLabel,
    annotation_row_id: targetItem.annotation_row_id,
    annotation_batch: config.annotationBatch
  };
}

function setFormValue(name, value) {
  const controls = Array.from(els.labelForm.elements).filter((el) => el.name === name);
  controls.forEach((control) => {
    if (control.type === "radio") {
      control.checked = control.value === value;
    } else {
      control.value = value || "";
    }
  });
}

function readForm() {
  const formData = new FormData(els.labelForm);
  const label = getLabel(currentItem().annotation_row_id);
  labelFields.forEach((field) => {
    if (field !== "row_status") label[field] = formData.get(field) || "";
  });
  label.is_tjst_prior_correct = "";
  label.is_side_reversal = "";
  return label;
}

function hydrateForm(label) {
  labelFields.forEach((field) => {
    if (field !== "row_status") setFormValue(field, label[field] || "");
  });
}

function rowIsComplete(label) {
  return label.row_status === "complete";
}

function isAdmin() {
  return state.annotator?.annotator_role === "admin";
}

function overlapIsComplete() {
  return state.items
    .slice(0, overlapTarget)
    .every((item) => rowIsComplete(getLabel(item.annotation_row_id)));
}

function rowIsAvailable(index) {
  return isAdmin() || index < overlapTarget || overlapIsComplete();
}

function renderProgress() {
  const complete = state.items.filter((item) => rowIsComplete(getLabel(item.annotation_row_id))).length;
  const total = state.items.length;
  const overlapComplete = state.items
    .slice(0, overlapTarget)
    .filter((item) => rowIsComplete(getLabel(item.annotation_row_id))).length;
  els.progressCount.textContent = `${complete} / ${total}`;
  els.progressDetail.textContent = `${overlapComplete} / ${overlapTarget} shared-overlap rows complete`;
  els.progressMeter.style.width = `${total ? (complete / total) * 100 : 0}%`;
  if (isAdmin()) {
    els.overlapNotice.textContent = `Admin view: rows 1-${overlapTarget} are the shared overlap target for RAs.`;
  } else if (overlapComplete < overlapTarget) {
    els.overlapNotice.textContent = `Shared overlap target: complete rows 1-${overlapTarget} first. Rows after ${overlapTarget} unlock after your overlap set is complete.`;
  } else {
    els.overlapNotice.textContent = `Shared overlap target complete. Rows after ${overlapTarget} are now available.`;
  }
}

function itemMatches(item, label, query, filter, index) {
  if (!rowIsAvailable(index)) return false;
  const haystack = [
    item.annotation_row_id,
    item.week,
    item.text_for_bert
  ].join(" ").toLowerCase();
  const matchesQuery = !query || haystack.includes(query);
  if (!matchesQuery) return false;
  if (filter === "complete") return rowIsComplete(label);
  if (filter === "incomplete") return !rowIsComplete(label);
  if (filter === "flagged") return label.exclude_from_bert === "yes";
  return true;
}

function renderRowList() {
  const query = els.searchRows.value.trim().toLowerCase();
  const filter = els.statusFilter.value;
  state.filteredIndexes = [];
  els.rowList.replaceChildren();

  state.items.forEach((item, index) => {
    const label = getLabel(item.annotation_row_id);
    if (!itemMatches(item, label, query, filter, index)) return;
    state.filteredIndexes.push(index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "row-button",
      index === state.currentIndex ? "active" : "",
      rowIsComplete(label) ? "complete" : ""
    ].join(" ");
    button.innerHTML = `
      <span class="row-title">Row ${index + 1}</span>
      <span class="row-subtitle">${item.week} · ${item.start_date} to ${item.end_date}</span>
    `;
    button.addEventListener("click", () => {
      state.currentIndex = index;
      renderCurrent();
    });
    els.rowList.append(button);
  });
}

function renderCurrent() {
  const item = currentItem();
  const label = getLabel(item.annotation_row_id);
  els.rowMeta.textContent = `${item.week} · ${item.start_date} to ${item.end_date}`;
  els.rowId.textContent = `Row ${state.currentIndex + 1} of ${state.items.length}`;
  els.sidebarCurrent.textContent = `Row ${state.currentIndex + 1} of ${state.items.length}`;
  const duplicateCount = duplicateItemsFor(item).length;
  els.duplicateNotice.textContent = duplicateCount > 1
    ? `Repeated tweet: saving this row also saves ${duplicateCount - 1} matching row${duplicateCount === 2 ? "" : "s"}.`
    : "";
  els.duplicateNotice.classList.toggle("hidden", duplicateCount < 2);
  els.tweetText.textContent = item.text_for_bert || item.text;
  hydrateForm(label);
  renderProgress();
  renderRowList();
}

function showTab(name) {
  const showingInstructions = name === "instructions";
  els.instructionsView.classList.toggle("hidden", !showingInstructions);
  els.labelView.classList.toggle("hidden", showingInstructions);
  els.instructionsTab.classList.toggle("active", showingInstructions);
  els.labelTab.classList.toggle("active", !showingInstructions);
}

function debouncedSave(status) {
  clearTimeout(state.saveTimer);
  const label = readForm();
  if (status) label.row_status = status;
  state.labels.set(label.annotation_row_id, label);
  writeLocalBackup();
  setStatus("Saving", "pending");
  renderProgress();
  state.saveTimer = setTimeout(() => saveCurrent(), 450);
}

async function saveCurrent() {
  const item = currentItem();
  const label = getLabel(item.annotation_row_id);
  const duplicateItems = duplicateItemsFor(item);
  try {
    let updatedAt = null;
    for (const duplicateItem of duplicateItems) {
      const duplicateLabel = copyLabelToItem(label, duplicateItem);
      const { data, error } = await client.rpc("dobbs_save_label", {
        p_access_code: state.accessCode,
        p_annotation_row_id: duplicateItem.annotation_row_id,
        p_annotation_batch: config.annotationBatch,
        p_label: duplicateLabel
      });
      if (error) throw error;
      if (data && data[0]) {
        duplicateLabel.updated_at = data[0].updated_at;
        updatedAt = data[0].updated_at;
      }
      state.labels.set(duplicateItem.annotation_row_id, duplicateLabel);
    }
    if (updatedAt) label.updated_at = updatedAt;
    writeLocalBackup();
    const duplicateText = duplicateItems.length > 1 ? ` ${duplicateItems.length} rows` : "";
    setStatus(`Synced${duplicateText}`, "synced");
    renderProgress();
    renderRowList();
  } catch (err) {
    console.error(err);
    setStatus("Local backup only", "error");
  }
}

function move(delta) {
  const pool = state.filteredIndexes.length ? state.filteredIndexes : state.items.map((_, i) => i);
  const currentInPool = pool.indexOf(state.currentIndex);
  const nextPoolIndex = Math.min(Math.max(currentInPool + delta, 0), pool.length - 1);
  state.currentIndex = pool[nextPoolIndex] ?? state.currentIndex;
  renderCurrent();
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function downloadCsv(filename, rows) {
  const headers = [
    "annotation_row_id",
    "annotation_batch",
    "annotator_name",
    "human_stance",
    "human_stance_confidence",
    "narrative_frame",
    "stance_evidence_span",
    "stance_notes",
    "is_tjst_prior_correct",
    "is_side_reversal",
    "exclude_from_bert",
    "exclude_reason",
    "row_status",
    "updated_at"
  ];
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportLocalMine() {
  const rows = Array.from(state.labels.values()).map((row) => ({
    ...row,
    annotator_name: state.annotator?.annotator_name || ""
  }));
  downloadCsv(`dobbs_labels_${state.annotator.annotator_name.replaceAll(" ", "_")}.csv`, rows);
}

async function exportFromSupabase(all = false) {
  if (!all) {
    exportLocalMine();
    return;
  }
  setStatus("Exporting", "pending");
  try {
    const { data, error } = await client.rpc("dobbs_export_labels", {
      p_access_code: state.accessCode,
      p_annotation_batch: config.annotationBatch
    });
    if (error) throw error;
    downloadCsv("dobbs_labels_all_annotators.csv", data);
    setStatus("Synced", "synced");
  } catch (err) {
    console.error(err);
    setStatus("Export failed", "error");
  }
}

async function boot(accessCode) {
  setStatus("Loading", "pending");
  await loadItems();
  await login(accessCode);
  await loadRemoteLabels();
  els.loginPanel.classList.add("hidden");
  els.appPanel.classList.remove("hidden");
  renderCurrent();
  setStatus("Synced", "synced");
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.textContent = "";
  try {
    await boot(els.accessCode.value.trim());
  } catch (err) {
    console.error(err);
    els.loginError.textContent = err.message || "Could not sign in.";
    setStatus("Login failed", "error");
  }
});

els.labelForm.addEventListener("input", () => debouncedSave());
els.labelForm.addEventListener("change", () => debouncedSave());
els.markDraft.addEventListener("click", () => debouncedSave("draft"));
els.markComplete.addEventListener("click", async () => {
  debouncedSave("complete");
  clearTimeout(state.saveTimer);
  await saveCurrent();
  move(1);
});
els.prevRow.addEventListener("click", () => move(-1));
els.nextRow.addEventListener("click", () => move(1));
els.sidebarPrevRow.addEventListener("click", () => move(-1));
els.sidebarNextRow.addEventListener("click", () => move(1));
els.toggleRowList.addEventListener("click", () => {
  const willOpen = els.rowBrowser.classList.contains("hidden");
  els.rowBrowser.classList.toggle("hidden", !willOpen);
  els.toggleRowList.setAttribute("aria-expanded", String(willOpen));
  els.toggleRowList.textContent = willOpen ? "Hide Rows" : "Browse Rows";
});
els.searchRows.addEventListener("input", renderRowList);
els.statusFilter.addEventListener("change", renderRowList);
els.labelTab.addEventListener("click", () => showTab("label"));
els.instructionsTab.addEventListener("click", () => showTab("instructions"));
els.exportMine.addEventListener("click", () => exportFromSupabase(false));
els.exportAll.addEventListener("click", () => exportFromSupabase(true));

if (state.accessCode) {
  boot(state.accessCode).catch(() => {
    localStorage.removeItem("dobbs_access_code");
    state.accessCode = "";
    els.accessCode.value = "";
    els.loginPanel.classList.remove("hidden");
    els.appPanel.classList.add("hidden");
  });
}
