/* Vegetable stock count — staff page.
   Every saved count is written to this phone first and sent to the server
   afterwards, so a refresh, a dead network or a mistakenly submitted session
   never loses the work. One item has one entry per session: counting the same
   vegetable again with another weight or grade adds to that entry instead of
   creating a second line, and any entry can be edited or removed and exported
   again as a revised PDF. */

const { createClient } = supabase;
const db = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);
const $ = (id) => document.getElementById(id);
const showEl = (id) => $(id)?.classList.remove("vegHidden");
const hideEl = (id) => $(id)?.classList.add("vegHidden");

const LEDGER_KEY = "veg_ledger_v2";
const DRAFT_KEY = "veg_draft_v2";
const GRADES = ["A", "B", "DUMP"];

let token = "";
let staff = "";
let sessionId = "";
let items = [];
let selected = null;
let grade = "A";
let lang = localStorage.getItem("veg_lang") || "en";
let entries = [];
let submittedRows = [];
let submitted = false;
let submittedAt = null;
let editing = null;
let draftTimer = null;

const T = {
  en: {
    title: "Vegetable stock count",
    quickCount: "Quick count",
    quickHelp: "Search → choose → enter kg → save.",
    weight: "Weight (kg)",
    reason: "Reason (optional)",
    save: "Save Count",
    update: "Update Count",
    finish: "Finish Today's Count",
    submitted: "Count submitted",
    submittedHelp: "Your record is ready to download or share.",
    downloadPdf: "Download PDF",
    sharePdf: "Share PDF",
    recent: "Recently saved",
    recentHelp: "Your latest entries",
    edit: "Edit",
    remove: "Remove entry",
    cancelEdit: "Cancel",
    pending: "Not synced",
    offlineSaved: "Saved on this phone. It syncs when the connection returns.",
    restored: "We restored the entry you had started before the page reloaded.",
    revised: "Revised",
  },
  hi: {
    title: "सब्ज़ी स्टॉक गिनती",
    quickCount: "जल्दी गिनती",
    quickHelp: "खोजें → चुनें → kg डालें → सेव करें।",
    weight: "वज़न (kg)",
    reason: "कारण (वैकल्पिक)",
    save: "गिनती सेव करें",
    update: "गिनती बदलें",
    finish: "आज की गिनती पूरी करें",
    submitted: "गिनती जमा हो गई",
    submittedHelp: "रिकॉर्ड डाउनलोड या शेयर करने के लिए तैयार है।",
    downloadPdf: "PDF डाउनलोड करें",
    sharePdf: "PDF शेयर करें",
    recent: "अभी सेव किया",
    recentHelp: "आपकी हाल की एंट्री",
    edit: "बदलें",
    remove: "एंट्री हटाएँ",
    cancelEdit: "रद्द करें",
    pending: "सिंक नहीं हुआ",
    offlineSaved: "फ़ोन में सेव हो गया। कनेक्शन आने पर सिंक होगा।",
    restored: "पेज दोबारा खुलने से पहले की एंट्री बहाल कर दी गई है।",
    revised: "संशोधित",
  },
  gu: {
    title: "શાકભાજી સ્ટોક ગણતરી",
    quickCount: "ઝડપી ગણતરી",
    quickHelp: "શોધો → પસંદ કરો → kg નાખો → સેવ કરો.",
    weight: "વજન (kg)",
    reason: "કારણ (વૈકલ્પિક)",
    save: "ગણતરી સેવ કરો",
    update: "ગણતરી બદલો",
    finish: "આજની ગણતરી પૂર્ણ કરો",
    submitted: "ગણતરી સબમિટ થઈ",
    submittedHelp: "રેકોર્ડ ડાઉનલોડ અથવા શેર કરવા માટે તૈયાર છે.",
    downloadPdf: "PDF ડાઉનલોડ કરો",
    sharePdf: "PDF શેર કરો",
    recent: "હમણાં સેવ કર્યું",
    recentHelp: "તમારી તાજેતરની એન્ટ્રી",
    edit: "બદલો",
    remove: "એન્ટ્રી દૂર કરો",
    cancelEdit: "રદ કરો",
    pending: "સિંક થયું નથી",
    offlineSaved: "ફોનમાં સેવ થયું. કનેક્શન આવશે ત્યારે સિંક થશે.",
    restored: "પેજ ફરી ખૂલતાં પહેલાંની એન્ટ્રી પાછી લાવવામાં આવી છે.",
    revised: "સુધારેલ",
  },
};

