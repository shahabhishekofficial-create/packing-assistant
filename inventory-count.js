const {createClient}=supabase;const db=createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.key);const $=id=>document.getElementById(id);const esc=s=>String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));let token="",staff="",sessionId="",items=[],current=null,exportRows=[],exportMeta=null;
function setMsg(id,s){$(id).textContent=s||""}
function networkish(e){const m=String(e?.message||e||"").toLowerCase();return !navigator.onLine||/network|fetch|failed to fetch|offline|timeout|connection/i.test(m)}

async function initGuest(){
  try{
    const {data,error}=await db.rpc("inv_inventory_guest_session");
    if(error)throw error;
    if(!data?.token)throw new Error("Inventory service returned no session.");
    token=data.token;staff=data.staff_name||"Warehouse Staff";
    sessionStorage.setItem("inv_staff_token",token);
    sessionStorage.setItem("inv_staff_name",staff);
    $("staffTitle").textContent=staff;
    await start();
  }catch(e){
    token="";staff="";
    sessionStorage.removeItem("inv_staff_token");
    sessionStorage.removeItem("inv_staff_name");
    setMsg("sessionMsg",e.message||"Inventory access could not start.");$("inventoryStartupError").textContent=e.message||"Inventory access could not start.";
  }
}
async function start(){
  const section=$("section").value;
  const {data,error}=await db.rpc("inv_staff_start_session",{p_staff_token:token,p_section:section,p_date:new Date().toISOString().slice(0,10)});
  if(error)throw error;
  sessionId=data;
  initLedger();
  const r=await db.rpc("inv_staff_get_items",{p_staff_token:token,p_section:section});
  if(r.error)throw r.error;
  items=r.data||[];
  renderList();
  restoreDraft();
  $("counter").classList.remove("hidden");
  $("items").classList.remove("hidden");
  $("submitBtn").classList.remove("hidden");
  setMsg("sessionMsg",items.length+" items loaded.");
  const report=await db.rpc("inv_staff_get_session_report",{p_staff_token:token,p_session_id:sessionId});
  if(report.error)throw report.error;
  if(report.data?.[0]?.status==="submitted"){
    exportRows=report.data||[];
    exportMeta=exportRows[0];
    markSubmitted();
    $("submitBtn").classList.add("hidden");
    $("startBtn").disabled=true;
    $("section").disabled=true;
    $("exportCard").classList.remove("hidden");
    setMsg("sessionMsg","Today's count is already submitted. Tap an item to correct its count, then download the revised report.");
    setMsg("exportMsg",exportRows.length+" counted items ready to export.");
  }
}
function displayUom(u){const m={L:"Ltr",ml:"ml",kg:"kg",g:"g",pcs:"pcs"};return m[u]||u||""}
function displayCountUnit(u,n){const s=String(u||"").trim();if(!s)return displayUom(current?.base_uom);const one=Number(n)===1;const map={Bottle:one?"bottle":"bottles",Packet:one?"packet":"packets",Box:one?"box":"boxes",Carton:one?"carton":"cartons",Pouch:one?"pouch":"pouches",Sack:one?"sack":"sacks",Jar:one?"jar":"jars",Can:one?"can":"cans",Tray:one?"tray":"trays",Crate:one?"crate":"crates",Drum:one?"drum":"drums",Bag:one?"bag":"bags",Bundle:one?"bundle":"bundles"};return map[s]||s+(one?"":"s")}
function displayUom(u){const m={L:"Ltr",ml:"ml",kg:"kg",g:"g",pcs:"pcs"};return m[u]||u||""}
function displayCountUnit(u,n){const s=String(u||"").trim();if(!s)return displayUom(current?.base_uom);const one=Number(n)===1;const map={Bottle:one?"bottle":"bottles",Packet:one?"packet":"packets",Box:one?"box":"boxes",Carton:one?"carton":"cartons",Pouch:one?"pouch":"pouches",Sack:one?"sack":"sacks",Jar:one?"jar":"jars",Can:one?"can":"cans",Tray:one?"tray":"trays",Crate:one?"crate":"crates",Drum:one?"drum":"drums",Bag:one?"bag":"bags",Bundle:one?"bundle":"bundles"};return map[s]||s+(one?"":"s")}
function renderList(){const q=$("search").value.trim().toLowerCase();const filtered=items.filter(x=>!q||x.name.toLowerCase().includes(q)||String(x.barcode||"").includes(q));$("items").innerHTML=filtered.map(x=>'<button class="secondary itemPick" data-id="'+esc(x.id)+'" style="display:block;width:100%;margin:6px 0;text-align:left"><b>'+esc(x.name)+'</b><br><small>'+esc(x.category)+' · '+esc(displayCountUnit(x.count_unit,2))+(Number(x.count_to_base)!==1?' · 1 '+esc(displayCountUnit(x.count_unit,1))+' = '+esc(x.count_to_base)+' '+esc(displayUom(x.base_uom)):' · '+esc(displayUom(x.base_uom)))+'</small></button>').join("")||'<div class="hint">No matching items.</div>';document.querySelectorAll(".itemPick").forEach(b=>b.onclick=()=>selectItem(b.dataset.id))}
function selectItem(id){current=items.find(x=>String(x.id)===String(id));if(!current)return;document.querySelectorAll(".itemPick").forEach(b=>b.classList.toggle("selected",String(b.dataset.id)===String(id)));$("countUnitLabel").textContent=displayCountUnit(current.count_unit,2);$("itemInfo").innerHTML='<b>'+esc(current.name)+'</b><br>'+esc(current.category)+' · '+esc(displayCountUnit(current.count_unit,2))+(Number(current.count_to_base)!==1?' · 1 '+esc(displayCountUnit(current.count_unit,1))+' = '+esc(current.count_to_base)+' '+esc(displayUom(current.base_uom)):' · '+esc(displayUom(current.base_uom)));$("countQty").value="";$("countQty").focus();updateConversion()}
let cameraStream=null,cameraVideo=null,cameraOverlay=null,cameraDetector=null;
function closeCamera(){
  if(cameraOverlay){cameraOverlay.remove();cameraOverlay=null}
  if(cameraVideo){cameraVideo.pause();cameraVideo.srcObject=null;cameraVideo=null}
}
async function scanBarcode(){
  if(!("BarcodeDetector" in window))return setMsg("savedMsg","Barcode scanning is not supported on this browser. Use search.");
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Camera access is not available.");
    if(!cameraStream){
      cameraStream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false
      });
    }
    closeCamera();
    cameraOverlay=document.createElement("div");
    cameraOverlay.className="invCameraOverlay";
    cameraOverlay.innerHTML='<div class="invCameraPanel"><div class="invCameraHead"><div><b>Scan barcode</b><small>Point the camera at the barcode, then tap Scan.</small></div><button type="button" class="invCameraClose">✕</button></div><div class="invCameraViewport"><video autoplay muted playsinline></video><div class="invScanFrame"></div></div><div class="invCameraFooter"><span class="invCameraStatus">Camera ready</span><button type="button" class="invCameraScan">Scan barcode</button></div></div>';
    document.body.appendChild(cameraOverlay);
    cameraVideo=cameraOverlay.querySelector("video");
    cameraVideo.srcObject=cameraStream;
    cameraDetector=new BarcodeDetector({formats:["ean_8","ean_13","upc_a","upc_e"]});
    cameraOverlay.querySelector(".invCameraClose").onclick=closeCamera;
    cameraOverlay.querySelector(".invCameraScan").onclick=async()=>{
      const status=cameraOverlay.querySelector(".invCameraStatus"),btn=cameraOverlay.querySelector(".invCameraScan");
      btn.disabled=true;status.textContent="Scanning…";
      try{
        const codes=await cameraDetector.detect(cameraVideo);
        if(!codes.length){status.textContent="No barcode found. Adjust the camera and try again.";return}
        const b=codes[0].rawValue;
        $("search").value=b;renderList();
        const x=items.find(i=>String(i.barcode||"")===String(b));
        if(x)selectItem(x.id);else setMsg("savedMsg","Barcode scanned: "+b);
        closeCamera();
      }catch(e){status.textContent="Could not scan. Try again."}
      finally{btn.disabled=false}
    };
    await cameraVideo.play();
  }catch(e){
    closeCamera();
    if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
    setMsg("savedMsg",e.name==="NotAllowedError"?"Camera permission was denied. Allow camera access in browser settings.":"Could not start camera: "+e.message);
  }
}
function updateConversion(){if(!current)return;const n=Number($("countQty").value);$("conversion").textContent=Number.isFinite(n)&&n>=0?(n+" "+displayCountUnit(current.count_unit,n)+" ("+(n*Number(current.count_to_base))+" "+displayUom(current.base_uom)+")"):""}
async function save(){
  if(!current)return setMsg("savedMsg","Select an item.");
  const item=current;
  const n=Number(document.getElementById("countQty").value);
  if(!Number.isFinite(n)||n<0)return setMsg("savedMsg","Enter a valid quantity.");
  const saveBtn=document.getElementById("saveBtn");
  saveBtn.disabled=true;
  recordLocal(item,n);
  try{
    if(!navigator.onLine)throw new Error("OFFLINE");
    const {data,error}=await db.rpc("inv_staff_save_count",{p_staff_token:token,p_session_id:sessionId,p_item_id:item.id,p_qty:n});
    if(error)throw error;
    markSynced(item.id);
    clearDraft();
    const unit=data&&data.count_unit?displayCountUnit(data.count_unit,n):displayCountUnit(item.count_unit,n);
    const base=data&&data.base_qty!=null?data.base_qty:n*Number(item.count_to_base||1);
    const baseUom=data&&data.base_uom?displayUom(data.base_uom):displayUom(item.base_uom);
    setMsg("savedMsg","Saved: "+n+" "+unit+" ("+base+" "+baseUom+")");
  }catch(e){
    if(networkish(e))setMsg("savedMsg","Saved on this phone. It syncs when the connection returns.");
    else if(/already submitted/i.test(String(e&&e.message||""))){markRevised(item.id);setMsg("savedMsg","Saved on this phone. The session is already submitted \u2014 download the revised report to share the change.");}
    else setMsg("savedMsg",e&&e.message?e.message:"Could not save this count.");
  }finally{
    saveBtn.disabled=false;
  }
}
function next(){document.querySelectorAll(".itemPick").forEach(b=>b.classList.remove("selected"));$("countUnitLabel").textContent="";$("itemInfo").textContent="Select an item.";$("countQty").value="";$("conversion").textContent="";$("savedMsg").textContent="";clearDraft();current=null;$("search").focus()}
async function loadExportData(){const {data,error}=await db.rpc("inv_staff_get_session_report",{p_staff_token:token,p_session_id:sessionId});if(error)throw error;exportRows=data||[];exportMeta=exportRows[0]||{session_date:new Date().toISOString().slice(0,10),counted_by:staff};$("exportCard").classList.remove("hidden");setMsg("exportMsg",exportRows.length+" counted items ready to export.");}
function hasRevision(){return Object.values(ledger.entries).some(e=>e.localOnly)}
function exportFilename(ext){const d=String(exportMeta?.session_date||new Date().toISOString().slice(0,10));return "inventory-count-"+d+"-"+String(staff||"staff").replace(/[^a-z0-9_-]+/gi,"-")+(hasRevision()?"-revised":"")+"."+ext}
function buildExportRows(){return mergedRows().map(r=>({Item:r.item_name,Category:r.category,"Physical Count":Number(r.count_qty),"Count Unit":r.count_unit,"Available Qty":Number(r.base_qty),"Base UOM":r.base_uom,"Counted By":r.counted_by||staff,"Counted At":r.counted_at?new Date(r.counted_at).toLocaleString("en-IN"):""}))}
function makeExcelBlob(){const wb=XLSX.utils.book_new();const meta=[["Inventory Count Report"],["Date",exportMeta?.session_date||""],["Staff",exportMeta?.counted_by||staff],["Status",exportMeta?.status||"submitted"],[],...Object.entries(buildExportRows()[0]||{}).map(([k])=>[k]),...buildExportRows().map(r=>Object.values(r))];const ws=XLSX.utils.aoa_to_sheet(meta);ws["!cols"]=[{wch:28},{wch:20},{wch:16},{wch:14},{wch:16},{wch:14},{wch:22},{wch:22}];XLSX.utils.book_append_sheet(wb,ws,"Inventory Count");return XLSX.write(wb,{bookType:"xlsx",type:"array"})}
function makePdfBlob(){if(!window.jspdf?.jsPDF)throw new Error("PDF exporter is still loading. Please try again.");const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});const rows=buildExportRows();doc.setFontSize(16);doc.text("Bigly Agro Private Limited — Inventory Count",14,14);doc.setFontSize(9);doc.text("Date: "+(exportMeta?.session_date||"")+"    Staff: "+(exportMeta?.counted_by||staff),14,21);if(hasRevision()){doc.setTextColor(180,83,9);doc.text("REVISED COPY \u2014 latest saved counts",283,21,{align:"right"});doc.setTextColor(0)}let y=30;const heads=["Item","Category","Count","Unit","Available","Base","Counted At"];const widths=[55,35,20,22,25,18,70];doc.setFontSize(8);heads.forEach((h,i)=>doc.text(h,14+widths.slice(0,i).reduce((a,b)=>a+b,0),y));y+=6;for(const r of rows){if(y>195){doc.addPage();y=15;heads.forEach((h,i)=>doc.text(h,14+widths.slice(0,i).reduce((a,b)=>a+b,0),y));y+=6}const vals=[r.Item,r.Category,String(r["Physical Count"]),r["Count Unit"],String(r["Available Qty"]),r["Base UOM"],r["Counted At"]];vals.forEach((v,i)=>doc.text(String(v).slice(0,34),14+widths.slice(0,i).reduce((a,b)=>a+b,0),y));y+=5}return doc.output("blob")}
function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
async function prepareExports(){if(!exportRows.length){try{await loadExportData()}catch(e){}}if(!mergedRows().length)throw new Error("No counts saved yet.");const excel=new Blob([makeExcelBlob()],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});const pdf=makePdfBlob();return{excel,pdf,excelName:exportFilename("xlsx"),pdfName:exportFilename("pdf")}}
async function exportExcel(){try{const x=await prepareExports();downloadBlob(x.excel,x.excelName);setMsg("exportMsg","Excel report downloaded.");}catch(e){setMsg("exportMsg",e.message||"Could not export Excel.");}}
async function exportPdf(){try{const x=await prepareExports();downloadBlob(x.pdf,x.pdfName);setMsg("exportMsg","PDF report downloaded.");}catch(e){setMsg("exportMsg",e.message||"Could not export PDF.");}}
async function shareExports(){try{if(!navigator.share)return setMsg("exportMsg","Sharing is not supported here. Download Excel/PDF and share them.");const x=await prepareExports();const files=[new File([x.excel],x.excelName,{type:x.excel.type}),new File([x.pdf],x.pdfName,{type:"application/pdf"})];if(navigator.canShare&&!navigator.canShare({files}))return setMsg("exportMsg","This browser cannot share files. Download them instead.");await navigator.share({title:"Inventory Count — "+(exportMeta?.session_date||""),text:"Inventory count report from "+(exportMeta?.counted_by||staff),files});setMsg("exportMsg","Report shared.");}catch(e){if(e.name!=="AbortError")setMsg("exportMsg",e.message||"Could not share the reports.");}}
async function submit(){
  await flushPending();
  if(ledgerPendingCount())return setMsg("sessionMsg","Some counts are still waiting to sync. Reconnect and try again.");
  const {error}=await db.rpc("inv_staff_submit_session",{p_staff_token:token,p_session_id:sessionId});
  if(error)return setMsg("sessionMsg",error.message);
  markSubmitted();
  setMsg("sessionMsg","Count submitted. You can still correct an item and download the revised report.");
  const btn=document.getElementById("submitBtn");
  btn.disabled=true;btn.classList.add("hidden");
  try{await loadExportData()}catch(e){document.getElementById("exportCard").classList.remove("hidden");setMsg("exportMsg","Submitted, but the report could not be refreshed. Your counts are still on this phone.");}
}
$("startBtn").onclick=()=>start().catch(e=>setMsg("sessionMsg",e.message));$("saveBtn").onclick=save;$("nextBtn").onclick=next;$("submitBtn").onclick=submit;$("exportExcelBtn").onclick=exportExcel;$("exportPdfBtn").onclick=exportPdf;$("shareExportBtn").onclick=shareExports;$("search").oninput=renderList;$("scanBtn").onclick=scanBarcode;$("countQty").oninput=()=>{updateConversion();saveDraft()};token=sessionStorage.getItem("inv_staff_token")||"";staff=sessionStorage.getItem("inv_staff_name")||"";if(token){
  $("staffTitle").textContent=staff||"Warehouse Staff";
  void start().catch(()=>initGuest());
}else{
  void initGuest();
}
window.addEventListener("online",()=>void flushPending());
window.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void flushPending()});
window.addEventListener("load",()=>{if(token)void flushPending()});

