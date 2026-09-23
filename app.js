const { createClient } = supabase;
const db = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);
const IS_ADMIN_PAGE = /\/admin\/?$/.test(location.pathname);

const DEFAULT_OUTLET_SETUP={"Satellite":{driver:"Vipul",rank:1},"Vasna":{driver:"Vipul",rank:2},"Celebration Mall":{driver:"Lux",rank:3},"Bopal - MP":{driver:"Lux",rank:4},"Shela":{driver:"Lux",rank:5},"Vejalpur":{driver:"Lux",rank:6},"Prahladnagar - MP":{driver:"Lux",rank:7},"Bodakdev":{driver:"Abdul",rank:8},"Motera":{driver:"Abdul",rank:9},"Sargasan Gandhinagar":{driver:"Abdul",rank:10},"Vandematram":{driver:"Abdul",rank:11},"Gujarat University - MP":{driver:"Vipul",rank:12},"Mani Nagar":{driver:"Vipul",rank:13},"Navrangpura":{driver:"Vipul",rank:14},"Nirma University":{driver:"Abdul",rank:15},"Odhav":{driver:"Vipul",rank:16},"Science City":{driver:"Abdul",rank:17},"Shahibag":{driver:"Vipul",rank:18},"Sola Road":{driver:"Vipul",rank:19}};
const SETUP_KEY="packing_assistant_outlet_setup";
const DRIVERS_KEY="packing_assistant_drivers";
const DEFAULT_DRIVERS=["Vipul","Lux","Abdul"];
let DB_DRIVERS=[...DEFAULT_DRIVERS];
async function loadDrivers(){try{const {data,error}=await db.from("drivers").select("id,name,active").eq("active",true).order("name");if(error)throw error;DB_DRIVERS=data?.map(x=>x.name)||DEFAULT_DRIVERS;saveDrivers(DB_DRIVERS);return DB_DRIVERS;}catch(e){console.warn("driver load",e.message);return DB_DRIVERS;}}
function getDrivers(){return [...new Set([...DB_DRIVERS,...DEFAULT_DRIVERS].map(x=>String(x).trim()).filter(Boolean))];}
function saveDrivers(a){localStorage.setItem(DRIVERS_KEY,JSON.stringify([...new Set(a.map(x=>String(x).trim()).filter(Boolean))]));}
function outletSetup(){try{return {...DEFAULT_OUTLET_SETUP,...JSON.parse(localStorage.getItem(SETUP_KEY)||"{}")};}catch{return DEFAULT_OUTLET_SETUP;}}

const state = {
  rows: [],
  outlets: new Map(),
  current: null,
  index: 0,
  orderId: null,
  token: null,
  events: [],
  poll: null,
  realtime: null,
  syncBusy: false,
  rankMap: {},
  narrationTimer: null,
  narrationItemId: null,
  narrationCount: 0,
  deliveryChargesLoadedAt: 0
};

const $ = id => document.getElementById(id);
function getRankMap(){ return state.rankMap || {}; }
function rankItem(code){ const n=Number(state.rankMap[String(code).trim()]); return Number.isFinite(n)?n:999999; }

const DEVICE_KEY = "packing_assistant_device_id";

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : "dev-" + Date.now() + "-" + Math.random();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
const DEVICE_ID = deviceId();

function norm(v){return String(v??"").trim().toLowerCase().replace(/[\s_-]+/g,"");}
function qty(v){const n=Number(v); return Number.isFinite(n)&&n>=0?n:NaN;}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}

function validateHeaders(headers){
  const aliases={
    store:["STORE_NAME","STORE NAME","OUTLET","OUTLET NAME"],
    code:["ITEM_CODE","ITEM CODE","ARTICLE","ARTICLE NUMBER"],
    product:["PRODUCT_NAME","PRODUCT NAME","ITEM NAME","PRODUCT"],
    indent:["SUM OF INDENTS","SUMOFINDENTS","INDENT","INDENT QTY","INDENT QUANTITY"],
    rank:["SKU NARRATION ORDER","SKU NARRATION RANK","NARRATION ORDER","NARRATION RANK","SKU RANK","RANK"]
  };
  const map={};
  for(const k in aliases){
    const found=headers.find(h=>aliases[k].some(a=>norm(a)===norm(h)));
    if(found) map[k]=found;
  }
  const missing=Object.keys(aliases).filter(k=>!map[k]);
  if(missing.length) throw new Error("Missing columns: "+missing.join(", "));
  return map;
}

function parseWorkbook(raw){
  const candidates=[];
  for(const name of raw.SheetNames){
    const rows=XLSX.utils.sheet_to_json(raw.Sheets[name],{defval:"",raw:false});
    if(!rows.length) continue;
    try{
      const map=validateHeaders(Object.keys(rows[0]));
      const parsed=[];
      for(let i=0;i<rows.length;i++){
        const r=rows[i];
        const store=String(r[map.store]).trim();
        const code=String(r[map.code]).trim();
        const product=String(r[map.product]).trim();
        const q=qty(r[map.indent]);
        const rank=Number(r[map.rank]);
        if(!store&&!code&&!product&&String(r[map.indent]).trim()==="") continue;
        // Ignore summary/total rows such as "Grand Total"
        // when they have no item code and no product name.
        if (!code && !product && !Number.isNaN(q)) continue;

        if(!store||!code||!product||Number.isNaN(q)||!Number.isInteger(rank)||rank<=0)
          throw new Error(`Row ${i+2}: invalid/missing data or SKU Narration Order`);
        parsed.push({store,code,product,required:q,rank});
      }
      if(parsed.length)candidates.push({name,rows:parsed});
    }catch(e){ /* invalid sheets are ignored */ }
  }
  if(!candidates.length) throw new Error("No sheet with the required columns was found.");
  if(candidates.length===1) return candidates[0].rows;
  const choice=prompt("Multiple valid sheets found. Enter sheet name:\\n"+candidates.map(x=>x.name).join("\\n"),candidates[0].name);
  return (candidates.find(x=>x.name===choice)||candidates[0]).rows;
}

function validateRows(rows){
  const seen=new Set(), rankByCode=new Map(), codeByRank=new Map();
  for(const r of rows){
    const key=r.store+"¦"+r.code;
    if(seen.has(key)) throw new Error(`Duplicate outlet + item code: ${r.store} / ${r.code}`);
    seen.add(key);
    const code=String(r.code).trim();
    const oldRank=rankByCode.get(code);
    if(oldRank!==undefined && oldRank!==r.rank) throw new Error(`SKU ${code} has different narration ranks`);
    rankByCode.set(code,r.rank);
    const oldCode=codeByRank.get(r.rank);
    if(oldCode!==undefined && oldCode!==code) throw new Error(`Duplicate SKU narration rank: ${r.rank} (${oldCode} and ${code})`);
    codeByRank.set(r.rank,code);
  }
}

