(()=>{"use strict";
const db=window.supabase.createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.key);
const $=id=>document.getElementById(id);
const S={items:[],editId:null,report:[],filtered:[]};
const token=()=>window.PA_ADMIN_SESSION||localStorage.getItem("packing_assistant_admin_session_token")||"";
const esc=s=>String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const alertBox=(m,t="")=>{const e=$("vegAdminAlert");if(!e)return;e.textContent=m||"";e.className="inventoryAlert "+t;if(m)e.classList.remove("hidden");else e.classList.add("hidden")};
const errorText=e=>e?.message||e?.details||"Unknown error";
function setKpis(){
  const active=S.items.filter(x=>x.is_active).length;
  const sessions=new Set(S.report.map(x=>x.session_id).filter(Boolean));
  const latest=S.report[0];
  $("vegKpiActive").textContent=String(active);
  $("vegKpiSessions").textContent=String(sessions.size);
  $("vegKpiEntries").textContent=String(S.report.length);
  $("vegKpiLast").textContent=latest?.count_date||"—";
  $("vegKpiLastSub").textContent=latest?((latest.item_name||"Latest count")+" · "+(latest.grade||"")):"No count entries recorded";
  $("vegMasterSummary").textContent=active+" active · "+S.items.length+" total";
}
function renderItems(){
  const q=$("vegAdminSearch").value.trim().toLowerCase(),f=$("vegAdminFilter").value;
  const a=S.items.filter(x=>(f==="all"||(f==="active"&&x.is_active)||(f==="inactive"&&!x.is_active))&&(!q||[x.name_en,x.name_hi,x.name_gu].filter(Boolean).join(" ").toLowerCase().includes(q)));
  $("vegAdminList").innerHTML=a.map(x=>'<div class="vegAdminRow"><div class="vegAdminNames"><b>'+esc(x.name_en)+'</b><span>Gujarati: '+esc(x.name_gu||"—")+' · Hindi: '+esc(x.name_hi||"—")+' · kg</span></div><div class="vegAdminActionsRow"><span class="statusPill '+(x.is_active?"on":"off")+'">'+(x.is_active?"Active":"Inactive")+'</span><button type="button" class="secondary vegEdit" data-id="'+x.item_id+'">Edit</button>'+(x.is_active?'<button type="button" class="dangerBtn vegDeactivate" data-id="'+x.item_id+'">Deactivate</button>':'<button type="button" class="secondary vegActivate" data-id="'+x.item_id+'">Activate</button>')+'</div></div>').join("")||'<div class="emptyState">No vegetables match the current filter.</div>';
  document.querySelectorAll(".vegEdit").forEach(b=>b.onclick=()=>openEdit(b.dataset.id));
  document.querySelectorAll(".vegDeactivate").forEach(b=>b.onclick=()=>setActive(b.dataset.id,false));
  document.querySelectorAll(".vegActivate").forEach(b=>b.onclick=()=>setActive(b.dataset.id,true));
}
async function loadItems(){
  const{data,error}=await db.rpc("inv_veg_admin_get_items",{p_admin_token:token()});
  if(error)throw error;
  S.items=data||[];
  const opts=S.items.map(x=>'<option value="'+x.item_id+'">'+esc(x.name_en)+'</option>').join("");
  $("reportItem").innerHTML='<option value="">All items</option>'+opts;
  renderItems();setKpis();
}
function openEdit(id=null){
  S.editId=id;
  const x=id?S.items.find(i=>i.item_id===id):null;
  $("vegDialogTitle").textContent=id?"Edit Vegetable":"Add Vegetable";
  $("vegNameEn").value=x?.name_en||"";
  $("vegNameGu").value=x?.name_gu||"";
  $("vegNameHi").value=x?.name_hi||"";
  $("vegEditError").textContent="";
  $("vegEditDialog").showModal();
  setTimeout(()=>$("vegNameEn").focus(),0);
}
async function saveItem(e){
  e.preventDefault();
  const en=$("vegNameEn").value.trim(),gu=$("vegNameGu").value.trim(),hi=$("vegNameHi").value.trim();
  if(!en){$("vegEditError").textContent="English name is required.";return}
  const duplicate=S.items.find(x=>x.name_en.trim().toLowerCase()===en.toLowerCase()&&x.item_id!==S.editId);
  if(duplicate){$("vegEditError").textContent="A vegetable with this English name already exists.";return}
  const b=$("vegSaveBtn");b.disabled=true;b.textContent="Saving…";
  try{
    const{error}=await db.rpc("inv_veg_admin_save_item",{p_admin_token:token(),p_item_id:S.editId,p_name_en:en,p_name_hi:hi,p_name_gu:gu});
    if(error)throw error;
    $("vegEditDialog").close();await loadItems();alertBox("Vegetable saved.","success");
  }catch(x){$("vegEditError").textContent=errorText(x)}finally{b.disabled=false;b.textContent="Save Vegetable"}
}
async function setActive(id,active){
  if(!active&&!confirm("Deactivate this vegetable? Historical counts will remain."))return;
  try{
    const{error}=await db.rpc("inv_veg_admin_set_active",{p_admin_token:token(),p_item_id:id,p_active:active});
    if(error)throw error;
    await loadItems();alertBox(active?"Vegetable activated.":"Vegetable deactivated.","success");
  }catch(e){alertBox(errorText(e),"error")}
}
function csvEscape(v){return '"'+String(v??"").replace(/"/g,'""')+'"'}
function download(name,text,type="text/csv"){const a=document.createElement("a");const u=URL.createObjectURL(new Blob([text],{type}));a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function exportItems(){
  const rows=[["English Name","Gujarati Name","Hindi Name","Base UOM","Active","Created By","Created At"],...S.items.map(x=>[x.name_en,x.name_gu||"",x.name_hi||"",x.base_uom,x.is_active?"Active":"Inactive",x.created_by,x.created_at])];
  download("vegetable-item-master.csv",rows.map(r=>r.map(csvEscape).join(",")).join("\n"));
}
function parseCsv(t){
  const rows=[];let row=[],cell="",q=false;
  for(let i=0;i<t.length;i++){const ch=t[i],n=t[i+1];
    if(ch==='"'&&q&&n==='"'){cell+='"';i++;continue}
    if(ch==='"'){q=!q;continue}
    if(ch===","&&!q){row.push(cell);cell="";continue}
    if((ch==="\n"||ch==="\r")&&!q){if(ch==="\r"&&n==="\n")i++;row.push(cell);cell="";if(row.some(v=>String(v).trim()))rows.push(row);row=[];continue}
    cell+=ch;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  return rows;
}
async function importItems(file){
  const rows=parseCsv(await file.text());
  if(!rows.length)throw Error("CSV is empty.");
  const h=rows[0].map(v=>String(v).trim().toLowerCase());
  const ie=h.indexOf("english name"),ig=h.indexOf("gujarati name"),ih=h.indexOf("hindi name");
  if(ie<0)throw Error("CSV must contain an English Name column.");
  const seen=new Set(),plan=[];
  for(let i=1;i<rows.length;i++){
    const en=String(rows[i][ie]||"").trim().replace(/\s+/g," ");
    if(!en)continue;
    const key=en.toLowerCase();
    if(seen.has(key))throw Error("Duplicate English name in CSV: "+en);
    seen.add(key);
    const old=S.items.find(x=>x.name_en.trim().toLowerCase()===key);
    plan.push({id:old?.item_id||null,en,hi:ih>=0?String(rows[i][ih]||"").trim():"",gu:ig>=0?String(rows[i][ig]||"").trim():""});
  }
  const newNames=plan.filter(x=>!x.id).map(x=>x.en.toLowerCase());
  if(new Set(newNames).size!==newNames.length)throw Error("CSV contains duplicate new vegetables.");
  let added=0,updated=0;
  for(const x of plan){
    const{error}=await db.rpc("inv_veg_admin_save_item",{p_admin_token:token(),p_item_id:x.id,p_name_en:x.en,p_name_hi:x.hi,p_name_gu:x.gu});
    if(error)throw error;
    x.id?updated++:added++;
  }
  await loadItems();alertBox("Imported "+(added+updated)+" rows · "+added+" added · "+updated+" updated.","success");
}
async function loadReport(){
  const{data,error}=await db.rpc("inv_veg_admin_report",{p_admin_token:token(),p_from:$("reportFrom").value||null,p_to:$("reportTo").value||null,p_item_id:$("reportItem").value||null,p_grade:$("reportGrade").value||null});
  if(error)throw error;
  S.report=data||[];
  const sessions=[...new Map(S.report.map(x=>[x.session_id,x.count_date]).filter(x=>x[0])).entries()];
  $("reportSession").innerHTML='<option value="">All sessions</option>'+sessions.map(x=>'<option value="'+x[0]+'">'+esc(x[1])+" · "+esc(String(x[0]).slice(0,8))+"</option>").join("");
  applyReportFilter();setKpis();
}
function applyReportFilter(){
  const sid=$("reportSession").value;
  S.filtered=sid?S.report.filter(x=>x.session_id===sid):S.report;
  $("vegReportBody").innerHTML=S.filtered.map(x=>'<tr><td>'+esc(x.count_date)+'</td><td>'+esc(x.item_name)+'</td><td><b>'+esc(x.grade)+'</b></td><td>'+Number(x.weight_kg).toFixed(3)+'</td><td>'+esc(x.counted_by)+'</td><td>'+esc(new Date(x.counted_at).toLocaleString("en-IN"))+'</td><td>'+esc(x.reason||"—")+'</td></tr>').join("")||'<tr><td colspan="7" class="vegEmptyCell">No count entries for the selected filters.</td></tr>';
}
function exportReport(){
  const rows=[["Date","Item (English)","Grade","Weight (kg)","Counted By","Timestamp","Reason"],...S.filtered.map(x=>[x.count_date,x.item_name,x.grade,x.weight_kg,x.counted_by,new Date(x.counted_at).toLocaleString("en-IN"),x.reason||""])];
  download("vegetable-count-report.csv",rows.map(r=>r.map(csvEscape).join(",")).join("\n"));
}
function wire(){
  $("addVegBtn").onclick=()=>openEdit();
  $("refreshVegItems").onclick=()=>loadItems().catch(e=>alertBox("Could not load vegetable master: "+errorText(e),"error"));
  $("vegEditForm").onsubmit=saveItem;
  $("vegAdminSearch").oninput=renderItems;
  $("vegAdminFilter").onchange=renderItems;
  $("downloadVegCsv").onclick=exportItems;
  $("importVegCsv").onclick=()=>$("vegCsvFile").click();
  $("vegCsvFile").onchange=e=>{const f=e.target.files?.[0];e.target.value="";if(f)importItems(f).catch(x=>alertBox("CSV import failed: "+errorText(x),"error"))};
  $("refreshReport").onclick=()=>loadReport().catch(e=>alertBox("Could not load count report: "+errorText(e),"error"));
  $("exportReport").onclick=exportReport;
  $("reportSession").onchange=applyReportFilter;
  ["reportFrom","reportTo","reportItem","reportGrade"].forEach(id=>$(id).onchange=()=>loadReport().catch(e=>alertBox("Could not load count report: "+errorText(e),"error")));
}
async function loadAfterAuth(){
  const results=await Promise.allSettled([loadItems(),loadReport()]);
  const failures=results.filter(x=>x.status==="rejected");
  if(failures.length)alertBox(failures.map(x=>errorText(x.reason)).join(" · "),"error");
  if(!S.items.length&&!failures.length)renderItems();
}
function init(){
  wire();
  if(window.PA_ADMIN_SESSION)void loadAfterAuth();
  else window.addEventListener("pa-admin-authenticated",()=>void loadAfterAuth(),{once:true});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();