const t = (key) => T[lang]?.[key] ?? T.en[key] ?? key;

/* ---------------------------------------------------------------------------
   Language + small helpers
   --------------------------------------------------------------------------- */

function setText() {
  document.querySelectorAll("[data-t]").forEach((el) => {
    const key = el.dataset.t;
    el.textContent = t(key);
  });
  document.querySelectorAll(".vegLang button").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
  const search = $("vegSearch");
  if (search) {
    search.placeholder = lang === "hi" ? "सब्ज़ी खोजें…" : lang === "gu" ? "શાકભાજી શોધો…" : "Search vegetable…";
  }
  if ($("vegSaveBtn")) $("vegSaveBtn").textContent = editing ? t("update") : t("save");
  if ($("vegDeleteBtn")) $("vegDeleteBtn").textContent = t("remove");
  renderRecent();
}

function today() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function nameOf(x) {
  return x["name_" + lang] || x.name_en || "";
}

/* the sub-line repeats the title when the page is in English, so it is only
   printed when it actually adds the second language */
function subtitle(name, secondary) {
  return secondary && secondary !== name ? secondary : "";
}

function norm(s) {
  return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function kg(n) {
  return Number(n || 0).toFixed(3) + " kg";
}

function gradeLabel(g) {
  return g === "DUMP" ? "Dump" : g + " Grade";
}

/* the row already sits under a grade-coloured form, so it can stay short */
function shortGrade(g) {
  return g === "DUMP" ? "Dump" : g;
}

function showStartupError(message) {
  const box = $("vegStartupError");
  if (box) {
    box.textContent = message;
    box.classList.remove("vegHidden");
  }
}

function msg(text) {
  const el = $("vegSaveMsg");
  if (el) el.textContent = text || "";
}

/* ---------------------------------------------------------------------------
   Local ledger — the durable record for this session on this phone
   --------------------------------------------------------------------------- */

function loadLedger() {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

function saveLedger() {
  try {
    localStorage.setItem(
      LEDGER_KEY,
      JSON.stringify({
        sessionId,
        date: today(),
        staff,
        submitted,
        submittedAt,
        entries,
      })
    );
  } catch (e) {
    /* private mode or full storage — the entry still lives in memory */
  }
}

function restoreLedger() {
  const saved = loadLedger();
  if (!saved) return false;
  /* yesterday's counts belong to yesterday's session */
  if (saved.date !== today()) return false;
  /* a submitted session's entries stay with that session once it is closed */
  if (saved.sessionId !== sessionId && saved.submitted) return false;
  entries = Array.isArray(saved.entries) ? saved.entries : [];
  submitted = !!saved.submitted && saved.sessionId === sessionId;
  submittedAt = submitted ? saved.submittedAt || null : null;
  entries.forEach((e) => {
    e.amounts = e.amounts || { A: 0, B: 0, DUMP: 0 };
    e.pending = e.pending || {};
    if (saved.sessionId !== sessionId) {
      /* the session changed under us: send every open amount to the new one */
      GRADES.forEach((g) => {
        if (Number(e.amounts[g] || 0) > 0) e.pending[g] = true;
      });
    }
  });
  return entries.length > 0;
}

function entryTotal(entry) {
  return GRADES.reduce((sum, g) => sum + Number(entry.amounts?.[g] || 0), 0);
}

function entryPendingGrades(entry) {
  return GRADES.filter((g) => entry.pending?.[g]);
}

function hasLocalRevision() {
  const submittedMs = submittedAt ? new Date(submittedAt).getTime() : 0;
  return entries.some((e) => e.localOnly || (submittedMs && Number(e.updatedAt || 0) > submittedMs));
}

/* ---------------------------------------------------------------------------
   Draft — the entry being typed right now
   --------------------------------------------------------------------------- */

function saveDraft() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      if (!selected) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          sessionId,
          date: today(),
          staff,
          item_id: selected.item_id,
          grade,
          weight: $("vegWeight")?.value ?? "",
          reason: $("vegReason")?.value ?? "",
          mode: editing ? "edit" : "add",
          updatedAt: Date.now(),
        })
      );
    } catch (e) {
      /* ignore */
    }
  }, 200);
}