async function createLiveOrder(rows){
  validateRows(rows);

  const token = crypto.randomUUID
    ? crypto.randomUUID() + crypto.randomUUID()
    : Date.now()+"-"+Math.random()+"-"+Math.random();

  const payload = rows.map(r => ({
    store_name: r.store,
    item_code: r.code,
    product_name: r.product,
    required_qty: r.required,
    narration_rank: r.rank
  }));

  const url = `${window.SUPABASE_CONFIG.url}/rest/v1/rpc/create_order`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": window.SUPABASE_CONFIG.key,
        "Authorization": `Bearer ${window.SUPABASE_CONFIG.key}`
      },
      body: JSON.stringify({
        p_order_name: "Packing Order " + new Date().toLocaleString("en-IN"),
        p_access_token: token,
        p_items: payload
      })
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Supabase create_order failed (${response.status}): ${text}`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Supabase returned invalid JSON: ${text}`);
    }

    if (!data) {
      throw new Error("Supabase created the order but returned no Order ID.");
    }

    state.orderId = data;
    state.token = token;

    localStorage.setItem("pa_order_id", state.orderId);
    localStorage.setItem("pa_order_token", state.token);

    showShareLink();

    const result = await db.rpc("get_order", {
      p_order_id: state.orderId,
      p_access_token: state.token
    });

    if (result.error) {
      throw new Error(`Order created, but loading it failed: ${result.error.message || JSON.stringify(result.error)}`);
    }

    applyServerData(result.data);
    renderHome();
    startRealtime();
    startPolling();

    return state.orderId;

  } catch (err) {
    console.error("CREATE LIVE ORDER ERROR:", err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function showShareLink(){
  
  const isAdmin=location.pathname.endsWith("/admin.html") || /\/admin\/?$/.test(location.pathname);
  const staffUrl=isAdmin && /\/admin\/?$/.test(location.pathname) ? new URL("../",location.href).href : new URL("./",location.href).href;
  $("orderLink").value=staffUrl;
  const label=$("orderLinkBox")?.querySelector("span");
  if(label) label.textContent=isAdmin ? "Packaging Staff Link" : "App Link";
  $("orderLinkBox").classList.remove("hidden");
}

async function loadCurrentOrder(){
  const {data,error}=await db.rpc("get_current_order");
  if(error) throw error;
  if(!data) return false;
  state.orderId=data.id;
  state.token=data.access_token;
  localStorage.setItem("pa_order_id",state.orderId);
  localStorage.setItem("pa_order_token",state.token);
  await loadOrder();
  showShareLink();
  startRealtime();
  startPolling();
  return true;
}

async function loadOrder(){
  const {data,error}=await db.rpc("get_order",{
    p_order_id:state.orderId,
    p_access_token:state.token
  });
  if(error) throw error;
  // Delivery charges are only needed by Admin settings. Cache them briefly so
  // the Admin fallback poll does not make an extra RPC on every order refresh.
  if(IS_ADMIN_PAGE){
    const chargesStale=!state.deliveryChargesLoadedAt || Date.now()-state.deliveryChargesLoadedAt>30000;
    if(chargesStale){
      const chargeResult=await db.rpc("get_outlet_delivery_charges",{
        p_order_id:state.orderId,
        p_access_token:state.token
      });
      if(!chargeResult.error){
        data.delivery_charges=chargeResult.data||[];
        state.deliveryChargesLoadedAt=Date.now();
      }else{
        data.delivery_charges=[];
      }
    }else{
      data.delivery_charges=[...state.outlets.values()].map(o=>({outlet_id:o.id,delivery_charge:Number(o.deliveryCharge||0)}));
    }
  }else{
    data.delivery_charges=[];
  }
  applyServerData(data);
  renderHome();
}

function applyServerData(data){
  state.rows=[];
  state.outlets=new Map();
  state.events=data.events||[];
  state.order=data.order||null;
  state.rankMap={};
  const outlets=data.outlets||[];
  const items=data.items||[];
  const setup=outletSetup();
  const deliveryCharges=new Map((data.delivery_charges||[]).map(x=>[String(x.outlet_id),Number(x.delivery_charge||0)]));
  for(const o of outlets){
    const meta=setup[o.store_name]||{};
    state.outlets.set(o.id,{
      id:o.id,
      name:o.store_name,
      driver:o.driver||meta.driver||"", rank:Number(o.outlet_rank||meta.rank||9999),
      deliveryCharge:deliveryCharges.has(String(o.id))?deliveryCharges.get(String(o.id)):Number(meta.deliveryCharge||0),
      status:o.status,
      lockedDeviceId:o.locked_device_id,
      started_at:o.started_at, completed_at:o.completed_at,
      rows:[]
    });
  }
  for(const r of items){
    const o=state.outlets.get(r.outlet_id);
    if(!o) continue;
    o.rows.push({
      id:r.id,code:r.item_code,product:r.product_name,
      voice:r.voice_text||r.product_name,required:Number(r.required_qty),
      rank:Number(r.narration_rank),
      packed:Number(r.packed_qty||0),missing:Number(r.missing_qty||0),
      status:r.status==="pending"?null:r.status.toUpperCase(),reason:r.reason||"",
      started_at:r.started_at,completed_at:r.completed_at
    });
    state.rows.push(r);
    if(Number.isFinite(Number(r.narration_rank))) state.rankMap[String(r.item_code).trim()]=Number(r.narration_rank);
  }
  // Outlet sequence follows Outlet Rank; items inside follow SKU Narration Rank.
  for(const o of state.outlets.values()){
    o.rows.sort((a,b)=>{
      const ar=rankItem(a.code), br=rankItem(b.code);
      if(ar!==br) return ar-br;
      return String(a.product).localeCompare(String(b.product));
    });
  }
}

function formatDate(v){ return v ? new Date(v).toLocaleString("en-IN") : ""; }

let realtimeSyncTimer=null;
function scheduleRealtimeSync(){
  clearTimeout(realtimeSyncTimer);
  realtimeSyncTimer=setTimeout(()=>syncFromServer(),250);
}
function startRealtime(){
  if(!state.orderId) return;
  if(state.realtime) db.removeChannel(state.realtime);
  state.realtime=db.channel("packing-order-"+state.orderId)
    .on("postgres_changes",{event:"*",schema:"public",table:"outlets",filter:"order_id=eq."+state.orderId},scheduleRealtimeSync)
    .on("postgres_changes",{event:"*",schema:"public",table:"order_items",filter:"order_id=eq."+state.orderId},scheduleRealtimeSync)
    .subscribe((status,error)=>{
      if(status==="CHANNEL_ERROR"||status==="TIMED_OUT") console.warn("Realtime subscription:",status,error||"");
    });
}

async function syncFromServer(){
  if(state.syncBusy || !state.orderId || !state.token) return;
  state.syncBusy=true;
  try{
    await loadOrder();
    if(state.current){
      const o=state.outlets.get(state.current);
      if(o && o.status==="in_progress" && o.lockedDeviceId===DEVICE_ID){
        const next=o.rows.findIndex(r=>!r.status);
        if(next>=0 && next!==state.index){
          state.index=next;
          showProduct();
        }
      }
    }
  }catch(e){
    console.warn("sync",e.message);
  }finally{
    state.syncBusy=false;
  }
}
function latestEventForItem(itemId){
  const ev=state.events.filter(e=>e.item_id===itemId);
  return ev.length ? ev[ev.length-1] : null;
}
function reportDateLabel(v){return v?new Date(v).toLocaleDateString("en-IN",{day:"2-digit",month:"2-digit",year:"numeric"}):"";}

async function ensureReportAccess(){
  if(state.token)return true;
  const savedToken=localStorage.getItem("pa_order_token");
  const savedOrder=localStorage.getItem("pa_order_id");
  if(!savedToken)return false;
  state.token=savedToken;
  if(savedOrder)state.orderId=savedOrder;
  try{
    if(savedOrder) await loadOrder();
    return true;
  }catch(e){
    state.token=null;
    return false;
  }
}

async function loadReportHistory(){
  const box=$("reportHistoryList");
  if(!box)return;
  box.innerHTML='<div class="hint">Loading saved orders…</div>';
  if(!(await ensureReportAccess())){
    box.innerHTML='<div class="hint">No saved order access is available on this device. Create/open an order here first.</div>';
    return;
  }
  const {data,error}=await db.rpc("get_order_history",{p_access_token:state.token});
  if(error){
    box.innerHTML='<div class="hint">Historical reporting is not enabled yet. Run <b>supabase/historical_reports.sql</b> once in Supabase SQL Editor.</div>';
    return;
  }
  const orders=data||[];
  box.innerHTML=orders.length
    ? orders.map(o=>'<div class="reportHistoryRow"><div><b>'+esc(reportDateLabel(o.created_at))+'</b><span>'+esc(o.order_name||"Packing Order")+'</span></div><div><small>'+Number(o.outlet_count||0)+' outlets · '+Number(o.item_count||0)+' items · '+esc(o.order_status)+'</small> <button class="secondary invoiceHistoryBtn" data-order-id="'+esc(o.order_id)+'" data-order-name="'+esc(o.order_name||"Packing Order")+'">📄 Invoices</button></div></div>').join("")
    : '<div class="hint">No saved orders found.</div>';
  box.querySelectorAll(".invoiceHistoryBtn").forEach(b=>b.onclick=()=>openOrderInvoices(b.dataset.orderId,b.dataset.orderName));
}

async function openOrderInvoices(orderId,orderName){
  const dlg=$("invoiceDialog"),box=$("invoiceList"); if(!dlg||!box)return;
  $("invoiceDialogTitle").textContent=orderName+" — Invoices"; box.innerHTML='<div class="hint">Loading invoices…</div>'; dlg.showModal();
  try{
    const {data,error}=await db.rpc("get_report_data",{p_access_token:state.token,p_from_date:null,p_to_date:null});
    if(error)throw error;
    const rows=(data||[]).filter(r=>r.order_id===orderId&&r.invoice_filename);
    const seen=new Set(),files=[];
    for(const r of rows){const key=r.outlet_id+"|"+r.invoice_filename;if(seen.has(key))continue;seen.add(key);files.push(r);}
    if(!files.length){box.innerHTML='<div class="hint">No invoice has been uploaded for this order.</div>';return;}
    box.innerHTML=files.map(r=>'<div class="reportHistoryRow"><div><b>'+esc(r.outlet_name)+'</b><span>'+esc(r.invoice_filename)+'</span></div><button class="primary viewInvoiceBtn" data-order-id="'+esc(r.order_id)+'" data-outlet-id="'+esc(r.outlet_id)+'">View Invoice</button></div>').join("");
    box.querySelectorAll(".viewInvoiceBtn").forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent="Opening…";try{const resp=await fetch(window.SUPABASE_CONFIG.url+"/functions/v1/driver-api",{method:"POST",headers:{"apikey":window.SUPABASE_CONFIG.key,"Content-Type":"application/json"},body:JSON.stringify({action:"admin_invoice_url",access_token:state.token,order_id:b.dataset.orderId,outlet_id:b.dataset.outletId})});const d=await resp.json();if(!resp.ok||!d.ok)throw new Error(d.message||"Could not open invoice");window.open(d.url,"_blank","noopener");}catch(e){alert("Could not open invoice: "+e.message)}finally{b.disabled=false;b.textContent="View Invoice";}});
  }catch(e){box.innerHTML='<div class="hint">Could not load invoices: '+esc(e.message||e)+'</div>';}
}

function openReportDialog(){
  const dlg=$("reportDialog");
  if(!dlg)return;
  const today=new Date();
  const iso=new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const from=$("reportFromDate"),to=$("reportToDate");
  if(from&&!from.value)from.value="";
  if(to&&!to.value)to.value="";
  dlg.showModal();
  loadReportHistory();
}

async function exportHistoricalReport(){
  const btn=$("exportReportBtn");
  const from=String($("reportFromDate")?.value||"").trim()||null;
  const to=String($("reportToDate")?.value||"").trim()||null;
  if(from&&to&&from>to)return alert("From date cannot be after To date.");
  if(!(await ensureReportAccess()))return alert("No order access is available. Open the admin page on the device used to create an order.");
  btn.disabled=true; btn.textContent="Preparing…";
  try{
    const {data,error}=await db.rpc("get_report_data",{
      p_access_token:state.token,
      p_from_date:from,
      p_to_date:to
    });
    if(error)throw error;
    const rows=data||[];
    if(!rows.length)return alert("No packing data found for the selected date range.");

    const orderMap=new Map(),outletMap=new Map(),itemMap=new Map(),driverMap=new Map();
    const itemRows=[],exceptionRows=[];
    for(const r of rows){
      orderMap.set(r.order_id,{
        id:r.order_id,name:r.order_name,created:r.order_created_at,completed:r.order_completed_at
      });
      const outletKey=r.order_id+"¦"+r.outlet_id;
      if(!outletMap.has(outletKey))outletMap.set(outletKey,{
        orderId:r.order_id,orderName:r.order_name,orderDate:r.order_created_at,
        outlet:r.outlet_name,driver:r.driver||"Unassigned",rank:Number(r.outlet_rank||9999),
        status:r.outlet_status,required:0,packed:0,missing:0,items:0,
        started:r.item_started_at||null,completed:r.item_completed_at||null,
        deliveryStatus:r.delivery_status||"pending",deliveredAt:r.delivered_at||null,
        invoice:r.invoice_filename||"",invoiceUploaded:r.invoice_uploaded_at||null,
        deliveryCharge:Number(r.delivery_charge||0)
      });
      const o=outletMap.get(outletKey);
      o.required+=Number(r.required_qty||0);o.packed+=Number(r.packed_qty||0);o.missing+=Number(r.missing_qty||0);o.items++;
      if(r.item_started_at&&(!o.started||new Date(r.item_started_at)<new Date(o.started)))o.started=r.item_started_at;
      if(r.item_completed_at&&(!o.completed||new Date(r.item_completed_at)>new Date(o.completed)))o.completed=r.item_completed_at;
      if(r.delivery_status)o.deliveryStatus=r.delivery_status;
      if(r.delivered_at)o.deliveredAt=r.delivered_at;
      if(r.invoice_filename)o.invoice=r.invoice_filename;
      if(r.invoice_uploaded_at)o.invoiceUploaded=r.invoice_uploaded_at;
      o.deliveryCharge=Number(r.delivery_charge||o.deliveryCharge||0);

      const evDevice=r.packer_device||"";
      const row={
        "Order Date":reportDateLabel(r.order_created_at),
        "Order ID":r.order_id,
        "Order":r.order_name||"",
        "Outlet":r.outlet_name,
        "Driver":r.driver||"Unassigned",
        "Item Code":r.item_code,
        "Product":r.product_name,
        "Required":Number(r.required_qty||0),
        "Packed":Number(r.packed_qty||0),
        "Missing":Number(r.missing_qty||0),
        "Status":r.item_status||"PENDING",
        "Reason":r.reason||"",
        "Item Started":formatDate(r.item_started_at),
        "Item Completed":formatDate(r.item_completed_at),
        "Packer/Device":evDevice,
        "Delivery Status":r.delivery_status||"Pending",
        "Delivered At":formatDate(r.delivered_at),
        "Invoice":r.invoice_filename||"",
        "Invoice Uploaded":formatDate(r.invoice_uploaded_at),
        "Delivery Charge":Number(r.delivery_charge||0)
      };
      itemRows.push(row);
      if(r.item_status==="PARTIAL"||r.item_status==="MISSING")exceptionRows.push(row);

      const ik=r.item_code+"¦"+r.product_name;
      if(!itemMap.has(ik))itemMap.set(ik,{code:r.item_code,product:r.product_name,outlets:new Set(),required:0,packed:0,missing:0});
      const im=itemMap.get(ik); im.outlets.add(outletKey); im.required+=Number(r.required_qty||0); im.packed+=Number(r.packed_qty||0); im.missing+=Number(r.missing_qty||0);

      const dk=r.order_id+"¦"+(r.driver||"Unassigned");
      if(!driverMap.has(dk))driverMap.set(dk,{orderId:r.order_id,orderDate:r.order_created_at,driver:r.driver||"Unassigned",outlets:new Set(),required:0,packed:0,missing:0});
      const dm=driverMap.get(dk); dm.outlets.add(outletKey); dm.required+=Number(r.required_qty||0); dm.packed+=Number(r.packed_qty||0); dm.missing+=Number(r.missing_qty||0);
    }

    const outletRows=[...outletMap.values()].sort((a,b)=>new Date(a.orderDate)-new Date(b.orderDate)||a.rank-b.rank).map(o=>{
      const dur=o.started&&o.completed?Math.max(0,Math.round((new Date(o.completed)-new Date(o.started))/1000)):"";
      return {
        "Order Date":reportDateLabel(o.orderDate),"Order":o.orderName||"","Outlet":o.outlet,"Driver":o.driver,
        "Total Items":o.items,"Required Qty":o.required,"Packed Qty":o.packed,"Missing Qty":o.missing,
        "Missing %":o.required?Math.round(o.missing/o.required*10000)/100:0,
        "Packing Status":o.status||"","Started At":formatDate(o.started),"Completed At":formatDate(o.completed),
        "Packing Duration":dur===""?"":Math.floor(dur/60)+":"+String(dur%60).padStart(2,"0"),
        "Delivery Status":o.deliveryStatus,"Delivered At":formatDate(o.deliveredAt),
        "Invoice":o.invoice,"Invoice Uploaded":formatDate(o.invoiceUploaded),"Delivery Charge":o.deliveryCharge
      };
    });

    const orderRows=[...orderMap.values()].sort((a,b)=>new Date(a.created)-new Date(b.created)).map(o=>{
      const ors=[...outletMap.values()].filter(x=>x.orderId===o.id);
      const req=ors.reduce((s,x)=>s+x.required,0),pack=ors.reduce((s,x)=>s+x.packed,0),miss=ors.reduce((s,x)=>s+x.missing,0);
      return {"Order Date":reportDateLabel(o.created),"Order ID":o.id,"Order":o.name||"","Status":o.completed?"COMPLETED":"ACTIVE","Outlets":ors.length,"Required Qty":req,"Packed Qty":pack,"Missing Qty":miss,"Missing %":req?Math.round(miss/req*10000)/100:0,"Created At":formatDate(o.created),"Completed At":formatDate(o.completed)};
    });

    const itemSummary=[...itemMap.values()].sort((a,b)=>String(a.product).localeCompare(String(b.product))).map(x=>({"Item Code":x.code,"Product":x.product,"Outlets":x.outlets.size,"Required":x.required,"Packed":x.packed,"Missing":x.missing,"Missing %":x.required?Math.round(x.missing/x.required*10000)/100:0}));
    const driverSummary=[...driverMap.values()].sort((a,b)=>new Date(a.orderDate)-new Date(b.orderDate)||a.driver.localeCompare(b.driver)).map(x=>({"Order Date":reportDateLabel(x.orderDate),"Driver":x.driver,"Outlets":x.outlets.size,"Required":x.required,"Packed":x.packed,"Missing":x.missing,"Missing %":x.required?Math.round(x.missing/x.required*10000)/100:0}));

    const wb=XLSX.utils.book_new();
    const add=(name,list)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(list),name);
    add("Item Wise",itemRows);
    add("Outlet Summary",outletRows);
    add("Item Summary",itemSummary);
    add("Driver Summary",driverSummary);
    add("Missing & Partial",exceptionRows);
    add("Order Summary",orderRows);
    const suffix=from&&to?from+"_to_"+to:from?from+"_onward":to?"up_to_"+to:"All_Dates";
    XLSX.writeFile(wb,"Packing_Report_"+suffix+".xlsx");
    $("reportDialog")?.close();
  }catch(e){
    console.error("REPORT EXPORT ERROR",e);
    alert("Report export failed: "+(e.message||e));
  }finally{
    btn.disabled=false; btn.textContent="Download Excel";
  }
}

