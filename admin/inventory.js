(()=>{"use strict";
const db=window.supabase.createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.key);
const S={items:[],editId:null,scanner:null,importRows:[],validRows:[],errors:[]};
const $=id=>document.getElementById(id);
const token=()=>window.PA_ADMIN_SESSION||localStorage.getItem("packing_assistant_admin_session_token")||"";
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function alertBox(msg,type=""){const e=$("inventoryAlert");e.textContent=msg||"";e.className="inventoryAlert "+type+(msg?"":" hidden")}
function splitPipe(v){return String(v??"").split("|").map(x=>x.trim()).filter(Boolean)}
function normalize(v){return String(v??"").trim().replace(/\s+/g," ")}
function formPayload(){
 const no=$("itemNoBarcode").checked;
 return {section:$("itemSection").value,name:normalize($("itemName").value),category:normalize($("itemCategory").value),base_uom:$("itemUom").value,count_mode:$("itemCountMode").value,default_pack_size:$("itemCountMode").value==="packet"?$("itemPackSize").value:"",barcodes:no?[]:splitPipe($("itemBarcodes").value),no_barcode:no,aliases:splitPipe($("itemAliases").value),brand:normalize($("itemBrand").value)||null};
}
function showErrors(list=[]){$("fieldErrors").innerHTML=list.length?list.map(x=>"<div>• "+esc(x)+"</div>").join(""):""}
function openDialog(item=null,barcode=""){
 S.editId=item?.id||null;$("dialogTitle").textContent=item?"Edit Item":"Add Item";$("itemForm").reset();
 $("itemSection").value=item?.section||$("sectionSelect").value;$("itemName").value=item?.name||"";$("itemCategory").value=item?.category||"";
 $("itemUom").value=item?.base_uom||"";$("itemCountMode").value=item?.count_mode||"";$("itemPackSize").value=item?.default_pack_size??"";
 $("itemBrand").value=item?.brand||"";$("itemBarcodes").value=item?.barcodes?.join("|")||barcode;$("itemNoBarcode").checked=!!item?.no_barcode;
 $("itemAliases").value=item?.aliases?.join("|")||"";showErrors([]);togglePack();$("itemDialog").showModal();
}
function togglePack(){$("packWrap").classList.toggle("hidden",$("itemCountMode").value!=="packet")}
async function lookup(){
 const b=normalize($("barcodeInput").value);
 if(!b)return alertBox("Scan or enter a barcode first.","error");
 $("fetchDetailsBtn").disabled=true;$("fetchDetailsBtn").textContent="Fetching…";
 try{
  const r=await db.functions.invoke("admin-item-lookup",{body:{admin_session:token(),barcode:b}});
  if(r.error)throw r.error;const d=r.data||{};
  if(d.linked){alertBox("This barcode is already linked to "+(d.item?.name||"an item")+". No new item was opened.","error");$("fetchDetailsBtn").classList.add("hidden");return}
  if(!d.found){alertBox(d.message||"Product not found. Add the item manually.","error");openDialog(null,b);return}
  const p=d.data||{};openDialog(null,b);
  $("itemName").value=p.name||"";$("itemBrand").value=p.brand||"";$("itemCategory").value=p.category||"";
  $("itemAliases").value=[...(p.aliases||[])].filter((x,i,a)=>x&&a.indexOf(x)===i).join("|");
  $("itemUom").value=p.base_uom||"";$("itemPackSize").value=p.default_pack_size??"";
  $("itemBarcodes").value=p.barcode||b;showErrors(p.quantity_ambiguous?["Pack quantity was ambiguous; please select Base UOM and Pack Size manually."]:[]);
  alertBox("Details fetched automatically. Review the fields before saving.","success");
 }catch(e){alertBox(e.message||"Could not fetch product details.","error")}
 finally{$("fetchDetailsBtn").disabled=false;$("fetchDetailsBtn").textContent="Fetch Details"}
}
function handleBarcode(b){
 b=String(b||"").replace(/\D/g,"");if(!b)return;$("barcodeInput").value=b;$("barcodeResult").classList.remove("hidden");$("barcodeResult").textContent="Barcode scanned: "+b;
 $("fetchDetailsBtn").classList.remove("hidden");$("manualAddBtn").onclick=()=>openDialog(null,b);
}
async function startScanner(){
 if(!window.Html5Qrcode)return alertBox("Scanner is still loading. Try again.","error");
 if(S.scanner)return;S.scanner=new Html5Qrcode("qrReader");$("qrReader").classList.remove("hidden");$("startScannerBtn").classList.add("hidden");$("stopScannerBtn").classList.remove("hidden");
 try{await S.scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:250,height:150}},x=>{handleBarcode(x);stopScanner()},()=>{})}
 catch(e){alertBox("Camera could not start. Check camera permission.","error");stopScanner()}
}
async function stopScanner(){if(!S.scanner)return;$("stopScannerBtn").classList.add("hidden");$("startScannerBtn").classList.remove("hidden");try{await S.scanner.stop()}catch{}try{S.scanner.clear()}catch{}S.scanner=null;$("qrReader").classList.add("hidden")}
async function loadItems(){
 const r=await db.rpc("inv_v2_get_items",{p_session_token:token(),p_section:$("sectionSelect").value});if(r.error)throw r.error;S.items=r.data||[];renderItems();
}
function renderItems(){
 const q=normalize($("itemSearch").value).toLowerCase(),rows=S.items.filter(i=>!q||[i.name,i.category,i.brand,(i.barcodes||[]).join(" "),...(i.aliases||[])].join(" ").toLowerCase().includes(q));
 $("itemList").innerHTML=rows.length?rows.map(i=>'<article class="adminItem"><div><b>'+esc(i.name)+'</b><small>'+esc(i.category)+' · '+esc(i.base_uom)+' · '+esc(i.count_mode)+(i.default_pack_size?" · pack "+esc(i.default_pack_size):"")+'</small><small>'+(i.barcodes?.length?esc(i.barcodes.join(" · ")):"No barcode")+'</small></div><div class="itemActions"><button class="secondary editBtn" data-id="'+i.id+'">Edit</button>'+(i.active?'<button class="dangerBtn deactivateBtn" data-id="'+i.id+'">Deactivate</button>':'<span class="inactiveBadge">Inactive</span>')+'</div></article>').join(""):'<div class="emptyState">No items yet. Scan a barcode or add an item manually.</div>';
 $("itemList").querySelectorAll(".editBtn").forEach(b=>b.onclick=()=>openDialog(S.items.find(i=>i.id===b.dataset.id)));
 $("itemList").querySelectorAll(".deactivateBtn").forEach(b=>b.onclick=()=>deactivate(b.dataset.id));
}
async function deactivate(id){if(!confirm("Deactivate this item? It will never be deleted."))return;try{const r=await db.rpc("inv_v2_save_item",{p_session_token:token(),p_operation:"deactivate",p_item_id:id,p_payload:{},p_import_id:null});if(r.error)throw r.error;await loadItems();alertBox("Item deactivated.","success")}catch(e){alertBox(e.message||"Could not deactivate item.","error")}}
async function saveItem(e){
 e.preventDefault();const p=formPayload(),errors=[];
 if(!p.name)errors.push("Name is required.");if(!p.category)errors.push("Category is required.");if(!p.base_uom)errors.push("Base UOM is required.");if(!p.count_mode)errors.push("Count mode is required.");
 if(p.count_mode==="packet"&&!(Number(p.default_pack_size)>0))errors.push("Default pack size must be greater than 0.");
 if(p.no_barcode&&p.barcodes.length)errors.push("No barcode cannot have barcodes.");if(!p.no_barcode&&!p.barcodes.length)errors.push("Barcode is required unless No barcode is selected.");
 showErrors(errors);if(errors.length)return;
 try{const r=await db.rpc("inv_v2_save_item",{p_session_token:token(),p_operation:S.editId?"update":"create",p_item_id:S.editId,p_payload:p,p_import_id:null});if(r.error)throw r.error;
  $("itemDialog").close();await loadItems();alertBox("Item saved.","success");
 }catch(x){showErrors([x.message||"Could not save item."]);alertBox(x.message||"Could not save item.","error")}
}
function template(){
 const wb=XLSX.utils.book_new(),headers=["section","name","category","base_uom","count_mode","default_pack_size","barcode(s)","no_barcode","aliases","brand"];
 const row=["restaurant","EXAMPLE Barilla Pasta 1kg","Dry Goods","kg","packet",1,"8076809571319",false,"barilla|pasta","Barilla"];
 const ws=XLSX.utils.aoa_to_sheet([headers,row]);ws["!cols"]=headers.map(()=>({wch:22}));XLSX.utils.book_append_sheet(wb,ws,"Items");
 const ins=[["Column","Required","Guidance"],...headers.map(h=>[h,h==="aliases"||h==="brand"?"No":"Yes",h==="section"?"restaurant or vegetable":h==="base_uom"?"kg, L or pcs":h==="count_mode"?"unit or packet":h==="barcode(s)"?"Use | for multiple valid EAN-8/UPC-A/EAN-13 barcodes":h==="no_barcode"?"TRUE only when there is no barcode":h==="default_pack_size"?"Required >0 for packet mode":"Trim spaces; do not use scientific notation"])];
 XSLX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(ins),"Instructions");XLSX.writeFile(wb,"Bigly_Inventory_Item_Template.xlsx");
}
function parseFile(file){
 return new Promise((res,rej)=>{const rd=new FileReader();rd.onload=e=>{try{const wb=XLSX.read(e.target.result,{type:"array",cellText:true,cellDates:false}),sheet=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{defval:"",raw:false});res(rows)}catch(x){rej(x)}};rd.onerror=()=>rej(rd.error);rd.readAsArrayBuffer(file)})
}
function barcodeValid(b){if(!/^[0-9]+$/.test(b)||![8,12,13].includes(b.length))return false;let s=0;for(let i=0;i<b.length-1;i++){const d=+b[i];s+=d*(((b.length-i-1)%2)?3:1)}return(10-s%10)%10===+b.at(-1)}
function rowToPayload(r){
 const get=(...a)=>{const k=Object.keys(r).find(x=>a.includes(String(x).trim().toLowerCase().replace(/[ _-]+/g,"")));return k?String(r[k]).trim():""};
 const n=get("name","itemname","productname"), section=get("section")||"restaurant", uom=get("base_uom","baseuom","unit","uom"), mode=get("count_mode","countmode"), pack=get("default_pack_size","defaultpacksize","packsize"), bc=get("barcode(s)","barcodes","barcode"), no=/^(true|yes|1)$/i.test(get("no_barcode","nobarcode")), aliases=splitPipe(get("aliases")),brand=normalize(get("brand"))||null;
 return {section,name:normalize(n),category:normalize(get("category")),base_uom:uom,count_mode:mode,default_pack_size:mode==="packet"?pack:"",barcodes:no?[]:splitPipe(bc),no_barcode:no,aliases,brand};
}
async function importFile(file){
 try{const rows=await parseFile(file);S.importRows=[];S.validRows=[];S.errors=[];let skipped=0;
  rows.forEach((r,idx)=>{const p=rowToPayload(r);if(!p.name)return;if(/^EXAMPLE\b/i.test(p.name)){skipped++;return}S.importRows.push({row:idx+2,payload:p})});
  const names=new Set(),codes=new Set();
  for(const x of S.importRows){const p=x.payload,e=[];const nk=p.section+"|"+p.name.toLowerCase();if(names.has(nk))e.push("Duplicate name in import file");else names.add(nk);p.barcodes.forEach(b=>{if(codes.has(b))e.push("Duplicate barcode in import file "+b);else codes.add(b)});if(!p.category)e.push("Category required");if(!["restaurant","vegetable"].includes(p.section))e.push("Invalid section");if(!["kg","L","pcs"].includes(p.base_uom))e.push("Invalid base UOM");if(!["unit","packet"].includes(p.count_mode))e.push("Invalid count mode");if(p.count_mode==="packet"&&!(Number(p.default_pack_size)>0))e.push("Pack size must be >0");if(!p.no_barcode&&!p.barcodes.length)e.push("Barcode required");if(p.no_barcode&&p.barcodes.length)e.push("No barcode conflicts with barcode");
   if(!p.no_barcode)p.barcodes.forEach(b=>{if(!barcodeValid(b))e.push("Invalid barcode/check digit "+b)});
   if(e.length)S.errors.push({row:x.row,errors:e.join("; "),payload:p});else S.validRows.push(x);
  }
  $("importSummary").innerHTML="<p><b>"+S.validRows.length+"</b> valid · <b>"+S.errors.length+"</b> errors · <b>"+skipped+"</b> example rows skipped.</p>";
  $("importErrors").innerHTML=S.errors.length?"<div class='errorTable'>"+S.errors.map(x=>"<div>Row "+x.row+": "+esc(x.errors)+"</div>").join("")+"</div>":"<p class='successText'>No row-level validation errors.</p>";
  $("importValidBtn").disabled=!S.validRows.length;$("downloadErrors").classList.toggle("hidden",!S.errors.length);$("importDialog").showModal();
 }catch(e){alertBox(e.message||"Could not read import file.","error")}
}
async function importValid(){
 const importId=crypto.randomUUID();let added=0,failed=[];
 for(const x of S.validRows){try{const r=await db.rpc("inv_v2_save_item",{p_session_token:token(),p_operation:"create",p_item_id:null,p_payload:x.payload,p_import_id:importId});if(r.error)throw r.error;added++}catch(e){failed.push({row:x.row,error:e.message||"Import failed"})}}
 if(failed.length){S.errors.push(...failed.map(x=>({row:x.row,errors:x.error,payload:{}})));alertBox(added+" imported; "+failed.length+" rows rejected. Download the error list.","error")}else{alertBox(added+" items imported.","success");$("importDialog").close()}
 await loadItems();
}
function downloadErrors(){const rows=S.errors.map(x=>({row:x.row,error:x.errors}));const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Errors");XLSX.writeFile(wb,"Bigly_Inventory_Import_Errors.xlsx")}
function wire(){
 $("sideDashboard").onclick=()=>location.href="./";$("sidePacking").onclick=()=>location.href="./";$("sideDelivery").onclick=()=>location.href="./";$("sideReports").onclick=()=>location.href="./";$("sideSettings").onclick=()=>location.href="./";$("backDashboard").onclick=()=>location.href="./";
 $("baSidebarToggle").onclick=()=>document.querySelector(".baSidebar")?.classList.toggle("open");
 $("sectionSelect").onchange=()=>loadItems().catch(e=>alertBox(e.message,"error"));$("itemSearch").oninput=renderItems;$("refreshBtn").onclick=()=>loadItems().catch(e=>alertBox(e.message,"error"));
 $("startScannerBtn").onclick=startScanner;$("stopScannerBtn").onclick=stopScanner;$("fetchDetailsBtn").onclick=lookup;$("barcodeInput").addEventListener("input",e=>{if(normalize(e.target.value)){handleBarcode(e.target.value)}});
 $("barcodeInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();handleBarcode(e.target.value);lookup()}});
 $("manualAddBtn").onclick=()=>openDialog(null,normalize($("barcodeInput").value));$("closeDialog").onclick=$("cancelDialog").onclick=()=>$("itemDialog").close();$("itemCountMode").onchange=togglePack;$("itemNoBarcode").onchange=()=>{$("itemBarcodes").disabled=$("itemNoBarcode").checked};$("itemForm").onsubmit=saveItem;
 $("downloadTemplateBtn").onclick=template;$("importBtn").onclick=()=>$("fileInput").click();$("fileInput").onchange=e=>{if(e.target.files[0])importFile(e.target.files[0]);e.target.value=""};
 $("closeImport").onclick=()=>$("importDialog").close();$("importValidBtn").onclick=importValid;$("downloadErrors").onclick=downloadErrors;
}
async function init(){wire();await loadItems();$("connection").textContent=navigator.onLine?"● Online":"● Offline"}
window.addEventListener("pa-admin-authenticated",()=>init().catch(e=>alertBox(e.message||"Inventory startup failed.","error")));
window.addEventListener("load",()=>{if(window.PA_ADMIN_SESSION)init().catch(e=>alertBox(e.message||"Inventory startup failed.","error"))});
})();