function clearDraft() {
  if (draftTimer) clearTimeout(draftTimer);
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (e) {
    /* ignore */
  }
}

function restoreDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
  } catch (e) {
    return false;
  }
  if (!draft || draft.date !== today()) return false;
  if (String(draft.staff || "") !== String(staff || "")) return false;
  const item = items.find((i) => String(i.item_id) === String(draft.item_id));
  if (!item) return false;
  if (draft.mode === "edit") startEdit(draft.item_id, { silent: true });
  else openEntry(item);
  if (GRADES.includes(draft.grade)) chooseGrade(draft.grade, { keepValue: true });
  if ($("vegWeight")) $("vegWeight").value = draft.weight ?? "";
  if ($("vegReason")) $("vegReason").value = draft.reason ?? "";
  return true;
}

/* ---------------------------------------------------------------------------
   Rendering
   --------------------------------------------------------------------------- */

function score(item, q) {
  const n = norm(nameOf(item));
  const en = norm(item.name_en);
  if (n === q || en === q) return 100;
  if (n.startsWith(q) || en.startsWith(q)) return 80;
  return q
    .split(" ")
    .filter(Boolean)
    .reduce((s, w) => s + (n.includes(w) || en.includes(w) ? 20 : 0), 0);
}

function renderItems() {
  const search = $("vegSearch");
  const list = $("vegItems");
  if (!search || !list) throw new Error("Vegetable Inventory page is incomplete. Refresh the page.");
  const q = norm(search.value);
  items.forEach((i) => (i._score = score(i, q)));
  const arr = [...items]
    .sort((a, b) => b._score - a._score || a.name_en.localeCompare(b.name_en))
    .filter((i) => !q || i._score > 0)
    .slice(0, 12);
  list.innerHTML =
    arr
      .map((i) => {
        const entry = entries.find((e) => String(e.item_id) === String(i.item_id));
        const done = entry && entryTotal(entry) > 0;
        return (
          (() => {
            const title = nameOf(i);
            const sub = subtitle(title, i.name_en);
            const tail = done ? "✓ " + kg(entryTotal(entry)) : "";
            const line = [sub, tail].filter(Boolean).join(" · ");
            return (
              '<button class="vegItem ' +
              (selected?.item_id === i.item_id ? "selected" : "") +
              (done ? " counted" : "") +
              '" data-id="' +
              i.item_id +
              '"><div><b>' +
              escapeHtml(title) +
              "</b>" +
              (line ? "<small>" + escapeHtml(line) + "</small>" : "") +
              "</div><span>›</span></button>"
            );
          })()
        );
      })
      .join("") || '<div class="vegMsg">No matching vegetable.</div>';
  document.querySelectorAll(".vegItem").forEach((b) => (b.onclick = () => selectItem(b.dataset.id)));
}

function renderRecent() {
  const box = $("vegRecentList");
  if (!box) return;
  if (!entries.length) {
    box.innerHTML = '<span class="vegEmpty">No counts saved yet.</span>';
  } else {
    box.innerHTML = entries
      .map((e) => {
        const parts = GRADES.filter((g) => Number(e.amounts?.[g] || 0) > 0)
          .map((g) => shortGrade(g) + " " + kg(e.amounts[g]))
          .join(" · ");
        const pending = entryPendingGrades(e).length > 0;
        const revised = !!e.localOnly;
        return (
          '<div class="vegRecentRow" data-id="' +
          e.item_id +
          '"><div class="vegRecentMain"><b>' +
          escapeHtml(e["name_" + lang] || e.name_en) +
          "</b><small>" +
          escapeHtml(parts || gradeLabel("A")) +
          (pending ? ' <span class="vegSyncChip">' + escapeHtml(t("pending")) + "</span>" : "") +
          (revised ? ' <span class="vegSyncChip revised">' + escapeHtml(t("revised")) + "</span>" : "") +
          '</small></div><div class="vegRecentActions"><strong>' +
          kg(entryTotal(e)) +
          '</strong><button type="button" class="vegEditBtn" data-id="' +
          e.item_id +
          '">' +
          escapeHtml(t("edit")) +
          "</button></div></div>"
        );
      })
      .join("");
    box.querySelectorAll(".vegEditBtn").forEach((b) => (b.onclick = () => startEdit(b.dataset.id)));
  }
  const badge = $("vegCountedBadge");
  if (badge) {
    const pending = entries.filter((e) => entryPendingGrades(e).length).length;
    const revised = entries.filter((e) => e.localOnly).length;
    badge.textContent =
      entries.length +
      (entries.length === 1 ? " item" : " items") +
      (pending ? " · " + pending + " not synced" : "") +
      (revised ? " · " + revised + " revised" : "");
  }
}