function downloadReport(){openReportDialog();}
let outletSetupDraft={};

function renderOutletSettings(all){
  const box=$("outletSettingsList");
  if(!box)return;
  const drivers=getDrivers();
  outletSetupDraft=Object.fromEntries(all.map(o=>[o.id,{driver:o.driver||"",rank:o.rank,deliveryCharge:Number(o.deliveryCharge||0)}]));
  box.innerHTML=all.map((o,i)=>`<div class="outletSettingRow" draggable="${window.matchMedia("(pointer:fine)").matches}" data-id="${o.id}">
    <span class="dragHandle" title="Drag to change rank">☷</span>
    <b class="rankNo">${i+1}</b>
    <span class="settingName">${esc(o.name)}</span>
    <select class="driverSelect" aria-label="Driver for ${esc(o.name)}">
      <option value="">Unassigned</option>
      ${drivers.map(d=>`<option value="${esc(d)}"${(o.driver||"")===d?" selected":""}>${esc(d)}</option>`).join("")}
    </select>
    <div class="chargeField"><span>₹ Delivery</span><input class="deliveryChargeInput" type="number" min="0" step="0.01" value="${Number(o.deliveryCharge||0).toFixed(2)}" aria-label="Delivery charge for ${esc(o.name)}" placeholder="0.00"></div>
  </div>`).join("");

  let drag=null;
  box.querySelectorAll(".outletSettingRow").forEach(row=>{
    row.addEventListener("dragstart",()=>{
      drag=row;
      row.classList.add("dragging");
    });
    row.addEventListener("dragend",()=>{
      row.classList.remove("dragging");
      drag=null;
      updateSettingRanks();
    });
    row.addEventListener("dragover",e=>{
      e.preventDefault();
      if(drag&&drag!==row){
        const r=row.getBoundingClientRect();
        row.parentNode.insertBefore(drag,e.clientY<r.top+r.height/2?row:row.nextSibling);
        updateSettingRanks();
      }
    });
  });

  box.querySelectorAll(".deliveryChargeInput").forEach(input=>{
    input.addEventListener("pointerdown",e=>e.stopPropagation());
    input.addEventListener("click",e=>e.stopPropagation());
    input.addEventListener("input",()=>{
      const row=input.closest(".outletSettingRow");
      if(!row)return;
      const id=row.dataset.id;
      if(!outletSetupDraft[id])outletSetupDraft[id]={};
      outletSetupDraft[id].deliveryCharge=Math.max(0,Number(input.value)||0);
    });
  });

  box.querySelectorAll(".driverSelect").forEach(select=>{
    select.addEventListener("pointerdown",e=>e.stopPropagation());
    select.addEventListener("click",e=>e.stopPropagation());
    select.addEventListener("change",()=>{
      const row=select.closest(".outletSettingRow");
      if(!row)return;
      const id=row.dataset.id;
      if(!outletSetupDraft[id])outletSetupDraft[id]={};
      outletSetupDraft[id].driver=select.value;
    });
  });
}

function updateSettingRanks(){
  $("outletSettingsList")?.querySelectorAll(".outletSettingRow").forEach((r,i)=>{
    r.querySelector(".rankNo").textContent=i+1;
    const id=r.dataset.id;
    if(!outletSetupDraft[id])outletSetupDraft[id]={};
    outletSetupDraft[id].rank=i+1;
  });
}

async function saveOutletSettings(){
  const btn=$("saveOutletSettings");
  const rows=[...($("outletSettingsList")?.querySelectorAll(".outletSettingRow")||[])];
  if(!rows.length)return;

  updateSettingRanks();
  btn.disabled=true;
  btn.textContent="Saving…";
  const errors=[];

  for(const o of state.outlets.values()){
    const draft=outletSetupDraft[o.id]||{};
    o.rank=Number(draft.rank)||9999;
    o.driver=String(draft.driver||"");
    o.deliveryCharge=Math.max(0,Number(draft.deliveryCharge)||0);
    const {error}=await db.rpc("update_outlet_settings",{
      p_order_id:state.orderId,
      p_outlet_id:o.id,
      p_access_token:state.token,
      p_rank:o.rank,
      p_driver:o.driver
    });
    if(error){errors.push(o.name+": "+error.message);continue;}
    const chargeResult=await db.rpc("update_outlet_delivery_charge",{
      p_order_id:state.orderId,
      p_outlet_id:o.id,
      p_access_token:state.token,
      p_delivery_charge:o.deliveryCharge
    });
    if(chargeResult.error)errors.push(o.name+" delivery charge: "+chargeResult.error.message);
  }

  btn.disabled=false;
  btn.textContent="Submit Changes";

  if(errors.length){
    return alert("Some changes could not be saved:\n\n"+errors.join("\n"));
  }

  localStorage.setItem(SETUP_KEY,JSON.stringify(
    Object.fromEntries([...state.outlets.values()].map(o=>[o.name,{rank:o.rank,driver:o.driver,deliveryCharge:o.deliveryCharge||0}]))
  ));
  $("outletSettingsDialog")?.close();
  renderAdminDashboard();
  alert("Outlet rank, driver assignments and delivery charges saved.");
}
function renderAdminDashboard(){
  if(!(location.pathname.endsWith("/admin.html") || /\/admin\/?$/.test(location.pathname))) return;
  const panel=$("adminDashboard"); if(!panel)return;
  panel.classList.remove("hidden");
  const all=[...state.outlets.values()];
  const outletQuery=String($("dashboardOutletFilter")?.value||"").trim().toLowerCase();
  const itemQuery=String($("dashboardItemFilter")?.value||"").trim().toLowerCase();
  const driverQuery=String($("dashboardDriverFilter")?.value||"").trim().toLowerCase();
  const filterStatus=$("dashboardStatusFilter")?.value||"ALL";
  const selected=all.filter(o=>{
    const outletOk=!outletQuery||String(o.name).toLowerCase().includes(outletQuery);
    const driverOk=!driverQuery||String(o.driver||"Unassigned").toLowerCase().includes(driverQuery);
    return outletOk&&driverOk;
  });
  const rows=selected.flatMap(o=>o.rows.map(r=>({...r,outlet:o.name,outletId:o.id,driver:o.driver||"Unassigned"})));
  const filtered=rows.filter(r=>{
    const itemOk=!itemQuery||String(r.product).toLowerCase().includes(itemQuery)||String(r.code).toLowerCase().includes(itemQuery);
    const statusOk=filterStatus==="ALL"||(r.status||"PENDING")===filterStatus;
    return itemOk&&statusOk;
  });
  const required=filtered.reduce((s,r)=>s+r.required,0),packed=filtered.reduce((s,r)=>s+r.packed,0),missing=filtered.reduce((s,r)=>s+r.missing,0);
  const exceptions=filtered.filter(r=>r.status==="MISSING"||r.status==="PARTIAL").length,pct=required?Math.round(missing/required*100):0;
  $("dashboardKpis").innerHTML=[["Required Qty",required,"blue"],["Packed Qty",packed,"green"],["Missing Qty",missing,"red"],["Exception Items",exceptions,"amber"],["Missing %",pct+"%","red"]].map(x=>'<div class="analysisKpi '+x[2]+'"><b>'+x[1]+'</b><span>'+x[0]+'</span></div>').join("");
  $("outletAnalysisBody").innerHTML=selected.map(o=>{
    const itemRows=o.rows.filter(r=>!itemQuery||String(r.product).toLowerCase().includes(itemQuery)||String(r.code).toLowerCase().includes(itemQuery));
    if(!itemRows.length)return "";
    const rq=itemRows.reduce((s,r)=>s+r.required,0),pk=itemRows.reduce((s,r)=>s+r.packed,0),ms=itemRows.reduce((s,r)=>s+r.missing,0),mp=rq?Math.round(ms/rq*100):0;
    return '<tr><td><b>'+esc(o.name)+'</b></td><td>'+esc(o.driver||"Unassigned")+'</td><td>'+rq+'</td><td>'+pk+'</td><td class="'+(ms?'dangerText':'')+'">'+ms+'</td><td>'+mp+'%</td><td><span class="miniStatus '+o.status+'">'+(o.status||"available").replace("_"," ")+'</span></td></tr>';
  }).join("")||'<tr><td colspan="7">No data</td></tr>';
  const byItem=new Map();
  filtered.forEach(r=>{const k=r.code;if(!byItem.has(k))byItem.set(k,{code:k,product:r.product,outlets:new Set(),required:0,packed:0,missing:0});const x=byItem.get(k);x.outlets.add(r.outlet);x.required+=r.required;x.packed+=r.packed;x.missing+=r.missing;});
  $("itemAnalysisBody").innerHTML=[...byItem.values()].filter(x=>x.missing>0).sort((a,b)=>b.missing-a.missing).map(x=>'<tr><td><b>'+esc(x.product)+'</b><small>'+esc(x.code)+'</small></td><td>'+x.outlets.size+'</td><td>'+x.required+'</td><td>'+x.packed+'</td><td class="dangerText">'+x.missing+'</td><td>'+Math.round(x.missing/x.required*100)+'%</td></tr>').join("")||'<tr><td colspan="6">No missing/partial items</td></tr>';
  $("exceptionAnalysisBody").innerHTML=filtered.filter(r=>r.status==="MISSING"||r.status==="PARTIAL").sort((a,b)=>b.missing-a.missing).map(r=>'<tr><td>'+esc(r.outlet)+'</td><td>'+esc(r.driver)+'</td><td><b>'+esc(r.product)+'</b><small>'+esc(r.code)+'</small></td><td>'+r.required+'</td><td>'+r.packed+'</td><td class="dangerText">'+r.missing+'</td><td><span class="miniStatus '+String(r.status).toLowerCase()+'">'+r.status+'</span></td><td>'+esc(r.reason||"")+'</td></tr>').join("")||'<tr><td colspan="8">No exceptions</td></tr>';
  const byDriver=new Map();
  selected.forEach(o=>{
    const itemRows=o.rows.filter(r=>!itemQuery||String(r.product).toLowerCase().includes(itemQuery)||String(r.code).toLowerCase().includes(itemQuery));
    if(!itemRows.length)return;
    const driver=o.driver||"Unassigned";
    if(!byDriver.has(driver))byDriver.set(driver,{driver,outlets:0,completed:0,inProgress:0,required:0,packed:0,missing:0});
    const d=byDriver.get(driver); d.outlets++;
    if(o.status==="completed")d.completed++;
    if(o.status==="in_progress")d.inProgress++;
    itemRows.forEach(r=>{d.required+=r.required;d.packed+=r.packed;d.missing+=r.missing;});
  });
  const driverBox=$("driverAnalysisBody");
  if(driverBox)driverBox.innerHTML=[...byDriver.values()].sort((x,y)=>x.driver.localeCompare(y.driver)).map(d=>'<tr><td><b>'+esc(d.driver)+'</b></td><td>'+d.outlets+'</td><td>'+d.completed+'</td><td>'+d.inProgress+'</td><td>'+d.required+'</td><td>'+d.packed+'</td><td class="'+(d.missing?'dangerText':'')+'">'+d.missing+'</td><td>'+((d.required?Math.round(d.missing/d.required*100):0))+'%</td></tr>').join("")||'<tr><td colspan="8">No driver data</td></tr>';
}

