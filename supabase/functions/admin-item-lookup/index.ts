import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info,x-supabase-api-version,x-requested-with",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const normalize = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");

async function adminSessionOk(session: string) {
  if (!session || session.length < 20) return false;
  const { data, error } = await admin().rpc("verify_admin_session", { p_session_token: session });
  return !error && data === true;
}

function parseQuantity(quantity: string) {
  const q = normalize(quantity).toLowerCase();
  const m = q.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|pcs?|pieces?)$/i);
  if (!m) return { base_uom: null, default_pack_size: null, quantity_ambiguous: true };
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return { base_uom: null, default_pack_size: null, quantity_ambiguous: true };
  const u = m[2].toLowerCase();
  if (u === "kg") return { base_uom: "kg", default_pack_size: n, quantity_ambiguous: false };
  if (u === "g") return { base_uom: "kg", default_pack_size: n / 1000, quantity_ambiguous: false };
  if (u === "mg") return { base_uom: "kg", default_pack_size: n / 1000000, quantity_ambiguous: false };
  if (u === "l") return { base_uom: "L", default_pack_size: n, quantity_ambiguous: false };
  if (u === "ml") return { base_uom: "L", default_pack_size: n / 1000, quantity_ambiguous: false };
  if (u === "cl") return { base_uom: "L", default_pack_size: n / 100, quantity_ambiguous: false };
  return { base_uom: "pcs", default_pack_size: n, quantity_ambiguous: false };
}

function mapProduct(product: Record<string, any>, barcode: string) {
  const name = normalize(product.product_name_en || product.product_name || product.generic_name_en || product.generic_name || "");
  const brands = normalize(product.brands).split(",").map(normalize).filter(Boolean);
  const categoryText = normalize(product.categories_en || product.categories);
  const category = categoryText.split(",")[0].split("|")[0].trim() || null;
  const aliases = [...new Set([
    normalize(product.generic_name_en || ""),
    normalize(product.generic_name || ""),
    normalize(product.abbreviated_product_name_en || "")
  ].filter(Boolean))].slice(0, 10);
  const quantity = normalize(product.quantity || product.product_quantity || product.net_weight || product.volume || "");
  const parsed = parseQuantity(quantity);
  return {
    barcode, name, brand: brands[0] || null, category, aliases,
    base_uom: parsed.base_uom, default_pack_size: parsed.default_pack_size,
    quantity, quantity_ambiguous: parsed.quantity_ambiguous,
    count_mode: null,
    image_url: normalize(product.image_front_url || product.image_url || "") || null
  };
}

async function audit(db: any, action: string, barcode: string, details: Record<string, unknown>) {
  try {
    await db.from("inv_v2_audit_log").insert({
      action, actor: "admin", barcode: barcode || null, result: "success", new_data: details
    });
  } catch (_) {}
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  try {
    const body = await req.json();
    const session = String(body.admin_session || "");
    const barcode = normalize(body.barcode);
    const forceRefresh = body.force_refresh === true;

    if (!(await adminSessionOk(session))) {
      await audit(db, "permission_denied", barcode, { operation: "lookup" });
      return json({ ok: false, message: "Admin session expired. Please sign in again." }, 403);
    }
    if (!/^\d+$/.test(barcode) || ![8, 12, 13].includes(barcode.length)) {
      await audit(db, "validation_failure", barcode, { reason: "invalid_barcode" });
      return json({ ok: false, message: "Enter a valid EAN-8, UPC-A or EAN-13 barcode." }, 400);
    }

    const { data: linked, error: linkedError } = await db
      .from("inv_v2_item_barcodes")
      .select("item_id,inv_v2_items!inner(name,active)")
      .eq("barcode", barcode)
      .maybeSingle();
    if (linkedError) throw linkedError;
    if (linked) {
      const item = Array.isArray(linked.inv_v2_items) ? linked.inv_v2_items[0] : linked.inv_v2_items;
      await audit(db, "already_linked", barcode, { item_id: linked.item_id, item_name: item?.name || null });
      return json({ ok: true, linked: true, found: true, message: "Barcode is already linked to " + (item?.name || "an existing item") + "." });
    }

    if (!forceRefresh) {
      const { data: cached, error } = await db.from("inv_barcode_lookup_cache")
        .select("barcode,source,fetched_at,found,raw_response,image_url")
        .eq("barcode", barcode).maybeSingle();
      if (error) throw error;
      if (cached) {
        const raw = cached.raw_response && typeof cached.raw_response === "object" ? cached.raw_response as Record<string, any> : {};
        if (cached.found && raw.product) {
          await audit(db, "fetch_cached", barcode, { found: true });
          return json({ ok: true, linked: false, found: true, cached: true, data: mapProduct(raw.product, barcode) });
        }
        await audit(db, "fetch_cached", barcode, { found: false });
        return json({ ok: true, linked: false, found: false, cached: true, message: "Product was not found in Open Food Facts." });
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch("https://world.openfoodfacts.org/api/v2/product/" + encodeURIComponent(barcode) + ".json", {
        headers: {
          "Accept": "application/json",
          "User-Agent": "BiglyAgroInventory/1.0 (Bigly Agro Private Limited; admin item lookup)"
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      const raw = { error: "rate_limited", status: 429, retry_after: response.headers.get("retry-after") };
      await db.from("inv_barcode_lookup_cache").upsert({ barcode, source: "open_food_facts", fetched_at: new Date().toISOString(), found: false, raw_response: raw, fetched_by: "admin" });
      await audit(db, "fetch_error", barcode, raw);
      return json({ ok: false, message: "Open Food Facts rate limit reached. Please retry shortly." }, 429);
    }

    if (!response.ok) {
      const raw = { error: "http_error", status: response.status };
      await db.from("inv_barcode_lookup_cache").upsert({ barcode, source: "open_food_facts", fetched_at: new Date().toISOString(), found: false, raw_response: raw, fetched_by: "admin" });
      await audit(db, "fetch_error", barcode, raw);
      return json({ ok: false, message: "Open Food Facts returned an error (" + response.status + ")." }, 502);
    }

    const payload = await response.json();
    const found = Number(payload?.status) === 1 && !!payload?.product;
    await db.from("inv_barcode_lookup_cache").upsert({
      barcode, source: "open_food_facts", fetched_at: new Date().toISOString(),
      found, raw_response: payload,
      image_url: normalize(payload?.product?.image_front_url || payload?.product?.image_url || "") || null,
      fetched_by: "admin"
    });

    if (!found) {
      await audit(db, "fetch_not_found", barcode, { source: "open_food_facts", status: payload?.status ?? null });
      return json({ ok: true, linked: false, found: false, cached: false, message: "Product was not found in Open Food Facts." });
    }

    const data = mapProduct(payload.product, barcode);
    await audit(db, "fetch", barcode, { source: "open_food_facts", found: true, quantity: data.quantity, quantity_ambiguous: data.quantity_ambiguous });
    return json({ ok: true, linked: false, found: true, cached: false, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await audit(db, "fetch_error", "", { error: message });
    return json({ ok: false, message: "Could not fetch product details right now. Please retry." }, 502);
  }
});