/* ---------------------------------------------------------------------------
   Entry form
   --------------------------------------------------------------------------- */

function paintGrade() {
  document.querySelectorAll(".vegGradeRow button").forEach((b) => b.classList.toggle("selected", b.dataset.grade === grade));
  $("vegReasonWrap")?.classList.toggle("vegHidden", grade !== "DUMP");
}

function openEntry(item) {
  selected = item;
  editing = null;
  showEl("vegEntry");
  hideEl("vegDeleteBtn");
  $("vegSaveBtn").textContent = t("save");
  $("vegSelected").innerHTML =
    "<b>" + escapeHtml(nameOf(item)) + "</b>" +
    (subtitle(nameOf(item), item.name_en) ? "<small>" + escapeHtml(item.name_en) + "</small>" : "");
  paintGrade();
  $("vegWeight").value = "";
  $("vegReason").value = "";
  msg("");
  renderItems();
  requestAnimationFrame(() => {
    $("vegWeight").focus();
    $("vegEntry").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function selectItem(id) {
  const item = items.find((x) => String(x.item_id) === String(id));
  if (!item) return;
  openEntry(item);
}

function startEdit(itemId, opts = {}) {
  const entry = entries.find((e) => String(e.item_id) === String(itemId));
  if (!entry) return;
  const item =
    items.find((i) => String(i.item_id) === String(itemId)) || {
      item_id: entry.item_id,
      name_en: entry.name_en,
      name_hi: entry.name_hi,
      name_gu: entry.name_gu,
    };
  selected = item;
  editing = { item_id: entry.item_id };
  const top = GRADES.slice()
    .sort((a, b) => Number(entry.amounts[b] || 0) - Number(entry.amounts[a] || 0))
    .find((g) => Number(entry.amounts[g] || 0) > 0) || "A";
  grade = top;
  showEl("vegEntry");
  showEl("vegDeleteBtn");
  $("vegSaveBtn").textContent = t("update");
  $("vegSelected").innerHTML =
    "<b>" + escapeHtml(nameOf(item)) + "</b><small>" +
    (subtitle(nameOf(item), item.name_en) ? escapeHtml(item.name_en) + " · " : "") +
    escapeHtml(t("edit")) + "</small>";
  paintGrade();
  $("vegWeight").value = String(entry.amounts[top] || "");
  $("vegReason").value = entry.reason || "";
  $("vegReasonWrap").classList.toggle("vegHidden", top !== "DUMP");
  msg("");
  if (!opts.silent) {
    $("vegEntry").scrollIntoView({ behavior: "smooth", block: "center" });
    $("vegWeight").focus();
  }
  renderItems();
}

function chooseGrade(g, opts = {}) {
  grade = g;
  paintGrade();
  if (editing) {
    const entry = entries.find((e) => String(e.item_id) === String(editing.item_id));
    if (entry && !opts.keepValue) $("vegWeight").value = String(entry.amounts[g] || "");
  }
  if (!opts.keepValue) $("vegWeight").focus();
  saveDraft();
}

function clearSelection() {
  selected = null;
  editing = null;
  hideEl("vegEntry");
  hideEl("vegDeleteBtn");
  $("vegWeight").value = "";
  $("vegReason").value = "";
  $("vegSaveBtn").textContent = t("save");
  clearDraft();
  if ($("vegSearch")) $("vegSearch").focus();
  renderItems();
}

/* ---------------------------------------------------------------------------
   Saving — local first, server second
   --------------------------------------------------------------------------- */

function isNetworkError(e) {
  const m = String(e?.message || e || "").toLowerCase();
  return !navigator.onLine || /network|fetch|failed|offline|timeout|connection/i.test(m);
}

function upsertEntry(item) {
  let entry = entries.find((e) => String(e.item_id) === String(item.item_id));
  if (!entry) {
    entry = {
      item_id: item.item_id,
      name_en: item.name_en,
      name_hi: item.name_hi,
      name_gu: item.name_gu,
      amounts: { A: 0, B: 0, DUMP: 0 },
      reason: "",
      pending: {},
      localOnly: false,
      updatedAt: 0,
    };
    entries.unshift(entry);
  }
  return entry;
}

async function syncGrade(entry, g, opts = {}) {
  const value = Number(entry.amounts[g] || 0);
  if (!entry.item_id || String(entry.item_id).startsWith("report:")) {
    /* seeded from the submitted report: there is no item row to update */
    entry.pending[g] = false;
    entry.localOnly = true;
    saveLedger();
    renderRecent();
    return false;
  }
  try {
    if (!navigator.onLine) throw Object.assign(new Error("offline"), { offline: true });
    const { error } = await db.rpc("inv_veg_staff_save_count", {
      p_staff_token: token,
      p_session_id: sessionId,
      p_item_id: entry.item_id,
      p_grade: g,
      p_weight_kg: value,
      p_inward_date: null,
      p_reason: g === "DUMP" ? entry.reason || null : null,
    });
    if (error) throw error;
    entry.pending[g] = false;
    entry.localOnly = false;
    saveLedger();
    renderRecent();
    if (!opts.silent) msg(t("save") + " ✓ " + kg(value) + " · " + gradeLabel(g));
    return true;
  } catch (e) {
    const message = String(e?.message || "");
    if (/already submitted/i.test(message)) {
      entry.pending[g] = false;
      entry.localOnly = true;
      saveLedger();
      renderRecent();
      if (!opts.silent) {
        msg("Saved on this phone. The session is already submitted, so download the revised PDF to share the change.");
      }
      return false;
    }
    if (isNetworkError(e)) {
      saveLedger();
      renderRecent();
      if (!opts.silent) msg(t("offlineSaved"));
      return false;
    }
    entry.pending[g] = false;
    saveLedger();
    renderRecent();
    if (!opts.silent) msg(message || "Could not save this entry.");
    return false;
  }
}

async function flushPending(opts = {}) {
  const pending = [];
  entries.forEach((e) => entryPendingGrades(e).forEach((g) => pending.push([e, g])));
  if (!pending.length) return;
  for (const [entry, g] of pending) {
    await syncGrade(entry, g, { silent: true });
  }
  if (!opts.silent) {
    const left = entries.filter((e) => entryPendingGrades(e).length).length;
    msg(left ? "Some entries are still waiting for a connection." : "All entries are synced.");
  }
}

async function save() {
  if (!selected) return msg("Select a vegetable.");
  const w = Number($("vegWeight").value);
  if (!Number.isFinite(w) || w < 0) return msg("Enter weight in kg.");

  const button = $("vegSaveBtn");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = lang === "hi" ? "सेव हो रहा है…" : lang === "gu" ? "સેવ થઈ રહ્યું છે…" : "Saving…";

  const entry = upsertEntry(selected);
  const previous = Number(entry.amounts[grade] || 0);
  entry.amounts[grade] = editing ? w : previous + w;
  if (grade === "DUMP") entry.reason = $("vegReason").value.trim();
  entry.pending[grade] = true;
  entry.updatedAt = Date.now();

  /* written to the phone before anything touches the network */
  saveLedger();
  renderRecent();
  renderItems();

  try {
    await syncGrade(entry, grade);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }

  const wasEditing = !!editing;
  clearSelection();
  $("vegSearch").value = "";
  renderItems();
  if (wasEditing) msg(t("update") + " ✓ " + kg(entryTotal(entry)) + " total");
  scheduleSyncRetry();
}

async function removeSelected() {
  if (!editing) return;
  const entry = entries.find((e) => String(e.item_id) === String(editing.item_id));
  if (!entry) return;
  const previous = { ...entry.amounts };
  GRADES.forEach((g) => {
    entry.amounts[g] = 0;
    if (Number(previous[g] || 0) > 0) entry.pending[g] = true;
  });
  entry.localOnly = true;
  saveLedger();
  renderRecent();
  renderItems();
  msg("Entry removed. " + (submitted ? "Download the revised PDF to share it." : ""));
  for (const g of GRADES) {
    if (Number(previous[g] || 0) > 0) await syncGrade(entry, g, { silent: true });
  }
  entries = entries.filter((e) => entryTotal(e) > 0 || entryPendingGrades(e).length);
  saveLedger();
  renderRecent();
  renderItems();
  clearSelection();
}

/* ---------------------------------------------------------------------------
   Session
   --------------------------------------------------------------------------- */

async function start() {
  const required = ["vegWorkspace","vegStaffTitle","vegDateLabel","vegSessionBadge","vegSearch","vegItems","vegEntry","vegSelected","vegWeight","vegReason","vegSaveBtn","vegFinishBtn","vegPdfBtn","vegShareBtn","vegClearBtn","vegRecentList","vegCountedBadge","vegSubmittedActions","vegQuickCard","vegRecent","vegFinishMsg","vegSaveMsg"];
  const missing = required.filter((id) => !$(id));
  if (missing.length) throw new Error("Vegetable Inventory page is incomplete. Missing: " + missing.join(", "));

  const { data, error } = await db.rpc("inv_veg_staff_start_session", { p_staff_token: token, p_date: today() });
  if (error) throw error;
  sessionId = data;

  const r = await db.rpc("inv_veg_staff_get_items", { p_staff_token: token });
  if (r.error) throw r.error;
  items = r.data || [];

  restoreLedger();
  renderItems();
  renderRecent();
  $("vegDateLabel").textContent = today();
  $("vegSessionBadge").textContent = submitted ? "Submitted" : "Session open";
  $("vegSessionBadge")?.classList.toggle("done", submitted);
  $("vegSearch").focus();

  if (!submitted) {
    try {
      const report = await loadSubmittedReport();
      if (report.length) {
        markSubmitted(report);
        seedEntriesFromReport(report);
      }
    } catch (e) {
      if (!/not submitted/i.test(String(e?.message || ""))) throw e;
    }
  } else if (!entries.length) {
    try {
      const report = await loadSubmittedReport();
      markSubmitted(report);
      seedEntriesFromReport(report);
    } catch (e) {
      /* keep the local view */
    }
  }

  saveLedger();
  if (restoreDraft()) {
    msg(t("restored"));
  }
  void flushPending({ silent: true }).then(scheduleSyncRetry);
}

/* a submitted session opened on a phone that has no local record shows the
   server rows instead of an empty list, so a correction is still possible */
function seedEntriesFromReport(rows) {
  if (entries.length || !rows || !rows.length) return;
  const at = submittedAt ? new Date(submittedAt).getTime() : Date.now();
  const grouped = new Map();
  rows.forEach((r) => {
    const key = String(r.name_en || "").toLowerCase();
    if (!key) return;
    if (!grouped.has(key)) {
      const match = items.find((i) => String(i.name_en || "").toLowerCase() === key);
      grouped.set(key, {
        item_id: match ? match.item_id : "report:" + key,
        name_en: r.name_en,
        name_hi: r.name_hi,
        name_gu: r.name_gu,
        amounts: { A: 0, B: 0, DUMP: 0 },
        reason: "",
        pending: {},
        localOnly: !match,
        updatedAt: at,
      });
    }
    const entry = grouped.get(key);
    if (GRADES.includes(r.grade)) entry.amounts[r.grade] += Number(r.weight_kg || 0);
  });
  entries = [...grouped.values()];
  renderRecent();
  renderItems();
}

function markSubmitted(rows) {
  submittedRows = rows || [];
  submitted = true;
  submittedAt = submittedRows[0]?.submitted_at || submittedAt || Date.now();
  $("vegSessionBadge").textContent = "Submitted";
  $("vegSessionBadge")?.classList.add("done");
  $("vegFinishBtn").disabled = true;
  hideEl("vegFinishBtn");
  showEl("vegSubmittedActions");
  if ($("vegPdfBtn")) $("vegPdfBtn").textContent = t("downloadPdf");
  saveLedger();
}

async function loadSubmittedReport() {
  const { data, error } = await db.rpc("inv_veg_staff_get_submitted_report", { p_staff_token: token, p_session_id: sessionId });
  if (error) throw error;
  submittedRows = data || [];
  return submittedRows;
}

async function finish() {
  await flushPending({ silent: true });
  const left = entries.filter((e) => entryPendingGrades(e).length).length;
  if (left) {
    $("vegFinishMsg").textContent = "Some entries are still syncing. Reconnect and try again.";
    return;
  }
  const { error } = await db.rpc("inv_veg_staff_submit_session", { p_staff_token: token, p_session_id: sessionId });
  if (error) return ($("vegFinishMsg").textContent = error.message);
  submitted = true;
  submittedAt = Date.now();
  markSubmitted(submittedRows.length ? submittedRows : entries);
  $("vegFinishMsg").textContent = "Today's vegetable count is submitted. Any change you make now is saved on this phone and included in the revised PDF.";
  submittedAt = Date.now();
  try {
    await loadSubmittedReport();
  } catch (e) {
    /* the local ledger still has everything */
  }
  saveLedger();
}

/* ---------------------------------------------------------------------------
   Export — always rebuilt from the current entries, so edits show up
   --------------------------------------------------------------------------- */

function reportRows() {
  if (entries.length) {
    return entries
      .filter((e) => entryTotal(e) > 0)
      .map((e) => ({
        name: e.name_en || e["name_" + lang] || "",
        A: Number(e.amounts.A || 0),
        B: Number(e.amounts.B || 0),
        DUMP: Number(e.amounts.DUMP || 0),
        total: entryTotal(e),
      }));
  }
  const grouped = {};
  submittedRows.forEach((r) => {
    const key = String(r.name_en || "");
    if (!grouped[key]) grouped[key] = { name: key, A: 0, B: 0, DUMP: 0, total: 0 };
    grouped[key][r.grade] = (grouped[key][r.grade] || 0) + Number(r.weight_kg || 0);
    grouped[key].total += Number(r.weight_kg || 0);
  });
  return Object.values(grouped);
}

function pdfData() {
  const rows = reportRows();
  if (!rows.length) throw new Error("No counts saved yet.");
  const totals = GRADES.reduce((acc, g) => acc + rows.reduce((s, r) => s + Number(r[g] || 0), 0), 0);
  return {
    rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
    totals,
    staff: staff || "Warehouse Staff",
    date: today(),
    revised: submitted && hasLocalRevision(),
  };
}

function makePdf() {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error("PDF engine is not loaded. Please refresh and try again.");
  const d = pdfData();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const now = new Date();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Bigly Agro Private Limited", 14, 18);
  doc.setFontSize(13);
  doc.text("Vegetable Inventory Count Report", 14, 27);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Staff Name: " + d.staff, 14, 37);
  doc.text("Date: " + now.toLocaleDateString("en-IN"), 14, 43);
  doc.text("Time: " + now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }), 14, 49);
  if (d.revised) {
    doc.setTextColor(180, 83, 9);
    doc.text("Revised copy — reflects the latest saved entries", 14, 55);
    doc.setTextColor(0);
  }

  const x = [14, 92, 126, 160, 194];
  const w = [78, 34, 34, 34];
  let y = d.revised ? 67 : 61;

  function tableHeader() {
    doc.setFillColor(239, 243, 248);
    doc.rect(14, y - 6, 180, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Item Name", 16, y);
    doc.text("A Grade", x[1] + w[1] / 2, y, { align: "center" });
    doc.text("B Grade", x[2] + w[2] / 2, y, { align: "center" });
    doc.text("Dump", x[3] + w[3] / 2, y, { align: "center" });
    doc.line(14, y + 4, 194, y + 4);
    y += 11;
  }

  tableHeader();
  doc.setFont("helvetica", "normal");
  d.rows.forEach((r) => {
    if (y > 266) {
      doc.addPage();
      y = 18;
      tableHeader();
      doc.setFont("helvetica", "normal");
    }
    doc.text(String(r.name).slice(0, 42), 16, y);
    doc.text(r.A ? kg(r.A) : "—", x[1] + w[1] / 2, y, { align: "center" });
    doc.text(r.B ? kg(r.B) : "—", x[2] + w[2] / 2, y, { align: "center" });
    doc.text(r.DUMP ? kg(r.DUMP) : "—", x[3] + w[3] / 2, y, { align: "center" });
    doc.line(14, y + 4, 194, y + 4);
    y += 8;
  });

  if (y > 268) {
    doc.addPage();
    y = 18;
  }
  doc.setFont("helvetica", "bold");
  doc.text((d.rows.length === 1 ? "1 item" : d.rows.length + " items") + " · total " + kg(d.totals), 16, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(
    d.revised ? "Revised vegetable inventory record generated on this device." : "Vegetable inventory record generated on this device.",
    14,
    289
  );
  doc.setTextColor(0);
  return doc;
}

function pdfFilename(ext) {
  const d = pdfData();
  return (
    "vegetable-count-" +
    d.date +
    "-" +
    String(d.staff).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() +
    (d.revised ? "-revised" : "") +
    "." +
    ext
  );
}

async function downloadPdf() {
  try {
    const doc = makePdf();
    doc.save(pdfFilename("pdf"));
    $("vegFinishMsg").textContent = "PDF downloaded.";
  } catch (e) {
    $("vegFinishMsg").textContent = e.message || "Could not build the PDF.";
  }
}

async function sharePdf() {
  try {
    const doc = makePdf();
    const name = pdfFilename("pdf");
    const blob = doc.output("blob");
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: "Vegetable Count — " + today(), text: "Vegetable inventory count", files: [file] });
    } else {
      doc.save(name);
    }
  } catch (e) {
    if (e.name !== "AbortError") $("vegFinishMsg").textContent = e.message || "Could not share the PDF.";
  }
}