function enableSelectTypeSearch(){
  document.querySelectorAll("select").forEach(select=>{
    if(select.dataset.typeSearch)return;
    select.dataset.typeSearch="1";
    let buffer="",timer=null;
    select.addEventListener("keydown",e=>{
      if(e.key.length!==1||e.ctrlKey||e.altKey||e.metaKey)return;
      buffer+=e.key.toLowerCase();
      clearTimeout(timer);
      timer=setTimeout(()=>buffer="",700);
      const options=[...select.options];
      const hit=options.find(o=>o.textContent.trim().toLowerCase().startsWith(buffer));
      if(hit){select.value=hit.value;select.dispatchEvent(new Event("change",{bubbles:true}));}
    });
  });
}
let liveDeliveryTimer=null;
let liveDeliveryBusy=false;
async function loadLiveDeliverySummary(){
  const section=$("deliverySummary"),kpis=$("deliverySummaryKpis"),body=$("deliverySummaryBody");
  if(!section||!kpis||!body||!window.PA_ADMIN_SESSION||liveDeliveryBusy)return;
  liveDeliveryBusy=true;
  try{
    const r=await fetch(window.SUPABASE_CONFIG.url+"/functions/v1/driver-api",{method:"POST",headers:{"apikey":window.SUPABASE_CONFIG.key,"Content-Type":"application/json"},body:JSON.stringify({action:"admin_driver_dashboard",admin_session:window.PA_ADMIN_SESSION,preset:"today"})});
    const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||"Could not load delivery status");
    const l=d.live||{};
    section.classList.remove("hidden");
    const deliveryKpis=[["Delivered",Number(l.delivered||0)],["Pending Delivery",Number(l.pending_delivery||0)],["Packing",Number(l.packing_in_progress||0)],["Unassigned",Number(l.unassigned||0)],["Delivery Issues",Number(l.rejections||0)+Number(l.missing||0)]];
    kpis.innerHTML=deliveryKpis.map(x=>'<div class="deliverySummaryKpi"><small>'+esc(x[0])+'</small><b>'+esc(String(x[1]))+'</b></div>').join("");
    body.innerHTML=(d.live_outlets||[]).map(x=>{const st=dashboardStatus(x);return '<tr><td><b>'+esc(x.store_name)+'</b></td><td>'+esc(x.driver||"Unassigned")+'</td><td><span class="deliveryStatus '+st[0]+'">'+esc(st[1])+'</span></td><td>'+Number(x.missing||0)+'</td><td>'+Number(x.rejections||0)+'</td><td>'+esc(x.delivered?dashboardDate(x.delivered_at):x.packing_done?(x.invoice_uploaded?"Invoice uploaded":"Invoice pending"):"Packing in progress")+'</td></tr>';}).join("")||'<tr><td colspan="6" class="hint">No live delivery data.</td></tr>';
    const delivered=deliveryKpis[0][1],pendingDelivery=deliveryKpis[1][1],packing=deliveryKpis[2][1],unassigned=deliveryKpis[3][1],issues=deliveryKpis[4][1];
    if($("dashPendingDelivery"))$("dashPendingDelivery").textContent=String(pendingDelivery);
    if($("dashDeliveryIssues"))$("dashDeliveryIssues").textContent=String(issues);
    if($("dashDeliveryDetail"))$("dashDeliveryDetail").textContent=delivered+" delivered · "+pendingDelivery+" pending · "+packing+" packing";
    const alerts=[];
    if(issues)alerts.push('<div class="baAlert issue"><b>'+issues+'</b> delivery issue'+(issues===1?"":"s")+" need attention.</div>");
    if(unassigned)alerts.push('<div class="baAlert warn"><b>'+unassigned+'</b> outlet'+(unassigned===1?"":"s")+" have no driver assigned.</div>");
    if(pendingDelivery)alerts.push('<div class="baAlert"><b>'+pendingDelivery+'</b> outlet'+(pendingDelivery===1?"":"s")+" waiting for delivery.</div>");
    if(!alerts.length)alerts.push('<div class="baAlert empty">No active delivery alerts.</div>');
    if($("dashAlerts"))$("dashAlerts").innerHTML=alerts.join("");
  }catch(e){
    console.warn("Live delivery summary:",e.message);
    section.classList.remove("hidden");
    kpis.innerHTML='<div class="hint">Live delivery status could not be loaded. Use Refresh to retry.</div>';
    body.innerHTML='<tr><td colspan="6" class="hint">Delivery status unavailable.</td></tr>';
  }finally{
    liveDeliveryBusy=false;
  }
}
function startLiveDeliverySummary(){
  clearInterval(liveDeliveryTimer);
  loadLiveDeliverySummary();
  liveDeliveryTimer=setInterval(()=>{if(!document.getElementById("home")?.classList.contains("hidden"))loadLiveDeliverySummary();},30000);
}
window.addEventListener("pa-admin-authenticated",async()=>{try{if(IS_ADMIN_PAGE && (!state.orderId || !state.outlets.size)){await loadCurrentOrder();}else if(IS_ADMIN_PAGE){renderHome();}}catch(e){console.warn("Admin dashboard order refresh:",e.message);}loadLiveDeliverySummary();startLiveDeliverySummary();});
document.getElementById("deliverySummaryRefresh")?.addEventListener("click",loadLiveDeliverySummary);
function renderHome(){
  const orderLoadStatus=$("orderLoadStatus");
  if(orderLoadStatus) orderLoadStatus.classList.add("hidden");
  $("orderSummary").classList.remove("hidden");
  const all=[...state.outlets.values()];
  const totalItems=all.reduce((s,o)=>s+o.rows.length,0);
  const completed=all.filter(o=>o.status==="completed").length;
  const inProgress=all.filter(o=>o.status==="in_progress").length;
  const pending=all.length-completed-inProgress;
  const total=all.reduce((s,o)=>s+o.rows.reduce((a,r)=>a+r.required,0),0);
  const packed=all.reduce((s,o)=>s+o.rows.reduce((a,r)=>a+r.packed,0),0);
  const missing=all.reduce((s,o)=>s+o.rows.reduce((a,r)=>a+r.missing,0),0);
  const pct=total?Math.round(((packed+missing)/total)*100):0;
  const createdAt = formatDate(state.order?.created_at) || "—";
  if($("dashTotalOutlets"))$("dashTotalOutlets").textContent=String(all.length);
  if($("dashPackingProgress"))$("dashPackingProgress").textContent=pct+"%";
  if($("dashPackingProgressText"))$("dashPackingProgressText").textContent=pct+"%";
  if($("dashPackingProgressBar"))$("dashPackingProgressBar").style.width=pct+"%";
  if($("dashOrderDate"))$("dashOrderDate").textContent=createdAt;
  if($("dashOrderOutlets"))$("dashOrderOutlets").textContent=String(all.length);
  if($("dashOrderProducts"))$("dashOrderProducts").textContent=String(totalItems);
  if($("dashPackingDetail"))$("dashPackingDetail").textContent=packed+" packed · "+missing+" missing";
  if($("dashOrderName"))$("dashOrderName").textContent=state.order?.order_name||"Current packing order";
  if($("dashOrderStatus")){
    $("dashOrderStatus").textContent=state.order?.status==="completed"||pct>=100?"Completed":inProgress?"Packing in progress":"Pending";
  }
  $("orderSummary").innerHTML=
    '<div class="orderCreatedMeta"><span>ORDER CREATED</span><b>'+esc(createdAt)+'</b></div>'+
    '<div class="stat blue"><div class="num">'+all.length+'</div><div class="label">Total Outlets</div></div>'+
    '<div class="stat green"><div class="num">'+completed+'</div><div class="label">Completed</div></div>'+
    '<div class="stat amber"><div class="num">'+inProgress+'</div><div class="label">In Progress</div></div>'+
    '<div class="stat red"><div class="num">'+pending+'</div><div class="label">Pending</div></div>'+
    '<div class="stat progressStat"><div class="label">Overall Progress <b style="float:right">'+pct+'%</b></div><div class="progressLine"><i style="width:'+pct+'%"></i></div><small style="margin-top:7px;color:#64748b">'+packed+' packed · '+missing+' missing · '+totalItems+' products</small></div>';

  if(location.pathname.endsWith("/admin.html") || /\/admin\/?$/.test(location.pathname)){
    const f=$("dashboardOutletFilter"), itemF=$("dashboardItemFilter"), driverF=$("dashboardDriverFilter");
    if(f&&itemF&&driverF){
      const oldOutlet=f.value, oldItem=itemF.value, oldDriver=driverF.value;
      const outlets=[...new Set(all.map(o=>o.name))].sort((x,y)=>x.localeCompare(y));
      const items=[...new Map(all.flatMap(o=>o.rows.map(r=>[r.code,{code:r.code,product:r.product}]))).values()].sort((x,y)=>x.product.localeCompare(y.product));
      const drivers=[...new Set(all.map(o=>o.driver||"Unassigned"))].sort((x,y)=>x.localeCompare(y));
      $("dashboardOutletOptions").innerHTML=outlets.map(x=>'<option value="'+esc(x)+'"></option>').join("");
      $("dashboardItemOptions").innerHTML=items.map(x=>'<option value="'+esc(x.product)+'"></option>').join("");
      $("dashboardDriverOptions").innerHTML=drivers.map(x=>'<option value="'+esc(x)+'"></option>').join("");
      f.value=oldOutlet; itemF.value=oldItem; driverF.value=oldDriver;
      if(!f.dataset.bound){
        f.dataset.bound="1";
        [f,itemF,driverF].forEach(el=>el.addEventListener("input",renderAdminDashboard));
        $("dashboardStatusFilter").addEventListener("change",renderAdminDashboard);
      }
    }
  }
  all.sort((a,b)=>a.rank-b.rank || String(a.name).localeCompare(String(b.name)));
  const lists=[$("adminOutletList")].filter(Boolean);
  lists.forEach(list=>{
    list.innerHTML="";
    all.forEach((o,i)=>{
      const b=document.createElement("button");
      const done=o.rows.filter(r=>r.status).length;
      const mine=o.status==="in_progress"&&o.lockedDeviceId===DEVICE_ID;
      const locked=o.status==="in_progress"&&!mine;
      b.className="outlet "+(o.status==="completed"?"completed":o.status==="in_progress"?"progressing":"available");
      b.disabled=o.status==="completed"||locked;
      const tag=o.status==="completed"?"✓ COMPLETED":mine?"YOUR OUTLET":locked?"IN PROGRESS":"AVAILABLE";
      b.innerHTML='<div><span style="display:block;text-align:left;color:#94a3b8;font-size:11px;margin-bottom:3px">'+(i+1)+'</span><b>'+esc(o.name)+'</b></div><span><strong class="statusTag">'+tag+'</strong><br>'+done+'/'+o.rows.length+' products</span>';
      b.onclick=()=>startOutlet(o.id);
      list.appendChild(b);
    });
  });
  enableSelectTypeSearch();
  renderAdminDashboard();
}
async function startOutlet(outletId){
  const o=state.outlets.get(outletId);
  if(!o || o.status==="completed") return;
  $("syncStatus").textContent="Claiming outlet…";
  const {data,error}=await db.rpc("claim_outlet",{
    p_order_id:state.orderId,p_outlet_id:outletId,
    p_access_token:state.token,p_device_id:DEVICE_ID
  });
  if(error) return alert(error.message);
  if(!data) return alert("This outlet is already being packed on another phone.");
  await loadOrder();
  const updated=state.outlets.get(outletId);
  state.current=outletId;
  state.index=updated.rows.findIndex(r=>!r.status);
  if(state.index<0) state.index=0;
  $("home").classList.add("hidden");
  $("packing").classList.remove("hidden");
  $("adminPackingChooser")?.classList.add("hidden");
  $("packing").querySelector(".packingTop")?.classList.remove("hidden");
  showProduct();
}