/* --- accidental refresh protection -------------------------------------
   The entry being typed is mirrored to the phone so a reload caused by a
   scroll gesture or a dropped connection reopens the same item and quantity
   instead of an empty form. The key is scoped to the open session. */
var DRAFT_KEY="inv_count_draft_v1";
function saveDraft(){
  try{
    if(!current||!sessionId){localStorage.removeItem(DRAFT_KEY);return}
    const qty=$("countQty").value;
    localStorage.setItem(DRAFT_KEY,JSON.stringify({sessionId,itemId:String(current.id),qty,updatedAt:Date.now()}));
  }catch(e){}
}
function clearDraft(){try{localStorage.removeItem(DRAFT_KEY)}catch(e){}}
function restoreDraft(){
  let d=null;
  try{d=JSON.parse(localStorage.getItem(DRAFT_KEY)||"null")}catch(e){return}
  if(!d||d.sessionId!==sessionId)return;
  const item=items.find(x=>String(x.id)===String(d.itemId));
  if(!item)return;
  selectItem(item.id);
  if(typeof d.qty==="string"){$("countQty").value=d.qty;updateConversion()}
  setMsg("savedMsg","Your last entry was restored after the page reloaded. Press Save to record it.");
}
document.addEventListener("input",e=>{if(e.target&&e.target.id==="countQty")saveDraft()});
document.addEventListener("click",e=>{const b=e.target.closest&&e.target.closest(".itemPick");if(b)setTimeout(saveDraft,0)});