/* ---------------------------------------------------------------------------
   Retry loop for anything that could not reach the server
   --------------------------------------------------------------------------- */

let retryTimer = null;

function scheduleSyncRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  const pending = entries.some((e) => entryPendingGrades(e).length);
  if (!pending) return;
  retryTimer = setTimeout(() => {
    if (navigator.onLine) void flushPending({ silent: true }).then(scheduleSyncRetry);
    else scheduleSyncRetry();
  }, 20000);
}

/* ---------------------------------------------------------------------------
   Boot
   --------------------------------------------------------------------------- */

async function initGuest() {
  try {
    const { data, error } = await db.rpc("inv_inventory_guest_session");
    if (error) throw error;
    if (!data?.token) throw new Error("Inventory service returned no session.");
    token = data.token;
    staff = data.staff_name || "Warehouse Staff";
    sessionStorage.setItem("veg_token", token);
    sessionStorage.setItem("veg_staff", staff);
    showEl("vegWorkspace");
    $("vegStaffTitle").textContent = staff;
    await start();
    hideEl("vegStartupError");
  } catch (e) {
    token = "";
    staff = "";
    sessionStorage.removeItem("veg_token");
    sessionStorage.removeItem("veg_staff");
    hideEl("vegWorkspace");
    showStartupError(e.message || "Inventory access could not start.");
  }
}