function showProduct(){
  const o=state.outlets.get(state.current);
  if(!o)return;
  const r=o.rows[state.index];
  if(!r){completeScreen();return;}
  $("outletTitle").textContent=o.name;
  $("progressText").textContent=`Product ${state.index+1} / ${o.rows.length}`;
  $("progressBar").style.width=((state.index/o.rows.length)*100)+"%";
  $("itemCode").textContent="Item Code: "+r.code;
  $("productName").textContent=r.product;
  $("requiredQty").textContent=r.required;
  $("syncStatus").textContent=navigator.onLine?"● Synced":"● Offline — changes will sync when online";
  speakProduct(r);
}

async function record(status,packed,missing,reason=""){
  stopItemNarration();
  const o=state.outlets.get(state.current),r=o.rows[state.index];
  if(!r||r.status)return;
  $("syncStatus").textContent="Saving…";
  const {data,error}=await db.rpc("update_item_status",{
    p_order_id:state.orderId,p_item_id:r.id,p_access_token:state.token,
    p_device_id:DEVICE_ID,p_status:status.toLowerCase(),
    p_packed_qty:packed,p_missing_qty:missing,p_reason:reason
  });
  if(error){
    $("syncStatus").textContent="Save failed";
    return alert(error.message);
  }
  if(!data)return;
  await loadOrder();
  const updated=state.outlets.get(state.current);
  const nextIndex=updated?.rows.findIndex(x=>!x.status) ?? -1;
  if(nextIndex===-1){completeScreen();return;}
  state.index=nextIndex;
  showProduct();
}

function completeScreen(){
  const name=state.outlets.get(state.current)?.name||"Outlet";
  $("packing").classList.add("hidden");
  $("adminPackingChooser")?.classList.remove("hidden");
  $("packing").querySelector(".packingTop")?.classList.add("hidden");
  $("home").classList.remove("hidden");
  state.current=null;
  alert(`${name} completed.`);
  loadOrder().catch(e=>console.error(e));
}

$("packedBtn").onclick=()=>{
  const r=state.outlets.get(state.current).rows[state.index];
  record("PACKED",r.required,0,"");
};

$("repeatBtn").onclick=()=>{
  const r=state.outlets.get(state.current).rows[state.index];
  speakProduct(r);
};

$("missingBtn").onclick=()=>{
  const r=state.outlets.get(state.current).rows[state.index];
  $("missingText").textContent=`Required: ${r.required}`;
  $("missingDialog").showModal();
};

$("missingConfirm").onclick=e=>{
  e.preventDefault();
  const r=state.outlets.get(state.current).rows[state.index];
  const reason=$("missingReason").value;
  $("missingDialog").close();
  record("MISSING",0,r.required,reason);
};

$("partialBtn").onclick=()=>{
  const r=state.outlets.get(state.current).rows[state.index];
  $("partialRequired").value=r.required;
  $("packedQty").value="";
  $("partialDialog").showModal();
};

$("partialConfirm").onclick=e=>{
  e.preventDefault();
  const r=state.outlets.get(state.current).rows[state.index];
  const p=Number($("packedQty").value);
  if(!Number.isFinite(p)||p<0||p>r.required)
    return alert("Packed quantity must be between 0 and required quantity.");
  const reason=$("partialReason").value;
  $("partialDialog").close();
  record("PARTIAL",p,r.required-p,reason);
};

async function exitOutlet(){
  const o=state.outlets.get(state.current);
  if(!o || !state.current) return;
  const hasPacked = o.rows.some(r => Number(r.packed)>0 || Number(r.missing)>0 || r.status);
  if(hasPacked){
    return alert("This outlet has packing activity. Finish the outlet before leaving.");
  }
  $("syncStatus").textContent="Releasing outlet…";
  const {data,error}=await db.rpc("release_outlet",{
    p_order_id:state.orderId,
    p_outlet_id:state.current,
    p_access_token:state.token,
    p_device_id:DEVICE_ID
  });
  if(error){
    console.error("RELEASE OUTLET ERROR:",error);
    return alert("Could not release this outlet. Please try again.");
  }
  if(!data) return alert("This outlet cannot be released.");
  state.current=null;
  await loadOrder();
  startRealtime();
  $("packing").classList.add("hidden");
  $("home").classList.remove("hidden");
}
$("backBtn").onclick=exitOutlet;if($("saveOutletSettings"))$("saveOutletSettings").onclick=saveOutletSettings;if($("addDriverBtn"))$("addDriverBtn").onclick=async()=>{const el=$("newDriverName"),name=el.value.trim();if(!name)return;const {error}=await db.from("drivers").insert({name});if(error){if(String(error.code)==="23505")return alert("Driver already exists.");return alert(error.message);}await loadDrivers();el.value="";const drivers=getDrivers();document.querySelectorAll("#outletSettingsList .driverSelect").forEach(select=>{const current=select.value;select.innerHTML=`<option value="">Unassigned</option>${drivers.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join("")}`;select.value=current;});};

$("fileInput").onchange=async e=>{
  try{
    const file=e.target.files[0];
    if(!file)return;
    const data=await file.arrayBuffer();
    state.pendingRows=parseWorkbook(XLSX.read(data,{type:"array"}));
    validateRows(state.pendingRows);
    alert(`Validated ${state.pendingRows.length} products successfully. Click Create Live Order.`);
  }catch(err){alert(err.message)}
};

$("createOrderBtn").onclick=async()=>{
  try{
    if(!state.pendingRows?.length) return alert("Choose an Excel/CSV file first.");
    $("createOrderBtn").disabled=true;
    $("createOrderBtn").textContent="Creating…";
    await createLiveOrder(state.pendingRows);
  }catch(err){alert(err.message)}
  finally{
    $("createOrderBtn").disabled=false;
    $("createOrderBtn").textContent="Create Live Order";
  }
};

$("loadDemo").onclick=async()=>{
  const rows=[
    {store:"Outlet A",code:"1025",product:"Broccoli",required:5,rank:1},
    {store:"Outlet A",code:"1095",product:"Button Mushroom",required:12,rank:2},
    {store:"Outlet B",code:"1025",product:"Broccoli",required:7,rank:1},
    {store:"Outlet B",code:"4079",product:"Baby Corn",required:3,rank:3}
  ];
  try{await createLiveOrder(rows)}catch(e){alert(e.message)}
};




$("copyLink").onclick=async()=>{
  try{
    await navigator.clipboard.writeText($("orderLink").value);
    $("copyLink").textContent="Copied";
    setTimeout(()=>$("copyLink").textContent="Copy",1200);
  }catch{alert("Copy failed. Select and copy the link manually.")}
};


const VOICE_LANG_KEY = "packing_assistant_voice_language";
function getVoiceLanguage(){ return localStorage.getItem(VOICE_LANG_KEY) || "en"; }
function setVoiceLanguage(v){ localStorage.setItem(VOICE_LANG_KEY,v); }

function stopItemNarration(){
  if(state.narrationTimer){clearTimeout(state.narrationTimer);state.narrationTimer=null;}
  state.narrationItemId=null;
  state.narrationCount=0;
  if("speechSynthesis" in window) speechSynthesis.cancel();
}
function speakProduct(r){
  stopItemNarration();
  if(!r || r.status)return;
  const itemId=r.id;
  const lang=getVoiceLanguage();
  const qtyText=lang==="hi"?numberWordsHindi(r.required):lang==="gu"?numberWordsGujarati(r.required):numberWordsEnglish(r.required);
  const textToSpeak=r.product+" - "+qtyText;
  state.narrationItemId=itemId;
  state.narrationCount=0;
  const speakNext=()=>{
    if(state.narrationItemId!==itemId||r.status||state.narrationCount>=4)return;
    state.narrationCount++;
    if(!("speechSynthesis" in window))return;
    speechSynthesis.cancel();
    const voices=speechSynthesis.getVoices();
    const locale=lang==="hi"?"hi-IN":lang==="gu"?"gu-IN":"en-IN";
    const candidates=voices.filter(v=>v.lang.toLowerCase().startsWith(locale.toLowerCase()));
    const voice=candidates.find(v=>/male|man|ravi|hemant|google hindi|google ગુજરાતી/i.test(v.name))||candidates[0]||voices.find(v=>v.lang.toLowerCase().startsWith(lang+"-"));
    const u=new SpeechSynthesisUtterance(textToSpeak);
    u.lang=locale;u.rate=.72;u.pitch=.9;u.volume=1;
    if(voice)u.voice=voice;
    u.onend=()=>{if(state.narrationItemId===itemId&&state.narrationCount<4)state.narrationTimer=setTimeout(speakNext,350);};
    u.onerror=()=>{if(state.narrationItemId===itemId&&state.narrationCount<4)state.narrationTimer=setTimeout(speakNext,350);};
    speechSynthesis.speak(u);
  };
  speakNext();
}
function speak(text, lang="en"){
  if(!("speechSynthesis" in window))return;
  speechSynthesis.cancel();
  const voices=speechSynthesis.getVoices();
  const locale=lang === "hi" ? "hi-IN" : lang === "gu" ? "gu-IN" : "en-IN";
  const candidates=voices.filter(v=>v.lang.toLowerCase().startsWith(locale.toLowerCase()));
  const voice=candidates.find(v=>/male|man|ravi|hemant|google hindi|google ગુજરાતી/i.test(v.name)) || candidates[0] || voices.find(v=>v.lang.toLowerCase().startsWith(lang+"-"));
  const u=new SpeechSynthesisUtterance(text);
  u.lang=locale; u.rate=.72; u.pitch=.9; u.volume=1;
  if(voice)u.voice=voice;
  speechSynthesis.speak(u);
}