/* --- durable session ledger ---------------------------------------------
   Every count is written to this phone before the network is touched, keyed
   by item so an item corrected twice keeps one line. The exports are built
   from the server report merged with this ledger, which is what makes a
   revised report possible after a session has been submitted. */
const LEDGER_KEY="inv_count_ledger_v1";
const EMPTY_LEDGER={sessionId:"",date:"",staff:"",submitted:false,entries:{}};
let ledger={...EMPTY_LEDGER};
function isoDate(){return new Date().toISOString().slice(0,10)}
function saveLedger(){try{localStorage.setItem(LEDGER_KEY,JSON.stringify(ledger))}catch(e){}}
function initLedger(){
  let stored=null;
  try{stored=JSON.parse(localStorage.getItem(LEDGER_KEY)||"null")}catch(e){stored=null}
  if(stored&&stored.sessionId===sessionId&&stored.date===isoDate()){
    ledger={...EMPTY_LEDGER,...stored,entries:stored.entries||{}};
  }else{
    ledger={...EMPTY_LEDGER,sessionId,date:isoDate(),staff};
    saveLedger();
  }
  if(ledger.submitted)markSubmitted();
  markCounted();
  void drainLegacyQueue().then((moved)=>{
    if(moved)setMsg("savedMsg",moved+(moved===1?" count":" counts")+" saved offline by the previous version were recovered.");
    if(ledgerPendingCount())void flushPending();
  });
}
function recordLocal(item,n){
  ledger.entries[item.id]={itemId:item.id,name:item.name,category:item.category||"",qty:n,unit:item.count_unit||"",unitText:displayCountUnit(item.count_unit,n),baseQty:n*Number(item.count_to_base||1),baseUom:item.base_uom||"",countedAt:Date.now(),pending:true,localOnly:false};
  saveLedger();markCounted();
}
function entryOf(id){return ledger.entries[id]}
function markSynced(id){const e=entryOf(id);if(e){e.pending=false;e.localOnly=false;saveLedger();markCounted()}}
function markRevised(id){const e=entryOf(id);if(e){e.pending=false;e.localOnly=true;saveLedger();markCounted()}}
function markFailed(id){const e=entryOf(id);if(e){e.pending=false;saveLedger();markCounted()}}
function ledgerPendingCount(){return Object.values(ledger.entries).filter(e=>e.pending).length}
function markSubmitted(){ledger.submitted=true;saveLedger()}
function countedLabel(e){return e.qty+" "+(e.unitText||e.unit||"")+(e.pending?" · not synced":"")+(e.localOnly?" · revised":"")}
function markCounted(){
  const box=document.getElementById("items");
  if(!box)return;
  box.querySelectorAll(".itemPick").forEach(btn=>{
    const e=entryOf(btn.dataset.id);
    btn.classList.toggle("counted",!!e);
    const small=btn.querySelector("small");
    if(!small)return;
    if(small.dataset.base==null)small.dataset.base=small.textContent;
    small.textContent=e?small.dataset.base+" · \u2713 "+countedLabel(e):small.dataset.base;
  });
}
function mergedRows(){
  const byName=new Map();
  exportRows.forEach(r=>byName.set(String(r.item_name||"").toLowerCase(),{...r}));
  Object.values(ledger.entries).forEach(e=>{
    const key=String(e.name||"").toLowerCase();
    const base=byName.get(key)||{item_name:e.name,category:e.category||"",counted_by:staff,status:ledger.submitted?"submitted":"open"};
    base.count_qty=e.qty;
    base.base_qty=e.baseQty;
    base.count_unit=e.unit;
    base.base_uom=e.baseUom;
    base.counted_at=new Date(e.countedAt).toISOString();
    if(!base.category)base.category=e.category||"";
    byName.set(key,base);
  });
  return [...byName.values()].filter(r=>Number(r.count_qty)>0);
}
/* counts queued offline by the previous build lived in IndexedDB; move any
   that belong to the open session into the ledger so nothing is stranded */
