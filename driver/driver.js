const DRIVER_API=window.SUPABASE_CONFIG.url+"/functions/v1/driver-api";const DRIVER_KEY=window.SUPABASE_CONFIG.key;let SB=null;function getSB(){if(!SB){if(!window.supabase?.createClient)throw new Error("Supabase library failed to load.");SB=window.supabase.createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.key);}return SB;}const ds={loading:false,loadedOutlets:0,totalOutlets:0,busy:{},token:localStorage.getItem("pa_driver_session")||"",name:localStorage.getItem("pa_driver_name")||"",orderId:null,outlets:[],earned:0};const $=id=>document.getElementById(id);function loadingHtml(){const total=ds.totalOutlets||0,loaded=ds.loadedOutlets||0,pct=total?Math.min(100,Math.round(loaded/total*100)):0;return '<div class="driverLoadCard"><div class="driverLoadHead"><b>Loading outlets</b><span>'+loaded+' / '+total+' loaded</span></div><div class="driverLoadBar"><i style="width:'+pct+'%"></i></div><div class="driverLoadText">'+(total?pct+'% loaded — showing outlets as they arrive':'Connecting to live dashboard…')+'</div></div>';}function toast(message,type="info"){let t=$("driverToast");if(!t){t=document.createElement("div");t.id="driverToast";document.body.appendChild(t);}t.textContent=message;t.className="driverToast "+type;clearTimeout(window.__driverToastTimer);window.__driverToastTimer=setTimeout(()=>{t.className="driverToast";},2800);}function compressImage(file,maxBytes=2200000){return new Promise((resolve,reject)=>{if(file.size<=maxBytes)return resolve(file);const img=new Image(),reader=new FileReader();reader.onload=()=>{img.onload=()=>{const scale=Math.min(1,1600/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale)),c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d");ctx.drawImage(img,0,0,w,h);let q=.82;const done=()=>c.toBlob(b=>{if(!b)return reject(new Error("Could not process image"));if(b.size<=maxBytes||q<=.5)return resolve(new File([b],"capture.jpg",{type:"image/jpeg",lastModified:Date.now()}));q-=.08;done();},"image/jpeg",q);done();};img.onerror=()=>reject(new Error("Could not read image"));img.src=reader.result;};reader.onerror=()=>reject(new Error("Could not read image"));reader.readAsDataURL(file);});}function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}async function api(action,body={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(DRIVER_API,{method:"POST",headers:{"apikey":DRIVER_KEY,"Content-Type":"application/json","x-driver-session":ds.token},body:JSON.stringify({action,session_token:ds.token,...body}),signal:controller.signal});const d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw new Error(d.message||"Request failed");return d;}catch(e){if(e.name==="AbortError")throw new Error("Request timed out. Please check your internet connection and try again.");throw e;}finally{clearTimeout(timer);}}function rejectionHtml(o,d,items){
 const allowShort=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.short_rejection"):true;
 const allowDamage=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.damage_rejection"):true;
 const saved=Array.isArray(d.item_rejections)?d.item_rejections:[];
 const byItem=Object.fromEntries(saved.map(r=>[String(r.item_id),r]));
 const rows=items.map(i=>{
  const r=byItem[String(i.item_id)]||{},qty=Number(r.rejected_qty||0),packedQty=Number(i.packed_qty||0),rejectable=packedQty>0;
  const opts='<option value="">'+(rejectable?'Reason':'Not delivered')+'</option>'
    +(allowShort?'<option value="SHORT" '+(r.reason==="SHORT"?"selected":"")+'>Short</option>':"")
    +(allowDamage?'<option value="DAMAGE" '+(r.reason==="DAMAGE"?"selected":"")+'>Damage</option>':"");
  return '<div class="driverRejectionRow '+(!rejectable?'rejectionNotApplicable':'')+'" data-outlet-id="'+esc(o.outlet_id)+'" data-item-id="'+esc(i.item_id)+'"><div class="driverRejectionItem"><b>'+esc(i.product_name)+'</b><small>Packed: '+packedQty+' / '+Number(i.required_qty||0)+'</small></div><input class="rejectQty" type="number" min="0" max="'+packedQty+'" step="1" inputmode="numeric" placeholder="'+(rejectable?'Qty':'N/A')+'" value="'+(rejectable?(qty||""):"")+'" '+(d.rejections_confirmed||!rejectable?"disabled":"")+'><select class="rejectReason" '+(d.rejections_confirmed||!rejectable?"disabled":"")+'>'+opts+'</select>'+(qty>0 && rejectable && r.reason==="DAMAGE" && allowDamage?'<button type="button" class="photoBtn" data-item-id="'+esc(i.item_id)+'" data-outlet-id="'+esc(o.outlet_id)+'">Add damage photo</button>':"")+'</div>';
 }).join("");
 return '<div class="driverRejectionSection"><div class="driverRejectionHead"><div><b>Delivery check</b><small>'+(allowShort||allowDamage?'Enter rejection quantity only where applicable.':'No rejection types are enabled. Continue to the invoice step.')+'</small></div><span>'+(allowShort||allowDamage?'Required':'Not required')+'</span></div>'+(allowShort||allowDamage?'<div class="driverRejectionRows">'+rows+'</div>':"")+(d.rejections_confirmed?'<div class="driverRejectionSaved">✓ Rejection check confirmed</div>':'<button type="button" class="primary saveRejectionsBtn" data-id="'+esc(o.outlet_id)+'">Continue</button>')+'</div>';
}
let pendingInvoiceUpload={outletId:"",invoiceNumber:""};
let ledgerCache=null;
async function loadLedger(){
 const d=await api("payment_ledger"); if(!d?.ok)throw new Error(d?.message||"Could not load payment ledger");
 ledgerCache=d;
 const s=$("driverLedgerSummary");
 s.innerHTML='<div><small>Total earned</small><b>₹'+Number(d.earned||0).toFixed(2)+'</b></div><div><small>Paid</small><b>₹'+Number(d.paid||0).toFixed(2)+'</b></div><div class="balance"><small>Remaining</small><b>₹'+Number(d.balance||0).toFixed(2)+'</b></div>';
 const rows=d.payments||[];
 $("driverLedgerRows").innerHTML=rows.length?rows.map(p=>'<div class="driverLedgerRow"><div><b>₹'+Number(p.amount||0).toFixed(2)+'</b><small>'+new Date(p.paid_at).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})+(p.note?" · "+esc(p.note):"")+'</small></div><div class="driverLedgerActions">'+(p.confirmed_at?'<span class="ledgerConfirmed">✓ Confirmed by you<br><small>'+new Date(p.confirmed_at).toLocaleString("en-IN")+'</small></span>':'<button class="primary confirmPaymentBtn" data-payment-id="'+esc(p.id)+'">Confirm received</button>')+(p.screenshot_path?'<button class="secondary ledgerPhotoBtn" data-path="'+esc(p.screenshot_path)+'">Payment proof</button>':'<span class="ledgerNoProof">No proof</span>')+'</div></div>').join(""):'<div class="hint">No payments recorded yet.</div>';
 $("driverLedgerRows").querySelectorAll(".ledgerPhotoBtn").forEach(b=>b.onclick=async()=>{try{const x=await api("payment_screenshot_url",{path:b.dataset.path});window.open(x.url,"_blank","noopener")}catch(e){toast(e.message,"error")}});
 $("driverLedgerRows").querySelectorAll(".confirmPaymentBtn").forEach(b=>b.onclick=()=>confirmPayment(b.dataset.paymentId));
}
function openDriverMenu(){ $("driverMenuName").textContent=(ds.name||"Driver")+" · Earnings & Ledger"; $("driverMenuDialog").showModal(); loadLedger().catch(e=>{$("driverLedgerRows").innerHTML='<div class="hint">Could not load ledger: '+esc(e.message)+'</div>';});}
async function savePaymentPassword(){
 const a=$("driverPaymentPassword").value,b=$("driverPaymentPasswordConfirm").value,msg=$("driverPasswordMsg"),btn=$("saveDriverPassword");
 msg.textContent="";
 if(a.length<8)return msg.textContent="Password must be at least 8 characters.";
 if(a!==b)return msg.textContent="Passwords do not match.";
 btn.disabled=true;btn.textContent="Saving…";
 try{await api("set_payment_password",{password:a});msg.textContent="Password saved. Only you can use it to confirm payments.";setTimeout(()=>$("driverPasswordDialog").close(),700);}
 catch(e){msg.textContent=e.message||"Could not save password.";}
 finally{btn.disabled=false;btn.textContent="Save Password";}
}
async function confirmPayment(paymentId){
 const d=ledgerCache;
 if(!d?.payment_password_set){
   $("driverPasswordMsg").textContent="Set your payment confirmation password first.";
   $("driverPasswordDialog").showModal();
   return;
 }
 const password=await requestPaymentConfirmationPassword();
 if(!password)return;
 try{
   toast("Confirming payment…","info");
   const x=await api("confirm_payment",{payment_id:paymentId,password});
   if(!x.ok)throw new Error(x.message||"Could not confirm payment.");
   toast("Payment confirmed by you.","success");
   await loadLedger();
 }catch(e){toast(e.message||"Payment confirmation failed.","error");}
}
function requestPaymentConfirmationPassword(){return new Promise(resolve=>{let dlg=$("driverConfirmPaymentDialog");if(!dlg){dlg=document.createElement("dialog");dlg.id="driverConfirmPaymentDialog";dlg.className="driverPasswordDialog";dlg.innerHTML='<form method="dialog" class="driverPasswordForm"><div class="driverPasswordHeader"><div class="driverSecurityIcon">🔐</div><div class="driverPasswordTitle"><span class="eyebrow">PAYMENT CONFIRMATION</span><h3>Confirm payment received</h3><p>Enter your private payment confirmation password.</p></div><button type="button" class="driverModalClose" aria-label="Close">×</button></div><label class="driverField">Password<input id="driverConfirmPaymentPassword" type="password" autocomplete="current-password" required></label><p class="hint">Your password is never shown to admin.</p><div class="driverPasswordActions"><button type="button" class="secondary cancelConfirmPayment">Cancel</button><button type="submit" class="primary">Confirm received</button></div></form>';document.body.appendChild(dlg);dlg.querySelector(".driverModalClose").onclick=()=>{dlg.close();resolve(null)};dlg.querySelector(".cancelConfirmPayment").onclick=()=>{dlg.close();resolve(null)};dlg.querySelector("form").onsubmit=e=>{e.preventDefault();const v=String(dlg.querySelector("#driverConfirmPaymentPassword").value||"");dlg.close();resolve(v)};}dlg.querySelector("#driverConfirmPaymentPassword").value="";dlg.showModal();setTimeout(()=>dlg.querySelector("#driverConfirmPaymentPassword").focus(),30);});}
function focusOutlet(outletId,scroll=true){const row=document.querySelector('.driverOutletRow[data-outlet-id="'+outletId+'"]');if(!row)return;row.open=true;if(scroll)setTimeout(()=>row.scrollIntoView({behavior:"smooth",block:"start"}),40);}
function postRejectionHtml(o,d,items){
 const photoRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.damage_photo_required"):true;
 const invoiceRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.invoice_photo_required"):true;
 const numberRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.invoice_number_required"):true;
 const rs=Array.isArray(d.item_rejections)?d.item_rejections.filter(r=>Number(r.rejected_qty||0)>0):[];
 const damage=rs.filter(r=>String(r.reason||"").toUpperCase()==="DAMAGE");
 const photos=Array.isArray(d.rejection_photos)?d.rejection_photos:[];
 if(photoRequired){
  const pending=damage.filter(r=>!photos.some(p=>String(p.item_id)===String(r.item_id)));
  if(pending.length){
   return '<div class="driverNextStep"><b>📷 Damage photo required</b><span>Upload one photo for each damaged item before continuing.</span>'+pending.map(r=>{const it=items.find(i=>String(i.item_id)===String(r.item_id));return '<button type="button" class="secondary photoBtn nextDamagePhoto" data-item-id="'+esc(r.item_id)+'" data-outlet-id="'+esc(o.outlet_id)+'">Upload photo • '+esc(it?.product_name||"Damaged item")+'</button>';}).join("")+'<small>'+pending.length+' damage photo'+(pending.length===1?"":"s")+' remaining</small></div>';
  }
 }
 if(!invoiceRequired&&!numberRequired)return '<div class="driverNextStep"><b>✓ Ready to deliver</b><span>No invoice evidence is required by current configuration.</span><button type="button" class="primary deliverNowBtn" data-id="'+esc(o.outlet_id)+'">Mark delivered</button></div>';
 const label=invoiceRequired?(numberRequired?"Enter invoice number & upload bill":"Upload bill"):"Enter invoice number";
 return '<div class="driverNextStep"><b>✓ Delivery check complete</b><span>Continue to the configured invoice step.</span><button type="button" class="primary nextInvoiceBtn" data-id="'+esc(o.outlet_id)+'">'+label+'</button></div>';
}
function applyDriverConfig(){
 const input=$("invoiceInput");
 const gallery=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.invoice_gallery_upload"):true;
 const numberRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.invoice_number_required"):true;
 const photoRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.invoice_photo_required"):true;
 if(input){if(gallery)input.removeAttribute("capture");else input.setAttribute("capture","environment");}
 $("invoiceNumber")?.toggleAttribute("required",numberRequired);
 document.querySelectorAll(".driverInvoiceRequiredHint").forEach(x=>x.textContent=numberRequired?"Required":"Optional");
 if(!numberRequired&&!photoRequired) document.querySelectorAll(".nextInvoiceBtn").forEach(b=>b.classList.add("hidden"));
}
window.addEventListener("pa-config-loaded",()=>{applyDriverConfig();render();});
function render(){$("driverLogin").classList.toggle("hidden",!!ds.token);$("driverHome").classList.toggle("hidden",!ds.token);$("driverLogout").classList.toggle("hidden",!ds.token);$("driverName").textContent=ds.name||"Driver";const busyCount=Object.keys(ds.busy).length;let processing=$("driverProcessing");if(ds.token&&!processing){processing=document.createElement("div");processing.id="driverProcessing";processing.className="driverProcessing hidden";$("driverHome").insertBefore(processing,$("driverEarnings"));}if(processing){processing.classList.toggle("hidden",!busyCount&&!ds.loading);processing.innerHTML=ds.loading?'<b>Refreshing your route…</b><span>Please wait — your current delivery status is being synced.</span>':busyCount?'<b>Processing…</b><span>Your action is being saved securely. Keep this screen open.</span>':"";}if($("driverRefresh")){$("driverRefresh").disabled=!!ds.loading;$("driverRefresh").textContent=ds.loading?"Refreshing…":"↻ Refresh";}const earned=Number(ds.earned||0);$("driverEarnings").innerHTML='<div class="driverEarnCard"><div><span class="eyebrow">DELIVERY EARNINGS</span><h3>₹'+earned.toFixed(2)+'</h3><p>Earned from completed deliveries</p></div><div class="earnIcon">₹</div></div>';const box=$("driverOutletCards");const sessionEnded=!!ds.session?.session_ended;const rows=ds.outlets.map(o=>{const d=o.delivery||{},busy=!!ds.busy[o.outlet_id],delivered=d.status==="delivered",packed=o.status==="completed";const items=o.items||[],exceptions=items.filter(i=>i.status==="MISSING"||i.status==="PARTIAL"),rejectionPhotos=Array.isArray(d.rejection_photos)?d.rejection_photos:[],required=items.reduce((s,i)=>s+Number(i.required_qty||0),0),missing=items.reduce((s,i)=>s+Number(i.missing_qty||0),0),invoiceRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.invoice_photo_required"):true,invoiceNumberRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.invoice_number_required"):true,rejectionRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.rejection_confirmation"):true,damagePhotoRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.damage_photo_required"):true,damageRows=(Array.isArray(d.item_rejections)?d.item_rejections:[]).filter(r=>Number(r.rejected_qty||0)>0&&String(r.reason||"").toUpperCase()==="DAMAGE"),damagePending=damagePhotoRequired&&damageRows.some(r=>!rejectionPhotos.some(p=>String(p.item_id)===String(r.item_id))),deliveryReady=(!invoiceRequired||!!d.invoice_path)&&(!invoiceNumberRequired||/^\d+$/.test(String(d.invoice_number||"")))&&(!rejectionRequired||!!d.rejections_confirmed)&&!damagePending,mapUrl="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(o.outlet_name+" Ahmedabad Gujarat");const itemRows=items.map(i=>{const exception=i.status==="MISSING"||i.status==="PARTIAL";const damageBtn=((d.item_rejections||[]).some(r=>String(r.item_id)===String(i.item_id)&&String(r.reason||"").toUpperCase()==="DAMAGE"&&Number(r.rejected_qty||0)>0)?'<button class="photoBtn" data-item-id="'+esc(i.item_id||"")+'" data-outlet-id="'+esc(o.outlet_id)+'">Add damage photo</button>':"");const packBtn=!sessionEnded&&exception&&Number(i.missing_qty||0)>0?'<button type="button" class="markExceptionPackedBtn" data-item-id="'+esc(i.item_id||"")+'" data-outlet-id="'+esc(o.outlet_id)+'">Mark packed</button>':"";return '<tr><td><b>'+esc(i.product_name)+'</b><small>'+esc(i.item_code||"")+'</small></td><td>'+Number(i.required_qty||0)+'</td><td>'+Number(i.packed_qty||0)+'</td><td>'+Number(i.missing_qty||0)+'</td><td><span class="itemStatus '+String(i.status||"PENDING").toLowerCase()+'">'+esc(i.status||"PENDING")+'</span>'+(i.reason?'<small>'+esc(i.reason)+'</small>':"")+damageBtn+packBtn+'</td></tr>';}).join("");return '<details class="driverOutletRow '+(delivered?"deliveredRow":"")+'" data-outlet-id="'+esc(o.outlet_id)+'"><summary class="driverOutletSummary"><div class="driverOutletSummaryMain"><strong>'+esc(o.outlet_name)+'</strong><span class="miniStatus '+(delivered?"completed":packed?"packed":"pending")+'">'+(delivered?"DELIVERED":packed?"READY FOR DELIVERY":"WAITING FOR PACKING")+'</span></div></summary><div class="driverOutletCard"><div class="driverOutletStats"><span><b>'+items.length+'</b> Items</span><span><b>'+required+'</b> Required</span><span><b>'+missing+'</b> Missing</span><span><b>₹'+Number(d.earned||0).toFixed(0)+'</b> Earned</span></div><div class="driverDeliveryMeta"><span>Invoice: '+(d.invoice_path?"Uploaded":"Not uploaded")+'</span><span>'+(d.delivered_at?new Date(d.delivered_at).toLocaleString("en-IN"):"")+'</span></div><div class="driverRejectionMount">'+((window.PA_CONFIG_ENABLED&&window.PA_CONFIG_ENABLED("driver.rejection_confirmation")===false)?postRejectionHtml(o,d,items):(d.rejections_confirmed?postRejectionHtml(o,d,items):rejectionHtml(o,d,items)))+'</div>'+'<div class="driverExceptionBox">'+(exceptions.length?'<b>⚠ Missing / Partial items</b><div class="exceptionList">'+exceptions.map(i=>'<div><span>'+esc(i.product_name)+'</span><strong>'+Number(i.missing_qty||0)+' missing</strong></div>').join("")+'</div>':'<span class="noException">✓ No missing / partial items</span>')+'</div><div class="driverPhotoMeta">Rejected-item photos: <b>'+rejectionPhotos.length+'</b></div><div class="driverActions"><a class="secondary mapBtn" target="_blank" rel="noopener" href="'+mapUrl+'">Open in Maps</a>'+(packed&&!delivered&&!sessionEnded?'<button class="primary deliverBtn" data-id="'+o.outlet_id+'" '+(!deliveryReady?"disabled":"")+'>Mark delivered</button>':packed&&!delivered&&sessionEnded?'<span class="deliveredNote">Session ended · Admin approval required</span>':delivered?'<span class="deliveredNote">Delivery completed • ₹'+Number(d.earned||0).toFixed(2)+'</span>':"")+'</div><details class="driverItems"><summary>Item-wise packing'+(exceptions.length?' • '+exceptions.length+' Missing/Partial':"")+'</summary><div class="tableWrap"><table><thead><tr><th>Item</th><th>Req.</th><th>Packed</th><th>Missing</th><th>Status</th></tr></thead><tbody>'+itemRows+'</tbody></table></div></details></div></details>';}).join("");box.innerHTML=(sessionEnded?'<div class="driverSessionEnded"><b>Delivery session ended</b><span>This session closed at 12:00 PM. Remaining outlets require Admin approval.</span></div>':"")+(ds.loading?loadingHtml():"")+(rows||(ds.loading?"":"<div class=\"hint\">No outlets assigned in the current order.</div>"));box.querySelectorAll(".saveRejectionsBtn").forEach(b=>b.onclick=()=>saveRejections(b.dataset.id));box.querySelectorAll(".invoiceBtn,.nextInvoiceBtn").forEach(b=>{b.onclick=()=>chooseInvoice(b.dataset.id);if(ds.busy[b.dataset.id])b.disabled=true;});box.querySelectorAll(".photoBtn").forEach(b=>b.onclick=()=>chooseRejectedPhoto(b.dataset.outletId,b.dataset.itemId));box.querySelectorAll(".markExceptionPackedBtn").forEach(b=>b.onclick=()=>markExceptionPacked(b.dataset.outletId,b.dataset.itemId));box.querySelectorAll(".deliverBtn,.deliverNowBtn").forEach(b=>{b.onclick=()=>markDelivered(b.dataset.id);if(ds.busy[b.dataset.id])b.disabled=true;});}if(typeof window.PA_DRIVER_RENDER_HOOK==="function")window.PA_DRIVER_RENDER_HOOK();async function refresh(){
 if(!ds.token)return;
 ds.loading=true;ds.loadedOutlets=0;ds.totalOutlets=0;ds.outlets=[];render();
 const loadPage=async offset=>{
  const d=await api("dashboard_page",{offset,limit:4});
  if(!d||d.ok===false)throw new Error(d?.message||"Dashboard failed");
  return d;
 };
 try{
  const first=await loadPage(0);
  ds.name=first.driver_name||ds.name;
  ds.orderId=first.order_id;
  ds.earned=Number(first.earned||0);
  ds.totalOutlets=Number(first.total_outlets||0);
  ds.outlets=first.outlets||[];
  ds.loadedOutlets=ds.outlets.length;
  localStorage.setItem("pa_driver_name",ds.name);
  render();
  const offsets=[];
  for(let offset=4;offset<ds.totalOutlets;offset+=4)offsets.push(offset);
  await Promise.all(offsets.map(async offset=>{
   const data=await loadPage(offset);
   ds.outlets.push(...(data.outlets||[]));
   ds.outlets.sort((a,b)=>(Number(a.outlet_rank)||999999)-(Number(b.outlet_rank)||999999));
   ds.loadedOutlets=ds.outlets.length;
   render();
  }));
  ds.loadedOutlets=ds.outlets.length;ds.loading=false;render();
 }catch(e){
  ds.loading=false;render();
  console.error("Driver dashboard:",e);
  if(/session expired/i.test(e.message)){logout();return;}
  $("driverLoginMsg").textContent="Dashboard load failed: "+e.message;
  toast("Could not load your route: "+e.message,"error");
 }
}async function login(){const name=$("driverLoginName").value.trim(),pin=$("driverPin").value.trim();if(!name||!pin)return;const btn=$("driverLoginBtn"),msg=$("driverLoginMsg");btn.disabled=true;btn.textContent="Signing in…";msg.textContent="Checking credentials…";try{const d=await api("login",{login_name:name,pin:pin});if(!d||d.ok===false||!d.token)throw new Error(d?.message||"Invalid driver ID or PIN");ds.token=d.token;ds.name=d.driver_name||name;localStorage.setItem("pa_driver_session",ds.token);localStorage.setItem("pa_driver_name",ds.name);msg.textContent="Login successful.";render();await refresh();}catch(e){ds.token="";ds.name="";localStorage.removeItem("pa_driver_session");localStorage.removeItem("pa_driver_name");render();msg.textContent=e.message||"Login failed";}finally{btn.disabled=false;btn.textContent="Login";}}function logout(){ds.token="";ds.name="";ds.orderId=null;ds.outlets=[];ds.earned=0;localStorage.removeItem("pa_driver_session");localStorage.removeItem("pa_driver_name");render();}async function runInvoiceOcr(file,outletId,invoiceNumber){
  try{
    if(!window.Tesseract?.recognize)return {status:"ocr_unavailable"};
    const outlet=ds.outlets.find(o=>String(o.outlet_id)===String(outletId));
    const result=await Tesseract.recognize(file,"eng",{logger:()=>{},tessedit_pageseg_mode:"6"});
    const text=String(result?.data?.text||"");
    const expected=String(invoiceNumber||"").replace(/\D/g,"");
    const numberCandidates=[...text.matchAll(/\d[\d\s\-_/]{1,}\d|\d{3,}/g)].map(m=>m[0].replace(/\D/g,"")).filter(x=>x.length>=3);
    const numberOk=!!expected&&numberCandidates.includes(expected);
    const confidence=Math.round(Number(result?.data?.confidence||0));
    const d=await api("invoice_ocr_result",{order_id:ds.orderId,outlet_id:outletId,outlet_name:String(outlet?.outlet_name||""),invoice_number:invoiceNumber,status:numberOk?"verified":"mismatch",result_text:text.slice(0,4000),confidence,ocr_invoice_candidates:numberCandidates,invoice_match:numberOk});
    const status=String(d?.ocr_status||"flagged");
    const current=ds.outlets.find(o=>String(o.outlet_id)===String(outletId));
    if(current){current.delivery=current.delivery||{};current.delivery.ocr_status=status;current.delivery.ocr_result={invoice_match:numberOk,confidence};}
    return {status,confidence,numberOk,invoice_match:d?.invoice_match===true,outlet_match:d?.outlet_match===true,result_text:String(d?.result_text||text).slice(0,4000),invoice_candidates:Array.isArray(d?.invoice_candidates)?d.invoice_candidates:numberCandidates};
  }catch(e){
    console.warn("Invoice OCR:",e);
    return {status:"ocr_error",error:e?.message||String(e)};
  }
}
let damageCameraStream=null,damageCaptureBusy=false,pendingDamagePhoto={outletId:"",itemId:""};