function numberWordsEnglish(n){
  if(!Number.isInteger(n))return String(n);
  const ones=["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"],tens=["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  if(n<20)return ones[n]; if(n<100)return tens[Math.floor(n/10)]+(n%10?" "+ones[n%10]:"");
  if(n<1000)return ones[Math.floor(n/100)]+" hundred"+(n%100?" "+numberWordsEnglish(n%100):""); return String(n);
}
function numberWordsHindi(n){
  if(!Number.isInteger(n))return String(n);
  const a=["शून्य","एक","दो","तीन","चार","पाँच","छह","सात","आठ","नौ","दस","ग्यारह","बारह","तेरह","चौदह","पंद्रह","सोलह","सत्रह","अठारह","उन्नीस","बीस","इक्कीस","बाईस","तेईस","चौबीस","पच्चीस","छब्बीस","सत्ताईस","अट्ठाईस","उनतीस","तीस","इकतीस","बत्तीस","तैंतीस","चौंतीस","पैंतीस","छत्तीस","सैंतीस","अड़तीस","उनतालीस","चालीस","इकतालीस","बयालीस","तैंतालीस","चवालीस","पैंतालीस","छियालीस","सैंतालीस","अड़तालीस","उनचास","पचास","इक्यावन","बावन","तिरेपन","चौवन","पचपन","छप्पन","सत्तावन","अट्ठावन","उनसठ","साठ","इकसठ","बासठ","तिरसठ","चौंसठ","पैंसठ","छियासठ","सड़सठ","अड़सठ","उनहत्तर","सत्तर","इकहत्तर","बहत्तर","तिहत्तर","चौहत्तर","पचहत्तर","छिहत्तर","सतहत्तर","अठहत्तर","उनासी","अस्सी","इक्यासी","बयासी","तिरासी","चौरासी","पचासी","छियासी","सतासी","अट्ठासी","नवासी","नब्बे","इक्यानबे","बानबे","तिरानबे","चौरानबे","पंचानबे","छियानबे","सत्तानबे","अट्ठानबे","निन्यानबे","सौ"];
  if(n<=100)return a[n]; return String(n);
}
function numberWordsGujarati(n){
  if(!Number.isInteger(n))return String(n);
  const a=["શૂન્ય","એક","બે","ત્રણ","ચાર","પાંચ","છ","સાત","આઠ","નવ","દસ","અગિયાર","બાર","તેર","ચૌદ","પંદર","સોળ","સત્તર","અઢાર","ઓગણીસ","વીસ","એકવીસ","બાવીસ","ત્રેવીસ","ચોવીસ","પચ્ચીસ","છવ્વીસ","સત્તાવીસ","અઠ્ઠાવીસ","ઓગણત્રીસ","ત્રીસ","એકત્રીસ","બત્રીસ","તેત્રીસ","ચોત્રીસ","પાંત્રીસ","છત્રીસ","સડત્રીસ","અડત્રીસ","ઓગણચાલીસ","ચાલીસ","એકતાલીસ","બેતાલીસ","ત્રેતાલીસ","ચુંમાલીસ","પિસ્તાલીસ","છેતાલીસ","સુડતાલીસ","અડતાલીસ","ઓગણપચાસ","પચાસ","એકાવન","બાવન","ત્રેપન","ચોપન","પંચાવન","છપ્પન","સત્તાવન","અઠ્ઠાવન","ઓગણસાઠ","સાઠ","એકસઠ","બાસઠ","ત્રેસઠ","ચોસઠ","પાંસઠ","છાસઠ","સડસઠ","અડસઠ","ઓગણોતેર","સિત્તેર","એકોતેર","બોતેર","ત્રોતેર","ચુમોતેર","પંચોતેર","છોતેર","સિત્યોતેર","ઇઠ્યોતેર","ઓગણએંસી","એંસી","એક્યાસી","બ્યાસી","ત્ર્યાસી","ચોર્યાસી","પંચાસી","છ્યાસી","સત્ત્યાસી","અઠ્યાસી","નેવ્યાસી","નેવું","એકાણું","બાણું","ત્રાણું","ચોરાણું","પંચાણું","છન્નું","સત્તાણું","અઠ્ઠાણું","નવ્વાણું","સો"];
  if(n<=100)return a[n]; return String(n);
}

const packingVoiceLanguageEl=$("packingVoiceLanguage");
function syncVoiceSelectors(v){
  if(packingVoiceLanguageEl) packingVoiceLanguageEl.value=v;
}
syncVoiceSelectors(getVoiceLanguage());
if(packingVoiceLanguageEl) packingVoiceLanguageEl.onchange=()=>{
  setVoiceLanguage(packingVoiceLanguageEl.value);
  syncVoiceSelectors(packingVoiceLanguageEl.value);
  const o=state.outlets.get(state.current); if(o) speakProduct(o.rows[state.index]);
};

function dashboardMoney(n){return "₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});}
function dashboardDate(v,withTime=true){if(!v)return "—";return new Date(v).toLocaleString("en-IN",withTime?{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}:{day:"2-digit",month:"short",year:"numeric"});}
function dashboardDuration(m){if(m==null||!Number.isFinite(Number(m)))return "—";const n=Math.round(Number(m));if(n<60)return n+" min";const h=Math.floor(n/60),mm=n%60;return h+"h "+String(mm).padStart(2,"0")+"m";}
function dashboardStatus(x){if(x.delivered)return ["delivered","✓ Delivered"];if(x.packing_done)return ["pending","Ready • Pending delivery"];return ["packing","Packing "+String(x.status||"available").replace("_"," ")];}
function renderDriverDashboard(data){
  const k=$("driverDashboardKpis"),drows=$("driverPerformanceBody"),live=$("liveRouteBody"),ex=$("driverExceptionsBody"),recent=$("recentDeliveriesBody");
  if(!k||!drows||!live||!ex||!recent)return;
  const p=data.period||{},l=data.live||{},drivers=data.drivers||[];
  const pendingExceptions=Number(p.invoice_pending||0)+Number(p.rejection_confirmation_pending||0);
  k.innerHTML=[
    ["Live route",Number(l.delivered||0)+" / "+Number(l.outlets||0),"delivered now"],["Live unassigned",Number(l.unassigned||0),"current route"],
    ["Delivered",Number(p.delivered||0),"selected period"],
    ["Pending delivery",Number(p.pending_delivery||0),"packing completed"],
    ["Missing qty",Number(p.missing||0),"packing exceptions"],
    ["Rejected qty",Number(p.rejections||0),"driver-reported"],
    ["Partial items",Number(p.partial_items||0),"outlet items"],
    ["Delivery checks",pendingExceptions,pendingExceptions?"needs attention":"clear"],
    ["Earnings",dashboardMoney(p.earnings),"selected period"]
  ].map(x=>'<div class="deliveryKpi"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b><span>'+esc(x[2])+'</span></div>').join("");
  drows.innerHTML=drivers.map(dr=>{
    const x=dr.period||{},lv=dr.live||{};
    return '<tr><td><b>'+esc(dr.driver_name)+'</b><small>Live '+Number(lv.delivered||0)+'/'+Number(lv.outlets||0)+'</small></td><td>'+Number(x.delivered||0)+'</td><td>'+Number(x.pending_delivery||0)+'</td><td>'+Number(x.missing||0)+'</td><td>'+Number(x.rejections||0)+'</td><td>'+Number(x.completion_pct||0).toFixed(1)+'%</td><td>'+dashboardDuration(x.avg_delivery_minutes)+'</td><td>'+dashboardMoney(x.earnings)+'</td><td>'+dashboardMoney(dr.balance)+'</td></tr>';
  }).join("")||'<tr><td colspan="9" class="hint">No active driver data.</td></tr>';
  live.innerHTML=(data.live_outlets||[]).map(x=>{
    const st=dashboardStatus(x);
    return '<tr><td><b>'+esc(x.store_name)+'</b><small>Rank '+Number(x.outlet_rank||0)+'</small></td><td>'+esc(x.driver)+'</td><td><span class="deliveryStatus '+st[0]+'">'+esc(st[1])+'</span></td><td>'+Number(x.missing||0)+'</td><td>'+Number(x.rejections||0)+'</td><td>'+(x.delivered?dashboardDate(x.delivered_at):x.packing_done?(x.invoice_uploaded?"Invoice uploaded":"Invoice pending"):"Packing in progress")+'</td></tr>';
  }).join("")||'<tr><td colspan="6" class="hint">No active live order.</td></tr>';
  ex.innerHTML=(data.exceptions||[]).map(x=>'<tr><td>'+dashboardDate(x.order_created_at,false)+'</td><td>'+esc(x.driver)+'</td><td><b>'+esc(x.store_name)+'</b><small>'+esc(x.order_name)+'</small></td><td>'+Number(x.missing||0)+'</td><td>'+Number(x.rejections||0)+'</td><td>'+(x.invoice_pending?'<span class="deliveryFlag bad">Invoice pending</span>':"✓")+'</td><td>'+(x.rejection_confirmation_pending?'<span class="deliveryFlag warn">Rejection confirmation pending</span>':"✓")+'</td></tr>').join("")||'<tr><td colspan="7" class="hint">No delivery exceptions in selected period.</td></tr>';
  recent.innerHTML=(data.recent||[]).map(x=>'<tr><td>'+dashboardDate(x.delivered_at)+'</td><td>'+esc(x.driver)+'</td><td><b>'+esc(x.store_name)+'</b></td><td>'+dashboardDuration(x.delivery_minutes)+'</td><td>'+dashboardMoney(x.delivery_charge)+'</td><td>'+(x.missing?Number(x.missing):"—")+'</td><td>'+(x.rejections?Number(x.rejections):"—")+'</td></tr>').join("")||'<tr><td colspan="7" class="hint">No deliveries in selected period.</td></tr>';
  const lo=data.live_order;
  $("liveOrderLabel").textContent=lo?(lo.order_name+" · "+dashboardDate(lo.created_at,false)):"No active order";
  $("driverDashboardPeriodLabel").textContent=(data.period?.from_date&&data.period?.to_date)?(data.period.from_date+" → "+data.period.to_date):"All saved dates";
}
let driverDashboardBusy=false;
async function loadDriverAdminDashboard(){
  const box=$("driverDashboardKpis");if(!box||driverDashboardBusy)return;
  driverDashboardBusy=true;
  if(!(await ensureFleetAdminPassword())){driverDashboardBusy=false;return;}
  const preset=$("driverDashboardPreset")?.value||"30d";
  const from=$("driverDashboardFrom")?.value||"",to=$("driverDashboardTo")?.value||"";
  box.innerHTML='<div class="hint">Loading delivery analytics…</div>';
  try{
    const r=await fetch(window.SUPABASE_CONFIG.url+"/functions/v1/driver-api",{method:"POST",headers:{"apikey":window.SUPABASE_CONFIG.key,"Content-Type":"application/json"},body:JSON.stringify({action:"admin_driver_dashboard",admin_session:window.PA_ADMIN_SESSION,preset,from_date:from,to_date:to})});
    const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||"Could not load delivery dashboard");
    renderDriverDashboard(d);
  }catch(e){box.innerHTML='<div class="hint">Could not load delivery dashboard: '+esc(e.message)+'</div>';}
  finally{driverDashboardBusy=false;}
}

function renderAdminPackingChooser(){
  const box=$("adminOutletList");
  if(!box)return;
  const all=[...state.outlets.values()].sort((a,b)=>a.rank-b.rank||String(a.name).localeCompare(String(b.name)));
  box.innerHTML="";
  if(!all.length){
    box.innerHTML='<div class="hint" style="padding:20px">No active order is loaded. Create or refresh the live order first.</div>';
    return;
  }
  all.forEach((o,i)=>{
    const b=document.createElement("button");
    const done=o.rows.filter(r=>r.status).length;
    const mine=o.status==="in_progress"&&o.lockedDeviceId===DEVICE_ID;
    const locked=o.status==="in_progress"&&!mine;
    b.className="outlet "+(o.status==="completed"?"completed":o.status==="in_progress"?"progressing":"available");
    b.disabled=o.status==="completed"||locked;
    const tag=o.status==="completed"?"✓ COMPLETED":mine?"YOUR OUTLET":locked?"IN PROGRESS":"AVAILABLE";
    b.innerHTML='<div><span style="display:block;text-align:left;color:#94a3b8;font-size:11px;margin-bottom:3px">'+(i+1)+'</span><b>'+esc(o.name)+'</b></div><span><strong class="statusTag">'+tag+'</strong><br>'+done+'/'+o.rows.length+' products</span>';
    b.onclick=()=>startOutlet(o.id);
    box.appendChild(b);
  });
}

function startPolling(){
  clearInterval(state.poll);
  const interval=IS_ADMIN_PAGE?10000:3000;
  state.poll=setInterval(async()=>{
    if(!navigator.onLine||!state.orderId||!state.token)return;
    if(IS_ADMIN_PAGE){
      const visible=["home","packingOverview","packing"].some(id=>!document.getElementById(id)?.classList.contains("hidden"));
      if(!visible)return;
    }
    try{
      await syncFromServer();
      if(state.current){
        const o=state.outlets.get(state.current);
        if(o && o.status==="in_progress" && o.lockedDeviceId===DEVICE_ID){
          const next=o.rows.findIndex(r=>!r.status);
          if(next>=0){state.index=next;showProduct();}
        }
      }
    }catch(e){console.warn("sync",e.message)}
  },interval);
}

function updateConnection(){
  $("connection").textContent=navigator.onLine?"● Online":"● Offline";
}
window.addEventListener("online",updateConnection);
window.addEventListener("offline",updateConnection);
updateConnection();

(async function init(){
  // Do not block the dashboard on the optional driver-name query. A slow/failed
  // settings query must never prevent the main order from loading.
  if(IS_ADMIN_PAGE) loadDrivers().catch(e=>console.warn("driver load",e.message));
  const params=new URLSearchParams(location.search);
  const legacyOrder=params.get("order");
  const legacyToken=params.get("token");
  const restoreSavedOrder=async()=>{
    const savedOrder=localStorage.getItem("pa_order_id");
    const savedToken=localStorage.getItem("pa_order_token");
    if(!savedOrder||!savedToken)return false;
    state.orderId=savedOrder;
    state.token=savedToken;
    await loadOrder();
    startPolling();
    return true;
  };
  try{
    if(legacyOrder && legacyToken){
      state.orderId=legacyOrder;
      state.token=legacyToken;
      localStorage.setItem("pa_order_id",state.orderId);
      localStorage.setItem("pa_order_token",state.token);
      await loadOrder();
      startPolling();
      history.replaceState({},document.title,location.pathname);
      return;
    }

    // Prefer the server's latest order, but never leave the admin screen blank
    // when that discovery call has a transient/network/API failure. Restore the
    // last known valid order token from this browser as a deterministic fallback.
    let loaded=false;
    try{
      loaded=await loadCurrentOrder();
    }catch(e){
      console.warn("Current order discovery failed; trying saved order",e.message);
    }
    if(!loaded) await restoreSavedOrder();
  }catch(e){
    console.warn("Order bootstrap failed",e.message);
    const status=$("orderLoadStatus");
    if(status){
      status.textContent="Could not load the saved order. Click Refresh to retry.";
      status.classList.remove("hidden");
    }
  }
})();

function renderPackingOverview(){
  const box=$("packingOverviewBody"),kpis=$("packingOverviewKpis");
  if(!box||!kpis)return;
  const all=[...state.outlets.values()].sort((a,b)=>(a.rank||999)-(b.rank||999));
  const total=all.reduce((s,o)=>s+o.rows.reduce((a,r)=>a+r.required,0),0);
  const packed=all.reduce((s,o)=>s+o.rows.reduce((a,r)=>a+r.packed,0),0);
  const missing=all.reduce((s,o)=>s+o.rows.reduce((a,r)=>a+r.missing,0),0);
  const completed=all.filter(o=>o.status==="completed").length;
  const inProgress=all.filter(o=>o.status==="in_progress").length;
  const pending=all.length-completed-inProgress;
  const pct=total?Math.round(((packed+missing)/total)*100):0;
  const k=[["Outlets",all.length],["Completed",completed],["In Progress",inProgress],["Pending",pending],["Required",total],["Packed",packed],["Missing",missing],["Progress",pct+"%"]];
  kpis.innerHTML=k.map(x=>'<div class="analysisKpi"><span>'+esc(String(x[0]))+'</span><b>'+esc(String(x[1]))+'</b></div>').join("");
  if($("packingOverviewOrderName"))$("packingOverviewOrderName").textContent=state.order?.order_name||"No current order";
  box.innerHTML=all.map(o=>{
    const req=o.rows.reduce((s,r)=>s+r.required,0),pk=o.rows.reduce((s,r)=>s+r.packed,0),ms=o.rows.reduce((s,r)=>s+r.missing,0),done=req?Math.round(((pk+ms)/req)*100):0;
    const status=o.status==="completed"?"Completed":o.status==="in_progress"?"Packing":"Pending";
    const cls=o.status==="completed"?"done":o.status==="in_progress"?"packing":"pending";
    return '<tr><td>'+esc(String(o.rank??"—"))+'</td><td><b>'+esc(o.name)+'</b></td><td>'+esc(o.driver||"Unassigned")+'</td><td>'+o.rows.length+'</td><td>'+req+'</td><td>'+pk+'</td><td>'+ms+'</td><td><div class="packingOverviewProgress"><i style="width:'+done+'%"></i><span>'+done+'%</span></div></td><td><span class="deliveryStatus '+cls+'">'+status+'</span></td></tr>';
  }).join("")||'<tr><td colspan="9" class="hint">No current order loaded.</td></tr>';
}
function showPackingOverview(){
  if(typeof stopItemNarration==="function")stopItemNarration();
  document.querySelector(".baSidebar")?.classList.remove("open");
  ["home","packing","packingOverview","driverDashboard","fleetManagement"].forEach(id=>document.getElementById(id)?.classList.add("hidden"));
  document.getElementById("packingOverview")?.classList.remove("hidden");
  setBAActive("sidePacking");
  renderPackingOverview();
  window.scrollTo({top:0,behavior:"smooth"});
}
function showAdminDashboard(){
  if(typeof stopItemNarration==="function")stopItemNarration();
  if(typeof setBAActive==="function")setBAActive("sideDashboard");
  document.querySelector(".baSidebar")?.classList.remove("open");
  ["packing","packingOverview","driverDashboard","fleetManagement"].forEach(id=>document.getElementById(id)?.classList.add("hidden"));
  document.getElementById("home")?.classList.remove("hidden");
  ["reportDialog","invoiceDialog","outletSettingsDialog","driverPaymentDialog"].forEach(id=>document.getElementById(id)?.open&&document.getElementById(id).close());
  window.scrollTo({top:0,behavior:"smooth"});
}
const adminMenu=document.getElementById("adminMenu"),adminMenuBtn=document.getElementById("adminMenuBtn");
adminMenuBtn?.addEventListener("click",e=>{e.stopPropagation();adminMenu.classList.toggle("hidden");adminMenuBtn.setAttribute("aria-expanded",String(!adminMenu.classList.contains("hidden")))});
document.addEventListener("click",e=>{if(adminMenu&&!adminMenu.contains(e.target)&&e.target!==adminMenuBtn)adminMenu.classList.add("hidden")});
document.getElementById("menuReportBtn")?.addEventListener("click",()=>{adminMenu.classList.add("hidden");setBAActive("sideReports");openReportDialog()});
document.getElementById("menuChangePassword")?.addEventListener("click",()=>{adminMenu.classList.add("hidden");window.PA_ADMIN_CHANGE_PASSWORD?.();});
document.getElementById("menuLogout")?.addEventListener("click",()=>{adminMenu.classList.add("hidden");window.PA_ADMIN_LOGOUT?.();});
document.getElementById("closeReportDialog")?.addEventListener("click",()=>document.getElementById("reportDialog")?.close());
document.getElementById("fleetBackBtn")?.addEventListener("click",showAdminDashboard);
document.getElementById("driverDashboardBackBtn")?.addEventListener("click",showAdminDashboard);
document.getElementById("packingChooserDashboardBackBtn")?.addEventListener("click",showAdminDashboard);
document.getElementById("packingDashboardBackBtn")?.addEventListener("click",showAdminDashboard);
document.getElementById("reportDashboardBack")?.addEventListener("click",showAdminDashboard);
document.getElementById("invoiceDashboardBack")?.addEventListener("click",showAdminDashboard);
document.getElementById("outletSettingsDashboardBack")?.addEventListener("click",showAdminDashboard);
document.getElementById("driverPaymentDashboardBack")?.addEventListener("click",showAdminDashboard);
document.getElementById("closeInvoiceDialog")?.addEventListener("click",()=>document.getElementById("invoiceDialog")?.close());
document.getElementById("exportReportBtn")?.addEventListener("click",exportHistoricalReport);
document.getElementById("reportAllDatesBtn")?.addEventListener("click",()=>{$("reportFromDate").value="";$("reportToDate").value="";loadReportHistory();});
document.getElementById("menuOutletSettings")?.addEventListener("click",()=>{adminMenu.classList.add("hidden");setBAActive("sideSettings");renderOutletSettings([...state.outlets.values()].sort((a,b)=>a.rank-b.rank));document.getElementById("outletSettingsDialog").showModal()});

async function ensureFleetAdminPassword(){if(window.PA_ADMIN_SESSION)return true;if(window.PA_REAUTH_ADMIN)return await window.PA_REAUTH_ADMIN();return false;}
async function loadFleetManagement(){
  const box=$("fleetCards"); if(!box)return;
  box.innerHTML='<div class="hint">Loading driver ledger…</div>';
  if(!(await ensureFleetAdminPassword())){box.innerHTML='<div class="hint">Admin session expired. Please sign in again.</div>';return;}
  try{
    const r=await fetch(window.SUPABASE_CONFIG.url+"/functions/v1/driver-api",{method:"POST",headers:{"apikey":window.SUPABASE_CONFIG.key,"Content-Type":"application/json"},body:JSON.stringify({action:"admin_driver_fleet",admin_session:window.PA_ADMIN_SESSION})});
    const d=await r.json(); if(!r.ok||!d.ok)throw new Error(d.message||"Could not load fleet");
    box.innerHTML=(d.drivers||[]).map(dr=>'<div class="fleetCard"><div class="fleetCardHead"><div><span class="eyebrow">DRIVER</span><h3>'+esc(dr.driver_name)+'</h3></div><button class="primary payDriverBtn" data-id="'+esc(dr.driver_id)+'" data-name="'+esc(dr.driver_name)+'">+ Add Payment</button></div><div class="fleetKpis"><div><small>Total earned</small><b>₹'+Number(dr.earned||0).toFixed(2)+'</b></div><div><small>Total paid</small><b>₹'+Number(dr.paid||0).toFixed(2)+'</b></div><div class="'+(Number(dr.balance||0)>0?"due":"clear")+'"><small>Remaining</small><b>₹'+Number(dr.balance||0).toFixed(2)+'</b></div></div><div class="fleetLedger"><div class="fleetLedgerTitle">Payment ledger</div>'+((dr.payments||[]).length?(dr.payments||[]).map(p=>'<div class="fleetLedgerRow"><div><b>₹'+Number(p.amount||0).toFixed(2)+'</b><small>'+new Date(p.paid_at).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})+(p.note?" · "+esc(p.note):"")+'</small></div>'+(p.screenshot_path?'<button class="secondary fleetProofBtn" data-path="'+esc(p.screenshot_path)+'">View proof</button>':"<span class=\"ledgerNoProof\">No proof</span>")+(p.confirmed_at?'<span class="ledgerConfirmed">✓ Driver confirmed<br><small>'+new Date(p.confirmed_at).toLocaleString("en-IN")+'</small></span>':'<span class="ledgerPending">Awaiting driver confirmation</span>')+'</div>').join(""):'<div class="hint">No payments recorded.</div>')+'</div></div>').join("")||'<div class="hint">No active drivers.</div>';
    box.querySelectorAll(".payDriverBtn").forEach(b=>b.onclick=()=>openDriverPayment(b.dataset.id,b.dataset.name));
    box.querySelectorAll(".fleetProofBtn").forEach(b=>b.onclick=async()=>{try{const x=await fetch(window.SUPABASE_CONFIG.url+"/functions/v1/driver-api",{method:"POST",headers:{"apikey":window.SUPABASE_CONFIG.key,"Content-Type":"application/json"},body:JSON.stringify({action:"admin_payment_screenshot_url",admin_session:window.PA_ADMIN_SESSION,path:b.dataset.path})});const d=await x.json();if(!x.ok||!d.ok)throw new Error(d.message||"Could not open proof");window.open(d.url,"_blank","noopener")}catch(e){alert(e.message)}});
  }catch(e){box.innerHTML='<div class="hint">Could not load fleet ledger: '+esc(e.message)+'</div>';}
}
function openDriverPayment(driverId,name){
  $("paymentDriverId").value=driverId;$("paymentDriverTitle").textContent=name+" — Record Payment";$("paymentAmount").value="";$("paymentNote").value="";$("paymentScreenshot").value="";$("paymentMsg").textContent="";
  const now=new Date();const d=new Date(now.getTime()-now.getTimezoneOffset()*60000);$("paymentDate").value=d.toISOString().slice(0,16);
  $("driverPaymentDialog").showModal();
}
async function saveDriverPayment(){
  const driverId=$("paymentDriverId").value,amount=Number($("paymentAmount").value||0),paidAt=$("paymentDate").value,note=$("paymentNote").value.trim(),file=$("paymentScreenshot").files[0];
  if(!driverId||amount<=0)return $("paymentMsg").textContent="Enter a valid payment amount.";
  if(!file)return $("paymentMsg").textContent="Add the payment screenshot.";
  const btn=$("saveDriverPayment");btn.disabled=true;btn.textContent="Saving…";$("paymentMsg").textContent="Uploading payment proof…";
  try{
    const session=window.PA_ADMIN_SESSION||"";if(!session)throw new Error("Admin session expired.");
    const up=await fetch(window.SUPABASE_CONFIG.url+"/functions/v1/driver-api",{method:"POST",headers:{"apikey":window.SUPABASE_CONFIG.key,"Content-Type":"application/json"},body:JSON.stringify({action:"admin_payment_upload_url",admin_session:session,driver_id:driverId,filename:file.name,mime_type:file.type,extension:"jpg"})});
    const ud=await up.json();if(!up.ok||!ud.ok)throw new Error(ud.message||"Could not prepare upload.");
    const {error}=await db.storage.from("driver-payments").uploadToSignedUrl(ud.path,ud.token,file);if(error)throw error;
    const rec=await fetch(window.SUPABASE_CONFIG.url+"/functions/v1/driver-api",{method:"POST",headers:{"apikey":window.SUPABASE_CONFIG.key,"Content-Type":"application/json"},body:JSON.stringify({action:"admin_record_payment",admin_session:session,driver_id:driverId,amount,paid_at:new Date(paidAt).toISOString(),note,screenshot_path:ud.path})});
    const rd=await rec.json();if(!rec.ok||!rd.ok)throw new Error(rd.message||"Could not save payment.");
    $("driverPaymentDialog").close();await loadFleetManagement();
  }catch(e){$("paymentMsg").textContent=e.message;}finally{btn.disabled=false;btn.textContent="Save Payment";}
}
document.getElementById("menuFleetManagement")?.addEventListener("click",async()=>{adminMenu.classList.add("hidden");setBAActive("sideDelivery");document.querySelector(".baSidebar")?.classList.remove("open");document.body.classList.remove("baSidebarOpen");document.getElementById("home")?.classList.add("hidden");document.getElementById("packing")?.classList.add("hidden");document.getElementById("packingOverview")?.classList.add("hidden");document.getElementById("driverDashboard")?.classList.add("hidden");document.getElementById("fleetManagement")?.classList.remove("hidden");await loadFleetManagement();});document.getElementById("fleetRefreshBtn")?.addEventListener("click",loadFleetManagement);document.getElementById("closeDriverPayment")?.addEventListener("click",()=>document.getElementById("driverPaymentDialog").close());document.getElementById("saveDriverPayment")?.addEventListener("click",saveDriverPayment);
document.getElementById("menuDriverDashboard")?.addEventListener("click",async()=>{adminMenu.classList.add("hidden");setBAActive("sideDelivery");document.querySelector(".baSidebar")?.classList.remove("open");document.getElementById("home")?.classList.add("hidden");document.getElementById("packing")?.classList.add("hidden");document.getElementById("packingOverview")?.classList.add("hidden");document.getElementById("fleetManagement")?.classList.add("hidden");document.getElementById("driverDashboard")?.classList.remove("hidden");await loadDriverAdminDashboard();});let driverDashboardTimer=null;function refreshDriverDashboardSoon(){clearInterval(driverDashboardTimer);driverDashboardTimer=setInterval(()=>{if(!document.getElementById("driverDashboard")?.classList.contains("hidden"))loadDriverAdminDashboard();},30000);}document.getElementById("driverDashboardApply")?.addEventListener("click",()=>loadDriverAdminDashboard());document.getElementById("driverDashboardRefresh")?.addEventListener("click",()=>loadDriverAdminDashboard());document.getElementById("driverDashboardPreset")?.addEventListener("change",e=>{const v=e.target.value;const custom=v==="custom";$("driverDashboardFrom").disabled=!custom;$("driverDashboardTo").disabled=!custom;if(!custom)loadDriverAdminDashboard();});$("driverDashboardFrom")?.addEventListener("change",()=>{if($("driverDashboardPreset")?.value==="custom")$("driverDashboardApply").disabled=!($("driverDashboardFrom").value&&$("driverDashboardTo").value);});$("driverDashboardTo")?.addEventListener("change",()=>{if($("driverDashboardPreset")?.value==="custom")$("driverDashboardApply").disabled=!($("driverDashboardFrom").value&&$("driverDashboardTo").value);});
refreshDriverDashboardSoon();
if($("driverDashboardPreset")){ $("driverDashboardFrom").disabled=true; $("driverDashboardTo").disabled=true; $("driverDashboardApply").disabled=true; }
document.getElementById("menuPacking")?.addEventListener("click",async()=>{adminMenu.classList.add("hidden");setBAActive("sidePacking");document.querySelector(".baSidebar")?.classList.remove("open");try{if(!state.outlets.size){const ok=await loadCurrentOrder();if(!ok)return alert("No active order available.");}renderAdminPackingChooser();document.getElementById("home")?.classList.add("hidden");document.getElementById("packingOverview")?.classList.add("hidden");document.getElementById("driverDashboard")?.classList.add("hidden");document.getElementById("packing")?.classList.remove("hidden");document.getElementById("adminPackingChooser")?.classList.remove("hidden");document.getElementById("packing")?.querySelector(".packingTop")?.classList.add("hidden");}catch(e){alert("Could not load packing screen: "+e.message);}});
document.getElementById("closeOutletSettings")?.addEventListener("click",()=>document.getElementById("outletSettingsDialog").close());


