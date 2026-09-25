const {createClient}=supabase;const db=createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.key);const $=id=>document.getElementById(id);const esc=s=>String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));let token="",staff="",sessionId="",items=[],current=null,exportRows=[],exportMeta=null;
function setMsg(id,s){$(id).textContent=s||""}
async function login(){const name=$("staffName").value.trim(),pin=$("staffPin").value.trim();if(!name||!/^[0-9]{4,6}$/.test(pin))return setMsg("loginMsg","Enter staff name and 4–6 digit PIN.");$("loginBtn").disabled=true;try{const {data,error}=await db.rpc("inv_staff_login",{p_name:name,p_pin:pin});if(error)throw error;token=data.token;staff=data.staff_name;sessionStorage.setItem("inv_staff_token",token);sessionStorage.setItem("inv_staff_name",staff);$("login").classList.add("hidden");$("count").classList.remove("hidden");$("staffTitle").textContent=staff}catch(e){setMsg("loginMsg",e.message)}finally{$("loginBtn").disabled=false}}
async function start(){const section=$("section").value;const {data,error}=await db.rpc("inv_staff_start_session",{p_staff_token:token,p_section:section,p_date:new Date().toISOString().slice(0,10)});if(error)throw error;sessionId=data;const r=await db.rpc("inv_staff_get_items",{p_staff_token:token,p_section:section});if(r.error)throw r.error;items=r.data||[];renderList();$("counter").classList.remove("hidden");$("items").classList.remove("hidden");$("submitBtn").classList.remove("hidden");setMsg("sessionMsg",items.length+" items loaded.")}
function renderList(){const q=$("search").value.trim().toLowerCase();const filtered=items.filter(x=>!q||x.name.toLowerCase().includes(q)||String(x.barcode||"").includes(q));$("items").innerHTML=filtered.map(x=>'<button class="secondary itemPick" data-id="'+esc(x.id)+'" style="display:block;width:100%;margin:6px 0;text-align:left"><b>'+esc(x.name)+'</b><br><small>'+esc(x.category)+' · '+esc(x.base_uom)+' · count as '+esc(x.count_unit)+(Number(x.count_to_base)!==1?' · 1 '+esc(x.count_unit)+' = '+esc(x.count_to_base)+' '+esc(x.base_uom):'')+'</small></button>').join("")||'<div class="hint">No matching items.</div>';document.querySelectorAll(".itemPick").forEach(b=>b.onclick=()=>selectItem(b.dataset.id))}
function selectItem(id){current=items.find(x=>String(x.id)===String(id));if(!current)return;document.querySelectorAll(".itemPick").forEach(b=>b.classList.toggle("selected",String(b.dataset.id)===String(id)));$("countUnitLabel").textContent=current.count_unit||current.base_uom||"";$("itemInfo").innerHTML='<b>'+esc(current.name)+'</b><br>'+esc(current.category)+' · Base UOM: '+esc(current.base_uom)+' · Count as: '+esc(current.count_unit)+(Number(current.count_to_base)!==1?' · 1 '+esc(current.count_unit)+' = '+esc(current.count_to_base)+' '+esc(current.base_uom):'');$("countQty").value="";$("countQty").focus();updateConversion()}
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
function updateConversion(){if(!current)return;const n=Number($("countQty").value);$("conversion").textContent=Number.isFinite(n)&&n>=0?(n+" "+current.count_unit+" = "+(n*Number(current.count_to_base))+" "+current.base_uom):""}
async function save(){if(!current)return setMsg("savedMsg","Select an item.");const n=Number($("countQty").value);if(!Number.isFinite(n)||n<0)return setMsg("savedMsg","Enter a valid quantity.");$("saveBtn").disabled=true;try{const {data,error}=await db.rpc("inv_staff_save_count",{p_staff_token:token,p_session_id:sessionId,p_item_id:current.id,p_qty:n});if(error)throw error;setMsg("savedMsg","Saved: "+n+" "+data.count_unit+" = "+data.base_qty+" "+data.base_uom)}catch(e){setMsg("savedMsg",e.message)}finally{$("saveBtn").disabled=false}}
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
async function submit(){const {error}=await db.rpc("inv_staff_submit_session",{p_staff_token:token,p_session_id:sessionId});if(error)return setMsg("sessionMsg",error.message);setMsg("sessionMsg","Count submitted successfully.");$("submitBtn").disabled=true;try{await loadExportData()}catch(e){setMsg("exportMsg",e.message||"Submitted, but export data could not be loaded.")}}
function logout(){closeCamera();if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}sessionStorage.clear();location.reload()}
$("loginBtn").onclick=login;$("startBtn").onclick=()=>start().catch(e=>setMsg("sessionMsg",e.message));$("saveBtn").onclick=save;$("nextBtn").onclick=next;$("submitBtn").onclick=submit;$("exportExcelBtn").onclick=exportExcel;$("exportPdfBtn").onclick=exportPdf;$("shareExportBtn").onclick=shareExports;$("logoutBtn").onclick=logout;$("search").oninput=renderList;$("scanBtn").onclick=scanBarcode;$("countQty").oninput=updateConversion;$("staffPin").onkeydown=e=>{if(e.key==="Enter")login()};token=sessionStorage.getItem("inv_staff_token")||"";staff=sessionStorage.getItem("inv_staff_name")||"";if(token){$("login").classList.add("hidden");$("count").classList.remove("hidden");$("staffTitle").textContent=staff}