function stopDamageCamera(){
 if(damageCameraStream){
  damageCameraStream.getTracks().forEach(t=>{try{t.stop();}catch(_){}});
  damageCameraStream=null;
 }
 damageCaptureBusy=false;
}
function closeDamageCamera(){
 stopDamageCamera();
 $("damageCamera")?.pause?.();
 const modal=$("damageCameraModal");
 if(modal){modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");}
 pendingDamagePhoto={outletId:"",itemId:""};
}
function fallbackToNativeDamageCamera(outletId,itemId,error){
 closeDamageCamera();
 const input=$("damagePhotoInput");
 if(!input){
  toast("Camera is unavailable and the photo picker could not be opened. Please refresh the app.","error");
  return;
 }
 input.value="";
 input.accept="image/*";
 input.setAttribute("capture","environment");
 input.dataset.outletId=String(outletId);
 input.dataset.itemId=String(itemId);
 input.dataset.cameraFallback="1";
 toast(error?.name==="NotAllowedError"?"Opening the phone camera…":"Using the phone camera instead…","info");
 try{input.click();}catch(e){toast("Could not open the phone camera. Please use Choose photo and try again.","error");}
}
async function uploadDamagePhoto(file,outletId,itemId){
 if(!file||!outletId||!itemId)return false;
 if(!file.type.startsWith("image/")){toast("Please select an image.","error");return false;}
 if(file.size>15*1024*1024){toast("Image must be under 15 MB.","error");return false;}
 const key=String(outletId);
 if(ds.busy[key])return false;
 ds.busy[key]=true;render();
 try{
  const liveOutlet=ds.outlets.find(o=>String(o.outlet_id)===key);
  if(!liveOutlet)throw new Error("Outlet is no longer assigned to this driver. Refresh and try again.");
  const prepared=await compressImage(file);
  const d=await api("rejection_photo_url",{order_id:ds.orderId,outlet_id:outletId,item_id:itemId,filename:prepared.name,mime_type:prepared.type,extension:"jpg"});
  if(!d?.path||!d?.token)throw new Error("Could not prepare the damage-photo upload.");
  let uploadError=null;
  for(let attempt=1;attempt<=3;attempt++){
   const result=await getSB().storage.from("delivery-evidence").uploadToSignedUrl(d.path,d.token,prepared,{contentType:prepared.type});
   if(!result.error){uploadError=null;break;}
   uploadError=result.error;
   if(attempt<3)await new Promise(r=>setTimeout(r,700*attempt));
  }
  if(uploadError)throw uploadError;
  const saved=await api("save_rejection_photo",{order_id:ds.orderId,outlet_id:outletId,item_id:itemId,path:d.path,filename:prepared.name,mime_type:prepared.type});
  if(!saved?.ok)throw new Error(saved?.message||"Damage photo was uploaded but could not be recorded.");
  toast("✓ Damage photo saved.","success");
  await refresh();
  const confirmed=ds.outlets.find(o=>String(o.outlet_id)===key);
  const confirmedPhotos=Array.isArray(confirmed?.delivery?.rejection_photos)?confirmed.delivery.rejection_photos:[];
  if(!confirmedPhotos.some(p=>String(p?.item_id)===String(itemId))){
   throw new Error("Photo upload completed, but the saved evidence was not confirmed. Please refresh and retry.");
  }
  return true;
 }catch(err){
  console.error("Damage photo upload",err);
  toast("Damage photo upload failed: "+(err?.message||"Please try again."),"error");
  return false;
 }finally{
  delete ds.busy[key];render();focusOutlet(outletId,true);
 }
}
async function captureDamageFrame(){
 if(damageCaptureBusy)return;
 const video=$("damageCamera"),canvas=document.createElement("canvas");
 const w=video?.videoWidth||0,h=video?.videoHeight||0;
 if(!w||!h)return toast("Camera is not ready. Hold steady and try again.","error");
 damageCaptureBusy=true;
 try{
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d",{alpha:false});
  if(!ctx)throw new Error("Camera capture is unavailable.");
  ctx.drawImage(video,0,0,w,h);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.92));
  if(!blob)throw new Error("Could not capture the damage photo.");
  const file=new File([blob],"damage-"+Date.now()+".jpg",{type:"image/jpeg",lastModified:Date.now()});
  const {outletId,itemId}=pendingDamagePhoto;
  closeDamageCamera();
  if(!outletId||!itemId)throw new Error("Damage photo target was lost. Please reopen the item.");
  await uploadDamagePhoto(file,outletId,itemId);
 }catch(e){
  console.error("Damage camera capture",e);
  toast(e?.message||"Could not capture the damage photo.","error");
  damageCaptureBusy=false;
 }
}
async function openDamageCamera(outletId,itemId){
 pendingDamagePhoto={outletId:String(outletId),itemId:String(itemId)};
 const modal=$("damageCameraModal"),video=$("damageCamera");
 if(!modal||!video)return fallbackToNativeDamageCamera(outletId,itemId,new Error("Damage camera UI unavailable"));
 modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");
 const status=$("damageCameraStatus"),capture=$("damageCaptureBtn");
 if(status)status.textContent="Starting camera…";
 if(capture){capture.disabled=true;capture.textContent="Starting camera…";}
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error("Camera API unavailable");
  damageCameraStream=await navigator.mediaDevices.getUserMedia({
   video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},
   audio:false
  });
  video.srcObject=damageCameraStream;
  await video.play();
  if(status)status.textContent="✓ Camera ready. Frame the damaged item clearly.";
  if(capture){capture.disabled=false;capture.textContent="Capture damage photo";}
 }catch(e){
  console.warn("Damage camera unavailable:",e);
  fallbackToNativeDamageCamera(outletId,itemId,e);
 }
}
async function chooseRejectedPhoto(outletId,itemId){
 const input=$("damagePhotoInput");
 if(!input)return toast("Damage photo input is unavailable. Please refresh the app.","error");
 try{
  await openDamageCamera(outletId,itemId);
 }catch(e){
  console.error("Damage photo camera launch",e);
  fallbackToNativeDamageCamera(outletId,itemId,e);
 }
}
async function chooseInvoice(outletId){
 const outlet=ds.outlets.find(o=>String(o.outlet_id)===String(outletId)); if(!outlet)return;
 const numberRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.invoice_number_required"):true;
 const photoRequired=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.invoice_photo_required"):true;
 if(!numberRequired){
   if(photoRequired){
     $("invoiceInput").value="";$("invoiceInput").dataset.outletId=outletId;$("invoiceInput").dataset.mode="invoice";$("invoiceInput").dataset.itemId="";$("invoiceInput").dataset.invoiceNumber="";$("invoiceInput").click();
   }else{
     await markDelivered(outletId);
   }
   return;
 }
 $("invoiceNumber").value="";$("invoiceNumber").dataset.outletId=outletId;
 $("invoiceNumberLabel").textContent=(outlet.outlet_name||"Outlet")+" · Invoice number";
 $("invoiceDialog").showModal();$("invoiceNumber").focus();
}
async function saveInvoiceNumberOnly(outletId,invoiceNumber){
 const d=await api("invoice_number_only",{order_id:ds.orderId,outlet_id:outletId,invoice_number:invoiceNumber,idempotency_key:crypto.randomUUID()});
 if(!d?.ok)throw new Error(d?.message||"Could not save invoice number");
 const o=ds.outlets.find(x=>String(x.outlet_id)===String(outletId));
 if(o){o.delivery=o.delivery||{};o.delivery.invoice_number=invoiceNumber;o.delivery.status="pending";}
 toast("Invoice number saved. Ready to deliver.","success");render();focusOutlet(outletId,true);
}
$("driverMenuBtn").onclick=openDriverMenu;
$("driverMenuClose").onclick=()=>$("driverMenuDialog").close();
$("invoiceCancelBtn").onclick=()=>$("invoiceDialog").close();$("invoiceCancelBtn2").onclick=()=>$("invoiceDialog").close();
$("invoiceNumberForm").addEventListener("submit",e=>{
 e.preventDefault();const outletId=String($("invoiceNumber").dataset.outletId||"").trim(),n=String($("invoiceNumber").value||"").trim();
 if(!outletId)return toast("Please reopen the invoice step.","error");
 if(!/^\d+$/.test(n))return toast("Enter the numeric invoice number.","error");
 $("invoiceDialog").close();openInvoiceScanner(outletId,n);
});
function resetPaymentPasswordForm(){
 $("driverPaymentPassword").value="";
 $("driverPaymentPasswordConfirm").value="";
 $("driverPasswordMsg").textContent="";
 $("driverPasswordMatch").textContent="";
 $("driverPasswordMatch").className="driverPasswordMatch";
 $("driverPasswordStrength").className="passwordStrength";
 $("driverPasswordStrength").querySelector("small").textContent="Use 8+ characters";
 document.querySelectorAll(".passwordToggle").forEach(b=>{
   const input=$(b.dataset.target);
   if(input)input.type="password";
   b.textContent="Show";
 });
}
function updatePasswordStrength(){
 const v=$("driverPaymentPassword").value||"",box=$("driverPasswordStrength"),label=box.querySelector("small");
 box.className="passwordStrength";
 if(!v){label.textContent="Use 8+ characters";return;}
 let score=0;
 if(v.length>=8)score++;
 if(v.length>=12)score++;
 if(/[A-Z]/.test(v)&&/[a-z]/.test(v))score++;
 if(/\d/.test(v))score++;
 if(/[^A-Za-z0-9]/.test(v))score++;
 if(score<=2){box.classList.add("weak");label.textContent="Weak — add length or more character types";}
 else if(score<=3){box.classList.add("medium");label.textContent="Good — a little stronger is better";}
 else{box.classList.add("strong");label.textContent="Strong password";}
}
function updatePasswordMatch(){
 const a=$("driverPaymentPassword").value,b=$("driverPaymentPasswordConfirm").value,msg=$("driverPasswordMatch");
 msg.className="driverPasswordMatch";
 if(!b){msg.textContent="";return;}
 if(a===b){msg.textContent="✓ Passwords match";msg.classList.add("ok");}
 else{msg.textContent="Passwords do not match";msg.classList.add("bad");}
}
$("driverPaymentPasswordBtn").onclick=()=>{resetPaymentPasswordForm();$("driverPasswordDialog").showModal();};
$("driverPasswordClose").onclick=()=>$("driverPasswordDialog").close();
$("driverPasswordCancel").onclick=()=>$("driverPasswordDialog").close();
$("driverPaymentPassword").addEventListener("input",()=>{updatePasswordStrength();updatePasswordMatch();});
$("driverPaymentPasswordConfirm").addEventListener("input",updatePasswordMatch);
document.querySelectorAll(".passwordToggle").forEach(b=>b.onclick=()=>{
 const input=$(b.dataset.target); if(!input)return;
 const show=input.type==="password";
 input.type=show?"text":"password";
 b.textContent=show?"Hide":"Show";
 b.setAttribute("aria-label",show?"Hide password":"Show password");
});
$("driverPasswordForm").addEventListener("submit",e=>{e.preventDefault();savePaymentPassword();});
let invoiceCameraStream=null,invoiceScanTimer=null,invoicePrevFrame=null,invoiceStableSince=0,invoiceScannerBusy=false;
async function processInvoiceFile(file,outletId,invoiceNumber){
 if(!file||!outletId)return;
 if(!/image\//.test(file.type))return toast("Please select an image.","error");
 if(file.size>15*1024*1024)return toast("Image must be under 15 MB.","error");
 const key=String(outletId);ds.busy[key]=true;render();
 try{
  const liveOutlet=ds.outlets.find(o=>String(o.outlet_id)===key);
  if(!liveOutlet)throw new Error("Outlet is no longer assigned to this driver. Refresh and try again.");
  const prepared=await compressImage(file);let ocr=null;
  toast("Checking invoice…","info");ocr=await runInvoiceOcr(prepared,outletId,invoiceNumber);
  const idempotencyKey=crypto.randomUUID();
  const d=await api("upload_url",{order_id:ds.orderId,outlet_id:outletId,outlet_name:(liveOutlet.outlet_name||""),filename:prepared.name,mime_type:prepared.type,extension:"jpg",invoice_number:invoiceNumber});
  let uploadError=null;
  for(let attempt=1;attempt<=3;attempt++){
   const {error}=await getSB().storage.from("delivery-invoices").uploadToSignedUrl(d.path,d.token,prepared,{contentType:prepared.type});
   if(!error){uploadError=null;break;}
   uploadError=error;if(attempt<3)await new Promise(r=>setTimeout(r,700*attempt));
  }
  if(uploadError)throw uploadError;
  toast("Finalizing delivery…","info");
  const transition=await api("invoice_uploaded",{order_id:ds.orderId,outlet_id:outletId,path:d.path,invoice_number:invoiceNumber,filename:(liveOutlet.outlet_name||"Outlet")+" - "+invoiceNumber+".jpg",mime_type:prepared.type,ocr_status:ocr?.status||"pending",ocr_result:ocr||null,idempotency_key:idempotencyKey});
  if(String(transition?.delivery_state||"")!=="DELIVERED")throw new Error("Invoice saved but delivery was not completed. Please refresh and retry.");
  const current=ds.outlets.find(o=>String(o.outlet_id)===String(outletId));
  const alreadyDelivered=current?.delivery?.status==="delivered";
  if(current){
    current.delivery=current.delivery||{};
    current.delivery.invoice_path=d.path;
    current.delivery.invoice_number=invoiceNumber;
    current.delivery.invoice_uploaded_at=new Date().toISOString();
    current.delivery.status="delivered";
    current.delivery.delivery_state="DELIVERED";
    current.delivery.delivered_at=transition.delivered_at||new Date().toISOString();
    current.delivery.earned=Number(current.delivery.delivery_charge||current.delivery.earned||0);
    current.delivery.ocr_status=ocr?.status||"pending";
    current.delivery.ocr_result=ocr||null;
  }
  if(!alreadyDelivered&&current)ds.earned=Number(ds.earned||0)+Number(current.delivery.earned||0);
  render();
  toast("✓ Delivery completed. Invoice uploaded successfully.","success");
  try{
   await refresh();
   const confirmed=ds.outlets.find(o=>String(o.outlet_id)===key);
   if(!confirmed?.delivery||confirmed.delivery.status!=="delivered")throw new Error("Delivery saved, but the refreshed route did not confirm it.");
  }catch(refreshError){
   console.warn("Delivery refresh verification:",refreshError);
   toast("✓ Delivery saved. Refreshing the route failed temporarily; use Refresh to sync.","success");
  }
 }catch(err){console.error("Invoice upload",{outletId,message:err?.message||String(err)});toast("Invoice upload failed: "+(err?.message||"Please try again."),"error");}
 finally{delete ds.busy[key];render();focusOutlet(outletId,true);}
}
function stopInvoiceCamera(){if(invoiceScanTimer){clearInterval(invoiceScanTimer);invoiceScanTimer=null;}if(invoiceCameraStream){invoiceCameraStream.getTracks().forEach(t=>t.stop());invoiceCameraStream=null;}invoicePrevFrame=null;invoiceStableSince=0;invoiceScannerBusy=false;}
function closeInvoiceScanner(){stopInvoiceCamera();$("invoiceScanner")?.classList.add("hidden");$("invoiceScanner")?.setAttribute("aria-hidden","true");}
async function captureInvoiceFrame(){
 if(invoiceScannerBusy)return;invoiceScannerBusy=true;
 const video=$("invoiceCamera"),canvas=document.createElement("canvas"),w=video.videoWidth,h=video.videoHeight;
 if(!w||!h){invoiceScannerBusy=false;return toast("Camera is not ready. Hold still and try again.","error");}
 canvas.width=w;canvas.height=h;canvas.getContext("2d",{alpha:false}).drawImage(video,0,0,w,h);
 const ctx=canvas.getContext("2d",{willReadFrequently:true}),img=ctx.getImageData(0,0,w,h).data;
 let sum=0,sq=0;for(let i=0;i<img.length;i+=16){const g=.299*img[i]+.587*img[i+1]+.114*img[i+2];sum+=g;sq+=g*g;}
 const n=Math.ceil(img.length/16),mean=sum/n,variance=Math.max(0,sq/n-mean*mean);
 if(variance<350){$("invoiceScanStatus").textContent="Image is too flat/dark. Improve lighting.";invoiceScannerBusy=false;return;}
 canvas.toBlob(async blob=>{if(!blob){invoiceScannerBusy=false;return toast("Could not capture invoice.","error");}
   const file=new File([blob],"invoice-capture.jpg",{type:"image/jpeg",lastModified:Date.now()});
   const outletId=pendingInvoiceUpload.outletId,invoiceNumber=pendingInvoiceUpload.invoiceNumber;
   $("invoiceScanStatus").textContent="✓ Photo captured. Uploading…";
   toast("✓ Photo captured. Uploading invoice…","success");
   closeInvoiceScanner();pendingInvoiceUpload={outletId:"",invoiceNumber:""};
   await processInvoiceFile(file,outletId,invoiceNumber);invoiceScannerBusy=false;
 },"image/jpeg",.92);
}
function fallbackToNativeInvoiceCamera(outletId,invoiceNumber,error){
 closeInvoiceScanner();
 const input=$("invoiceInput");
 if(!input){toast("Camera is unavailable and the photo picker could not be opened.","error");return;}
 input.value="";
 input.accept="image/*";
 input.setAttribute("capture","environment");
 input.dataset.outletId=String(outletId);
 input.dataset.mode="invoice";
 input.dataset.invoiceNumber=String(invoiceNumber||"");
 input.dataset.cameraFallback="1";
 toast(error?.name==="NotAllowedError"?"Opening the phone camera…":"Using the phone camera instead…","info");
 input.click();
}
async function openInvoiceScanner(outletId,invoiceNumber){
 pendingInvoiceUpload={outletId,invoiceNumber};const modal=$("invoiceScanner"),video=$("invoiceCamera");
 modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");$("invoiceScanStatus").textContent="Starting camera…";$("invoiceCaptureBtn").disabled=true;$("invoiceCaptureBtn").textContent="Hold steady…";
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error("Camera API unavailable");
  invoiceCameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false});
  video.srcObject=invoiceCameraStream;await video.play();
  const probe=document.createElement("canvas"),pc=probe.getContext("2d",{willReadFrequently:true});probe.width=96;probe.height=54;
  invoiceScanTimer=setInterval(()=>{if(video.readyState<2)return;pc.drawImage(video,0,0,96,54);const data=pc.getImageData(0,0,96,54).data;let diff=999;if(invoicePrevFrame){diff=0;for(let i=0;i<data.length;i+=16)diff+=Math.abs(data[i]-invoicePrevFrame[i]);diff/=data.length/16;}invoicePrevFrame=data;const motion=diff;if(motion<8){if(!invoiceStableSince)invoiceStableSince=Date.now();}else invoiceStableSince=0;const stable=invoiceStableSince&&Date.now()-invoiceStableSince>900;if(stable){$("invoiceScanStatus").textContent="✓ Steady — capturing…";$("invoiceCaptureBtn").disabled=false;$("invoiceCaptureBtn").textContent="Capture invoice";if(!invoiceScannerBusy)captureInvoiceFrame();}else{$("invoiceScanStatus").textContent="Keep the entire bill inside the frame and hold steady";$("invoiceCaptureBtn").disabled=true;$("invoiceCaptureBtn").textContent="Hold steady…";}},150);
 }catch(e){fallbackToNativeInvoiceCamera(outletId,invoiceNumber,e);}
}
$("invoiceScannerClose").onclick=()=>{pendingInvoiceUpload={outletId:"",invoiceNumber:""};closeInvoiceScanner();};
$("damageCameraClose").onclick=()=>closeDamageCamera();
$("damageCaptureBtn").onclick=captureDamageFrame;
$("damageGalleryBtn").onclick=()=>{const outletId=pendingDamagePhoto.outletId,itemId=pendingDamagePhoto.itemId;closeDamageCamera();const input=$("damagePhotoInput");if(!input)return toast("Photo picker unavailable.","error");input.value="";input.removeAttribute("capture");input.dataset.outletId=outletId;input.dataset.itemId=itemId;input.click();};

