import { createClient } from "npm:@supabase/supabase-js@2";

/* Vegetable Inward API.
   Session gate first: every request must carry either the admin session or a
   staff session, and every action declares which of the two may call it.
   Weights arrive as typed text with at most three decimals and are converted to
   integer grams by string arithmetic — never by floating point. */

const ORIGIN = "https://shahabhishekofficial-create.github.io";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
const fail = (code: string, message: string, status: number, extra: Record<string, unknown> = {}) =>
  json({ ok: false, code, message, ...extra }, status);

const uuidRx = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateRx = /^\d{4}-\d{2}-\d{2}$/;
const gramsRx = /^\d{1,9}(?:\.\d{1,3})?$/;
const MAX_GRAMS = 1000000000; // 1,000,000 kg: a sane ceiling, not a business rule
const PAGE_SIZE = 50;
const EXPORT_PAGE = 1000;

const textValue = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/* Typed text -> integer grams. "12.5" -> 12500, "0.001" -> 1, "7" -> 7000. */
function grams(v: unknown, allowZero: boolean): number | null {
  const raw = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!raw || !gramsRx.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  const value = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  if (!Number.isSafeInteger(value) || value > MAX_GRAMS) return null;
  if (!allowZero && value <= 0) return null;
  return value;
}

const validDate = (v: unknown): v is string =>
  typeof v === "string" && dateRx.test(v) && Number.isFinite(Date.parse(v + "T00:00:00Z"));

const optionalDate = (v: unknown): string | null | undefined => {
  if (v === null || v === undefined || v === "") return null;
  return validDate(v) ? v : undefined;
};

const optionalUuid = (v: unknown): string | null | undefined => {
  if (v === null || v === undefined || v === "") return null;
  return typeof v === "string" && uuidRx.test(v) ? v : undefined;
};

function timestamp(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  if (ms < Date.parse("2020-01-01T00:00:00Z")) return null;
  if (ms > Date.now() + 2 * 24 * 60 * 60 * 1000) return null;
  return new Date(ms).toISOString();
}

const todayIndia = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const normalName = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const nameKey = (v: string) => normalName(v).toLowerCase();

const ERROR_TEXT: Record<string, string> = {
  "23505": "This record already exists.",
  "23503": "That vegetable or vendor is not available.",
  "23514": "Please check the weights and try again.",
  "22007": "Please enter a valid date.",
  "22P02": "Some details are invalid. Please check and try again.",
};

