(()=>{"use strict";
const db=window.supabase.createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.key);
const S={section:"restaurant",items:[],editId:null,scanner:null,importRows:[],importErrors:[],importValid:[],importFile:""};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const token=()=>window.PA_ADMIN_SESSION||localStorage.getItem("packing_assistant_admin_session_token")||"";
const norm=s=>String(s??"").trim().replace(/\s+/g," ");
const bool=s=>String(s??"").trim().toUpperCase()==="TRUE";
const barcodeValid=b=>{b=String(b).trim();if(!/^\d+$/.test(b)||![8,12,13].includes(b.length))return false;let sum=0,n=b.length;for(let i=0;i<n-1;i++)sum+=Number(b[i])*(((n-i-1)%2)?3:1);return ((10-sum%10)%10)===Number(b[n-1])};
function alertBox(msg,type=""){const e=$("inventoryAlert");e.textContent=msg||"";e.className="inventoryAlert "+type;if(msg)e.classList.remove("hidden");else e.classList.add("hidden")}
function splitPipe(v){return norm(v).split("|").map(norm).filter(Boolean)}
function payloadFromForm(){return{operation:S.editId?"update":"create",section:$("itemSection").value,name:norm($("itemName").value),category:norm($("itemCategory").value),base_uom:$("itemUom").value,count_mode:$("itemMode").value,default_pack_size:$("itemPackSize").value.trim()===""?null:Number($("itemPackSize").value),barcodes:splitPipe($("itemBarcodes").value),no_barcode:$("itemNoBarcode").checked,aliases:splitPipe($("itemAliases").value),brand:norm($("itemBrand").value)||null}}
function validateItem(p,existing=[]){
 const e=[];
 if(!["restaurant","vegetable"].includes(p.section))e.push("Section is required.");
 if(!p.name)e.push("Item name is required.");
 if(!p.category)e.push("Category is required.");
 if(!["kg","L","pcs"].includes(p.base_uom))e.push("Base UOM must be kg, L or pcs.");
 if(!["unit","packet"].includes(p.count_mode))e.push("Count mode must be Unit or Packet.");
 if(p.count_mode==="packet"&&(!Number.isFinite(p.default_pack_size)||p.default_pack_size<=0))e.push("Default pack size is required and must be greater than 0 for Packet mode.");
 if(p.no_barcode&&p.barcodes.length)e.push("Remove barcodes when No barcode is selected.");
 if(!p.no_barcode&&!p.barcodes.length)e.push("Barcode is required unless No barcode is selected.");
 const seen=new Set();p.barcodes.forEach(b=>{if(!barcodeValid(b))e.push("Invalid barcode check digit: "+b);if(seen.has(b))e.push("Duplicate barcode in this item: "+b);seen.add(b)});
 const same=existing.find(x=>x.id!==S.editId&&x.section===p.section&&norm(x.name).toLowerCase()===p.name.toLowerCase());if(same)e.push("Duplicate item name in this section.");
 const oldBars=new Set((existing.find(x=>x.id===S.editId)?.barcodes||[]));p.barcodes.forEach(b=>{if(existing.some(x=>x.id!==S.editId&&(x.barcodes||[]).includes(b)))e.push("Barcode already linked: "+b)});
 return e;
}
async function loadItems(){const r=await db.rpc("inv_v2_get_items",{p_session_token:token(),p_section:S.section});if(r.error)throw r.error;S.items=(r.data||[]).map(x=>({...x,barcodes:Array.isArray(x.barcodes)?x.barcodes.filter(Boolean):[]}));renderItems()}
function renderItems(){
 const q=norm($("itemSearch").value).toLowerCase(),filter=$("itemFilter").value;
 const arr=S.items.filter(i=>(filter==="all"||(filter==="active"&&i.active)||(filter==="inactive"&&!i.active))&&(!q||[i.name,i.category,i.brand,...(i.aliases||[]),...(i.barcodes||[])].join(" ").toLowerCase().includes(q)));
 $("itemsTitle").textContent=(S.section==="restaurant"?"Restaurant":"Vegetable")+" Items";
 $("masterSummary").textContent=S.items.filter(i=>i.active).length+" active · "+S.items.filter(i=>!i.active).length+" inactive · "+new Set(S.items.flatMap(i=>i.barcodes)).size+" barcodes";
 $("itemList").innerHTML=arr.map(i=>'<article class="adminItemRow '+(i.active?"":"inactiveItem")+'"><div class="adminItemMain"><b>'+esc(i.name)+'</b><span>'+esc(i.category)+' · '+esc(i.base_uom)+' · '+esc(i.count_mode)+(i.default_pack_size?" · pack "+esc(i.default_pack_size):"")+'</span><small>'+(i.barcodes.length?"Barcode: "+esc(i.barcodes.join(" | ")):"No barcode")+(i.brand?" · "+esc(i.brand):"")+'</small></div><div class="adminItemActions"><span class="statusPill '+(i.active?"on":"off")+'">'+(i.active?"Active":"Inactive")+'</span><button class="secondary editItem" data-id="'+i.id+'">Edit</button>'+(i.active?'<button class="dangerBtn deactivateItem" data-id="'+i.id+'">Deactivate</button>':"")+'</div></article>').join("")||'<div class="emptyState">No items found.</div>';
 $("itemList").querySelectorAll(".editItem").forEach(b=>b.onclick=()=>openDialog(b.dataset.id));
 $("itemList").querySelectorAll(".deactivateItem").forEach(b=>b.onclick=()=>deactivate(b.dataset.id));
}
function resetForm(){S.editId=null;$("dialogTitle").textContent="Add Item";$("itemForm").reset();$("itemSection").value=S.section;$("fieldErrors").innerHTML="";$("dialogFetchStatus").textContent="Data is placed into these fields automatically."}
function openDialog(id=null){resetForm();if(id){const i=S.items.find(x=>x.id===id);if(!i)return;S.editId=id;$("dialogTitle").textContent="Edit Item";$("itemSection").value=i.section;$("itemCategory").value=i.category;$("itemName").value=i.name;$("itemUom").value=i.base_uom;$("itemMode").value=i.count_mode;$("itemPackSize").value=i.default_pack_size??"";$("itemBarcodes").value=i.barcodes.join(" | ");$("itemNoBarcode").checked=!!i.no_barcode;$("itemAliases").value=(i.aliases||[]).join(" | ");$("itemBrand").value=i.brand||""} $("itemDialog").showModal()}
async function lookup(barcode,button,status){
 barcode=norm(barcode);if(!barcode){status.textContent="Enter a barcode first.";return}
 if(!barcodeValid(barcode)){status.textContent="Invalid barcode check digit.";return}
 const linked=S.items.find(i=>i.barcodes.includes(barcode));
 if(linked){status.textContent="Already linked to: "+linked.name;alertBox("Barcode already linked to "+linked.name+". No fetch performed.","error");return}
 button.disabled=true;status.textContent="Fetching details…";
 try{
  const {data,error}=await db.functions.invoke("admin-item-lookup",{body:{admin_session:token(),barcode}});
  if(error)throw error;if(!data?.ok)throw new Error(data?.message||"Lookup failed.");
  if(data.linked){status.textContent=data.message||"Barcode already linked.";return}
  if(!data.found){status.textContent=data.message||"Product not found in Open Food Facts.";return}
  const d=data.data||{};$("itemBarcodes").value=d.barcode||barcode;if(d.name)$("itemName").value=d.name;if(d.brand)$("itemBrand").value=d.brand;if(d.category)$("itemCategory").value=d.category;if(d.aliases?.length)$("itemAliases").value=[...new Set(d.aliases)].join(" | ");if(d.base_uom)$("itemUom").value=d.base_uom;if(d.default_pack_size!=null)$("itemPackSize").value=d.default_pack_size;
  if(d.quantity_ambiguous)$("dialogFetchStatus").textContent="Quantity '"+(d.quantity||"")+" ' could not safely determine pack/base unit. Complete it manually.";else $("dialogFetchStatus").textContent="Details fetched. Verify all fields before saving.";
  $("fieldErrors").innerHTML="";alertBox("Product details fetched automatically. Review the fields before saving.","success");
  $("itemDialog").showModal();
 }catch(e){status.textContent=e.message||"Could not fetch product details.";alertBox(status.textContent,"error")}finally{button.disabled=false}
}
async function handleLookupTop(){const b=norm($("adminBarcode").value);if(!b)return;const linked=S.items.find(i=>i.barcodes.includes(b));if(linked){$("lookupStatus").textContent="Already linked to: "+linked.name;return}openDialog();$("itemBarcodes").value=b;await lookup(b,$("fetchLookupBtn"),$("lookupStatus"))}
async function startCamera(){if(!window.Html5Qrcode)return alertBox("Scanner library is still loading.","error");if(S.scanner)return;S.scanner=new Html5Qrcode("qrReader");$("cameraBox").classList.remove("hidden");try{await S.scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:280,height:140}},async code=>{await stopCamera();$("adminBarcode").value=code;$("fetchLookupBtn").disabled=false;await handleLookupTop()},()=>{})}catch(e){alertBox("Camera could not start. Check browser camera permission.","error");await stopCamera()}}
async function stopCamera(){if(!S.scanner)return;$("cameraBox").classList.add("hidden");try{await S.scanner.stop()}catch{}try{S.scanner.clear()}catch{}S.scanner=null}
async function saveItem(e,keepOpen=false){e?.preventDefault();const p=payloadFromForm(),errors=validateItem(p,S.items);$("fieldErrors").innerHTML=errors.length?errors.map(x=>"<div>"+esc(x)+"</div>").join(""):"";if(errors.length)return;const b=$("saveItemBtn");b.disabled=true;b.textContent="Saving…";try{const {data,error}=await db.rpc("inv_v2_save_item",{p_session_token:token(),p_item_id:S.editId,p_payload:p,p_import_id:null});if(error)throw error;if(keepOpen){const section=p.section;resetForm();$("itemSection").value=section;$("itemDialog").showModal();}else $("itemDialog").close();alertBox(S.editId?"Item updated.":"Item saved.","success");await loadItems()}catch(x){alertBox(x.message||"Could not save item.","error")}finally{b.disabled=false;b.textContent="Save Item"}}
async function deactivate(id){if(!confirm("Deactivate this item? It will remain in history and cannot be deleted."))return;try{const {error}=await db.rpc("inv_v2_save_item",{p_session_token:token(),p_item_id:id,p_payload:{operation:"deactivate"},p_import_id:null});if(error)throw error;alertBox("Item deactivated.","success");await loadItems()}catch(e){alertBox(e.message||"Could not deactivate item.","error")}}
function templateRows(){return [["restaurant","EXAMPLE Barilla Pasta 1kg","Dry Goods","kg","packet",1,"8076809571319",false,"barilla|pasta","Barilla"]]}
function downloadTemplate(){const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([["section","name","category","base_uom","count_mode","default_pack_size","barcodes","no_barcode","aliases","brand"],...templateRows()]);ws["!cols"]=[{wch:14},{wch:30},{wch:18},{wch:12},{wch:14},{wch:20},{wch:22},{wch:12},{wch:24},{wch:18}];XLSX.utils.book_append_sheet(wb,ws,"Items");const ins=[["Column","Required","Guidance"],["section","YES","restaurant or vegetable"],["name","YES","Trim and collapse repeated spaces. Duplicate names within the same section are rejected, including inactive items."],["category","YES","Use your operational category."],["base_uom","YES","kg, L or pcs only."],["count_mode","YES","unit or packet."],["default_pack_size","YES for packet","Must be > 0 for packet mode. Leave blank for unit mode."],["barcodes","YES unless no_barcode=TRUE","One or more EAN-8, UPC-A or EAN-13 barcodes separated by |. Check digit is validated."],["no_barcode","YES","TRUE means there must be no barcode. FALSE requires at least one barcode."],["aliases","NO","Optional aliases separated by |."],["brand","NO","Optional brand/manufacturer."]];XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(ins),"Instructions");XLSX.writeFile(wb,"bigly-inventory-item-template.xlsx")}
function parseFile(file){return new Promise((res,rej)=>{const rd=new FileReader();rd.onload=ev=>{try{const wb=XLSX.read(ev.target.result,{type:"array",cellText:false,cellDates:false});const name=wb.SheetNames.includes("Items")?"Items":wb.SheetNames[0];const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:"",raw:false});if(!rows.length)return res([]);const headers=rows[0].map(x=>norm(x).toLowerCase());res(rows.slice(1).map((r,i)=>{const o={};headers.forEach((h,j)=>o[h]=norm(r[j]??""));return{row:i+2,raw:o}}))}catch(e){rej(e)}};rd.onerror=()=>rej(rd.error);rd.readAsArrayBuffer(file)})}
function validateImport(rows){
 const valid=[],errors=[],seenNames=new Set(),seenBarcodes=new Set();
 const required=["section","name","category","base_uom","count_mode","default_pack_size","barcodes","no_barcode","aliases","brand"];
 rows.forEach(x=>{const r=x.raw;if(Object.keys(r).filter(Boolean).length===0)return;if(/^EXAMPLE\b/i.test(norm(r.name))){x.status="skipped";return}
 const packRaw=norm(r.default_pack_size),flag=norm(r.no_barcode).toUpperCase();const p={section:norm(r.section),name:norm(r.name),category:norm(r.category),base_uom:norm(r.base_uom),count_mode:norm(r.count_mode).toLowerCase(),default_pack_size:packRaw===""?null:Number(packRaw),barcodes:splitPipe(r.barcodes),no_barcode:flag==="TRUE",aliases:splitPipe(r.aliases),brand:norm(r.brand)||null};let e=[];if(packRaw!==""&&!Number.isFinite(p.default_pack_size))e.push("default_pack_size must be numeric.");if(!["TRUE","FALSE"].includes(flag))e.push("no_barcode must be TRUE or FALSE.");
 if(!required.every(k=>Object.prototype.hasOwnProperty.call(r,k)))e.push("Template columns are incomplete.");
 e=e.concat(validateItem({...p},S.items));
 const nk=p.section+"|"+p.name.toLowerCase();if(seenNames.has(nk))e.push("Duplicate name in import file.");seenNames.add(nk);
 p.barcodes.forEach(b=>{if(seenBarcodes.has(b))e.push("Duplicate barcode in import file: "+b);seenBarcodes.add(b)});
 x.payload=p;x.error=e.join(" ");x.status=e.length?"error":"valid";(e.length?errors:valid).push(x)});
 return{valid,errors,skipped:rows.filter(x=>x.status==="skipped")};
}
async function previewImport(file){try{const rows=await parseFile(file);if(!rows.length)throw new Error("No rows found.");S.importFile=file.name;const r=validateImport(rows);S.importRows=rows;S.importValid=r.valid;S.importErrors=r.errors;$("importPreviewCard").classList.remove("hidden");$("importSummary").textContent=r.valid.length+" valid · "+r.errors.length+" errors · "+r.skipped.length+" example rows skipped";$("importRows").innerHTML=rows.map(x=>'<tr><td>'+x.row+'</td><td>'+esc(x.raw.name)+'</td><td>'+esc(x.raw.section)+'</td><td><span class="statusPill '+(x.status==="valid"?"on":x.status==="skipped"?"skip":"off")+'">'+esc(x.status||"empty")+'</span></td><td>'+esc(x.error||"")+'</td></tr>').join("");$("confirmImportBtn").disabled=!r.valid.length||r.errors.length>0;$("downloadErrorsBtn").classList.toggle("hidden",!r.errors.length);$("importPreviewCard").scrollIntoView({behavior:"smooth"})}catch(e){alertBox(e.message||"Could not read import file.","error")}}
async function confirmImport(){if(S.importErrors.length||!S.importValid.length)return;const importId=crypto.randomUUID();const btn=$("confirmImportBtn");btn.disabled=true;btn.textContent="Importing…";try{const {data,error}=await db.rpc("inv_v2_save_item",{p_session_token:token(),p_item_id:null,p_payload:{operation:"batch_create",items:S.importValid.map(x=>x.payload)},p_import_id:importId});if(error)throw error;alertBox("Import complete: "+data.added+" items added.","success");$("importPreviewCard").classList.add("hidden");S.importRows=[];S.importValid=[];S.importErrors=[];await loadItems()}catch(e){alertBox(e.message||"Import failed. No rows were partially imported.","error")}finally{btn.disabled=false;btn.textContent="Import Valid Rows"}}
function errorCsv(){const rows=[["row","name","error"],...S.importErrors.map(x=>[x.row,x.raw.name,x.error])];downloadText("inventory-import-errors.csv",rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\n"),"text/csv")}
function downloadText(name,text,type){const a=document.createElement("a");const u=URL.createObjectURL(new Blob([text],{type}));a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function wire(){
 $("backDashboard").onclick=()=>location.href="./";$("sideDashboard").onclick=()=>location.href="./";$("sidePacking").onclick=()=>location.href="./";$("sideDelivery").onclick=()=>location.href="./";$("sideReports").onclick=()=>location.href="./";$("sideSettings").onclick=()=>location.href="./";
 $("baSidebarToggle").onclick=()=>document.querySelector(".baSidebar")?.classList.toggle("open");
 document.querySelectorAll(".sectionTab").forEach(b=>b.onclick=async()=>{document.querySelectorAll(".sectionTab").forEach(x=>x.classList.remove("active"));b.classList.add("active");S.section=b.dataset.section;$("itemSearch").value="";await loadItems()});
 $("itemSearch").oninput=renderItems;$("itemFilter").onchange=renderItems;$("addItemBtn").onclick=()=>openDialog();$("downloadTemplateBtn").onclick=downloadTemplate;
 $("importBtn").onclick=()=>$("fileInput").click();$("fileInput").onchange=e=>{const f=e.target.files?.[0];if(f)previewImport(f);e.target.value=""};
 $("cancelImportBtn").onclick=()=>{$("importPreviewCard").classList.add("hidden")};$("confirmImportBtn").onclick=confirmImport;$("downloadErrorsBtn").onclick=errorCsv;
 $("saveItemBtn").onclick=e=>saveItem(e,false);$("saveAnotherBtn").onclick=e=>saveItem(e,true);$("dialogFetchBtn").onclick=()=>lookup($("itemBarcodes").value.split("|")[0],$("dialogFetchBtn"),$("dialogFetchStatus"));
 $("itemBarcodes").addEventListener("input",()=>{$("dialogFetchBtn").disabled=!norm($("itemBarcodes").value)});
 $("itemNoBarcode").onchange=e=>{if(e.target.checked){$("itemBarcodes").value="";$("itemBarcodes").disabled=true;$("dialogFetchBtn").disabled=true}else{$("itemBarcodes").disabled=false}};
 $("adminBarcode").addEventListener("input",()=>{const b=norm($("adminBarcode").value);$("fetchLookupBtn").disabled=!b});
 $("adminBarcode").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();handleLookupTop()}});
 $("fetchLookupBtn").onclick=handleLookupTop;$("cameraBtn").onclick=startCamera;$("stopCameraBtn").onclick=stopCamera;
}
async function init(){wire();await loadItems();$("connection").textContent=navigator.onLine?"● Online":"● Offline";window.addEventListener("online",()=>{$("connection").textContent="● Online"});window.addEventListener("offline",()=>{$("connection").textContent="● Offline"})}
window.addEventListener("pa-admin-authenticated",()=>init().catch(e=>alertBox(e.message||"Inventory startup failed.","error")));
window.addEventListener("load",()=>{if(window.PA_ADMIN_SESSION&&!S.items.length)init().catch(e=>alertBox(e.message||"Inventory startup failed.","error"))});
})();