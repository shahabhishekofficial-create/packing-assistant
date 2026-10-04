const {createClient}=supabase;const db=createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.key);const $=id=>document.getElementById(id);const esc=s=>String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));let token="",staff="",sessionId="",items=[],current=null,exportRows=[],exportMeta=null;
function setMsg(id,s){$(id).textContent=s||""}
const QUEUE_DB="bigly-inventory-sync-v1";
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open(QUEUE_DB,1);r.onupgradeneeded=()=>r.result.createObjectStore("counts",{keyPath:"key"});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});}
async function queueCount(payload){const d=await idb();await new Promise((res,rej)=>{const t=d.transaction("counts","readwrite");t.objectStore("counts").put(payload);t.oncomplete=res;t.onerror=()=>rej(t.error)});d.close()}
async function queuedCounts(){const d=await idb();const a=await new Promise((res,rej)=>{const t=d.transaction("counts","readonly");const q=t.objectStore("counts").getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error)});d.close();return a}
async function removeQueued(key){const d=await idb();await new Promise((res,rej)=>{const t=d.transaction("counts","readwrite");t.objectStore("counts").delete(key);t.oncomplete=res;t.onerror=()=>rej(t.error)});d.close()}
function networkish(e){const m=String(e?.message||e||"").toLowerCase();return !navigator.onLine||/network|fetch|failed to fetch|offline|timeout|connection/i.test(m)}
async function flushCountQueue(){if(!token||!navigator.onLine)return;const rows=await queuedCounts();for(const q of rows){try{const {error}=await db.rpc("inv_staff_save_count",{p_staff_token:token,p_session_id:q.sessionId,p_item_id:q.itemId,p_qty:q.qty,p_note:q.note||null});if(error)throw error;await removeQueued(q.key)}catch(e){if(/session expired|unauthorized|not open|item not found/i.test(String(e?.message||"")))break;return}}if(rows.length) setMsg("savedMsg","Offline counts synchronized.");}

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
  const r=await db.rpc("inv_staff_get_items",{p_staff_token:token,p_section:section});
  if(r.error)throw r.error;
  items=r.data||[];
  renderList();
  $("counter").classList.remove("hidden");
  $("items").classList.remove("hidden");
  $("submitBtn").classList.remove("hidden");
  setMsg("sessionMsg",items.length+" items loaded.");
  const report=await db.rpc("inv_staff_get_session_report",{p_staff_token:token,p_session_id:sessionId});
  if(report.error)throw report.error;
  if(report.data?.[0]?.status==="submitted"){
    exportRows=report.data||[];
    exportMeta=exportRows[0];
    $("counter").classList.add("hidden");
    $("items").classList.add("hidden");
    $("submitBtn").classList.add("hidden");
    $("startBtn").disabled=true;
    $("section").disabled=true;
    $("exportCard").classList.remove("hidden");
    setMsg("sessionMsg","Today's count is already submitted.");
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
async function save(){if(!current)return setMsg("savedMsg","Select an item.");const n=Number($("countQty").value);if(!Number.isFinite(n)||n<0)return setMsg("savedMsg","Enter a valid quantity.");$("saveBtn").disabled=true;try{if(!navigator.onLine)throw new Error("OFFLINE");const {data,error}=await db.rpc("inv_staff_save_count",{p_staff_token:token,p_session_id:sessionId,p_item_id:current.id,p_qty:n});if(error)throw error;setMsg("savedMsg","Saved: "+n+" "+displayCountUnit(data.count_unit,n)+" ("+data.base_qty+" "+displayUom(data.base_uom)+")")}catch(e){if(networkish(e)){const key=sessionId+"|"+current.id+"|"+Date.now();await queueCount({key,sessionId,itemId:current.id,qty:n,note:null,createdAt:Date.now()});setMsg("savedMsg","Saved offline. It will sync automatically when connection returns.");}else setMsg("savedMsg",e.message)}finally{$("saveBtn").disabled=false}}
function next(){document.querySelectorAll(".itemPick").forEach(b=>b.classList.remove("selected"));$("countUnitLabel").textContent="";$("itemInfo").textContent="Select an item.";$("countQty").value="";$("conversion").textContent="";$("savedMsg").textContent="";current=null;$("search").focus()}
async function loadExportData(){const {data,error}=await db.rpc("inv_staff_get_session_report",{p_staff_token:token,p_session_id:sessionId});if(error)throw error;exportRows=data||[];exportMeta=exportRows[0]||{session_date:new Date().toISOString().slice(0,10),counted_by:staff};$("exportCard").classList.remove("hidden");setMsg("exportMsg",exportRows.length+" counted items ready to export.");}
function exportFilename(ext){const d=String(exportMeta?.session_date||new Date().toISOString().slice(0,10));return "inventory-count-"+d+"-"+String(staff||"staff").replace(/[^a-z0-9_-]+/gi,"-")+"."+ext}
function buildExportRows(){return exportRows.map(r=>({Item:r.item_name,Category:r.category,"Physical Count":Number(r.count_qty),"Count Unit":r.count_unit,"Available Qty":Number(r.base_qty),"Base UOM":r.base_uom,"Counted By":r.counted_by,"Counted At":new Date(r.counted_at).toLocaleString("en-IN")}))}
function makeExcelBlob(){const wb=XLSX.utils.book_new();const meta=[["Inventory Count Report"],["Date",exportMeta?.session_date||""],["Staff",exportMeta?.counted_by||staff],["Status",exportMeta?.status||"submitted"],[],...Object.entries(buildExportRows()[0]||{}).map(([k])=>[k]),...buildExportRows().map(r=>Object.values(r))];const ws=XLSX.utils.aoa_to_sheet(meta);ws["!cols"]=[{wch:28},{wch:20},{wch:16},{wch:14},{wch:16},{wch:14},{wch:22},{wch:22}];XLSX.utils.book_append_sheet(wb,ws,"Inventory Count");return XLSX.write(wb,{bookType:"xlsx",type:"array"})}
function makePdfBlob(){if(!window.jspdf?.jsPDF)throw new Error("PDF exporter is still loading. Please try again.");const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});const rows=buildExportRows();doc.setFontSize(16);doc.text("Bigly Agro Private Limited — Inventory Count",14,14);doc.setFontSize(9);doc.text("Date: "+(exportMeta?.session_date||"")+"    Staff: "+(exportMeta?.counted_by||staff),14,21);let y=30;const heads=["Item","Category","Count","Unit","Available","Base","Counted At"];const widths=[55,35,20,22,25,18,70];doc.setFontSize(8);heads.forEach((h,i)=>doc.text(h,14+widths.slice(0,i).reduce((a,b)=>a+b,0),y));y+=6;for(const r of rows){if(y>195){doc.addPage();y=15;heads.forEach((h,i)=>doc.text(h,14+widths.slice(0,i).reduce((a,b)=>a+b,0),y));y+=6}const vals=[r.Item,r.Category,String(r["Physical Count"]),r["Count Unit"],String(r["Available Qty"]),r["Base UOM"],r["Counted At"]];vals.forEach((v,i)=>doc.text(String(v).slice(0,34),14+widths.slice(0,i).reduce((a,b)=>a+b,0),y));y+=5}return doc.output("blob")}
function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
async function prepareExports(){if(!exportRows.length)await loadExportData();const excel=new Blob([makeExcelBlob()],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});const pdf=makePdfBlob();return{excel,pdf,excelName:exportFilename("xlsx"),pdfName:exportFilename("pdf")}}
async function exportExcel(){try{const x=await prepareExports();downloadBlob(x.excel,x.excelName);setMsg("exportMsg","Excel report downloaded.");}catch(e){setMsg("exportMsg",e.message||"Could not export Excel.");}}
async function exportPdf(){try{const x=await prepareExports();downloadBlob(x.pdf,x.pdfName);setMsg("exportMsg","PDF report downloaded.");}catch(e){setMsg("exportMsg",e.message||"Could not export PDF.");}}
async function shareExports(){try{if(!navigator.share)return setMsg("exportMsg","Sharing is not supported here. Download Excel/PDF and share them.");const x=await prepareExports();const files=[new File([x.excel],x.excelName,{type:x.excel.type}),new File([x.pdf],x.pdfName,{type:"application/pdf"})];if(navigator.canShare&&!navigator.canShare({files}))return setMsg("exportMsg","This browser cannot share files. Download them instead.");await navigator.share({title:"Inventory Count — "+(exportMeta?.session_date||""),text:"Inventory count report from "+(exportMeta?.counted_by||staff),files});setMsg("exportMsg","Report shared.");}catch(e){if(e.name!=="AbortError")setMsg("exportMsg",e.message||"Could not share the reports.");}}
async function submit(){await flushCountQueue();const pending=await queuedCounts();if(pending.some(x=>x.sessionId===sessionId))return setMsg("sessionMsg","Some offline counts are still syncing. Reconnect and try again.");const {error}=await db.rpc("inv_staff_submit_session",{p_staff_token:token,p_session_id:sessionId});if(error)return setMsg("sessionMsg",error.message);setMsg("sessionMsg","Count submitted successfully.");$("submitBtn").disabled=true;try{await loadExportData()}catch(e){setMsg("exportMsg",e.message||"Submitted, but export data could not be loaded.")}}
$("startBtn").onclick=()=>start().catch(e=>setMsg("sessionMsg",e.message));$("saveBtn").onclick=save;$("nextBtn").onclick=next;$("submitBtn").onclick=submit;$("exportExcelBtn").onclick=exportExcel;$("exportPdfBtn").onclick=exportPdf;$("shareExportBtn").onclick=shareExports;$("search").oninput=renderList;$("scanBtn").onclick=scanBarcode;$("countQty").oninput=updateConversion;token=sessionStorage.getItem("inv_staff_token")||"";staff=sessionStorage.getItem("inv_staff_name")||"";if(token){
  $("staffTitle").textContent=staff||"Warehouse Staff";
  void start().catch(()=>initGuest());
}else{
  void initGuest();
}
window.addEventListener("online",()=>void flushCountQueue());
window.addEventListener("load",()=>{if(token)void flushCountQueue()});