async function boot() {
  try {
    const required = ["vegStartupError","vegWorkspace","vegStaffTitle","vegDateLabel","vegSessionBadge","vegSearch","vegItems","vegEntry","vegSelected","vegWeight","vegReason","vegSaveBtn","vegFinishBtn","vegPdfBtn","vegShareBtn","vegClearBtn","vegRecentList","vegCountedBadge","vegSubmittedActions","vegQuickCard","vegRecent","vegFinishMsg","vegSaveMsg"];
    const missing = required.filter((id) => !$(id));
    if (missing.length) throw new Error("Vegetable Inventory page is incomplete. Missing: " + missing.join(", "));

    setText();
    document.querySelectorAll(".vegLang button").forEach((b) => {
      b.onclick = () => {
        lang = b.dataset.lang;
        localStorage.setItem("veg_lang", lang);
        setText();
        renderItems();
      };
    });
    $("vegSaveBtn").onclick = save;
    $("vegFinishBtn").onclick = finish;
    $("vegPdfBtn").onclick = downloadPdf;
    $("vegShareBtn").onclick = sharePdf;
    if ($("vegDeleteBtn")) $("vegDeleteBtn").onclick = removeSelected;
    if (navigator.share) showEl("vegShareBtn");
    $("vegSearch").oninput = renderItems;
    $("vegSearch").onkeydown = (e) => {
      if (e.key === "Enter") {
        const first = document.querySelector(".vegItem");
        if (first) first.click();
      }
    };
    $("vegWeight").oninput = () => {
      saveDraft();
    };
    $("vegReason").oninput = () => {
      saveDraft();
    };
    $("vegWeight").onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
    };
    $("vegClearBtn").onclick = clearSelection;
    document.querySelectorAll(".vegGradeRow button").forEach((b) => (b.onclick = () => chooseGrade(b.dataset.grade)));

    await initGuest();
  } catch (e) {
    hideEl("vegWorkspace");
    showStartupError(e.message || "Inventory page could not start.");
  }
}

window.addEventListener("online", () => void flushPending({ silent: true }).then(scheduleSyncRetry));
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void flushPending({ silent: true });
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else void boot();
