/* Vegetable Inward — admin dashboard.

   Every number on this screen comes from the database summary
   (veg_inward_summary). The browser only formats what it is given: it never
   adds rows up and never recalculates a percentage. */

(() => {
  "use strict";

  const API = "https://pbhkuofylhqcqmspubmb.supabase.co/functions/v1/veg-inward-api";
  const $ = (id) => document.getElementById(id);
  const app = $("viAdminApp");
  const boot = $("viAdminBoot");

  const state = {
    preset: "today",
    from: "",
    to: "",
    item: "",
    vendor: "",
    summary: [],
    totals: null,
    entries: [],
    entryOffset: 0,
    entryTotal: 0,
    items: [],
    vendors: [],
    compareItem: "",
    busy: false,
  };

  /* ---------------------------------------------------------------- helpers */

  const kgText = (v) => {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const s = (n / 1000).toFixed(3);
    return s.replace(/\.000$/, "").replace(/(\.\d{2})0$/, "$1").replace(/(\.\d)0$/, "$1");
  };
  const pctText = (v) => (v === null || v === undefined || v === "" ? "—" : String(v) + "%");
  const num = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));

  function say(text) {
    const el = $("viStatus");
    if (!text) {
      el.textContent = "";
      el.hidden = true;
      return;
    }
    el.textContent = text;
    el.hidden = false;
  }

  const indiaToday = () => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const o = Object.fromEntries(p.map((x) => [x.type, x.value]));
    return `${o.year}-${o.month}-${o.day}`;
  };
  const addDays = (date, days) => {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const dateText = (v) => {
    const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || "—");
  };
  const timeText = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
  };

  function rangeFor(preset) {
    const today = indiaToday();
    if (preset === "today") return { from: today, to: today };
    if (preset === "yesterday") {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    if (preset === "week") {
      const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0 Sun
      const back = dow === 0 ? 6 : dow - 1;
      return { from: addDays(today, -back), to: today };
    }
    if (preset === "month") return { from: today.slice(0, 7) + "-01", to: today };
    return { from: state.from, to: state.to };
  }

  function applyPreset(preset, announce) {
    state.preset = preset;
    if (preset !== "custom") {
      const r = rangeFor(preset);
      state.from = r.from;
      state.to = r.to;
      $("viFrom").value = r.from;
      $("viTo").value = r.to;
    } else {
      state.from = $("viFrom").value;
      state.to = $("viTo").value;
    }
    document.querySelectorAll("#viPresets button").forEach((b) => b.classList.toggle("active", b.dataset.preset === preset));
    $("viRangeLabel").textContent = `Showing ${dateText(state.from)} to ${dateText(state.to)}${state.item || state.vendor ? " · filtered" : ""}`;
    if (announce) void loadDashboard();
  }

  /* -------------------------------------------------------------- api calls */

  async function api(action, extra) {
    const token = window.PA_ADMIN_SESSION || "";
    if (!token) throw Object.assign(new Error("Session expired. Please log in again — your place on this page is kept."), { sessionExpired: true });
    let res;
    let body = null;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action, admin_session: token, ...(extra || {}) }),
      });
      body = await res.json();
    } catch (e) {
      throw Object.assign(new Error("Network error. Check the connection and tap Refresh."), { network: true });
    }
    if (res.status === 401 || (body && body.code === "SESSION_EXPIRED")) {
      say("Session expired. Please log in again.");
      throw Object.assign(new Error("Session expired. Please log in again."), { sessionExpired: true });
    }
    if (!res.ok || !body || body.ok !== true) {
      throw Object.assign(new Error((body && body.message) || "The request failed."), { code: (body && body.code) || "REQUEST_FAILED" });
    }
    return body;
  }

  const filters = () => ({ from_date: state.from || null, to_date: state.to || null, item_id: state.item || null, vendor_id: state.vendor || null });

  /* ------------------------------------------------------------------ render */

  function renderCards() {
    const t = state.totals || {};
    $("viCardTotal").textContent = kgText(t.total_g) + " kg";
    $("viCardTotalSub").textContent = `${num(t.trips)} ${num(t.trips) === 1 ? "trip" : "trips"} · sorted ${kgText(t.sorted_g)} kg`;
    const aPct = state.summary.find((r) => r.row_kind === "total")?.a_pct;
    const bPct = state.summary.find((r) => r.row_kind === "total")?.b_pct;
    const dPct = state.summary.find((r) => r.row_kind === "total")?.dump_pct;
    $("viCardA").textContent = kgText(t.a_g) + " kg";
    $("viCardASub").textContent = pctText(aPct) + " of sorted weight";
    $("viCardB").textContent = kgText(t.b_g) + " kg";
    $("viCardBSub").textContent = pctText(bPct) + " of sorted weight";
    $("viCardDump").textContent = kgText(t.dump_g) + " kg";
    $("viCardDumpSub").textContent = pctText(dPct) + " of sorted weight";
    $("viCardPending").textContent = kgText(t.pending_g) + " kg";
    $("viCardPendingSub").textContent = num(t.pending_g) > 0 ? "Waiting to be sorted" : "Everything is sorted";
    $("viCardTrips").textContent = String(num(t.trips));
    $("viCardTripsSub").textContent = "Separate entries";
  }

  function bar(aPct, bPct, dPct) {
    const wrap = document.createElement("div");
    wrap.className = "viBar";
    const parts = [
      ["a", Number(aPct) || 0],
      ["b", Number(bPct) || 0],
      ["d", Number(dPct) || 0],
    ];
    const total = parts.reduce((sum, p) => sum + p[1], 0);
    if (total <= 100) {
      parts.forEach(([cls, value]) => {
        if (value <= 0) return;
        const i = document.createElement("i");
        i.className = cls;
        i.style.width = value + "%";
        wrap.append(i);
      });
    } else {
      parts.forEach(([cls, value]) => {
        const i = document.createElement("i");
        i.className = cls;
        i.style.width = (value / total) * 100 + "%";
        wrap.append(i);
      });
    }
    return wrap;
  }

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function renderTable() {
    const body = $("viSummaryBody");
    body.replaceChildren();
    const rows = state.summary.filter((r) => r.row_kind !== "total");
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 10;
      td.textContent = "No inward entries in this period.";
      tr.append(td);
      body.append(tr);
      return;
    }
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.className = row.row_kind === "item" ? "viItemRow" : "viVendorRow";
      const name = document.createElement("td");
      const b = document.createElement("b");
      b.className = "viName";
      b.textContent = row.row_kind === "item" ? row.item_name : row.vendor_name;
      name.append(b);
      if (row.row_kind === "vendor") {
        const sub = document.createElement("span");
        sub.className = "viSub";
        sub.textContent = "vendor of " + row.item_name;
        name.append(sub);
      } else {
        const sub = document.createElement("span");
        sub.className = "viSub";
        sub.textContent = "subtotal";
        name.append(sub);
      }
      const barCell = bar(row.a_pct, row.b_pct, row.dump_pct);
      name.append(barCell);
      tr.append(name);
      tr.append(cell(String(num(row.trips))));
      tr.append(cell(kgText(row.total_g)));
      tr.append(cell(kgText(row.a_g)));
      tr.append(cell(pctText(row.a_pct)));
      tr.append(cell(kgText(row.b_g)));
      tr.append(cell(pctText(row.b_pct)));
      tr.append(cell(kgText(row.dump_g)));
      tr.append(cell(pctText(row.dump_pct)));
      tr.append(cell(kgText(row.pending_g)));
      if (row.row_kind === "vendor") {
        tr.addEventListener("click", () => {
          state.item = row.item_id;
          state.vendor = row.vendor_id;
          $("viItemFilter").value = row.item_id;
          $("viVendorFilter").value = row.vendor_id;
          state.entryOffset = 0;
          $("viRangeLabel").textContent = `Showing ${dateText(state.from)} to ${dateText(state.to)} · ${row.item_name} · ${row.vendor_name}`;
          void loadEntries().then(() => $("viEntryList").scrollIntoView({ block: "start", behavior: "auto" }));
        });
      }
      body.append(tr);
    });
    const total = state.summary.find((r) => r.row_kind === "total");
    if (total) {
      const tr = document.createElement("tr");
      tr.className = "viTotalRow";
      tr.append(cell("Grand total"));
      tr.append(cell(String(num(total.trips))));
      tr.append(cell(kgText(total.total_g)));
      tr.append(cell(kgText(total.a_g)));
      tr.append(cell(pctText(total.a_pct)));
      tr.append(cell(kgText(total.b_g)));
      tr.append(cell(pctText(total.b_pct)));
      tr.append(cell(kgText(total.dump_g)));
      tr.append(cell(pctText(total.dump_pct)));
      tr.append(cell(kgText(total.pending_g)));
      body.append(tr);
    }
  }

  function renderCompare() {
    const wrap = $("viCompare");
    wrap.replaceChildren();
    const itemId = state.compareItem || $("viCompareItem").value;
    if (!itemId) {
      const p = document.createElement("p");
      p.className = "viMuted";
      p.textContent = "Choose a vegetable to compare its vendors by A grade.";
      wrap.append(p);
      return;
    }
    const rows = state.summary
      .filter((r) => r.row_kind === "vendor" && r.item_id === itemId)
      .slice()
      .sort((a, b) => (Number(b.a_pct ?? -1) - Number(a.a_pct ?? -1)) || String(b.total_g || 0).localeCompare(String(a.total_g || 0)));
    if (!rows.length) {
      const p = document.createElement("p");
      p.className = "viMuted";
      p.textContent = "No vendor rows for that vegetable in this period.";
      wrap.append(p);
      return;
    }
    rows.forEach((row) => {
      const line = document.createElement("div");
      line.className = "viCompareRow";
      const left = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = row.vendor_name;
      const s = document.createElement("small");
      s.textContent = `${num(row.trips)} ${num(row.trips) === 1 ? "trip" : "trips"} · total ${kgText(row.total_g)} kg · A ${kgText(row.a_g)} kg · B ${kgText(row.b_g)} kg · Dump ${kgText(row.dump_g)} kg · pending ${kgText(row.pending_g)} kg`;
      left.append(b, s);
      left.append(bar(row.a_pct, row.b_pct, row.dump_pct));
      const right = document.createElement("div");
      right.className = "viComparePct";
      right.textContent = row.a_pct === null ? "A —" : `A ${row.a_pct}%`;
      line.append(left, right);
      wrap.append(line);
    });
  }

  function renderEntries() {
    const wrap = $("viEntryList");
    wrap.replaceChildren();
    if (!state.entries.length) {
      const p = document.createElement("p");
      p.className = "viMuted";
      p.textContent = "No entries for this period and filter.";
      wrap.append(p);
    }
    state.entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "viEntryRow";
      const left = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = `${entry.item_name} · ${entry.vendor_name}`;
      left.append(b);
      const s = document.createElement("small");
      const bits = [timeText(entry.received_at), `total ${kgText(entry.total_g)} kg`];
      if (entry.sorted) bits.push(`A ${kgText(entry.a_g)} · B ${kgText(entry.b_g)} · Dump ${kgText(entry.dump_g)}`);
      else bits.push("sorting pending");
      if (entry.entered_by) bits.push("by " + entry.entered_by);
      if (entry.notes) bits.push("note: " + entry.notes);
      s.textContent = bits.join(" · ");
      left.append(s);
      const right = document.createElement("div");
      right.className = "viRight";
      const pill = document.createElement("span");
      pill.className = "viPill " + (entry.sorted ? "sorted" : "pending");
      pill.textContent = entry.sorted ? "Sorted" : "Sorting pending";
      const buttons = document.createElement("div");
      buttons.className = "viEntryButtons";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "viSecondary";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => openEdit(entry));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "viSecondary viDanger";
      del.textContent = "Delete";
      del.addEventListener("click", () => openDelete(entry));
      buttons.append(edit, del);
      right.append(pill, buttons);
      row.append(left, right);
      wrap.append(row);
    });
    $("viEntryCount").textContent = state.entryTotal ? `${state.entryOffset + 1}–${Math.min(state.entryOffset + 50, state.entryTotal)} of ${state.entryTotal}` : "No entries";
    $("viPrevPage").disabled = state.entryOffset <= 0;
    $("viNextPage").disabled = state.entryOffset + 50 >= state.entryTotal;
  }

  function renderVendors() {
    const wrap = $("viVendorList");
    wrap.replaceChildren();
    if (!state.vendors.length) {
      const p = document.createElement("p");
      p.className = "viMuted";
      p.textContent = "No active vendors yet. Add the first one.";
      wrap.append(p);
      return;
    }
    state.vendors.forEach((vendor) => {
      const row = document.createElement("div");
      row.className = "viVendorRowAdmin" + (vendor.active ? "" : " off");
      const left = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = vendor.name;
      const s = document.createElement("small");
      s.textContent = vendor.active ? "Active" : "Inactive";
      left.append(b, s);
      const buttons = document.createElement("div");
      buttons.className = "viEntryButtons";
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "viSecondary";
      rename.textContent = "Rename";
      rename.addEventListener("click", () => openVendor(vendor));
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "viSecondary" + (vendor.active ? " viDanger" : "");
      toggle.textContent = vendor.active ? "Deactivate" : "Activate";
      toggle.addEventListener("click", () => void toggleVendor(vendor));
      buttons.append(rename, toggle);
      row.append(left, buttons);
      wrap.append(row);
    });
  }

  /* ------------------------------------------------------------------- load */

  async function loadSummary() {
    const out = await api("summary", filters());
    state.summary = Array.isArray(out.rows) ? out.rows : [];
    state.totals = out.totals || null;
    renderCards();
    renderTable();
    renderCompare();
  }

  async function loadEntries() {
    const out = await api("list_entries", { ...filters(), status: $("viStatusFilter").value, offset: state.entryOffset });
    state.entries = Array.isArray(out.entries) ? out.entries : [];
    state.entryTotal = Number(out.total) || 0;
    renderEntries();
  }

  async function loadVendors() {
    const out = await api("bootstrap");
    state.vendors = Array.isArray(out.vendors) ? out.vendors : [];
    if (!state.items.length && Array.isArray(out.items)) state.items = out.items.map((i) => ({ item_id: i.item_id, name_en: i.name_en }));
    renderVendors();
    fillVendorFilter();
  }

  function fillItemFilter() {
    const sel = $("viItemFilter");
    const current = sel.value;
    sel.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All vegetables";
    sel.append(all);
    state.items.forEach((item) => {
      const o = document.createElement("option");
      o.value = item.item_id;
      o.textContent = item.name_en;
      sel.append(o);
    });
    sel.value = current || "";
    const cmp = $("viCompareItem");
    const cmpCurrent = cmp.value;
    cmp.replaceChildren();
    state.items.forEach((item) => {
      const o = document.createElement("option");
      o.value = item.item_id;
      o.textContent = item.name_en;
      cmp.append(o);
    });
    if (cmpCurrent) cmp.value = cmpCurrent;
    state.compareItem = cmp.value || (state.items[0] ? state.items[0].item_id : "");
  }

  function fillVendorFilter() {
    const sel = $("viVendorFilter");
    const current = sel.value;
    sel.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All vendors";
    sel.append(all);
    state.vendors.forEach((v) => {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = v.name;
      sel.append(o);
    });
    sel.value = current || "";
  }

  async function loadItems() {
    try {
      const token = window.PA_ADMIN_SESSION || "";
      const db = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);
      const { data, error } = await db.rpc("inv_veg_admin_get_items", { p_admin_token: token });
      if (!error && Array.isArray(data)) state.items = data.map((i) => ({ item_id: i.item_id, name_en: i.name_en }));
    } catch (e) {
      /* the bootstrap item list is already loaded */
    }
    fillItemFilter();
  }

  async function loadDashboard() {
    if (state.busy) return;
    state.busy = true;
    say("Loading vegetable inward…");
    try {
      await loadSummary();
      await loadEntries();
      say("");
      $("viRangeLabel").textContent = `Showing ${dateText(state.from)} to ${dateText(state.to)}${state.item || state.vendor ? " · filtered" : ""}`;
    } catch (e) {
      say(e.message || "Could not load vegetable inward.");
    } finally {
      state.busy = false;
    }
  }

  async function refreshAll() {
    say("Refreshing…");
    await Promise.all([loadVendors(), loadItems()]).catch(() => {});
    state.entryOffset = 0;
    await loadDashboard();
  }

  /* ------------------------------------------------------------------ edits */

  let editing = null;
  function openEdit(entry) {
    editing = entry;
    $("viEntryMeta").textContent = `${entry.item_name} · ${entry.vendor_name} · ${timeText(entry.received_at)} · total ${kgText(entry.total_g)} kg`;
    $("viEditTotal").value = kgText(entry.total_g);
    $("viEditA").value = entry.a_g === null ? "" : kgText(entry.a_g);
    $("viEditB").value = entry.b_g === null ? "" : kgText(entry.b_g);
    $("viEditDump").value = entry.dump_g === null ? "" : kgText(entry.dump_g);
    $("viEditNotes").value = entry.notes || "";
    $("viEditReason").value = "";
    $("viEditMsg").textContent = "";
    const dialog = $("viEntryDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  async function submitEdit(event) {
    event.preventDefault();
    if (!editing) return;
    const reason = $("viEditReason").value.trim();
    if (reason.length < 3) {
      $("viEditMsg").textContent = "Write a short reason for this change.";
      return;
    }
    const payload = { id: editing.id, reason, total: $("viEditTotal").value.trim(), notes: $("viEditNotes").value.trim() };
    const hasGrades = $("viEditA").value.trim() || $("viEditB").value.trim() || $("viEditDump").value.trim();
    if (hasGrades) {
      payload.a = $("viEditA").value.trim() || "0";
      payload.b = $("viEditB").value.trim() || "0";
      payload.dump = $("viEditDump").value.trim() || "0";
    }
    const button = $("viEditSave");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await api("update_entry", payload);
      $("viEntryDialog").close();
      say("Correction saved.");
      await loadDashboard();
    } catch (e) {
      $("viEditMsg").textContent = e.message;
    } finally {
      button.disabled = false;
      button.textContent = "Save correction";
    }
  }

  let deleting = null;
  function openDelete(entry) {
    deleting = entry;
    $("viDeleteMeta").textContent = `${entry.item_name} · ${entry.vendor_name} · total ${kgText(entry.total_g)} kg · ${entry.sorted ? `A ${kgText(entry.a_g)} / B ${kgText(entry.b_g)} / Dump ${kgText(entry.dump_g)} kg` : "sorting pending"}`;
    $("viDeleteReason").value = "";
    $("viDeleteMsg").textContent = "";
    const dialog = $("viDeleteDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  async function submitDelete(event) {
    event.preventDefault();
    if (!deleting) return;
    const reason = $("viDeleteReason").value.trim();
    if (reason.length < 3) {
      $("viDeleteMsg").textContent = "Write a short reason for deleting this entry.";
      return;
    }
    const button = $("viDeleteConfirm");
    button.disabled = true;
    button.textContent = "Deleting…";
    try {
      await api("delete_entry", { id: deleting.id, reason });
      $("viDeleteDialog").close();
      const note = $("viEntryMessage");
      note.textContent = `Deleted — ${deleting.item_name} · ${deleting.vendor_name} · ${kgText(deleting.total_g)} kg. Reason recorded.`;
      note.hidden = false;
      await loadDashboard();
    } catch (e) {
      $("viDeleteMsg").textContent = e.message;
    } finally {
      button.disabled = false;
      button.textContent = "Delete entry";
    }
  }

  let vendorTarget = null;
  function openVendor(vendor) {
    vendorTarget = vendor || null;
    $("viVendorDialogTitle").textContent = vendor ? "Rename vendor" : "Add vendor";
    $("viVendorName").value = vendor ? vendor.name : "";
    $("viVendorMsg").textContent = "";
    const dialog = $("viVendorDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  async function submitVendor(event) {
    event.preventDefault();
    const name = $("viVendorName").value.trim();
    if (name.length < 2) {
      $("viVendorMsg").textContent = "Enter a vendor name.";
      return;
    }
    const button = $("viVendorSave");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      if (vendorTarget) await api("rename_vendor", { vendor_id: vendorTarget.id, name });
      else await api("add_vendor", { name });
      $("viVendorDialog").close();
      say(vendorTarget ? "Vendor renamed." : "Vendor added.");
      await loadVendors();
    } catch (e) {
      $("viVendorMsg").textContent = e.message;
    } finally {
      button.disabled = false;
      button.textContent = "Save vendor";
    }
  }

  async function toggleVendor(vendor) {
    const next = !vendor.active;
    if (!next && !window.confirm(`Deactivate ${vendor.name}? Staff will not see this vendor, but old entries stay.`)) return;
    try {
      await api("set_vendor_active", { vendor_id: vendor.id, active: next });
      say(next ? "Vendor activated." : "Vendor deactivated.");
      await loadVendors();
    } catch (e) {
      say(e.message);
    }
  }

  /* ----------------------------------------------------------------- wiring */

  document.querySelectorAll("#viPresets button").forEach((b) => {
    b.addEventListener("click", () => {
      state.item = "";
      state.vendor = "";
      $("viItemFilter").value = "";
      $("viVendorFilter").value = "";
      applyPreset(b.dataset.preset, true);
      state.entryOffset = 0;
    });
  });
  $("viFrom").addEventListener("change", () => {
    state.from = $("viFrom").value;
    state.preset = "custom";
    document.querySelectorAll("#viPresets button").forEach((b) => b.classList.toggle("active", b.dataset.preset === "custom"));
    state.entryOffset = 0;
    void loadDashboard();
  });
  $("viTo").addEventListener("change", () => {
    state.to = $("viTo").value;
    state.preset = "custom";
    document.querySelectorAll("#viPresets button").forEach((b) => b.classList.toggle("active", b.dataset.preset === "custom"));
    state.entryOffset = 0;
    void loadDashboard();
  });
  $("viItemFilter").addEventListener("change", () => {
    state.item = $("viItemFilter").value;
    state.entryOffset = 0;
    void loadDashboard();
  });
  $("viVendorFilter").addEventListener("change", () => {
    state.vendor = $("viVendorFilter").value;
    state.entryOffset = 0;
    void loadDashboard();
  });
  $("viCompareItem").addEventListener("change", () => {
    state.compareItem = $("viCompareItem").value;
    renderCompare();
  });
  $("viStatusFilter").addEventListener("change", () => {
    state.entryOffset = 0;
    void loadEntries().catch((e) => say(e.message));
  });
  $("viPrevPage").addEventListener("click", () => {
    state.entryOffset = Math.max(0, state.entryOffset - 50);
    void loadEntries().catch((e) => say(e.message));
  });
  $("viNextPage").addEventListener("click", () => {
    state.entryOffset += 50;
    void loadEntries().catch((e) => say(e.message));
  });
  $("viRefresh").addEventListener("click", () => void refreshAll());
  $("viAddVendorBtn").addEventListener("click", () => openVendor(null));
  $("viVendorCancel").addEventListener("click", () => $("viVendorDialog").close());
  $("viVendorForm").addEventListener("submit", (e) => void submitVendor(e));
  $("viEntryForm").addEventListener("submit", (e) => void submitEdit(e));
  $("viEditCancel").addEventListener("click", () => $("viEntryDialog").close());
  $("viDeleteForm").addEventListener("submit", (e) => void submitDelete(e));
  $("viDeleteCancel").addEventListener("click", () => $("viDeleteDialog").close());

  /* The export module reads the current filters through this small surface. */
  window.VI_ADMIN = {
    api,
    filters,
    periodLabel: () => `${dateText(state.from)} to ${dateText(state.to)}`,
    filterLabels: () => [
      ["Period", `${dateText(state.from)} to ${dateText(state.to)}`],
      ["Vegetable", $("viItemFilter").selectedOptions[0]?.textContent || "All vegetables"],
      ["Vendor", $("viVendorFilter").selectedOptions[0]?.textContent || "All vendors"],
    ],
    fileStem: () => `Vegetable_Inward_${state.from || "start"}_to_${state.to || "today"}`,
    say,
  };

  /* ------------------------------------------------------------------- boot */

  function start() {
    app.hidden = false;
    boot.hidden = true;
    applyPreset("today", false);
    void refreshAll();
  }

  window.addEventListener("pa-admin-authenticated", () => {
    if (boot.hidden) void refreshAll();
    else start();
  });

  Promise.resolve(window.PA_ADMIN_READY)
    .then(() => {
      if (window.PA_ADMIN_SESSION) start();
      else {
        app.hidden = true;
        boot.textContent = "Admin sign-in is required before vegetable inward can be shown.";
      }
    })
    .catch(() => {
      boot.textContent = "Admin sign-in is required before vegetable inward can be shown.";
    });
})();
