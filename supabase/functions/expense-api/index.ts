import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = "https://shahabhishekofficial-create.github.io";
const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const fail = (code: string, message: string, status: number) => json({ ok: false, code, message }, status);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateRx = /^\d{4}-\d{2}-\d{2}$/;
const modes = new Set(["Bank", "Cash", "UPI", "Other"]);
const friendly: Record<string, string> = { "23505": "This record already exists.", "23503": "That category or claim is unavailable.", "23514": "Please check the amount, date, and selected values.", "22007": "Please enter a valid date.", "22P02": "Some details are invalid. Please check and try again." };
const textValue = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const validDate = (v: unknown): v is string => typeof v === "string" && dateRx.test(v) && Number.isFinite(new Date(v + "T00:00:00Z").getTime()) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const amountValue = (v: unknown) => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const raw = String(v).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw) || (raw.split(".")[1] || "").length > 2) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1000000000 ? n : null;
};
const PAGE_SIZE = 1000;
const fetchAllPages = async <T>(buildQuery: () => any): Promise<T[]> => {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
};
const dateDaysAgoIST = (days: number) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const date = new Date(today + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
const sessionExpired = () => fail("SESSION_EXPIRED", "Your admin session has expired. Please log in again.", 401);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    if (req.headers.get("origin") && req.headers.get("origin") !== ORIGIN) return new Response(null, { status: 403, headers: cors });
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.headers.get("origin") && req.headers.get("origin") !== ORIGIN) return fail("ORIGIN_NOT_ALLOWED", "This site is not allowed to access expenses.", 403);
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Use the expense app to continue.", 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); if (!body || typeof body !== "object" || Array.isArray(body)) return fail("INVALID_REQUEST", "Please check the request and try again.", 400); }
  catch { return fail("INVALID_REQUEST", "Please check the request and try again.", 400); }

  const session = textValue(body.admin_session, 512);
  if (!session) return sessionExpired();
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return fail("SERVICE_UNAVAILABLE", "Expenses are temporarily unavailable. Please try again.", 503);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // AUTH GATE: every operation reaches this check before any table/view query or data-changing RPC.
  // This verifies the application's custom admin-session token, not a Supabase JWT.
  try {
    const { data, error } = await db.rpc("verify_admin_session", { p_session_token: session });
    if (error || data !== true) return sessionExpired();
  } catch { return sessionExpired(); }

  let action = textValue(body.action, 60) || "unknown";
  try {
    const employeeId = async () => {
      const { data, error } = await db.from("expense_employees").select("id").eq("is_default", true).eq("active", true).limit(2);
      if (error || !data || data.length !== 1) throw new Error("DEFAULT_EMPLOYEE");
      return data[0].id as string;
    };
    const balances = async () => {
      const { data, error } = await db.from("expense_balance_summary").select("*");
      if (error) throw error;
      return data || [];
    };
    const getById = async (table: "expenses" | "expense_payments", id: string) => {
      const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    };
    const insertOnce = async (table: "expenses" | "expense_payments", row: Record<string, unknown>) => {
      const { data, error } = await db.from(table).insert(row).select("*").maybeSingle();
      if (!error && data) return { row: data, duplicate: false };
      if (error?.code === "23505") {
        const existing = await getById(table, String(row.id));
        if (existing) return { row: existing, duplicate: true };
      }
      throw error || new Error("SAVE_FAILED");
    };

    switch (action) {
      case "bootstrap": {
        const eid = await employeeId();
        const [cats, expenses, claims, payments, bal] = await Promise.all([
          db.from("expense_categories").select("id,name,active,sort_order").eq("active", true).order("sort_order").order("id"),
          fetchAllPages<any>(() => db.from("expenses").select("*,expense_categories(id,name)").eq("employee_id", eid).is("deleted_at", null).gte("expense_date", dateDaysAgoIST(89)).order("expense_date", { ascending: false }).order("id", { ascending: false })),
          fetchAllPages<any>(() => db.from("expense_claims").select("*").eq("employee_id", eid).order("claim_number", { ascending: false }).order("id", { ascending: false })),
          fetchAllPages<any>(() => db.from("expense_payments").select("*").eq("employee_id", eid).order("payment_date", { ascending: false }).order("id", { ascending: false })),
          balances()
        ]);
        if (cats.error) throw cats.error;
        return json({ ok: true, employee: { id: eid, name: "Abhishek" }, expenses_from_date: dateDaysAgoIST(89), categories: cats.data || [], expenses, claims, payments, balances: bal });
      }
      case "list_expenses": {
        const eid = await employeeId();
        const fromDate = body.from_date == null || body.from_date === "" ? null : body.from_date;
        const toDate = body.to_date == null || body.to_date === "" ? null : body.to_date;
        const categoryId = body.category_id == null || body.category_id === "" ? null : body.category_id;
        const status = body.status == null || body.status === "" ? null : body.status;
        const reasonSearch = body.reason_search == null ? "" : body.reason_search;
        const rawOffset = body.offset == null || body.offset === "" ? 0 : body.offset;
        const offset = typeof rawOffset === "number" ? rawOffset : (typeof rawOffset === "string" && /^\d+$/.test(rawOffset) ? Number(rawOffset) : NaN);
        if ((fromDate !== null && !validDate(fromDate)) || (toDate !== null && !validDate(toDate)) || (fromDate && toDate && fromDate > toDate)) return fail("INVALID_DATE_RANGE", "Choose a valid date range.", 400);
        if (categoryId !== null && (typeof categoryId !== "string" || !uuid.test(categoryId))) return fail("INVALID_CATEGORY", "Choose a valid category.", 400);
        if (status !== null && status !== "unclaimed" && status !== "claimed") return fail("INVALID_STATUS", "Choose unclaimed or claimed.", 400);
        if (typeof reasonSearch !== "string" || reasonSearch.length > 200 || reasonSearch.includes("\u0000")) return fail("INVALID_REASON_SEARCH", "Enter a valid search (maximum 200 characters).", 400);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return fail("INVALID_OFFSET", "Choose a valid page offset.", 400);
        const matchingQuery = (select: string, count?: "exact" | "planned" | "estimated") => {
          let q = db.from("expenses").select(select, count ? { count } : undefined)
            .eq("employee_id", eid).is("deleted_at", null);
          if (fromDate) q = q.gte("expense_date", fromDate);
          if (toDate) q = q.lte("expense_date", toDate);
          if (categoryId) q = q.eq("category_id", categoryId);
          if (status === "unclaimed") q = q.is("claim_id", null);
          if (status === "claimed") q = q.not("claim_id", "is", null);
          if (reasonSearch) {
            const escapedSearch = reasonSearch.replace(/[\\%_]/g, "\\$&");
            q = q.ilike("reason", "%" + escapedSearch + "%");
          }
          return q;
        };
        const { data: expenses, error, count } = await matchingQuery("*,expense_categories(id,name)", "exact")
          .order("expense_date", { ascending: false }).order("id", { ascending: false })
          .range(offset, offset + 49);
        if (error) throw error;
        const result: Record<string, unknown> = {
          ok: true,
          expenses: expenses || [],
          total_count: count || 0,
          has_more: offset + (expenses || []).length < (count || 0)
        };
        if (offset === 0) {
          // Amounts are decimal text; convert directly to whole paise without floating-point arithmetic.
          const totalPaise = (expenses || []).reduce((sum: bigint, row: any) => {
            const match = typeof row.amount === "string" ? row.amount.match(/^(\d+)(?:\.(\d{1,2}))?$/) : null;
            if (!match) return sum;
            return sum + BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0") || "0");
          }, 0n);
          result.total_amount_paise = totalPaise.toString();
        }
        return json(result);
      }
      case "create_expense": {
        const id = textValue(body.id, 36), amount = amountValue(body.amount), reason = textValue(body.reason, 500);
        const d = body.expense_date == null || body.expense_date === "" ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()) : body.expense_date;
        if (!uuid.test(id) || !amount || !reason) return fail("INVALID_EXPENSE", "Enter a valid amount and reason.", 400);
        if (!validDate(d)) return fail("INVALID_DATE", "Enter a valid expense date.", 400);
        if (!uuid.test(String(body.category_id || ""))) return fail("INVALID_CATEGORY", "Choose a valid category.", 400);
        const eid = await employeeId();
        const { data: cat, error: ce } = await db.from("expense_categories").select("id").eq("id", body.category_id).eq("active", true).maybeSingle();
        if (ce) throw ce; if (!cat) return fail("INVALID_CATEGORY", "Choose an active category.", 400);
        const result = await insertOnce("expenses", { id, employee_id: eid, expense_date: d, amount, category_id: body.category_id, reason, notes: textValue(body.notes, 1000) || null });
        return json({ ok: true, duplicate: result.duplicate, expense: result.row });
      }
      case "update_expense": {
        const id = textValue(body.id, 36); if (!uuid.test(id)) return fail("INVALID_EXPENSE", "Choose a valid expense.", 400);
        const updates: Record<string, unknown> = {};
        if (body.amount !== undefined) { const n = amountValue(body.amount); if (!n) return fail("INVALID_AMOUNT", "Amount must be greater than zero.", 400); updates.amount = n; }
        if (body.reason !== undefined) { const r = textValue(body.reason, 500); if (!r) return fail("INVALID_REASON", "Enter a reason.", 400); updates.reason = r; }
        if (body.notes !== undefined) updates.notes = textValue(body.notes, 1000) || null;
        if (body.expense_date !== undefined) { if (!validDate(body.expense_date)) return fail("INVALID_DATE", "Enter a valid expense date.", 400); updates.expense_date = body.expense_date; }
        if (body.category_id !== undefined) {
          if (!uuid.test(String(body.category_id))) return fail("INVALID_CATEGORY", "Choose a valid category.", 400);
          const { data: cat, error } = await db.from("expense_categories").select("id").eq("id", body.category_id).eq("active", true).maybeSingle();
          if (error) throw error; if (!cat) return fail("INVALID_CATEGORY", "Choose an active category.", 400); updates.category_id = body.category_id;
        }
        if (!Object.keys(updates).length) return fail("NOTHING_TO_UPDATE", "There are no changes to save.", 400);
        updates.updated_at = new Date().toISOString();
        const eid = await employeeId();
        const { data: old, error: oe } = await db.from("expenses").select("id,claim_id,deleted_at").eq("id", id).eq("employee_id", eid).maybeSingle();
        if (oe) throw oe; if (!old || old.deleted_at) return fail("EXPENSE_NOT_FOUND", "Expense not found.", 404);
        if (old.claim_id) return fail("EXPENSE_CLAIMED", "Claimed expenses are locked. Reopen the claim first.", 409);
        const { data, error } = await db.from("expenses").update(updates).eq("id", id).eq("employee_id", eid).is("claim_id", null).is("deleted_at", null).select("*").maybeSingle();
        if (error) throw error; if (!data) return fail("EXPENSE_CLAIMED", "This expense changed or was claimed. Refresh and try again.", 409);
        return json({ ok: true, expense: data });
      }
      case "delete_expense": {
        const id = textValue(body.id, 36); if (!uuid.test(id)) return fail("INVALID_EXPENSE", "Choose a valid expense.", 400);
        const eid = await employeeId();
        const { data, error } = await db.from("expenses").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("employee_id", eid).is("claim_id", null).is("deleted_at", null).select("id").maybeSingle();
        if (error) throw error; if (!data) return fail("EXPENSE_LOCKED_OR_MISSING", "This expense is claimed or no longer available.", 409);
        return json({ ok: true });
      }
      case "list_claims": {
        const eid = await employeeId();
        const { data, error } = await db.from("expense_claims").select("*").eq("employee_id", eid).order("claim_number", { ascending: false });
        if (error) throw error; return json({ ok: true, claims: data || [], balances: await balances() });
      }
      case "create_claim": {
        if (!validDate(body.from_date) || !validDate(body.to_date) || String(body.from_date) > String(body.to_date)) return fail("INVALID_DATE_RANGE", "Choose a valid date range.", 400);
        const eid = await employeeId();
        const { data, error } = await db.rpc("expense_create_claim", { p_employee_id: eid, p_from_date: body.from_date, p_to_date: body.to_date });
        if (error) throw error;
        const claimId = typeof data === "string" ? data : (data as any)?.id;
        if (!claimId || !uuid.test(String(claimId))) throw new Error("CLAIM_CREATE_RESULT_INVALID");
        const { data: claim, error: claimError } = await db.from("expense_claims").select("*").eq("id", claimId).eq("employee_id", eid).maybeSingle();
        if (claimError) throw claimError;
        if (!claim) throw new Error("CLAIM_CREATE_RESULT_MISSING");
        return json({ ok: true, claim });
      }
      case "reopen_claim": {
        const id = textValue(body.claim_id, 36); if (!uuid.test(id)) return fail("INVALID_CLAIM", "Choose a valid claim.", 400);
        const { data, error } = await db.rpc("expense_reopen_claim", { p_claim_id: id });
        if (error) throw error; return json({ ok: true, claim: data });
      }
      case "record_payment": {
        const id = textValue(body.id, 36), amount = amountValue(body.amount), mode = textValue(body.mode, 40);
        const d = body.payment_date == null || body.payment_date === "" ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()) : body.payment_date;
        if (!uuid.test(id) || !amount || !modes.has(mode)) return fail("INVALID_PAYMENT", "Enter a valid amount and payment mode.", 400);
        if (!validDate(d)) return fail("INVALID_DATE", "Enter a valid payment date.", 400);
        const eid = await employeeId(); let claimId: string | null = null;
        if (body.claim_id != null && body.claim_id !== "") {
          claimId = textValue(body.claim_id, 36); if (!uuid.test(claimId)) return fail("INVALID_CLAIM", "Choose a valid claim.", 400);
          const { data: cl, error } = await db.from("expense_claims").select("id,employee_id,reopened_at").eq("id", claimId).maybeSingle();
          if (error) throw error; if (!cl || cl.employee_id !== eid || cl.reopened_at) return fail("INVALID_CLAIM", "Choose an active claim.", 400);
        }
        const result = await insertOnce("expense_payments", { id, employee_id: eid, claim_id: claimId, payment_date: d, amount, mode, reference_note: textValue(body.reference_note, 500) || null });
        return json({ ok: true, duplicate: result.duplicate, payment: result.row, balances: await balances() });
      }
      case "update_payment": {
        const id = textValue(body.id, 36);
        if (!uuid.test(id)) return fail("INVALID_PAYMENT", "Choose a valid payment.", 400);
        const updates: Record<string, unknown> = {};
        if (body.claim_id !== undefined) {
          if (body.claim_id === null || body.claim_id === "") updates.claim_id = null;
          else {
            const claimId = textValue(body.claim_id, 36);
            if (!uuid.test(claimId)) return fail("INVALID_CLAIM", "Choose a valid claim or Unallocated.", 400);
            const employee = await employeeId();
            const { data: cl, error } = await db.from("expense_claims").select("id,employee_id,reopened_at").eq("id", claimId).maybeSingle();
            if (error) throw error;
            if (!cl || cl.employee_id !== employee || cl.reopened_at !== null) return fail("INVALID_CLAIM", "Choose an active claim.", 400);
            updates.claim_id = claimId;
          }
        }
        if (body.payment_date !== undefined) {
          if (!validDate(body.payment_date)) return fail("INVALID_DATE", "Enter a valid payment date.", 400);
          updates.payment_date = body.payment_date;
        }
        if (body.mode !== undefined) {
          const mode = textValue(body.mode, 40);
          if (!modes.has(mode)) return fail("INVALID_PAYMENT_MODE", "Choose Bank, Cash, UPI, or Other.", 400);
          updates.mode = mode;
        }
        if (body.reference_note !== undefined) updates.reference_note = textValue(body.reference_note, 500) || null;
        if (!Object.keys(updates).length) return fail("NOTHING_TO_UPDATE", "There are no changes to save.", 400);
        updates.updated_at = new Date().toISOString();
        const eid = await employeeId();
        const { data, error } = await db.from("expense_payments").update(updates).eq("id", id).eq("employee_id", eid).select("*").maybeSingle();
        if (error) throw error;
        if (!data) return fail("PAYMENT_NOT_FOUND", "Payment not found.", 404);
        return json({ ok: true, payment: data, balances: await balances() });
      }
      case "delete_payment": {
        const id = textValue(body.id, 36);
        if (!uuid.test(id)) return fail("INVALID_PAYMENT", "Choose a valid payment.", 400);
        const eid = await employeeId();
        const { data, error } = await db.from("expense_payments").delete().eq("id", id).eq("employee_id", eid).select("id").maybeSingle();
        if (error) throw error;
        if (!data) return fail("PAYMENT_NOT_FOUND", "Payment not found.", 404);
        return json({ ok: true, balances: await balances() });
      }
      case "balances": return json({ ok: true, balances: await balances() });
      case "export": {
        const eid = await employeeId();
        const [expenses, claims, payments, bal] = await Promise.all([
          fetchAllPages<any>(() => db.from("expenses").select("*,expense_categories(name)").eq("employee_id", eid).is("deleted_at", null).order("expense_date", { ascending: true }).order("id", { ascending: true })),
          fetchAllPages<any>(() => db.from("expense_claims").select("*").eq("employee_id", eid).order("claim_number", { ascending: true }).order("id", { ascending: true })),
          fetchAllPages<any>(() => db.from("expense_payments").select("*").eq("employee_id", eid).order("payment_date", { ascending: true }).order("id", { ascending: true })),
          balances()
        ]);
        return json({ ok: true, exported_at: new Date().toISOString(), expenses, claims, payments, balances: bal });
      }
      default: return fail("UNKNOWN_ACTION", "Choose an available expense action.", 400);
    }
  } catch (e: any) {
    const code = String(e?.code || "UNKNOWN");
    console.error("expense-api failure", { action, code });
    if (String(e?.message || "") === "DEFAULT_EMPLOYEE") return fail("CONFIGURATION_ERROR", "The default employee is not configured. Please contact support.", 500);
    if (code === "P0001" && typeof e?.message === "string" && e.message) return fail("REQUEST_FAILED", e.message, 400);
    return fail("REQUEST_FAILED", friendly[code] || "We couldn't complete that. Please try again.", 400);
  }
});
