/* Vegetable Inward — staff entry screen.

   One row per trip. Total weight is captured first; sorting into A / B / Dump
   can be added now or later, so an entry can be saved as "sorting pending".
   Nothing is lost: every entry gets its phone id before it is sent, the form is
   persisted while typing, and an entry that cannot reach the server waits in an
   IndexedDB queue and is retried with the same id, so a retry can never create
   a duplicate. */

(() => {
  "use strict";

  const API = "https://pbhkuofylhqcqmspubmb.supabase.co/functions/v1/veg-inward-api";
  const KEY = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.key) || "";
  const DRAFT_KEY = "veg_inward_draft_v1";
  const DB_NAME = "bigly-veg-inward-v1";
  const STORE = "queue";
  const PENDING_KEY = "veg_inward_queue_v1";

  const $ = (id) => document.getElementById(id);
  const show = (el) => el && el.classList.remove("vegHidden");
  const hide = (el) => el && el.classList.add("vegHidden");

  const state = {
    token: "",
    staff: "",
    items: [],
    vendors: [],
    entries: [],
    queue: [],
    vendorId: "",
    itemId: "",
    dirty: false,
    saving: false,
    syncing: false,
    confirmArm: null,
    sortTarget: null,
    draftId: "",
    restoreNotice: false,
  };

  /* ---------------------------------------------------------------- helpers */

  const kg = (g) => {
    if (g === null || g === undefined || !Number.isFinite(Number(g))) return "—";
    const s = (Number(g) / 1000).toFixed(3);
    return s.replace(/\.000$/, "").replace(/(\.\d{2})0$/, "$1").replace(/(\.\d)0$/, "$1");
  };

  /* Typed kg -> integer grams, by string arithmetic (never floating point). */
  function parseKg(text, allowZero = false) {
    const raw = String(text ?? "").trim().replace(",", ".");
    if (!raw) return null;
    if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(raw)) return null;
    const [whole, frac = ""] = raw.split(".");
    const grams = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
    if (!Number.isSafeInteger(grams)) return null;
    if (!allowZero && grams <= 0) return null;
    return grams;
  }

  const pct = (part, whole) => (whole > 0 ? ((part * 100) / whole).toFixed(1) : "0.0");

  function newId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    } catch (e) {
      /* fall through */
    }
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(b) : b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256)));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const indiaParts = (date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).reduce((all, p) => ((all[p.type] = p.value), all), {});

  function nowInputValue() {
    const p = indiaParts(new Date());
    return `${p.year === "24" ? "00" : p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }

  function indiaDateLabel() {
    const p = indiaParts(new Date());
    const d = new Date(`${p.year}-${p.month}-${p.day}T12:00:00+05:30`);
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d);
  }

  const timeText = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
  };

  const localInputToIso = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ""))) return null;
    const d = new Date(`${value}:00+05:30`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const isoToLocalInput = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = indiaParts(d);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };

  function msg(text) {
    const el = $("viMsg");
    if (el) el.textContent = text || "";
  }

  function warn(text, danger) {
    const el = $("viWarn");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("danger", !!danger);
    text ? show(el) : hide(el);
  }

  function startupNote(text) {
    const el = $("viStartup");
    if (!el) return;
    el.textContent = text || "";
    text ? show(el) : hide(el);
  }

  /* ------------------------------------------------------------------ queue */

  let idbPromise = null;
  function openDb() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("no indexeddb"));
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexeddb failed"));
    });
    return idbPromise;
  }

  const lsQueue = () => {
    try {
      return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    } catch (e) {
      return [];
    }
  };
  const lsSave = (list) => {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    } catch (e) {
      /* private mode */
    }
  };

  async function queueAll() {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return lsQueue();
    }
  }

  async function queuePut(item) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(item);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      const list = lsQueue().filter((x) => x.key !== item.key);
      list.push(item);
      lsSave(list);
    }
    state.queue = await queueAll();
    renderSync();
  }

  async function queueDelete(key) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      lsSave(lsQueue().filter((x) => x.key !== key));
    }
    state.queue = await queueAll();
    renderSync();
  }

  /* ---------------------------------------------------------------- session */

  const dbClient = window.supabase ? window.supabase.createClient(window.SUPABASE_CONFIG.url, KEY) : null;

  async function ensureSession(force) {
    if (!force && state.token) return state.token;
    if (!force) {
      const cached = sessionStorage.getItem("veg_token");
      if (cached) {
        state.token = cached;
        state.staff = sessionStorage.getItem("veg_staff") || "";
        return cached;
      }
    }
    if (!dbClient) throw Object.assign(new Error("This phone could not start the app. Reload the page."), { code: "NO_CLIENT" });
    const { data, error } = await dbClient.rpc("inv_inventory_guest_session");
    if (error) throw Object.assign(new Error("Could not open a staff session. Check the connection and reload."), { code: "SESSION_EXPIRED" });
    state.token = (data && data.token) || "";
    state.staff = (data && data.staff_name) || "";
    try {
      sessionStorage.setItem("veg_token", state.token);
      sessionStorage.setItem("veg_staff", state.staff);
    } catch (e) {
      /* private mode */
    }
    return state.token;
  }

  async function api(action, payload, retried) {
    const token = await ensureSession(false);
    let res;
    let body = null;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: KEY },
        cache: "no-store",
        body: JSON.stringify({ action, staff_session: token, ...(payload || {}) }),
      });
      body = await res.json();
    } catch (e) {
      throw Object.assign(new Error("No connection to the server."), { network: true });
    }
    if (res.status === 401 || (body && body.code === "SESSION_EXPIRED")) {
      state.token = "";
      try {
        sessionStorage.removeItem("veg_token");
      } catch (e) {
        /* ignore */
      }
      if (!retried) {
        await ensureSession(true);
        return api(action, payload, true);
      }
      throw Object.assign(new Error("Your session expired. Your typed entry is kept — tap Save again."), { code: "SESSION_EXPIRED" });
    }
    if (!res.ok || !body || body.ok !== true) {
      throw Object.assign(new Error((body && body.message) || "The request failed. Please try again."), { code: (body && body.code) || "REQUEST_FAILED" });
    }
    return body;
  }

  /* ------------------------------------------------------------------ draft */

  function draftPayload() {
    return {
      id: state.draftId || (state.draftId = newId()),
      vendor_id: state.vendorId,
      item_id: state.itemId,
      time: $("viTime") ? $("viTime").value : "",
      total: $("viTotal") ? $("viTotal").value : "",
      a: $("viA") ? $("viA").value : "",
      b: $("viB") ? $("viB").value : "",
      dump: $("viDump") ? $("viDump").value : "",
      notes: $("viNotes") ? $("viNotes").value : "",
      at: Date.now(),
    };
  }

  let draftTimer = null;
  function saveDraft() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draftPayload()));
      } catch (e) {
        /* private mode */
      }
    }, 150);
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
      return;
    }
    if (!draft || !draft.at || Date.now() - draft.at > 36 * 60 * 60 * 1000) return;
    if (!draft.total && !draft.a && !draft.b && !draft.dump && !draft.item_id && !draft.notes) return;
    state.draftId = draft.id || newId();
    $("viTime").value = draft.time || nowInputValue();
    $("viTotal").value = draft.total || "";
    $("viA").value = draft.a || "";
    $("viB").value = draft.b || "";
    $("viDump").value = draft.dump || "";
    $("viNotes").value = draft.notes || "";
    state.vendorId = draft.vendor_id || "";
    state.itemId = draft.item_id || "";
    state.restoreNotice = true;
  }

  /* ----------------------------------------------------------------- render */

  function vendorName(id) {
    const v = state.vendors.find((x) => x.id === id);
    return v ? v.name : "";
  }

  function itemName(id) {
    const i = state.items.find((x) => x.item_id === id);
    return i ? i.name_en : "";
  }

  function recentVendors() {
    const seen = [];
    state.entries.forEach((e) => {
      if (e.vendor_id && !seen.includes(e.vendor_id)) seen.push(e.vendor_id);
    });
    const recents = seen.map((id) => state.vendors.find((v) => v.id === id)).filter(Boolean);
    const rest = state.vendors.filter((v) => !seen.includes(v.id));
    return recents.concat(rest);
  }

  function chip(text, selected, onPick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "viChip" + (selected ? " selected" : "");
    b.textContent = text;
    b.addEventListener("click", onPick);
    return b;
  }

  function renderVendors() {
    const chips = $("viVendorChips");
    chips.replaceChildren();
    recentVendors().slice(0, 14).forEach((v) => {
      chips.append(chip(v.name, v.id === state.vendorId, () => pickVendor(v.id)));
    });
    const q = $("viVendorSearch").value.trim().toLowerCase();
    const list = $("viVendorList");
    list.replaceChildren();
    if (!q) {
      hide(list);
    } else {
      const matches = state.vendors.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 20);
      show(list);
      if (!matches.length) {
        const p = document.createElement("p");
        p.className = "viPicked";
        p.textContent = "No vendor matches. Use “+ Add vendor”.";
        list.append(p);
      }
      matches.forEach((v) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "viPick" + (v.id === state.vendorId ? " selected" : "");
        const b1 = document.createElement("b");
        b1.textContent = v.name;
        b.append(b1);
        const s = document.createElement("span");
        s.textContent = v.id === state.vendorId ? "✓" : "›";
        b.append(s);
        b.addEventListener("click", () => pickVendor(v.id));
        list.append(b);
      });
    }
    const picked = $("viVendorPicked");
    picked.textContent = state.vendorId ? "Vendor: " + vendorName(state.vendorId) : "";
  }

  function pickVendor(id) {
    state.vendorId = id;
    $("viVendorSearch").value = "";
    hide($("viVendorList"));
    renderVendors();
    changed();
  }

  function renderItems() {
    const q = $("viItemSearch").value.trim().toLowerCase();
    const list = $("viItemList");
    list.replaceChildren();
    const pool = state.items
      .filter((i) => !q || i.name_en.toLowerCase().includes(q) || String(i.name_gu || "").toLowerCase().includes(q) || String(i.name_hi || "").toLowerCase().includes(q))
      .slice(0, q ? 40 : 12);
    pool.forEach((item) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "viPick" + (item.item_id === state.itemId ? " selected" : "");
      const b1 = document.createElement("b");
      b1.textContent = item.name_en;
      b.append(b1);
      const small = document.createElement("small");
      small.textContent = [item.name_gu, item.name_hi].filter(Boolean).join(" · ") || "kg";
      b.append(small);
      const s = document.createElement("span");
      s.textContent = item.item_id === state.itemId ? "✓" : "›";
      b.append(s);
      b.addEventListener("click", () => {
        state.itemId = item.item_id;
        $("viItemSearch").value = "";
        renderItems();
        changed();
      });
      list.append(b);
    });
    const picked = $("viItemPicked");
    picked.textContent = state.itemId ? "Vegetable: " + itemName(state.itemId) : "";
  }

  /* An empty grade box counts as zero once the worker starts typing grades, so
     "A only" can be entered without filling the other two. Text that is not a
     weight is still an error. */
  function gradesFromInputs(aEl, bEl, dEl) {
    const any = !!(aEl.value.trim() || bEl.value.trim() || dEl.value.trim());
    const one = (el) => (el.value.trim() ? parseKg(el.value, true) : 0);
    const a = one(aEl);
    const b = one(bEl);
    const d = one(dEl);
    return { a, b, d, any, ok: !any || (a !== null && b !== null && d !== null) };
  }

  function updateLive() {
    const total = parseKg($("viTotal").value, true) || 0;
    const g = gradesFromInputs($("viA"), $("viB"), $("viDump"));
    const sorted = g.any && g.ok ? g.a + g.b + g.d : 0;
    const unaccounted = total > sorted ? total - sorted : 0;
    const line = $("viLive");
    line.classList.toggle("over", !!(g.any && g.ok && sorted > total));
    if (!g.any) {
      line.textContent = `Sorted 0 of ${kg(total)} kg, unaccounted ${kg(total)} kg`;
      return;
    }
    if (!g.ok) {
      line.textContent = "Enter A, B and Dump in kg (up to 3 decimals).";
      return;
    }
    if (sorted > total) {
      line.textContent = `A + B + Dump is ${kg(sorted)} kg — more than the total ${kg(total)} kg.`;
      return;
    }
    line.textContent = `Sorted ${kg(sorted)} of ${kg(total)} kg, unaccounted ${kg(unaccounted)} kg · A ${pct(g.a, sorted)}% · B ${pct(g.b, sorted)}% · Dump ${pct(g.d, sorted)}%`;
  }

  function entryRow(entry, opts) {
    const row = document.createElement("div");
    row.className = "viEntry";
    const main = document.createElement("div");
    main.className = "viEntryMain";
    const title = document.createElement("b");
    title.textContent = `${entry.item_name || "Vegetable"} · ${entry.vendor_name || "Vendor"}`;
    main.append(title);
    const meta = document.createElement("small");
    const parts = [timeText(entry.received_at), `Total ${kg(entry.total_g)} kg`];
    if (entry.sorted) parts.push(`A ${kg(entry.a_g)} · B ${kg(entry.b_g)} · Dump ${kg(entry.dump_g)}`);
    else parts.push("Sorting pending");
    if (entry.entered_by) parts.push(entry.entered_by);
    meta.textContent = parts.join(" · ");
    main.append(meta);
    const side = document.createElement("div");
    side.className = "viEntrySide";
    if (opts && opts.badge) {
      const badge = document.createElement("span");
      badge.className = "viBadge " + opts.badge.kind;
      badge.textContent = opts.badge.text;
      side.append(badge);
    } else {
      const badge = document.createElement("span");
      badge.className = "viBadge " + (entry.sorted ? "saved" : "pending");
      badge.textContent = entry.sorted ? "Sorted" : "Sorting pending";
      side.append(badge);
    }
    if (opts && opts.onSort) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "viEntryBtn";
      b.textContent = "Add sorting";
      b.addEventListener("click", opts.onSort);
      side.append(b);
    } else if (opts && opts.onRetry) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "viEntryBtn";
      b.textContent = "Retry";
      b.addEventListener("click", opts.onRetry);
      side.append(b);
    }
    row.append(main, side);
    return row;
  }

  function queuedEntries() {
    return state.queue
      .filter((q) => q.kind === "create")
      .map((q) => ({
        id: q.payload.id,
        item_id: q.payload.item_id,
        item_name: itemName(q.payload.item_id),
        vendor_id: q.payload.vendor_id,
        vendor_name: vendorName(q.payload.vendor_id),
        received_at: q.payload.received_at,
        total_g: q.payload.total_g,
        a_g: q.payload.a_g,
        b_g: q.payload.b_g,
        dump_g: q.payload.dump_g,
        sorted: q.payload.a_g !== null && q.payload.a_g !== undefined,
        queued: true,
        failed: q.state === "failed",
        error: q.error || "",
      }));
  }

  function renderToday() {
    const wrap = $("viTodayList");
    wrap.replaceChildren();
    const rows = state.entries.concat(queuedEntries()).sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
    $("viTodayCount").textContent = `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`;
    if (!rows.length) {
      const p = document.createElement("span");
      p.className = "vegEmpty";
      p.textContent = "No entries yet today.";
      wrap.append(p);
      return;
    }
    rows.forEach((entry) => {
      wrap.append(
        entryRow(entry, {
          badge: entry.queued ? { kind: entry.failed ? "failed" : "waiting", text: entry.failed ? "Failed" : "Waiting to sync" } : { kind: "saved", text: "Saved" },
          onRetry: entry.queued && entry.failed ? () => void syncQueue(false) : null,
        })
      );
    });
  }

  function renderPending() {
    const wrap = $("viPending");
    wrap.replaceChildren();
    const rows = state.entries.filter((e) => !e.sorted).sort((a, b) => new Date(a.received_at) - new Date(b.received_at));
    $("viPendingCount").textContent = `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`;
    if (!rows.length) {
      const p = document.createElement("span");
      p.className = "vegEmpty";
      p.textContent = "Nothing waiting for sorting.";
      wrap.append(p);
      return;
    }
    rows.forEach((entry) => {
      wrap.append(entryRow(entry, { onSort: () => openSort(entry) }));
    });
  }

  function renderSync() {
    const bar = $("viSyncBar");
    const text = $("viSyncText");
    const waiting = state.queue.filter((q) => q.state !== "failed").length;
    const failed = state.queue.filter((q) => q.state === "failed").length;
    const offline = !navigator.onLine;
    bar.classList.toggle("warn", !failed && (waiting > 0 || offline));
    bar.classList.toggle("error", failed > 0);
    if (failed) text.textContent = `${failed} not saved — tap Sync now, or tell the admin`;
    else if (waiting) text.textContent = `${waiting} waiting to sync`;
    else if (offline) text.textContent = "Offline — entries are kept on this phone";
    else text.textContent = "All saved";
    $("viSyncNow").disabled = state.syncing || (!waiting && !failed);
  }

  /* ------------------------------------------------------------------- save */

  function changed() {
    state.dirty = true;
    state.confirmArm = null;
    warn("");
    saveDraft();
    updateLive();
  }

  function formSignature() {
    const g = gradesFromInputs($("viA"), $("viB"), $("viDump"));
    return [$("viTime").value, $("viTotal").value, g.a, g.b, g.d].join("|");
  }

  async function save(andAnother) {
    if (state.saving) return;
    warn("");
    msg("");

    if (!state.vendorId) {
      msg("Choose the vendor first.");
      return;
    }
    if (!state.itemId) {
      msg("Choose the vegetable.");
      return;
    }
    const receivedAt = localInputToIso($("viTime").value);
    if (!receivedAt) {
      msg("Check the time of receiving.");
      return;
    }
    const total = parseKg($("viTotal").value, false);
    if (total === null) {
      msg("Enter the total weight in kg, up to 3 decimals.");
      return;
    }
    const g = gradesFromInputs($("viA"), $("viB"), $("viDump"));
    if (g.any && !g.ok) {
      msg("Enter A, B and Dump in kg, up to 3 decimals.");
      return;
    }
    if (g.any && g.a + g.b + g.d > total) {
      warn("A + B + Dump is more than the total weight. Check the weights.", true);
      msg("Nothing saved.");
      return;
    }

    /* One confirm tap for a difference, for an unusually big load, for a big
       dump share, and for a possible second entry of the same truck. */
    const warnings = [];
    if (g.any && g.a + g.b + g.d < total) warnings.push(`Sorted ${kg(g.a + g.b + g.d)} kg of ${kg(total)} kg — ${kg(total - (g.a + g.b + g.d))} kg is unaccounted.`);
    if (total > 1000000) warnings.push(`Total ${kg(total)} kg is more than 1000 kg. Check the weight.`);
    if (g.any && g.d > 0 && g.d * 100 > (g.a + g.b + g.d) * 40) warnings.push(`Dump is ${pct(g.d, g.a + g.b + g.d)}% of the sorted weight.`);
    const recentCut = Date.now() - 10 * 60 * 1000;
    const sameTruck = state.entries.concat(queuedEntries()).find(
      (e) => e.vendor_id === state.vendorId && e.item_id === state.itemId && new Date(e.received_at).getTime() > recentCut
    );
    if (sameTruck) warnings.push(`The same vendor and vegetable was entered at ${timeText(sameTruck.received_at)}. Is this a second truck?`);

    const signature = formSignature();
    if (warnings.length && (!state.confirmArm || state.confirmArm.signature !== signature)) {
      state.confirmArm = { signature, at: Date.now() };
      warn(warnings.join(" ") + " Tap Save again to keep it, or change the weights.", false);
      return;
    }
    state.confirmArm = null;

    const id = state.draftId || (state.draftId = newId());
    const payload = {
      id,
      item_id: state.itemId,
      vendor_id: state.vendorId,
      received_at: receivedAt,
      total_g: total,
      a_g: g.any ? g.a : null,
      b_g: g.any ? g.b : null,
      dump_g: g.any ? g.d : null,
      notes: $("viNotes").value.trim() || "",
    };
    const request = {
      id,
      item_id: payload.item_id,
      vendor_id: payload.vendor_id,
      received_at: payload.received_at,
      total: $("viTotal").value.trim(),
      notes: payload.notes,
    };
    if (g.any) {
      request.a = $("viA").value.trim() || "0";
      request.b = $("viB").value.trim() || "0";
      request.dump = $("viDump").value.trim() || "0";
    }

    state.saving = true;
    setBusy(true, andAnother);
    try {
      await api("create_entry", request);
      msg("Saved");
      afterSaved(andAnother);
    } catch (e) {
      if (e.code === "SESSION_EXPIRED") {
        msg(e.message);
        warn("Your typed entry is kept on this screen.", true);
        return;
      }
      if (e.code && e.code !== "REQUEST_FAILED" && !e.network) {
        msg(e.message);
        warn("Nothing was saved.", true);
        return;
      }
      /* No connection: keep it on the phone and retry with the same id. */
      await queuePut({
        key: "create:" + id,
        kind: "create",
        payload: request,
        state: "waiting",
        error: "",
        at: Date.now(),
      });
      msg("Saved on this phone. It syncs when the connection returns.");
      afterSaved(andAnother);
    } finally {
      state.saving = false;
      setBusy(false, andAnother);
    }
  }

  function setBusy(busy, andAnother) {
    const a = $("viSave");
    const b = $("viSaveAnother");
    a.disabled = busy;
    b.disabled = busy;
    a.textContent = busy && !andAnother ? "Saving…" : "Save";
    b.textContent = busy && andAnother ? "Saving…" : "Save & add another";
  }

  function afterSaved(andAnother) {
    state.draftId = "";
    const keepVendor = state.vendorId;
    ["viTotal", "viA", "viB", "viDump", "viNotes"].forEach((id) => ($(id).value = ""));
    $("viTime").value = nowInputValue();
    state.itemId = "";
    if (andAnother) {
      state.vendorId = keepVendor;
      $("viItemSearch").focus();
    } else {
      state.vendorId = "";
    }
    state.dirty = false;
    clearDraft();
    updateLive();
    renderVendors();
    renderItems();
    void refreshEntries();
  }

  /* --------------------------------------------------------------- sorting */

  function openSort(entry) {
    state.sortTarget = entry;
    $("viSortTitle").textContent = "Add sorting";
    $("viSortMeta").textContent = `${entry.item_name} · ${entry.vendor_name} · ${timeText(entry.received_at)} · total ${kg(entry.total_g)} kg`;
    $("viSortA").value = "";
    $("viSortB").value = "";
    $("viSortDump").value = "";
    $("viSortMsg").textContent = "";
    updateSortLive();
    const dialog = $("viSortDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function updateSortLive() {
    const total = state.sortTarget ? Number(state.sortTarget.total_g) : 0;
    const a = parseKg($("viSortA").value, true);
    const b = parseKg($("viSortB").value, true);
    const d = parseKg($("viSortDump").value, true);
    const ok = a !== null && b !== null && d !== null;
    const sorted = ok ? a + b + d : 0;
    const line = $("viSortLive");
    line.classList.toggle("over", ok && sorted > total);
    if (!ok) {
      line.textContent = "Enter A, B and Dump in kg (up to 3 decimals).";
      return;
    }
    if (sorted > total) {
      line.textContent = `A + B + Dump is ${kg(sorted)} kg — more than the total ${kg(total)} kg.`;
      return;
    }
    const unaccounted = total - sorted;
    line.textContent = `Sorted ${kg(sorted)} of ${kg(total)} kg, unaccounted ${kg(unaccounted)} kg · A ${pct(a, sorted)}% · B ${pct(b, sorted)}% · Dump ${pct(d, sorted)}%`;
  }

  async function submitSort(event) {
    event.preventDefault();
    const entry = state.sortTarget;
    if (!entry) return;
    const a = parseKg($("viSortA").value, true);
    const b = parseKg($("viSortB").value, true);
    const d = parseKg($("viSortDump").value, true);
    if (a === null || b === null || d === null) {
      $("viSortMsg").textContent = "Enter A, B and Dump in kg, up to 3 decimals.";
      return;
    }
    if (a + b + d > Number(entry.total_g)) {
      $("viSortMsg").textContent = "A + B + Dump is more than the total weight.";
      return;
    }
    const button = $("viSortSave");
    button.disabled = true;
    button.textContent = "Saving…";
    $("viSortMsg").textContent = "";
    const request = { id: entry.id, a: $("viSortA").value.trim() || "0", b: $("viSortB").value.trim() || "0", dump: $("viSortDump").value.trim() || "0" };
    try {
      await api("complete_sorting", request);
      $("viSortDialog").close();
      msg("Sorting saved");
      await refreshEntries();
    } catch (e) {
      if (e.code === "SESSION_EXPIRED") $("viSortMsg").textContent = e.message;
      else if (e.code && !e.network && e.code !== "REQUEST_FAILED") $("viSortMsg").textContent = e.message;
      else {
        await queuePut({ key: "sort:" + entry.id, kind: "sort", payload: request, state: "waiting", error: "", at: Date.now() });
        $("viSortDialog").close();
        msg("Sorting kept on this phone. It syncs when the connection returns.");
      }
    } finally {
      button.disabled = false;
      button.textContent = "Save sorting";
    }
  }

  /* ------------------------------------------------------------------- sync */

  async function syncQueue(manual) {
    if (state.syncing) return;
    state.syncing = true;
    renderSync();
    let changedList = false;
    try {
      const items = await queueAll();
      for (const item of items) {
        if (item.state === "failed" && !manual) continue;
        try {
          if (item.kind === "create") await api("create_entry", item.payload);
          else await api("complete_sorting", item.payload);
          await queueDelete(item.key);
          changedList = true;
        } catch (e) {
          if (e.code === "SESSION_EXPIRED") {
            msg(e.message);
            break;
          }
          if (e.network || e.code === "REQUEST_FAILED") break;
          await queuePut({ ...item, state: "failed", error: e.message, at: Date.now() });
        }
      }
    } finally {
      state.syncing = false;
      state.queue = await queueAll();
      renderSync();
      if (changedList) await refreshEntries();
    }
  }

  /* ------------------------------------------------------------------- load */

  async function refreshEntries() {
    try {
      const out = await api("bootstrap");
      state.entries = Array.isArray(out.entries) ? out.entries : [];
      renderToday();
      renderPending();
      renderVendors();
    } catch (e) {
      if (e.code === "SESSION_EXPIRED") startupNote(e.message);
    }
  }

  async function boot() {
    $("viDateLabel").textContent = indiaDateLabel();
    $("viBuild").textContent = "20261104-inward1";
    $("viTime").value = nowInputValue();
    restoreDraft();
    updateLive();
    state.queue = await queueAll();
    renderSync();

    try {
      await ensureSession(false);
      const out = await api("bootstrap");
      state.items = Array.isArray(out.items) ? out.items : [];
      state.vendors = Array.isArray(out.vendors) ? out.vendors : [];
      state.entries = Array.isArray(out.entries) ? out.entries : [];
      state.staff = out.actor || state.staff;
      $("viStaffTitle").textContent = state.staff || "Vegetable inward";
      $("viSessionBadge").textContent = "Session open";
      show($("viWorkspace"));
      hide($("viStartup"));
      renderVendors();
      renderItems();
      renderToday();
      renderPending();
      if (state.restoreNotice) {
        show($("viRestored"));
        setTimeout(() => hide($("viRestored")), 6000);
      }
      void syncQueue(false);
    } catch (e) {
      startupNote(
        e.code === "SESSION_EXPIRED"
          ? "Your staff session has expired. Turn the connection on and reload this page — your typed entry stays on this phone."
          : "Could not reach the server. You can still type an entry: it is kept on this phone and syncs later."
      );
      show($("viWorkspace"));
      $("viSessionBadge").textContent = "Offline";
      renderVendors();
      renderItems();
      renderToday();
      renderPending();
      if (state.restoreNotice) show($("viRestored"));
    }
  }

  /* ----------------------------------------------------------------- wiring */

  $("viVendorSearch").addEventListener("input", () => renderVendors());
  $("viItemSearch").addEventListener("input", () => renderItems());
  ["viTime", "viTotal", "viA", "viB", "viDump", "viNotes"].forEach((id) => $(id).addEventListener("input", changed));
  ["viTotal", "viA", "viB", "viDump"].forEach((id) => $(id).addEventListener("focus", () => setTimeout(() => $(id).select(), 0)));

  $("viSave").addEventListener("click", () => void save(false));
  $("viSaveAnother").addEventListener("click", () => void save(true));
  $("viSyncNow").addEventListener("click", () => void syncQueue(true));

  $("viAddVendorBtn").addEventListener("click", () => {
    $("viVendorName").value = $("viVendorSearch").value.trim();
    $("viVendorMsg").textContent = "";
    const dialog = $("viVendorDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
  $("viVendorCancel").addEventListener("click", () => $("viVendorDialog").close());
  $("viVendorForm").addEventListener("submit", async (event) => {
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
      const out = await api("add_vendor", { name });
      const vendor = out.vendor;
      if (vendor && !state.vendors.some((v) => v.id === vendor.id)) state.vendors.push(vendor);
      state.vendors.sort((a, b) => a.name.localeCompare(b.name));
      state.vendorId = vendor.id;
      $("viVendorDialog").close();
      renderVendors();
      msg(out.existing ? "That vendor already existed — selected." : "Vendor added.");
      changed();
    } catch (e) {
      $("viVendorMsg").textContent = e.message;
    } finally {
      button.disabled = false;
      button.textContent = "Save vendor";
    }
  });

  ["viSortA", "viSortB", "viSortDump"].forEach((id) => $(id).addEventListener("input", updateSortLive));
  $("viSortForm").addEventListener("submit", (event) => void submitSort(event));
  $("viSortCancel").addEventListener("click", () => $("viSortDialog").close());

  window.addEventListener("online", () => {
    renderSync();
    void syncQueue(false);
  });
  window.addEventListener("offline", renderSync);
  window.addEventListener("beforeunload", (event) => {
    const waiting = state.queue.length > 0;
    if (!waiting && !state.dirty) return;
    event.preventDefault();
    event.returnValue = "Some entries are not synced yet.";
    return event.returnValue;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void syncQueue(false);
  });
  setTimeout(() => void syncQueue(false), 3000);

  void boot();
})();