function drainLegacyQueue(){
  return new Promise((resolve)=>{
    let req;
    try{req=indexedDB.open("bigly-inventory-sync-v1")}catch(e){return resolve(0)}
    req.onupgradeneeded=()=>{try{req.result.createObjectStore("counts",{keyPath:"key"})}catch(e){}};
    req.onerror=()=>resolve(0);
    req.onsuccess=()=>{
      const dbx=req.result;
      let tx;
      try{tx=dbx.transaction("counts","readwrite")}catch(e){dbx.close();return resolve(0)}
      const store=tx.objectStore("counts");
      const all=store.getAll();
      let moved=0;
      all.onerror=()=>{dbx.close();resolve(0)};
      all.onsuccess=()=>{
        (all.result||[]).forEach((q)=>{
          if(q.sessionId!==sessionId)return;
          const existing=ledger.entries[q.itemId];
          if(!existing){
            const item=items.find(i=>String(i.id)===String(q.itemId));
            if(!item)return;
            ledger.entries[q.itemId]={itemId:item.id,name:item.name,category:item.category||"",qty:Number(q.qty),unit:item.count_unit||"",unitText:displayCountUnit(item.count_unit,Number(q.qty)),baseQty:Number(q.qty)*Number(item.count_to_base||1),baseUom:item.base_uom||"",countedAt:q.createdAt||Date.now(),pending:true,localOnly:false};
            moved+=1;
          }
          store.delete(q.key);
        });
        tx.oncomplete=()=>{dbx.close();if(moved){saveLedger();markCounted()}resolve(moved)};
        tx.onerror=()=>{dbx.close();resolve(0)};
      };
    };
  });
}

async function flushPending(){
  if(!token||!navigator.onLine)return;
  const waiting=Object.values(ledger.entries).filter(e=>e.pending);
  if(!waiting.length)return;
  for(const e of waiting){
    try{
      const {error}=await db.rpc("inv_staff_save_count",{p_staff_token:token,p_session_id:sessionId,p_item_id:e.itemId,p_qty:e.qty});
      if(error)throw error;
      markSynced(e.itemId);
    }catch(err){
      if(/already submitted/i.test(String(err&&err.message||""))){markRevised(e.itemId);continue}
      return;
    }
  }
  if(!ledgerPendingCount())setMsg("savedMsg","Offline counts synchronized.");
}

/* an already counted item re-opens with its value, so correcting it is one tap */
const baseSelectItem=selectItem;
selectItem=function(id){
  baseSelectItem(id);
  const e=entryOf(id);
  if(!e||!current)return;
  const qty=document.getElementById("countQty");
  qty.value=String(e.qty);
  updateConversion();
  setMsg("savedMsg","This item is already counted ("+countedLabel(e)+"). Change the number and press Save to correct it.");
  saveDraft();
};
new MutationObserver(()=>markCounted()).observe(document.getElementById("items"),{childList:true});
