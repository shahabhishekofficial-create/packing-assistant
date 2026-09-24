const DRIVER_API=window.SUPABASE_CONFIG.url+"/functions/v1/driver-api";const DRIVER_KEY=window.SUPABASE_CONFIG.key;let SB=null;function getSB(){if(!SB){if(!window.supabase?.createClient)throw new Error("Supabase library failed to load.");SB=window.supabase.createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.key);}return SB;}const ds={loading:false,loadedOutlets:0,totalOutlets:0,busy:{},token:localStorage.getItem("pa_driver_session")||"",name:localStorage.getItem("pa_driver_name")||"",orderId:null,outlets:[],earned:0};const $=id=>document.getElementById(id);function loadingHtml(){const total=ds.totalOutlets||0,loaded=ds.loadedOutlets||0,pct=total?Math.min(100,Math.round(loaded/total*100)):0;return '<div class="driverLoadCard"><div class="driverLoadHead"><b>Loading outlets</b><span>'+loaded+' / '+total+' loaded</span></div><div class="driverLoadBar"><i style="width:'+pct+'%"></i></div><div class="driverLoadText">'+(total?pct+'% loaded — showing outlets as they arrive':'Connecting to live dashboard…')+'</div></div>';}function toast(message,type="info"){let t=$("driverToast");if(!t){t=document.createElement("div");t.id="driverToast";document.body.appendChild(t);}t.textContent=message;t.className="driverToast "+type;clearTimeout(window.__driverToastTimer);window.__driverToastTimer=setTimeout(()=>{t.className="driverToast";},2800);}function compressImage(file,maxBytes=2200000){return new Promise((resolve,reject)=>{if(file.size<=maxBytes)return resolve(file);const img=new Image(),reader=new FileReader();reader.onload=()=>{img.onload=()=>{const scale=Math.min(1,1600/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale)),c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d");ctx.drawImage(img,0,0,w,h);let q=.82;const done=()=>c.toBlob(b=>{if(!b)return reject(new Error("Could not process image"));if(b.size<=maxBytes||q<=.5)return resolve(new File([b],"capture.jpg",{type:"image/jpeg",lastModified:Date.now()}));q-=.08;done();},"image/jpeg",q);done();};img.onerror=()=>reject(new Error("Could not read image"));img.src=reader.result;};reader.onerror=()=>reject(new Error("Could not read image"));reader.readAsDataURL(file);});}function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}async function api(action,body={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(DRIVER_API,{method:"POST",headers:{"apikey":DRIVER_KEY,"Content-Type":"application/json","x-driver-session":ds.token},body:JSON.stringify({action,session_token:ds.token,...body}),signal:controller.signal});const d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw new Error(d.message||"Request failed");return d;}catch(e){if(e.name==="AbortError")throw new Error("Request timed out. Please check your internet connection and try again.");throw e;}finally{clearTimeout(timer);}}function rejectionHtml(o,d,items){
 const saved=Array.isArray(d.item_rejections)?d.item_rejections:[];
 const byItem=Object.fromEntries(saved.map(r=>[String(r.item_id),r]));
 const rows=items.map(i=>{
  const r=byItem[String(i.item_id)]||{},qty=Number(r.rejected_qty||0),packedQty=Number(i.packed_qty||0),rejectable=packedQty>0;
  return '<div class="driverRejectionRow '+(!rejectable?'rejectionNotApplicable':'')+'" data-outlet-id="'+esc(o.outlet_id)+'" data-item-id="'+esc(i.item_id)+'"><div class="driverRejectionItem"><b>'+esc(i.product_name)+'</b><small>Packed: '+packedQty+' / '+Number(i.required_qty||0)+'</small></div><input class="rejectQty" type="number" min="0" max="'+packedQty+'" step="1" inputmode="numeric" placeholder="'+(rejectable?'Qty':'N/A')+'" value="'+(rejectable?(qty||""):"")+'" '+(d.rejections_confirmed||!rejectable?"disabled":"")+'><select class="rejectReason" '+(d.rejections_confirmed||!rejectable?"disabled":"")+'><option value="">'+(rejectable?'Reason':'Not delivered')+'</option><option value="SHORT" '+(r.reason==="SHORT"?"selected":"")+'>Missing</option><option value="DAMAGE" '+(r.reason==="DAMAGE"?"selected":"")+'>Damage</option></select>'+(qty>0 && rejectable && r.reason==="DAMAGE"?'<button type="button" class="photoBtn" data-item-id="'+esc(i.item_id)+'" data-outlet-id="'+esc(o.outlet_id)+'">Add damage photo</button>':"")+'</div>';
 }).join("");
 return '<div class="driverRejectionSection"><div class="driverRejectionHead"><div><b>Check delivered items</b><small>Leave rejected quantity empty if everything is accepted.</small></div><span>Optional</span></div><div class="driverRejectionRows">'+rows+'</div>'+(d.rejections_confirmed?'<div class="driverRejectionSaved">✓ Rejection check confirmed</div>':'<button type="button" class="primary saveRejectionsBtn" data-id="'+esc(o.outlet_id)+'">Save rejection check</button>')+'</div>';
}
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
 const password=prompt("Enter your payment confirmation password:");
 if(password===null)return;
 if(!password)return toast("Password is required.","error");
 try{
   const x=await api("confirm_payment",{payment_id:paymentId,password});
   if(!x.ok)throw new Error(x.message||"Could not confirm payment.");
   toast("Payment confirmed by you.","success");
   await loadLedger();
 }catch(e){toast(e.message||"Payment confirmation failed.","error");}
}
function focusOutlet(outletId,scroll=true){const row=document.querySelector('.driverOutletRow[data-outlet-id="'+outletId+'"]');if(!row)return;row.open=true;if(scroll)setTimeout(()=>row.scrollIntoView({behavior:"smooth",block:"start"}),40);}
function postRejectionHtml(o,d,items){
 const rs=Array.isArray(d.item_rejections)?d.item_rejections.filter(r=>Number(r.rejected_qty||0)>0):[];
 const damage=rs.filter(r=>String(r.reason||"").toUpperCase()==="DAMAGE");
 const photos=Array.isArray(d.rejection_photos)?d.rejection_photos:[];
 if(!damage.length)return '<div class="driverNextStep"><b>✓ Rejection check complete</b><span>No damaged items reported.</span><button type="button" class="primary nextInvoiceBtn" data-id="'+esc(o.outlet_id)+'">Upload invoice now</button></div>';
 const pending=damage.filter(r=>!photos.some(p=>String(p.item_id)===String(r.item_id)));
 if(!pending.length)return '<div class="driverNextStep"><b>✓ Damage photos complete</b><span>All damaged items have photo evidence.</span><button type="button" class="primary nextInvoiceBtn" data-id="'+esc(o.outlet_id)+'">Upload invoice now</button></div>';
 return '<div class="driverNextStep"><b>📷 Damage photo required</b><span>Upload one photo for each damaged item before the invoice.</span>'+pending.map(r=>{const it=items.find(i=>String(i.item_id)===String(r.item_id));return '<button type="button" class="secondary photoBtn nextDamagePhoto" data-item-id="'+esc(r.item_id)+'" data-outlet-id="'+esc(o.outlet_id)+'">Upload photo • '+esc(it?.product_name||"Damaged item")+'</button>';}).join("")+'<small>'+pending.length+' damage photo'+(pending.length===1?"":"s")+' remaining</small></div>';
}
function render(){$("driverLogin").classList.toggle("hidden",!!ds.token);$("driverHome").classList.toggle("hidden",!ds.token);$("driverLogout").classList.toggle("hidden",!ds.token);$("driverName").textContent=ds.name||"Driver";const earned=Number(ds.earned||0);$("driverEarnings").innerHTML='<div class="driverEarnCard"><div><span class="eyebrow">DELIVERY EARNINGS</span><h3>₹'+earned.toFixed(2)+'</h3><p>Earned from completed deliveries</p></div><div class="earnIcon">₹</div></div>';const box=$("driverOutletCards");const rows=ds.outlets.map(o=>{const d=o.delivery||{},busy=!!ds.busy[o.outlet_id],delivered=d.status==="delivered",packed=o.status==="completed";const items=o.items||[],exceptions=items.filter(i=>i.status==="MISSING"||i.status==="PARTIAL"),rejectionPhotos=Array.isArray(d.rejection_photos)?d.rejection_photos:[],required=items.reduce((s,i)=>s+Number(i.required_qty||0),0),missing=items.reduce((s,i)=>s+Number(i.missing_qty||0),0),mapUrl="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(o.outlet_name+" Ahmedabad Gujarat");const itemRows=items.map(i=>'<tr><td><b>'+esc(i.product_name)+'</b><small>'+esc(i.item_code||"")+'</small></td><td>'+Number(i.required_qty||0)+'</td><td>'+Number(i.packed_qty||0)+'</td><td>'+Number(i.missing_qty||0)+'</td><td><span class="itemStatus '+String(i.status||"PENDING").toLowerCase()+'">'+esc(i.status||"PENDING")+'</span>'+(i.reason?'<small>'+esc(i.reason)+'</small>':"")+((d.item_rejections||[]).some(r=>String(r.item_id)===String(i.item_id)&&String(r.reason||"").toUpperCase()==="DAMAGE"&&Number(r.rejected_qty||0)>0)?'<button class="photoBtn" data-item-id="'+esc(i.item_id||"")+'" data-outlet-id="'+esc(o.outlet_id)+'">Add damage photo</button>':"")+'</td></tr>').join("");return '<details class="driverOutletRow '+(delivered?"deliveredRow":"")+'" data-outlet-id="'+esc(o.outlet_id)+'"><summary class="driverOutletSummary"><div class="driverOutletSummaryMain"><strong>'+esc(o.outlet_name)+'</strong><span class="miniStatus '+(delivered?"completed":packed?"packed":"pending")+'">'+(delivered?"DELIVERED":packed?"READY FOR DELIVERY":"WAITING FOR PACKING")+'</span></div></summary><div class="driverOutletCard"><div class="driverOutletStats"><span><b>'+items.length+'</b> Items</span><span><b>'+required+'</b> Required</span><span><b>'+missing+'</b> Missing</span><span><b>₹'+Number(d.earned||0).toFixed(0)+'</b> Earned</span></div><div class="driverDeliveryMeta"><span>Invoice: '+(d.invoice_path?"Uploaded":"Not uploaded")+'</span><span>'+(d.delivered_at?new Date(d.delivered_at).toLocaleString("en-IN"):"")+'</span></div><div class="driverRejectionMount">'+(d.rejections_confirmed?postRejectionHtml(o,d,items):rejectionHtml(o,d,items))+'</div>'+'<div class="driverExceptionBox">'+(exceptions.length?'<b>⚠ Missing / Partial items</b><div class="exceptionList">'+exceptions.map(i=>'<div><span>'+esc(i.product_name)+'</span><strong>'+Number(i.missing_qty||0)+' missing</strong></div>').join("")+'</div>':'<span class="noException">✓ No missing / partial items</span>')+'</div><div class="driverPhotoMeta">Rejected-item photos: <b>'+rejectionPhotos.length+'</b></div><div class="driverActions"><a class="secondary mapBtn" target="_blank" rel="noopener" href="'+mapUrl+'">Open in Maps</a>'+(packed&&!delivered?'<button class="secondary invoiceBtn" data-id="'+o.outlet_id+'">Upload invoice</button><button class="primary deliverBtn" data-id="'+o.outlet_id+'" '+(!d.invoice_path||!d.rejections_confirmed?"disabled":"")+'>Mark delivered</button>':delivered?'<span class="deliveredNote">Delivery completed • ₹'+Number(d.earned||0).toFixed(2)+'</span>':"")+'</div><details class="driverItems"><summary>Item-wise packing'+(exceptions.length?' • '+exceptions.length+' Missing/Partial':"")+'</summary><div class="tableWrap"><table><thead><tr><th>Item</th><th>Req.</th><th>Packed</th><th>Missing</th><th>Status</th></tr></thead><tbody>'+itemRows+'</tbody></table></div></details></div></details>';}).join("");box.innerHTML=(ds.loading?loadingHtml():"")+(rows||(ds.loading?"":"<div class=\"hint\">No outlets assigned in the current order.</div>"));box.querySelectorAll(".saveRejectionsBtn").forEach(b=>b.onclick=()=>saveRejections(b.dataset.id));box.querySelectorAll(".invoiceBtn,.nextInvoiceBtn").forEach(b=>{b.onclick=()=>chooseInvoice(b.dataset.id);if(ds.busy[b.dataset.id])b.disabled=true;});box.querySelectorAll(".photoBtn").forEach(b=>b.onclick=()=>chooseRejectedPhoto(b.dataset.outletId,b.dataset.itemId));box.querySelectorAll(".deliverBtn").forEach(b=>{b.onclick=()=>markDelivered(b.dataset.id);if(ds.busy[b.dataset.id])b.disabled=true;});}async function refresh(){
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
  alert("Unable to load outlets: "+e.message);
 }
}async function login(){const name=$("driverLoginName").value.trim(),pin=$("driverPin").value.trim();if(!name||!pin)return;const btn=$("driverLoginBtn"),msg=$("driverLoginMsg");btn.disabled=true;btn.textContent="Signing in…";msg.textContent="Checking credentials…";try{const d=await api("login",{login_name:name,pin:pin});if(!d||d.ok===false||!d.token)throw new Error(d?.message||"Invalid driver ID or PIN");ds.token=d.token;ds.name=d.driver_name||name;localStorage.setItem("pa_driver_session",ds.token);localStorage.setItem("pa_driver_name",ds.name);msg.textContent="Login successful.";render();await refresh();}catch(e){ds.token="";ds.name="";localStorage.removeItem("pa_driver_session");localStorage.removeItem("pa_driver_name");render();msg.textContent=e.message||"Login failed";}finally{btn.disabled=false;btn.textContent="Login";}}function logout(){ds.token="";ds.name="";ds.orderId=null;ds.outlets=[];ds.earned=0;localStorage.removeItem("pa_driver_session");localStorage.removeItem("pa_driver_name");render();}async function runInvoiceOcr(file,outletId,invoiceNumber){
  try{
    if(!window.Tesseract?.recognize)return;
    const outlet=ds.outlets.find(o=>String(o.outlet_id)===String(outletId));
    const result=await Tesseract.recognize(file,"eng",{logger:()=>{}});
    const text=String(result?.data?.text||"");
    const normalized=text.toLowerCase().replace(/[^a-z0-9]+/g," ");
    const numberOk=normalized.includes(String(invoiceNumber));
    const outletWords=String(outlet?.outlet_name||"").toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(x=>x.length>=4);
    const outletHits=outletWords.filter(w=>normalized.includes(w)).length;
    const outletOk=!outletWords.length||outletHits>=Math.min(2,outletWords.length);
    const status=numberOk&&outletOk?"verified":"mismatch";
    await api("invoice_ocr_result",{order_id:ds.orderId,outlet_id:outletId,invoice_number:invoiceNumber,status,result_text:text.slice(0,4000),confidence:Number(result?.data?.confidence||0)});
  }catch(e){console.warn("Invoice OCR:",e);}
}
async function chooseRejectedPhoto(outletId,itemId){$("invoiceInput").value="";$("invoiceInput").dataset.outletId=outletId;$("invoiceInput").dataset.itemId=itemId;$("invoiceInput").dataset.mode="rejected";$("invoiceInput").click();}async function chooseInvoice(outletId){
 const outlet=ds.outlets.find(o=>String(o.outlet_id)===String(outletId)); if(!outlet)return;
 $("invoiceNumber").value=""; $("invoiceNumber").dataset.outletId=outletId;
 $("invoiceNumberLabel").textContent=(outlet.outlet_name||"Outlet")+" · Invoice number";
 $("invoiceDialog").showModal(); $("invoiceNumber").focus();
}$("driverMenuBtn").onclick=openDriverMenu;
$("driverMenuClose").onclick=()=>$("driverMenuDialog").close();
$("invoiceCancelBtn").onclick=()=>$("invoiceDialog").close();$("invoiceCancelBtn2").onclick=()=>$("invoiceDialog").close();
$("invoiceNumberForm").addEventListener("submit",e=>{
 e.preventDefault();
 const outletId=$("invoiceNumber").dataset.outletId,n=$("invoiceNumber").value.trim();
 if(!/^\d+$/.test(n))return toast("Enter the numeric invoice number.","error");
 $("invoiceDialog").close();
 $("invoiceInput").value="";
 $("invoiceInput").dataset.outletId=outletId;
 $("invoiceInput").dataset.mode="invoice";
 $("invoiceInput").dataset.itemId="";
 $("invoiceInput").dataset.invoiceNumber=n;
 $("invoiceInput").click();
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
$("invoiceInput").onchange=async e=>{const input=e.target,file=input.files[0],outletId=input.dataset.outletId,mode=input.dataset.mode||"invoice",itemId=input.dataset.itemId||"";input.value="";if(!file||!outletId)return;if(mode==="invoice"&&!/^\d+$/.test(invoiceNumber))return toast("Enter the invoice number before uploading.","error");if(!file.type.startsWith("image/"))return toast("Please select an image.","error");if(file.size>15*1024*1024)return toast("Image must be under 15 MB.","error");const key=String(outletId);ds.busy[key]=true;render();try{const liveOutlet=ds.outlets.find(o=>String(o.outlet_id)===key);if(!liveOutlet)throw new Error("Outlet is no longer assigned to this driver. Refresh and try again.");const prepared=await compressImage(file);const action=mode==="rejected"?"rejection_photo_url":"upload_url";const d=await api(action,{order_id:ds.orderId,outlet_id:outletId,outlet_name:(liveOutlet.outlet_name||""),item_id:itemId,filename:prepared.name,mime_type:prepared.type,extension:"jpg",invoice_number:invoiceNumber});let uploadError=null;for(let attempt=1;attempt<=3;attempt++){const {error}=await getSB().storage.from(mode==="rejected"?"delivery-evidence":"delivery-invoices").uploadToSignedUrl(d.path,d.token,prepared,{contentType:prepared.type});if(!error){uploadError=null;break;}uploadError=error;if(attempt<3)await new Promise(r=>setTimeout(r,700*attempt));}if(uploadError)throw uploadError;if(mode==="rejected"){await api("save_rejection_photo",{order_id:ds.orderId,outlet_id:outletId,item_id:itemId,path:d.path,filename:prepared.name,mime_type:prepared.type});toast("Damage photo uploaded.","success");}else{await api("invoice_uploaded",{order_id:ds.orderId,outlet_id:outletId,path:d.path,invoice_number:invoiceNumber,filename:(liveOutlet.outlet_name||"Outlet")+" - "+invoiceNumber+".jpg",mime_type:prepared.type}); runInvoiceOcr(prepared,outletId,invoiceNumber);const current=ds.outlets.find(o=>String(o.outlet_id)===String(d.outlet_id||outletId));if(current){current.delivery=current.delivery||{};current.delivery.invoice_path=d.path;current.delivery.invoice_number=invoiceNumber;current.delivery.invoice_uploaded_at=new Date().toISOString();current.delivery.status="pending";}toast("Invoice uploaded successfully.","success");}}catch(err){console.error("Driver evidence upload failed",{mode,outletId,itemId,message:err?.message||String(err)});toast("Upload failed: "+(err?.message||"Please try again."),"error");}finally{delete ds.busy[key];render();focusOutlet(outletId,true);}};async function saveRejections(outletId){
 const outlet=ds.outlets.find(o=>String(o.outlet_id)===String(outletId)); if(!outlet)return;
 const rows=[...document.querySelectorAll('.driverRejectionRow[data-outlet-id="'+outletId+'"]')];
 const rejections=rows.map(row=>({item_id:row.dataset.itemId,qty:Number(row.querySelector(".rejectQty")?.value||0),reason:row.querySelector(".rejectReason")?.value||""})).filter(x=>x.qty>0||x.reason).filter(x=>{const item=outlet.items.find(i=>String(i.item_id)===String(x.item_id));return item&&Number(item.packed_qty||0)>0;});
 if(rejections.some(x=>x.qty<=0||![ "SHORT","DAMAGE" ].includes(x.reason)))return toast("For every rejected item, enter quantity and choose Short or Damage.","error");
 const invalid=rejections.find(x=>{const item=outlet.items.find(i=>String(i.item_id)===String(x.item_id));return !item||x.qty>Number(item.packed_qty||0);});
 if(invalid)return toast("Rejected quantity cannot exceed packed quantity.","error");
 try{
  const b=document.querySelector('.saveRejectionsBtn[data-id="'+outletId+'"]');if(b){b.disabled=true;b.textContent="Saving…";}
  const d=await api("save_item_rejections",{order_id:ds.orderId,outlet_id:outletId,rejections});if(!d?.ok)throw new Error(d?.message||"Could not save rejection check");
  outlet.delivery=outlet.delivery||{};outlet.delivery.rejections_confirmed=true;outlet.delivery.item_rejections=d.rejections||rejections;
  toast(rejections.some(x=>x.reason==="DAMAGE")?"Upload damage photo(s) before invoice.":"Rejection check complete. Upload invoice now.","success");render();focusOutlet(outletId,true);
 }catch(e){toast("Could not save: "+e.message,"error");render();}
}
async function markDelivered(outletId){const key=String(outletId);if(ds.busy[key])return;if(!confirm("Mark this outlet as delivered?"))return;ds.busy[key]=true;render();try{const outlet=ds.outlets.find(o=>String(o.outlet_id)===key);await api("mark_delivered",{order_id:ds.orderId,outlet_id:outletId,outlet_name:outlet?.outlet_name||""});toast("Delivery marked successfully.","success");await refresh();}catch(e){if(/session expired/i.test(e.message)){logout();return;}toast("Delivery failed: "+e.message,"error");}finally{delete ds.busy[key];render();}}$("driverMenuBtn").onclick=openDriverMenu;$("driverMenuClose").onclick=()=>$("driverMenuDialog").close();$("driverLoginBtn").onclick=login;$("driverPin").onkeydown=e=>{if(e.key==="Enter")login()};$("driverLogout").onclick=logout;$("driverRefresh").onclick=refresh;if(ds.token){ds.loading=true;ds.totalOutlets=0;ds.loadedOutlets=0;render();refresh();}else render();