function setBAActive(id){document.querySelectorAll(".baSideItem").forEach(x=>x.classList.toggle("active",x.id===id));}
function bindBAAction(id,targetId){document.getElementById(id)?.addEventListener("click",()=>document.getElementById(targetId)?.click());}
document.getElementById("baSidebarToggle")?.addEventListener("click",()=>{
  const sidebar=document.querySelector(".baSidebar"),open=sidebar?.classList.toggle("open");
  document.body.classList.toggle("baSidebarOpen",!!open);
  document.getElementById("baSidebarToggle")?.setAttribute("aria-expanded",String(!!open));
});
document.addEventListener("click",e=>{
  const sidebar=document.querySelector(".baSidebar"),toggle=document.getElementById("baSidebarToggle");
  if(!sidebar||!sidebar.classList.contains("open")||!window.matchMedia("(max-width:850px)").matches)return;
  if(!sidebar.contains(e.target)&&e.target!==toggle){
    sidebar.classList.remove("open");
    document.body.classList.remove("baSidebarOpen");
    toggle?.setAttribute("aria-expanded","false");
  }
});
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  const sidebar=document.querySelector(".baSidebar");
  if(sidebar?.classList.contains("open")){
    sidebar.classList.remove("open");
    document.body.classList.remove("baSidebarOpen");
    document.getElementById("baSidebarToggle")?.setAttribute("aria-expanded","false");
  }
});
document.getElementById("sideDashboard")?.addEventListener("click",()=>{document.querySelector(".baSidebar")?.classList.remove("open");showAdminDashboard();setBAActive("sideDashboard")});
document.getElementById("sidePacking")?.addEventListener("click",showPackingOverview);bindBAAction("sideDelivery","menuDriverDashboard");bindBAAction("sideReports","menuReportBtn");bindBAAction("sideSettings","menuOutletSettings");
document.getElementById("modulePacking")?.addEventListener("click",showPackingOverview);bindBAAction("moduleDelivery","menuDriverDashboard");bindBAAction("moduleReports","menuReportBtn");
["moduleInventory","modulePurchase","moduleEmployees","sideInventory","sidePurchase","sideEmployees"].forEach(id=>document.getElementById(id)?.addEventListener("click",e=>alert((e.currentTarget.dataset.comingSoon||({"moduleInventory":"Inventory","modulePurchase":"Purchase & Suppliers","moduleEmployees":"Employees & HR","sideInventory":"Inventory","sidePurchase":"Purchase & Suppliers","sideEmployees":"Employees & HR"}[id]))+" is coming soon.")));
function runGlobalSearch(raw){
  const q=String(raw||"").trim().toLowerCase();
  if(!q)return;
  if(/^(packing|pack|dispatch)/.test(q)){showPackingOverview();return;}
  if(/^(delivery|deliveries|fleet|driver)/.test(q)){document.getElementById("menuDriverDashboard")?.click();return;}
  if(/^(report|reports|analytics)/.test(q)){document.getElementById("menuReportBtn")?.click();return;}
  const all=[...state.outlets.values()];
  const outlet=all.find(o=>String(o.name).toLowerCase().includes(q));
  const driver=all.find(o=>String(o.driver||"Unassigned").toLowerCase().includes(q));
  const item=all.flatMap(o=>o.rows).find(r=>String(r.product).toLowerCase().includes(q)||String(r.code).toLowerCase().includes(q));
  if(outlet||driver||item){
    document.getElementById("home")?.classList.remove("hidden");
    ["packing","packingOverview","driverDashboard","fleetManagement"].forEach(id=>document.getElementById(id)?.classList.add("hidden"));
    const target=outlet?$("dashboardOutletFilter"):driver?$("dashboardDriverFilter"):$("dashboardItemFilter");
    if(target){
      target.value=outlet?outlet.name:driver?driver.driver:item.product;
      target.dispatchEvent(new Event("input",{bubbles:true}));
    }
    document.getElementById("adminDashboard")?.scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }
  alert("No matching outlet, item, driver, or dashboard section found.");
}
const globalSearch=$("globalSearch");
globalSearch?.addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();runGlobalSearch(globalSearch.value);}
  if(e.key==="Escape"){globalSearch.value="";globalSearch.blur();}
});
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){
    e.preventDefault();
    globalSearch?.focus();
    globalSearch?.select();
  }
});
document.getElementById("dashOpenPacking")?.addEventListener("click",showPackingOverview);
document.getElementById("dashOpenDelivery")?.addEventListener("click",()=>document.getElementById("menuDriverDashboard")?.click());
document.getElementById("dashOpenReports")?.addEventListener("click",()=>document.getElementById("menuReportBtn")?.click());
document.getElementById("dashCreateOrder")?.addEventListener("click",()=>document.getElementById("dashCreateOrderTools")?.classList.toggle("hidden"));
document.getElementById("packingOverviewDashboardBack")?.addEventListener("click",showAdminDashboard);
document.getElementById("packingOverviewRefresh")?.addEventListener("click",async()=>{try{await syncFromServer();renderPackingOverview();}catch(e){alert("Refresh failed: "+e.message);}});
document.getElementById("packingOverviewStaffBtn")?.addEventListener("click",()=>document.getElementById("menuPacking")?.click());
document.getElementById("baHeaderDate")?.replaceChildren(document.createTextNode(new Date().toLocaleString("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})));
setInterval(()=>{const el=document.getElementById("baHeaderDate");if(el)el.textContent=new Date().toLocaleString("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});},60000);

const adminRefreshBtn=document.getElementById("adminRefreshBtn");
adminRefreshBtn?.addEventListener("click",async()=>{
  if(!navigator.onLine)return alert("You are offline. Please reconnect and try again.");
  const old=adminRefreshBtn.textContent; adminRefreshBtn.disabled=true; adminRefreshBtn.textContent="↻";
  try{
    await syncFromServer();
    await loadLiveDeliverySummary();
    if(!document.getElementById("driverDashboard")?.classList.contains("hidden")) await loadDriverAdminDashboard();
    if(!document.getElementById("fleetManagement")?.classList.contains("hidden")) await loadFleetManagement();
    if(!document.getElementById("packingOverview")?.classList.contains("hidden")) renderPackingOverview();
    adminRefreshBtn.title="Data refreshed";
  }catch(e){alert("Refresh failed: "+e.message);}
  finally{adminRefreshBtn.disabled=false;adminRefreshBtn.textContent=old;}
});