function entryOut(row: any) {
  const item = row.inv_vegetable_items || null;
  const vendor = row.veg_inward_vendors || null;
  return {
    id: row.id,
    item_id: row.item_id,
    item_name: item?.name_en || "",
    item_name_hi: item?.name_hi || "",
    item_name_gu: item?.name_gu || "",
    vendor_id: row.vendor_id,
    vendor_name: vendor?.name || "",
    received_at: row.received_at,
    total_g: Number(row.total_g),
    a_g: row.a_g === null ? null : Number(row.a_g),
    b_g: row.b_g === null ? null : Number(row.b_g),
    dump_g: row.dump_g === null ? null : Number(row.dump_g),
    sorted: row.sorted_at !== null,
    sorted_at: row.sorted_at,
    notes: row.notes || "",
    entered_by: row.entered_by || "",
    deleted_at: row.deleted_at,
    delete_reason: row.delete_reason || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ENTRY_SELECT = "*, inv_vegetable_items(name_en,name_hi,name_gu), veg_inward_vendors(name)";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    if (req.headers.get("origin") && req.headers.get("origin") !== ORIGIN) return new Response(null, { status: 403, headers: cors });
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.headers.get("origin") && req.headers.get("origin") !== ORIGIN) {
    return fail("ORIGIN_NOT_ALLOWED", "This site is not allowed to record vegetable inward.", 403);
  }
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Use the vegetable inward screen to continue.", 405);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("INVALID_REQUEST", "Please check the request and try again.", 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("INVALID_REQUEST", "Please check the request and try again.", 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return fail("SERVICE_UNAVAILABLE", "Vegetable inward is temporarily unavailable. Please try again.", 503);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let action = textValue(body.action, 60) || "unknown";

  /* ---- session gate: admin session or staff session ----------------------
     The database owns both checks: the same admin session table the admin app
     uses, and the same hashed staff-session lookup the inventory staff RPCs
     use. Nothing is re-implemented here. */
  const adminToken = textValue(body.admin_session, 512);
  const staffToken = textValue(body.staff_session, 512);
  let session: { role: "admin" | "staff"; actor: string } | null = null;

  if (adminToken || staffToken) {
    try {
      const { data, error } = await db.rpc("veg_inward_whoami", {
        p_admin_token: adminToken || null,
        p_staff_token: staffToken || null,
      });
      if (!error && data && (data.role === "admin" || data.role === "staff")) {
        session = { role: data.role, actor: textValue(data.actor, 60) || (data.role === "admin" ? "Admin" : "Staff") };
      }
    } catch {
      session = null;
    }
  }

  if (!session) {
    console.log(JSON.stringify({ fn: "veg-inward-api", action, code: "SESSION_EXPIRED" }));
    return fail("SESSION_EXPIRED", "Your session has expired. Please open the screen again.", 401);
  }

  const ALLOWED: Record<string, "admin" | "staff" | "both"> = {
    bootstrap: "both",
    add_vendor: "both",
    create_entry: "both",
    complete_sorting: "both",
    update_entry: "admin",
    delete_entry: "admin",
    list_entries: "admin",
    summary: "admin",
    export_rows: "admin",
    rename_vendor: "admin",
    set_vendor_active: "admin",
  };
  const need = ALLOWED[action];
  if (!need) return fail("UNKNOWN_ACTION", "That request is not available.", 400);
  if (need !== "both" && need !== session.role) {
    console.log(JSON.stringify({ fn: "veg-inward-api", action, code: "NOT_ALLOWED" }));
    return fail("NOT_ALLOWED", "Only the admin can do that.", 403);
  }

  const actor = session.actor;

  const filters = () => {
    const from = optionalDate(body.from_date);
    const to = optionalDate(body.to_date);
    const item = optionalUuid(body.item_id);
    const vendor = optionalUuid(body.vendor_id);
    if (from === undefined || to === undefined) return { error: "INVALID_DATE_RANGE" as const };
    if (item === undefined) return { error: "INVALID_ITEM" as const };
    if (vendor === undefined) return { error: "INVALID_VENDOR" as const };
    if (from && to && from > to) return { error: "INVALID_DATE_RANGE" as const };
    return { from, to, item, vendor };
  };

  const readEntry = async (id: string) => {
    const { data, error } = await db.from("veg_inward_entries").select(ENTRY_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  };

  const writeAudit = async (entryId: string, action_: string, before: unknown, after: unknown, who: string) => {
    const { error } = await db.from("veg_inward_audit").insert({ entry_id: entryId, action: action_, before, after, actor: who });
    if (error) throw error;
  };

  const summaryRows = async (f: { from: string | null; to: string | null; item: string | null; vendor: string | null }) => {
    const { data, error } = await db.rpc("veg_inward_summary", {
      p_from_date: f.from,
      p_to_date: f.to,
      p_item_id: f.item,
      p_vendor_id: f.vendor,
    });
    if (error) throw error;
    return (data || []) as any[];
  };

  const gramsFromSummary = (rows: any[]) => {
    const total = rows.find((r) => r.row_kind === "total") || {};
    const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
    return {
      trips: n(total.trips),
      total_g: n(total.total_g),
      sorted_g: n(total.sorted_g),
      a_g: n(total.a_g),
      b_g: n(total.b_g),
      dump_g: n(total.dump_g),
      pending_g: n(total.pending_g),
      unaccounted_g: n(total.unaccounted_g),
    };
  };

  try {
    switch (action) {
      /* ---------------------------------------------------------------- */
      case "bootstrap": {
        const [items, vendors, today] = await Promise.all([
          db.rpc("veg_inward_items"),
          db.from("veg_inward_vendors").select("id,name,active").eq("active", true).order("name"),
          db
            .from("veg_inward_entries")
            .select(ENTRY_SELECT)
            .is("deleted_at", null)
            .gte("received_at", todayIndia() + "T00:00:00+05:30")
            .lt("received_at", todayIndia() + "T23:59:59.999+05:30")
            .order("received_at", { ascending: false })
            .order("id"),
        ]);
        if (items.error) throw items.error;
        if (vendors.error) throw vendors.error;
        if (today.error) throw today.error;
        return json({
          ok: true,
          role: session.role,
          actor,
          today: todayIndia(),
          items: items.data || [],
          vendors: vendors.data || [],
          entries: (today.data || []).map(entryOut),
        });
      }

      /* ---------------------------------------------------------------- */
      case "add_vendor": {
        const name = normalName(body.name).slice(0, 60);
        if (name.length < 2) return fail("INVALID_VENDOR_NAME", "Enter a vendor name (at least 2 letters).", 400);
        const wanted = nameKey(name);
        const { data: existing, error: existingError } = await db
          .from("veg_inward_vendors")
          .select("id,name,active")
          .eq("name_key", wanted)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) {
          if (!existing.active) {
            const { error } = await db.from("veg_inward_vendors").update({ active: true }).eq("id", existing.id);
            if (error) throw error;
          }
          return json({ ok: true, vendor: { ...existing, active: true }, existing: true });
        }
        const { data, error } = await db.from("veg_inward_vendors").insert({ name }).select("id,name,active").maybeSingle();
        if (error) {
          if (error.code === "23505") {
            const { data: again } = await db.from("veg_inward_vendors").select("id,name,active").eq("name_key", wanted).maybeSingle();
            if (again) return json({ ok: true, vendor: again, existing: true });
          }
          throw error;
        }
        return json({ ok: true, vendor: data, existing: false });
      }

      /* ---------------------------------------------------------------- */
      case "rename_vendor": {
        const id = optionalUuid(body.vendor_id);
        const name = normalName(body.name).slice(0, 60);
        if (!id) return fail("INVALID_VENDOR", "Choose a vendor to rename.", 400);
        if (name.length < 2) return fail("INVALID_VENDOR_NAME", "Enter a vendor name (at least 2 letters).", 400);
        const { data: before } = await db.from("veg_inward_vendors").select("id,name,active").eq("id", id).maybeSingle();
        if (!before) return fail("NOT_FOUND", "That vendor no longer exists.", 404);
        const { data, error } = await db.from("veg_inward_vendors").update({ name }).eq("id", id).select("id,name,active").maybeSingle();
        if (error) {
          if (error.code === "23505") return fail("DUPLICATE_VENDOR", "Another vendor already has that name.", 409);
          throw error;
        }
        console.log(JSON.stringify({ fn: "veg-inward-api", action: "rename_vendor", code: "OK" }));
        return json({ ok: true, vendor: data });
      }

      /* ---------------------------------------------------------------- */
      case "set_vendor_active": {
        const id = optionalUuid(body.vendor_id);
        if (!id) return fail("INVALID_VENDOR", "Choose a vendor.", 400);
        if (typeof body.active !== "boolean") return fail("INVALID_REQUEST", "Choose whether the vendor is active.", 400);
        const { data, error } = await db
          .from("veg_inward_vendors")
          .update({ active: body.active })
          .eq("id", id)
          .select("id,name,active")
          .maybeSingle();
        if (error) throw error;
        if (!data) return fail("NOT_FOUND", "That vendor no longer exists.", 404);
        return json({ ok: true, vendor: data });
      }

      /* ---------------------------------------------------------------- */
      case "create_entry": {
        const id = typeof body.id === "string" && uuidRx.test(body.id) ? body.id.toLowerCase() : "";
        if (!id) return fail("INVALID_ENTRY", "This entry is missing its phone id. Reopen the screen and try again.", 400);
        const itemId = optionalUuid(body.item_id);
        const vendorId = optionalUuid(body.vendor_id);
        if (!itemId) return fail("INVALID_ITEM", "Choose a vegetable.", 400);
        if (!vendorId) return fail("INVALID_VENDOR", "Choose a vendor.", 400);
        const receivedAt = timestamp(body.received_at);
        if (!receivedAt) return fail("INVALID_TIME", "Check the time of receiving.", 400);
        const total = grams(body.total, false);
        if (total === null) return fail("INVALID_WEIGHT", "Enter the total weight in kg, up to 3 decimals.", 400);

        const hasGrades = body.a !== undefined || body.b !== undefined || body.dump !== undefined;
        let a: number | null = null;
        let b: number | null = null;
        let dump: number | null = null;
        if (hasGrades) {
          a = grams(body.a ?? "0", true);
          b = grams(body.b ?? "0", true);
          dump = grams(body.dump ?? "0", true);
          if (a === null || b === null || dump === null) return fail("INVALID_WEIGHT", "Enter A, B and Dump weights in kg, up to 3 decimals.", 400);
          if (a + b + dump > total) return fail("SORTED_ABOVE_TOTAL", "A + B + Dump is more than the total weight. Check the weights.", 400);
        }

        const notesRaw = typeof body.notes === "string" ? body.notes.trim() : "";
        if (notesRaw.length > 500) return fail("INVALID_NOTES", "Keep the note under 500 characters.", 400);

        const row = {
          id,
          item_id: itemId,
          vendor_id: vendorId,
          received_at: receivedAt,
          total_g: total,
          a_g: a,
          b_g: b,
          dump_g: dump,
          sorted_at: hasGrades ? new Date().toISOString() : null,
          notes: notesRaw || null,
          entered_by: actor,
        };
        const { error } = await db.from("veg_inward_entries").insert(row);
        if (error) {
          if (error.code === "23505") {
            const existing = await readEntry(id);
            if (existing) return json({ ok: true, entry: entryOut(existing), duplicate: true });
          }
          throw error;
        }
        const saved = await readEntry(id);
        await writeAudit(id, "create", null, saved, actor);
        return json({ ok: true, entry: saved ? entryOut(saved) : null, duplicate: false });
      }

      /* ---------------------------------------------------------------- */
      case "complete_sorting": {
        const id = typeof body.id === "string" && uuidRx.test(body.id) ? body.id.toLowerCase() : "";
        if (!id) return fail("INVALID_ENTRY", "Choose the entry you are sorting.", 400);
        const a = grams(body.a ?? "0", true);
        const b = grams(body.b ?? "0", true);
        const dump = grams(body.dump ?? "0", true);
        if (a === null || b === null || dump === null) return fail("INVALID_WEIGHT", "Enter A, B and Dump weights in kg, up to 3 decimals.", 400);
        const before = await readEntry(id);
        if (!before || before.deleted_at) return fail("NOT_FOUND", "That entry was removed. Refresh the list.", 404);
        if (a + b + dump > Number(before.total_g)) {
          return fail("SORTED_ABOVE_TOTAL", "A + B + Dump is more than the total weight. Check the weights.", 400);
        }
        if (before.sorted_at !== null) {
          const same = Number(before.a_g) === a && Number(before.b_g) === b && Number(before.dump_g) === dump;
          if (same) return json({ ok: true, entry: entryOut(before), already: true });
          console.log(JSON.stringify({ fn: "veg-inward-api", action, code: "ALREADY_SORTED" }));
          return fail("ALREADY_SORTED", "Already sorted. Ask the admin to correct it.", 409);
        }
        const { error } = await db
          .from("veg_inward_entries")
          .update({ a_g: a, b_g: b, dump_g: dump, sorted_at: new Date().toISOString() })
          .eq("id", id)
          .is("sorted_at", null);
        if (error) throw error;
        const after = await readEntry(id);
        await writeAudit(id, "sort", before, after, actor);
        return json({ ok: true, entry: after ? entryOut(after) : null, already: false });
      }

      /* ---------------------------------------------------------------- */
      case "update_entry": {
        const id = typeof body.id === "string" && uuidRx.test(body.id) ? body.id.toLowerCase() : "";
        if (!id) return fail("INVALID_ENTRY", "Choose an entry to edit.", 400);
        const reason = textValue(body.reason, 300);
        if (reason.length < 3) return fail("REASON_REQUIRED", "Write a short reason for this change.", 400);
        const before = await readEntry(id);
        if (!before || before.deleted_at) return fail("NOT_FOUND", "That entry was removed.", 404);

        const patch: Record<string, unknown> = {};
        if (body.item_id !== undefined) {
          const itemId = optionalUuid(body.item_id);
          if (!itemId) return fail("INVALID_ITEM", "Choose a vegetable.", 400);
          patch.item_id = itemId;
        }
        if (body.vendor_id !== undefined) {
          const vendorId = optionalUuid(body.vendor_id);
          if (!vendorId) return fail("INVALID_VENDOR", "Choose a vendor.", 400);
          patch.vendor_id = vendorId;
        }
        if (body.received_at !== undefined) {
          const receivedAt = timestamp(body.received_at);
          if (!receivedAt) return fail("INVALID_TIME", "Check the time of receiving.", 400);
          patch.received_at = receivedAt;
        }
        const nextTotal = body.total !== undefined ? grams(body.total, false) : Number(before.total_g);
        if (nextTotal === null) return fail("INVALID_WEIGHT", "Enter the total weight in kg, up to 3 decimals.", 400);
        if (body.total !== undefined) patch.total_g = nextTotal;

        const gradesGiven = body.a !== undefined || body.b !== undefined || body.dump !== undefined;
        let nextA = before.a_g === null ? null : Number(before.a_g);
        let nextB = before.b_g === null ? null : Number(before.b_g);
        let nextD = before.dump_g === null ? null : Number(before.dump_g);
        if (gradesGiven) {
          nextA = grams(body.a ?? "0", true);
          nextB = grams(body.b ?? "0", true);
          nextD = grams(body.dump ?? "0", true);
          if (nextA === null || nextB === null || nextD === null) return fail("INVALID_WEIGHT", "Enter A, B and Dump weights in kg, up to 3 decimals.", 400);
          patch.a_g = nextA;
          patch.b_g = nextB;
          patch.dump_g = nextD;
          if (before.sorted_at === null) patch.sorted_at = new Date().toISOString();
        }
        if (nextA !== null && nextB !== null && nextD !== null && nextA + nextB + nextD > nextTotal) {
          return fail("SORTED_ABOVE_TOTAL", "A + B + Dump is more than the total weight. Check the weights.", 400);
        }
        if (body.notes !== undefined) {
          const notesRaw = typeof body.notes === "string" ? body.notes.trim() : "";
          if (notesRaw.length > 500) return fail("INVALID_NOTES", "Keep the note under 500 characters.", 400);
          patch.notes = notesRaw || null;
        }
        if (!Object.keys(patch).length) return fail("NOTHING_TO_CHANGE", "Nothing was changed.", 400);

        const { error } = await db.from("veg_inward_entries").update(patch).eq("id", id);
        if (error) throw error;
        const after = await readEntry(id);
        await writeAudit(id, "edit", { ...before, reason }, { ...after, reason }, actor);
        return json({ ok: true, entry: after ? entryOut(after) : null, reason });
      }

      /* ---------------------------------------------------------------- */
      case "delete_entry": {
        const id = typeof body.id === "string" && uuidRx.test(body.id) ? body.id.toLowerCase() : "";
        if (!id) return fail("INVALID_ENTRY", "Choose an entry to delete.", 400);
        const reason = textValue(body.reason, 300);
        if (reason.length < 3) return fail("REASON_REQUIRED", "Write a short reason for deleting this entry.", 400);
        const before = await readEntry(id);
        if (!before) return fail("NOT_FOUND", "That entry no longer exists.", 404);
        if (before.deleted_at) return json({ ok: true, id, already: true, deleted_at: before.deleted_at });
        const stamp = new Date().toISOString();
        const { error } = await db
          .from("veg_inward_entries")
          .update({ deleted_at: stamp, delete_reason: reason })
          .eq("id", id)
          .is("deleted_at", null);
        if (error) throw error;
        const after = await readEntry(id);
        await writeAudit(id, "delete", before, { ...after, reason }, actor);
        return json({ ok: true, id, already: false, deleted_at: stamp });
      }

      /* ---------------------------------------------------------------- */
      case "list_entries": {
        const f = filters();
        if ("error" in f) return fail(f.error, f.error === "INVALID_DATE_RANGE" ? "Choose a valid date range." : "Choose a valid filter.", 400);
        const status = body.status === "pending" || body.status === "sorted" ? body.status : "all";
        const rawOffset = body.offset ?? 0;
        const offset = typeof rawOffset === "number" ? rawOffset : typeof rawOffset === "string" && /^\d+$/.test(rawOffset) ? Number(rawOffset) : NaN;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return fail("INVALID_OFFSET", "Choose a valid page.", 400);

        let q = db
          .from("veg_inward_entries")
          .select(ENTRY_SELECT, { count: "exact" })
          .is("deleted_at", null);
        if (f.from) q = q.gte("received_at", f.from + "T00:00:00+05:30");
        if (f.to) q = q.lt("received_at", f.to + "T23:59:59.999+05:30");
        if (f.item) q = q.eq("item_id", f.item);
        if (f.vendor) q = q.eq("vendor_id", f.vendor);
        if (status === "pending") q = q.is("sorted_at", null);
        if (status === "sorted") q = q.not("sorted_at", "is", null);
        const { data, error, count } = await q
          .order("received_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const total = count ?? 0;
        return json({
          ok: true,
          entries: (data || []).map(entryOut),
          offset,
          page_size: PAGE_SIZE,
          total,
          has_more: offset + PAGE_SIZE < total,
        });
      }

      /* ---------------------------------------------------------------- */
      case "summary": {
        const f = filters();
        if ("error" in f) return fail(f.error, f.error === "INVALID_DATE_RANGE" ? "Choose a valid date range." : "Choose a valid filter.", 400);
        const rows = await summaryRows(f as any);
        return json({ ok: true, rows, totals: gramsFromSummary(rows) });
      }

      /* ---------------------------------------------------------------- */
      case "export_rows": {
        const f = filters();
        if ("error" in f) return fail(f.error, f.error === "INVALID_DATE_RANGE" ? "Choose a valid date range." : "Choose a valid filter.", 400);
        const rawOffset = body.offset ?? 0;
        const offset = typeof rawOffset === "number" ? rawOffset : typeof rawOffset === "string" && /^\d+$/.test(rawOffset) ? Number(rawOffset) : NaN;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset % EXPORT_PAGE !== 0) {
          return fail("INVALID_OFFSET", "Choose a valid export page.", 400);
        }
        const wanted = offset + EXPORT_PAGE;

        // Read every row up to the end of this page in a stable order, so the
        // running totals of this call always describe exactly the rows returned
        // so far. Nothing is added up in the browser.
        const all: any[] = [];
        for (let from = 0; from < wanted; from += EXPORT_PAGE) {
          let q = db.from("veg_inward_entries").select(ENTRY_SELECT).is("deleted_at", null);
          if (f.from) q = q.gte("received_at", f.from + "T00:00:00+05:30");
          if (f.to) q = q.lt("received_at", f.to + "T23:59:59.999+05:30");
          if (f.item) q = q.eq("item_id", f.item);
          if (f.vendor) q = q.eq("vendor_id", f.vendor);
          const { data, error } = await q
            .order("received_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, Math.min(from + EXPORT_PAGE, wanted) - 1);
          if (error) throw error;
          const page = data || [];
          all.push(...page);
          if (page.length < Math.min(from + EXPORT_PAGE, wanted) - from) break;
        }

        const slice = all.slice(offset, offset + EXPORT_PAGE);
        const running = { trips: all.length, total_g: 0, sorted_g: 0, a_g: 0, b_g: 0, dump_g: 0 };
        for (const row of all) {
          running.total_g += Number(row.total_g);
          if (row.sorted_at !== null) {
            running.sorted_g += Number(row.total_g);
            running.a_g += Number(row.a_g || 0);
            running.b_g += Number(row.b_g || 0);
            running.dump_g += Number(row.dump_g || 0);
          }
        }
        const done = slice.length < EXPORT_PAGE;
        let checks: Record<string, unknown> = { checked: false };
        if (done) {
          const expected = gramsFromSummary(await summaryRows(f as any));
          const ok =
            expected.trips === running.trips &&
            expected.total_g === running.total_g &&
            expected.sorted_g === running.sorted_g &&
            expected.a_g === running.a_g &&
            expected.b_g === running.b_g &&
            expected.dump_g === running.dump_g;
          if (!ok) {
            console.log(JSON.stringify({ fn: "veg-inward-api", action, code: "DATA_CHANGED" }));
            return fail("DATA_CHANGED", "The totals changed while preparing this file. Prepare it again.", 409, {
              expected,
              found: running,
            });
          }
          checks = { checked: true, ok: true, expected };
        }
        return json({
          ok: true,
          rows: slice.map(entryOut),
          offset,
          page_size: EXPORT_PAGE,
          done,
          running,
          checks,
        });
      }

      default:
        return fail("UNKNOWN_ACTION", "That request is not available.", 400);
    }
  } catch (e: any) {
    const code = typeof e?.code === "string" ? e.code : "REQUEST_FAILED";
    const message =
      ERROR_TEXT[code] ||
      (typeof e?.message === "string" && e.message.startsWith("ROW_LIMIT_EXCEEDED")
        ? "That period has too many rows. Choose a shorter period."
        : typeof e?.message === "string" && e.message.startsWith("INVALID_DATE_RANGE")
          ? "Choose a valid date range."
          : "Something went wrong. Please try again.");
    console.log(JSON.stringify({ fn: "veg-inward-api", action, code }));
    const status = code === "23505" || code === "23503" || code === "23514" ? 400 : 500;
    return fail(code === "ROW_LIMIT_EXCEEDED" ? "ROW_LIMIT_EXCEEDED" : code, message, status);
  }
});
