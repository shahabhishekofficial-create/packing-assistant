const { createClient } = supabase;
const db = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);

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
  rankMap: {}
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
  for(const o of outlets){
    const meta=setup[o.store_name]||{};
    state.outlets.set(o.id,{
      id:o.id,
      name:o.store_name,
      driver:o.driver||meta.driver||"", rank:Number(o.outlet_rank||meta.rank||9999),
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

function startRealtime(){
  if(!state.orderId) return;
  if(state.realtime) db.removeChannel(state.realtime);
  state.realtime=db.channel("packing-order-"+state.orderId)
    .on("postgres_changes",{event:"*",schema:"public",table:"outlets",filter:"order_id=eq."+state.orderId},()=>{
      syncFromServer();
    })
    .on("postgres_changes",{event:"*",schema:"public",table:"order_items"},()=>{
      syncFromServer();
    })
    .subscribe();
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
function downloadReport(){
  if(!state.orderId) return alert("No live order loaded.");
  const all=[...state.outlets.values()];
  const itemRows=[], outletRows=[], exceptionRows=[];
  for(const o of all){
    const started=o.rows.map(r=>r.started_at).filter(Boolean).sort()[0]||null;
    const completed=o.rows.map(r=>r.completed_at).filter(Boolean).sort().slice(-1)[0]||o.completed_at||null;
    const duration=started&&completed ? Math.round((new Date(completed)-new Date(started))/1000) : "";
    const mins=duration==="" ? "" : Math.floor(duration/60)+":"+String(duration%60).padStart(2,"0");
    let packedItems=0, partialItems=0, missingItems=0;
    o.rows.forEach(r=>{
      if(r.status==="PACKED") packedItems++;
      if(r.status==="PARTIAL") partialItems++;
      if(r.status==="MISSING") missingItems++;
      const ev=latestEventForItem(r.id);
      const row={
        "Outlet":o.name,"Item Code":r.code,"Product":r.product,
        "Required":r.required,"Packed":r.packed,"Missing":r.missing,
        "Status":r.status||"PENDING","Reason":r.reason||"",
        "Item Started":formatDate(r.started_at),"Item Completed":formatDate(r.completed_at),
        "Packer/Device":ev?.device_id||""
      };
      itemRows.push(row);
      if(r.status==="PARTIAL"||r.status==="MISSING") exceptionRows.push(row);
    });
    outletRows.push({
      "Outlet":o.name,"Total Items":o.rows.length,"Packed Items":packedItems,
      "Partial Items":partialItems,"Missing Items":missingItems,
      "Required Qty":o.rows.reduce((s,r)=>s+r.required,0),
      "Packed Qty":o.rows.reduce((s,r)=>s+r.packed,0),
      "Missing Qty":o.rows.reduce((s,r)=>s+r.missing,0),
      "Started At":formatDate(started),"Completed At":formatDate(completed),
      "Packing Duration":mins,"Packer/Device":o.lockedDeviceId||""
    });
  }
  const orderData=state.rows.length ? [{
    "Order ID":state.orderId,
    "Order Status":state.outlets.size && [...state.outlets.values()].every(o=>o.status==="completed")?"COMPLETED":"ACTIVE",
    "Created At":formatDate(state.order?.created_at),
    "Completed At":formatDate(state.order?.completed_at)
  }] : [];
  const wb=XLSX.utils.book_new();
  const add=(name,rows)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),name);
  add("Item Wise",itemRows); add("Outlet Summary",outletRows); add("Missing & Partial",exceptionRows); add("Order Summary",orderData);
  XLSX.writeFile(wb,"Packing_Report_"+new Date().toISOString().slice(0,10)+".xlsx");
}
function renderOutletSettings(all){const box=$("outletSettingsList");if(!box)return;const drivers=getDrivers();box.innerHTML=all.map((o,i)=>`<div class="outletSettingRow" draggable="${window.matchMedia("(pointer:fine)").matches}" data-id="${o.id}"><span class="dragHandle">☷</span><b class="rankNo">${i+1}</b><span class="settingName">${esc(o.name)}</span><select class="driverSelect"><option value="">Unassigned</option>${drivers.map(d=>`<option value="${esc(d)}"${o.driver===d?" selected":""}>${esc(d)}</option>`).join("")}</select></div>`).join("");let drag=null;box.querySelectorAll(".outletSettingRow").forEach(row=>{row.addEventListener("dragstart",()=>{drag=row;row.classList.add("dragging")});row.addEventListener("dragend",()=>{row.classList.remove("dragging");drag=null});row.addEventListener("dragover",e=>{e.preventDefault();if(drag&&drag!==row){const r=row.getBoundingClientRect();row.parentNode.insertBefore(drag,e.clientY<r.top+r.height/2?row:row.nextSibling);updateSettingRanks()}})});box.querySelectorAll(".driverSelect").forEach(s=>s.addEventListener("change",()=>{const o=state.outlets.get(s.closest(".outletSettingRow").dataset.id);if(o)o.driver=s.value}))}
function updateSettingRanks(){$("outletSettingsList")?.querySelectorAll(".outletSettingRow").forEach((r,i)=>r.querySelector(".rankNo").textContent=i+1)}
async function saveOutletSettings(){
  const btn=$("saveOutletSettings");
  const rows=[...($("outletSettingsList")?.querySelectorAll(".outletSettingRow")||[])];
  if(!rows.length)return;
  rows.forEach((row,i)=>{
    const o=state.outlets.get(row.dataset.id);
    if(o){o.rank=i+1;o.driver=row.querySelector(".driverSelect").value;}
  });
  btn.disabled=true; btn.textContent="Saving…";
  const errors=[];
  for(const o of state.outlets.values()){
    const {error}=await db.rpc("update_outlet_settings",{
      p_order_id:state.orderId,p_outlet_id:o.id,p_access_token:state.token,
      p_rank:o.rank,p_driver:o.driver
    });
    if(error)errors.push(o.name+": "+error.message);
  }
  if(errors.length){
    btn.disabled=false; btn.textContent="Submit Changes";
    return alert("Some changes could not be saved:\n\n"+errors.join("\n"));
  }
  localStorage.setItem(SETUP_KEY,JSON.stringify(Object.fromEntries(
    [...state.outlets.values()].map(o=>[o.name,{rank:o.rank,driver:o.driver}])
  )));
  btn.disabled=false; btn.textContent="Submit Changes";
  $("outletSettingsDialog")?.close();
  renderHome();
  alert("Outlet rank and driver assignments saved.");
}

function renderAdminDashboard(){
  if(!(location.pathname.endsWith("/admin.html") || /\/admin\/?$/.test(location.pathname))) return;
  const panel=$("adminDashboard");
  if(!panel) return;
  panel.classList.remove("hidden");
  const all=[...state.outlets.values()];
  const filterOutlet=$("dashboardOutletFilter").value;
  const filterStatus=$("dashboardStatusFilter").value;
  const selected=filterOutlet==="ALL"?all:all.filter(o=>o.id===filterOutlet);
  const rows=selected.flatMap(o=>o.rows.map(r=>({...r,outlet:o.name,outletId:o.id})));
  const filtered=filterStatus==="ALL"?rows:rows.filter(r=>(r.status||"PENDING")===filterStatus);
  const required=filtered.reduce((s,r)=>s+r.required,0);
  const packed=filtered.reduce((s,r)=>s+r.packed,0);
  const missing=filtered.reduce((s,r)=>s+r.missing,0);
  const exceptions=filtered.filter(r=>r.status==="MISSING"||r.status==="PARTIAL").length;
  const pct=required?Math.round((missing/required)*100):0;
  $("dashboardKpis").innerHTML=[
    ["Required Qty",required,"blue"],["Packed Qty",packed,"green"],["Missing Qty",missing,"red"],["Exception Items",exceptions,"amber"],["Missing %",pct+"%","red"]
  ].map(x=>'<div class="analysisKpi '+x[2]+'"><b>'+x[1]+'</b><span>'+x[0]+'</span></div>').join("");
  $("outletAnalysisBody").innerHTML=selected.map(o=>{
    const rq=o.rows.reduce((s,r)=>s+r.required,0),pk=o.rows.reduce((s,r)=>s+r.packed,0),ms=o.rows.reduce((s,r)=>s+r.missing,0);
    const mp=rq?Math.round(ms/rq*100):0;
    return '<tr><td><b>'+esc(o.name)+'</b></td><td>'+rq+'</td><td>'+pk+'</td><td class="'+(ms?'dangerText':'')+'">'+ms+'</td><td>'+mp+'%</td><td><span class="miniStatus '+o.status+'">'+(o.status||"available").replace("_"," ")+'</span></td></tr>';
  }).join("")||'<tr><td colspan="6">No data</td></tr>';
  const byItem=new Map();
  filtered.forEach(r=>{
    const k=r.code;
    if(!byItem.has(k)) byItem.set(k,{code:k,product:r.product,outlets:new Set(),required:0,packed:0,missing:0});
    const x=byItem.get(k); x.outlets.add(r.outlet); x.required+=r.required; x.packed+=r.packed; x.missing+=r.missing;
  });
  $("itemAnalysisBody").innerHTML=[...byItem.values()].filter(x=>x.missing>0).sort((a,b)=>b.missing-a.missing).map(x=>'<tr><td><b>'+esc(x.product)+'</b><small>'+esc(x.code)+'</small></td><td>'+x.outlets.size+'</td><td>'+x.required+'</td><td>'+x.packed+'</td><td class="dangerText">'+x.missing+'</td><td>'+Math.round(x.missing/x.required*100)+'%</td></tr>').join("")||'<tr><td colspan="6">No missing/partial items</td></tr>';
  $("exceptionAnalysisBody").innerHTML=filtered.filter(r=>r.status==="MISSING"||r.status==="PARTIAL").sort((a,b)=>b.missing-a.missing).map(r=>'<tr><td>'+esc(r.outlet)+'</td><td><b>'+esc(r.product)+'</b><small>'+esc(r.code)+'</small></td><td>'+r.required+'</td><td>'+r.packed+'</td><td class="dangerText">'+r.missing+'</td><td><span class="miniStatus '+String(r.status).toLowerCase()+'">'+r.status+'</span></td><td>'+esc(r.reason||"")+'</td></tr>').join("")||'<tr><td colspan="7">No exceptions</td></tr>';
}

function renderHome(){
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
  $("orderSummary").innerHTML=
    '<div class="orderCreatedMeta"><span>ORDER CREATED</span><b>'+esc(createdAt)+'</b></div>'+
    '<div class="stat blue"><div class="num">'+all.length+'</div><div class="label">Total Outlets</div></div>'+
    '<div class="stat green"><div class="num">'+completed+'</div><div class="label">Completed</div></div>'+
    '<div class="stat amber"><div class="num">'+inProgress+'</div><div class="label">In Progress</div></div>'+
    '<div class="stat red"><div class="num">'+pending+'</div><div class="label">Pending</div></div>'+
    '<div class="stat progressStat"><div class="label">Overall Progress <b style="float:right">'+pct+'%</b></div><div class="progressLine"><i style="width:'+pct+'%"></i></div><small style="margin-top:7px;color:#64748b">'+packed+' packed · '+missing+' missing · '+totalItems+' products</small></div>';

  if(location.pathname.endsWith("/admin.html") || /\/admin\/?$/.test(location.pathname)){
    const f=$("dashboardOutletFilter");
    if(f){
      const current=f.value;
      f.innerHTML='<option value="ALL">All Outlets</option>'+all.map(o=>'<option value="'+o.id+'">'+esc(o.name)+'</option>').join("");
      f.value=[...all].some(o=>o.id===current)?current:"ALL";
      if(!f.dataset.bound){f.dataset.bound="1";f.onchange=renderAdminDashboard;$("dashboardStatusFilter").onchange=renderAdminDashboard;}
    }
  }
  all.sort((a,b)=>a.rank-b.rank || String(a.name).localeCompare(String(b.name)));
  renderOutletSettings(all);
  const lists=[$("outletList"),$("adminOutletList")].filter(Boolean);
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
$("backBtn").onclick=exitOutlet;if($("saveOutletSettings"))$("saveOutletSettings").onclick=saveOutletSettings;if($("addDriverBtn"))$("addDriverBtn").onclick=async()=>{const el=$("newDriverName"),name=el.value.trim();if(!name)return;const {error}=await db.from("drivers").insert({name});if(error){if(String(error.code)==="23505")return alert("Driver already exists.");return alert(error.message);}await loadDrivers();el.value="";renderOutletSettings([...state.outlets.values()].sort((a,b)=>a.rank-b.rank));};

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

function speakProduct(r){
  if(!r)return;
  const lang=getVoiceLanguage();
  const qtyText = lang === "hi" ? numberWordsHindi(r.required) : lang === "gu" ? numberWordsGujarati(r.required) : numberWordsEnglish(r.required);
  speak(`${r.product} - ${qtyText}`, lang);
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

const voiceLanguageEl=$("voiceLanguage");
const packingVoiceLanguageEl=$("packingVoiceLanguage");
function syncVoiceSelectors(v){
  if(voiceLanguageEl) voiceLanguageEl.value=v;
  if(packingVoiceLanguageEl) packingVoiceLanguageEl.value=v;
}
syncVoiceSelectors(getVoiceLanguage());
if(voiceLanguageEl) voiceLanguageEl.onchange=()=>{
  setVoiceLanguage(voiceLanguageEl.value);
  syncVoiceSelectors(voiceLanguageEl.value);
  const o=state.outlets.get(state.current); if(o) speakProduct(o.rows[state.index]);
};
if(packingVoiceLanguageEl) packingVoiceLanguageEl.onchange=()=>{
  setVoiceLanguage(packingVoiceLanguageEl.value);
  syncVoiceSelectors(packingVoiceLanguageEl.value);
  const o=state.outlets.get(state.current); if(o) speakProduct(o.rows[state.index]);
};

function startPolling(){
  clearInterval(state.poll);
  state.poll=setInterval(async()=>{
    if(!navigator.onLine||!state.orderId||!state.token)return;
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
  },2000);
}

function updateConnection(){
  $("connection").textContent=navigator.onLine?"● Online":"● Offline";
}
window.addEventListener("online",updateConnection);
window.addEventListener("offline",updateConnection);
updateConnection();

(async function init(){
  await loadDrivers();
  const params=new URLSearchParams(location.search);
  const legacyOrder=params.get("order");
  const legacyToken=params.get("token");
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
    await loadCurrentOrder();
  }catch(e){console.warn("No current order",e.message)}
})();

const adminMenu=document.getElementById("adminMenu"),adminMenuBtn=document.getElementById("adminMenuBtn");
adminMenuBtn?.addEventListener("click",e=>{e.stopPropagation();adminMenu.classList.toggle("hidden");adminMenuBtn.setAttribute("aria-expanded",String(!adminMenu.classList.contains("hidden")))});
document.addEventListener("click",e=>{if(adminMenu&&!adminMenu.contains(e.target)&&e.target!==adminMenuBtn)adminMenu.classList.add("hidden")});
document.getElementById("menuReportBtn")?.addEventListener("click",()=>{adminMenu.classList.add("hidden");downloadReport()});
document.getElementById("menuOutletSettings")?.addEventListener("click",()=>{adminMenu.classList.add("hidden");renderOutletSettings([...state.outlets.values()].sort((a,b)=>a.rank-b.rank));document.getElementById("outletSettingsDialog").showModal()});
document.getElementById("menuVoiceSettings")?.addEventListener("click",()=>{adminMenu.classList.add("hidden");document.getElementById("voiceSettingsDialog").showModal()});
document.getElementById("menuPacking")?.addEventListener("click",()=>{adminMenu.classList.add("hidden");renderHome();document.getElementById("home")?.classList.add("hidden");document.getElementById("packing")?.classList.remove("hidden");document.getElementById("adminPackingChooser")?.classList.remove("hidden");document.getElementById("packing")?.querySelector(".packingTop")?.classList.add("hidden")});
document.getElementById("closeOutletSettings")?.addEventListener("click",()=>document.getElementById("outletSettingsDialog").close());
document.getElementById("closeVoiceSettings")?.addEventListener("click",()=>document.getElementById("voiceSettingsDialog").close());


const adminRefreshBtn=document.getElementById("adminRefreshBtn");
adminRefreshBtn?.addEventListener("click",async()=>{
  if(!navigator.onLine)return alert("You are offline. Please reconnect and try again.");
  const old=adminRefreshBtn.textContent; adminRefreshBtn.disabled=true; adminRefreshBtn.textContent="↻";
  try{await syncFromServer();adminRefreshBtn.title="Data refreshed";}
  catch(e){alert("Refresh failed: "+e.message);}
  finally{adminRefreshBtn.disabled=false;adminRefreshBtn.textContent=old;}
});