$("invoiceCaptureBtn").onclick=captureInvoiceFrame;
$("invoiceGalleryBtn").onclick=()=>{const outletId=pendingInvoiceUpload.outletId,invoiceNumber=pendingInvoiceUpload.invoiceNumber;closeInvoiceScanner();$("invoiceInput").value="";$("invoiceInput").dataset.outletId=outletId;$("invoiceInput").dataset.mode="invoice";$("invoiceInput").dataset.invoiceNumber=invoiceNumber;$("invoiceInput").click();};
$("invoiceInput").onchange=async e=>{const input=e.target,file=input.files[0],outletId=input.dataset.outletId,mode=input.dataset.mode||"invoice",invoiceNumber=mode==="invoice"?String(pendingInvoiceUpload.invoiceNumber||input.dataset.invoiceNumber||"").trim():String(input.dataset.invoiceNumber||"").trim();input.value="";if(!file||!outletId)return;if(mode==="invoice"){pendingInvoiceUpload={outletId:"",invoiceNumber:""};input.removeAttribute("capture");applyDriverConfig();return processInvoiceFile(file,outletId,invoiceNumber);}};
 $("damagePhotoInput").onchange=async e=>{const input=e.target,file=input.files?.[0],outletId=input.dataset.outletId,itemId=input.dataset.itemId;input.value="";input.removeAttribute("capture");input.dataset.cameraFallback="";if(!file||!outletId||!itemId)return;await uploadDamagePhoto(file,outletId,itemId);};async function saveRejections(outletId){
 const outlet=ds.outlets.find(o=>String(o.outlet_id)===String(outletId)); if(!outlet)return;
 const rows=[...document.querySelectorAll('.driverRejectionRow[data-outlet-id="'+outletId+'"]')];
 const rejections=rows.map(row=>({item_id:row.dataset.itemId,qty:Number(row.querySelector(".rejectQty")?.value||0),reason:row.querySelector(".rejectReason")?.value||""})).filter(x=>x.qty>0||x.reason).filter(x=>{const item=outlet.items.find(i=>String(i.item_id)===String(x.item_id));return item&&Number(item.packed_qty||0)>0;});
 const allowShort=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.short_rejection"):true;
 const allowDamage=window.PA_CONFIG_ENABLED?window.PA_CONFIG_ENABLED("driver.damage_rejection"):true;
 if(rejections.some(x=>x.qty<=0||![ "SHORT","DAMAGE" ].includes(x.reason)))return toast("For every rejected item, enter quantity and choose Short or Damage.","error");
 if(rejections.some(x=>x.reason==="SHORT"&&!allowShort))return toast("Short rejection is disabled by admin configuration.","error");
 if(rejections.some(x=>x.reason==="DAMAGE"&&!allowDamage))return toast("Damage rejection is disabled by admin configuration.","error");
 const invalid=rejections.find(x=>{const item=outlet.items.find(i=>String(i.item_id)===String(x.item_id));return !item||x.qty>Number(item.packed_qty||0);});
 if(invalid)return toast("Rejected quantity cannot exceed packed quantity.","error");
 try{
  const key=String(outletId);if(ds.busy[key])return;ds.busy[key]=true;render();
  const b=document.querySelector('.saveRejectionsBtn[data-id="'+outletId+'"]');if(b){b.disabled=true;b.textContent="Saving…";}
  toast("Saving delivery check…","info");const d=await api("save_item_rejections",{order_id:ds.orderId,outlet_id:outletId,rejections,idempotency_key:crypto.randomUUID()});if(!d?.ok)throw new Error(d?.message||"Could not save rejection check");
  outlet.delivery=outlet.delivery||{};outlet.delivery.rejections_confirmed=true;outlet.delivery.item_rejections=d.rejections||rejections;
  toast(rejections.some(x=>x.reason==="DAMAGE")?"Upload damage photo(s) before invoice.":"Rejection check complete. Upload invoice now.","success");render();focusOutlet(outletId,true);
 }catch(e){toast("Could not save: "+e.message,"error");render();}finally{delete ds.busy[String(outletId)];render();}
}
async function markExceptionPacked(outletId,itemId){const key="pack:"+String(itemId);if(ds.busy[key])return;ds.busy[key]=true;render();try{toast("Marking item packed…","info");await api("mark_item_packed",{order_id:ds.orderId,outlet_id:outletId,item_id:itemId,idempotency_key:crypto.randomUUID()});toast("Item marked as packed. It will no longer appear as missing.","success");await refresh();}catch(e){if(/session expired/i.test(e.message)){logout();return;}toast("Could not mark item packed: "+e.message,"error");}finally{delete ds.busy[key];render();}}
async function markDelivered(outletId){const key=String(outletId);if(ds.busy[key])return;ds.busy[key]=true;render();try{const outlet=ds.outlets.find(o=>String(o.outlet_id)===key);toast("Completing delivery…","info");await api("mark_delivered",{order_id:ds.orderId,outlet_id:outletId,outlet_name:outlet?.outlet_name||"",idempotency_key:crypto.randomUUID()});toast("Delivery completed.","success");await refresh();}catch(e){if(/session expired/i.test(e.message)){logout();return;}toast("Delivery failed: "+e.message,"error");}finally{delete ds.busy[key];render();}}$("driverMenuBtn").onclick=openDriverMenu;$("driverMenuClose").onclick=()=>$("driverMenuDialog").close();$("driverLoginBtn").onclick=login;$("driverPin").onkeydown=e=>{if(e.key==="Enter")login()};$("driverLogout").onclick=logout;$("driverRefresh").onclick=refresh;applyDriverConfig();if(ds.token){ds.loading=true;ds.totalOutlets=0;ds.loadedOutlets=0;render();refresh();}else render();