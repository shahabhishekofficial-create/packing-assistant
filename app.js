const { createClient } = supabase;
const db = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);

const state = {
  rows: [],
  outlets: new Map(),
  current: null,
  index: 0,
  orderId: null,
  token: null,
  poll: null
};

const $ = id => document.getElementById(id);
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
    indent:["SUM OF INDENTS","SUMOFINDENTS","INDENT","INDENT QTY","INDENT QUANTITY"]
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
    const rows=XLSX.utils.sheet_to_json(raw.Sheets[name],{defval:""});
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
        if(!store&&!code&&!product&&String(r[map.indent]).trim()==="") continue;
        if(!store||!code||!product||Number.isNaN(q))
          throw new Error(`Row ${i+2}: invalid/missing data`);
        parsed.push({store,code,product,required:q});
      }
      if(parsed.length)candidates.push({name,rows:parsed});
    }catch(e){ /* invalid sheets are ignored */ }
  }
  if(!candidates.length) throw new Error("No sheet with the required columns was found.");
  if(candidates.length===1) return candidates[0].rows;
  const choice=prompt("Multiple valid sheets found. Enter sheet name:\n"+candidates.map(x=>x.name).join("\n"),candidates[0].name);
  return (candidates.find(x=>x.name===choice)||candidates[0]).rows;
}

function validateRows(rows){
  const seen=new Set();
  for(const r of rows){
    const key=r.store+"¦"+r.code;
    if(seen.has(key)) throw new Error(`Duplicate outlet + item code: ${r.store} / ${r.code}`);
    seen.add(key);
  }
}

async function createLiveOrder(rows){
  validateRows(rows);
  const token = crypto.randomUUID ? crypto.randomUUID() + crypto.randomUUID() : Date.now()+"-"+Math.random()+"-"+Math.random();
  const {data,error}=await db.rpc("create_order",{
    p_order_name:"Packing Order "+new Date().toLocaleString("en-IN"),
    p_access_token:token,
    p_items:rows.map(r=>({
      store_name:r.store,
      item_code:r.code,
      product_name:r.product,
      required_qty:r.required
    }))
  });
  if(error) throw error;
  state.orderId=data;
  state.token=token;
  localStorage.setItem("pa_order_id",state.orderId);
  localStorage.setItem("pa_order_token",state.token);
  showShareLink();
  await loadOrder();
}

function showShareLink(){
  const url=new URL(location.href);
  url.searchParams.set("order",state.orderId);
  url.searchParams.set("token",state.token);
  $("orderLink").value=url.toString();
  $("orderLinkBox").classList.remove("hidden");
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
  const outlets=data.outlets||[];
  const items=data.items||[];
  for(const o of outlets){
    state.outlets.set(o.id,{
      id:o.id,
      name:o.store_name,
      status:o.status,
      lockedDeviceId:o.locked_device_id,
      rows:[]
    });
  }
  for(const r of items){
    const o=state.outlets.get(r.outlet_id);
    if(!o) continue;
    o.rows.push({
      id:r.id,code:r.item_code,product:r.product_name,
      voice:r.voice_text||r.product_name,required:Number(r.required_qty),
      packed:Number(r.packed_qty||0),missing:Number(r.missing_qty||0),
      status:r.status==="pending"?null:r.status.toUpperCase(),reason:r.reason||""
    });
    state.rows.push(r);
  }
}

function renderHome(){
  $("orderSummary").classList.remove("hidden");
  const all=[...state.outlets.values()];
  const total=all.reduce((s,o)=>s+o.rows.reduce((a,r)=>a+r.required,0),0);
  const packed=all.reduce((s,o)=>s+o.rows.reduce((a,r)=>a+r.packed,0),0);
  const missing=all.reduce((s,o)=>s+o.rows.reduce((a,r)=>a+r.missing,0),0);
  $("orderSummary").innerHTML=
    `<h2>Live Order</h2><b>${all.length} outlets</b> · ${state.rows.length} products
     <br>Required: ${total} · Packed: ${packed} · Missing: ${missing}`;
  $("outletList").innerHTML="";
  all.forEach(o=>{
    const b=document.createElement("button");
    b.className="outlet";
    const done=o.rows.filter(r=>r.status).length;
    const mine=o.status==="in_progress"&&o.lockedDeviceId===DEVICE_ID;
    const locked=o.status==="in_progress"&&!mine;
    b.disabled=o.status==="completed"||locked;
    b.innerHTML=`<b>${esc(o.name)}</b><span>${o.rows.length} products · ${done}/${o.rows.length}
      ${o.status==="completed"?"· ✓ COMPLETED":mine?"· YOUR OUTLET":locked?"· IN PROGRESS":"· AVAILABLE"}</span>`;
    b.onclick=()=>startOutlet(o.id);
    $("outletList").appendChild(b);
  });
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
  speak(`${r.voice}. Quantity ${numberWords(r.required)}.`);
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
  speak(`${r.voice}. Quantity ${numberWords(r.required)}.`);
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

$("backBtn").onclick=async()=>{
  const o=state.outlets.get(state.current);
  if(o?.rows.some(r=>!r.status))
    return alert("Finish all products in this outlet before leaving.");
  completeScreen();
};

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
    {store:"Outlet A",code:"1025",product:"Broccoli",required:5},
    {store:"Outlet A",code:"1095",product:"Button Mushroom",required:12},
    {store:"Outlet B",code:"1025",product:"Broccoli",required:7},
    {store:"Outlet B",code:"4079",product:"Baby Corn",required:3}
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

$("openOrderBtn").onclick=async()=>{
  try{
    state.orderId=$("orderIdInput").value.trim();
    state.token=$("accessTokenInput").value.trim();
    if(!state.orderId||!state.token) return alert("Enter both Order ID and access token.");
    localStorage.setItem("pa_order_id",state.orderId);
    localStorage.setItem("pa_order_token",state.token);
    await loadOrder();
    startPolling();
  }catch(e){alert(e.message)}
};

function speak(text){
  if(!("speechSynthesis"in window))return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);
  u.lang="en-IN";u.rate=.85;u.pitch=1;
  speechSynthesis.speak(u);
}

function numberWords(n){
  if(!Number.isInteger(n))return String(n);
  const ones=["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tens=["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  if(n<20)return ones[n];
  if(n<100)return tens[Math.floor(n/10)]+(n%10?"-"+ones[n%10]:"");
  if(n<1000)return ones[Math.floor(n/100)]+" hundred"+(n%100?" "+numberWords(n%100):"");
  return String(n);
}

function startPolling(){
  clearInterval(state.poll);
  state.poll=setInterval(async()=>{
    if(!navigator.onLine||!state.orderId||!state.token)return;
    try{
      await loadOrder();
      if(state.current){
        const o=state.outlets.get(state.current);
        if(o && o.status==="in_progress" && o.lockedDeviceId===DEVICE_ID){
          const next=o.rows.findIndex(r=>!r.status);
          if(next>=0){state.index=next;showProduct();}
        }
      }
    }catch(e){console.warn("sync",e.message)}
  },3000);
}

function updateConnection(){
  $("connection").textContent=navigator.onLine?"● Online":"● Offline";
}
window.addEventListener("online",updateConnection);
window.addEventListener("offline",updateConnection);
updateConnection();

(async function init(){
  const params=new URLSearchParams(location.search);
  state.orderId=params.get("order")||localStorage.getItem("pa_order_id");
  state.token=params.get("token")||localStorage.getItem("pa_order_token");
  if(state.orderId&&state.token){
    try{
      await loadOrder();
      startPolling();
      if(params.get("order")) showShareLink();
    }catch(e){console.warn("No saved order",e.message)}
  }
})();
