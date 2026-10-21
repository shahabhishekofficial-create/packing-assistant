(() => {
"use strict";
const API="https://pbhkuofylhqcqmspubmb.supabase.co/functions/v1/expense-api", $=id=>document.getElementById(id);
const app=$("paymentApp"),boot=$("paymentBoot"),form=$("paymentForm"),save=$("paymentSave");
const state={saving:false,pendingId:"",editing:null,payments:[],claims:[],balances:[]};
const money=v=>{const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",minimumFractionDigits:2,maximumFractionDigits:2}).format(n):"Unavailable";};
const today=()=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),o=Object.fromEntries(p.map(x=>[x.type,x.value]));return o.year+"-"+o.month+"-"+o.day;};
const dateText=v=>{const m=String(v||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+"/"+m[2]+"/"+m[1]:String(v||"—");};
function message(s){$("paymentStatus").textContent=s;}function formMessage(s){$("paymentFormMessage").textContent=s;}
function sessionExpired(){app.hidden=false;boot.hidden=true;formMessage("Session expired. Your entries are kept. Please log in again, then tap Save payment.");}
async function api(action,extra={}){
 const token=window.PA_ADMIN_SESSION||"";if(!token)throw Object.assign(Error("Session expired. Your entries are kept. Please log in again, then retry."),{sessionExpired:true});
 let r,j;try{r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({action,admin_session:token,...extra})});j=await r.json();}
 catch(e){if(e.sessionExpired)throw e;throw Object.assign(Error("Network or response error. Your entries are kept; reconnect and retry."),{networkError:true});}
 if(r.status===401||j.code==="SESSION_EXPIRED"){window.PA_ADMIN_LOGOUT?.();throw Object.assign(Error("Session expired. Your entries are kept. Please log in again, then retry."),{sessionExpired:true});}
 if(!r.ok||j.ok!==true)throw Object.assign(Error(j.message||"The payment request failed."),{code:j.code||""});return j;
}
function balanceRow(rows){const a=Array.isArray(rows)?rows:[];return a.find(r=>r.claim_id===null||r.claim_id===undefined)||a[0]||{};}
async function loadBalances(){
 const r=await api("balances");state.balances=Array.isArray(r.balances)?r.balances:[];const b=balanceRow(state.balances);
 const due=b.total_due??b.due_amount??b.balance_due??b.amount_due??b.net_due,un=b.unallocated_payments??b.unallocated_amount??b.unallocated_total??b.unallocated_payment_amount;
 $("paymentTotalDue").textContent=due===undefined||due===null?"Unavailable":money(due);$("paymentUnallocated").textContent=un===undefined||un===null?"Unavailable":money(un);
 return due===undefined||due===null?null:Number(due);
}
function renderClaims(){
 const sel=$("paymentClaim"),cur=sel.value;sel.replaceChildren();const un=document.createElement("option");un.value="";un.textContent="Unallocated payment";sel.append(un);
 state.claims.filter(c=>!c.reopened_at).forEach(c=>{const o=document.createElement("option");o.value=c.id;const range=c.from_date&&c.to_date?" · "+dateText(c.from_date)+"–"+dateText(c.to_date):"";o.textContent="Claim #"+String(c.claim_number??"—")+range;sel.append(o);});
 if([...sel.options].some(o=>o.value===cur))sel.value=cur;
}
function claimLabel(id){if(!id)return "Unallocated";const c=state.claims.find(x=>x.id===id);return c?"Claim #"+String(c.claim_number??"—"):"Claim";}
function renderPaymentRows(rows,wrap,limit){
 wrap.replaceChildren();const list=(Array.isArray(rows)?rows:[]).slice();list.sort((a,b)=>String(b.payment_date||"").localeCompare(String(a.payment_date||""))||String(b.created_at||"").localeCompare(String(a.created_at||"")));
 const shown=limit?list.slice(0,limit):list;if(!shown.length){const p=document.createElement("p");p.className="paymentMuted";p.textContent="No payments recorded yet.";wrap.append(p);return;}
 shown.forEach(row=>{
  const item=document.createElement("article");item.className="paymentRow";const main=document.createElement("div");main.className="paymentRowMain";const title=document.createElement("div");title.className="paymentRowTitle";title.textContent=dateText(row.payment_date)+" · "+String(row.mode||"Other");
  const meta=document.createElement("div");meta.className="paymentRowMeta";meta.textContent=[claimLabel(row.claim_id),row.reference_note?String(row.reference_note):""].filter(Boolean).join(" · ");
  const side=document.createElement("div");side.className="paymentRowSide";const amount=document.createElement("div");amount.className="paymentRowAmount";amount.textContent=money(row.amount);side.append(amount);
  const actions=document.createElement("div");actions.className="paymentRowActions";const edit=document.createElement("button");edit.type="button";edit.className="paymentSecondary";edit.textContent="Edit";edit.addEventListener("click",()=>beginEdit(row));
  const del=document.createElement("button");del.type="button";del.className="paymentSecondary paymentDelete";del.textContent="Delete";del.addEventListener("click",()=>void deletePayment(row));actions.append(edit,del);side.append(actions);main.append(title,meta);item.append(main,side);wrap.append(item);
 });
}
async function loadPayments(){
 $("paymentListMessage").textContent="Loading payment history…";const r=await api("export");state.payments=Array.isArray(r.payments)?r.payments:[];state.claims=Array.isArray(r.claims)?r.claims:[];renderClaims();
 renderPaymentRows(state.payments,$("paymentRecent"),3);renderPaymentRows(state.payments,$("paymentList"),0);$("paymentListMessage").textContent=state.payments.length+" payment"+(state.payments.length===1?"":"s")+" listed.";
}
async function refreshAll(){
 if(!window.PA_ADMIN_SESSION){boot.hidden=false;app.hidden=true;return;}app.hidden=false;boot.hidden=true;message("Refreshing balances and payments…");
 try{await Promise.all([loadBalances(),loadPayments()]);message("Balances and payment history refreshed.");}
 catch(e){message(e.message||"Could not refresh all payment data. Tap Refresh to retry.");if(e.sessionExpired)sessionExpired();}
}
function setBusy(v){state.saving=v;save.disabled=v;$("paymentCancelEdit").disabled=v;form.querySelectorAll("input,select").forEach(el=>{if(el.id!=="paymentAmount"||!state.editing)el.disabled=v;});$("paymentRefresh").disabled=v;}
function beginEdit(row){
 state.editing=row;$("paymentFormTitle").textContent="Edit payment";save.textContent="Save changes";$("paymentCancelEdit").hidden=false;$("paymentEditNote").hidden=false;
 $("paymentDate").value=String(row.payment_date||"");$("paymentAmount").value=String(row.amount??"");$("paymentAmount").readOnly=true;$("paymentMode").value=String(row.mode||"Other");
 $("paymentReference").value=String(row.reference_note||"");$("paymentClaim").value=String(row.claim_id||"");formMessage("Amount cannot be edited. To correct it, permanently delete this payment and record it again.");form.scrollIntoView({behavior:"smooth",block:"start"});
}
function cancelEdit(force=false){
 if(state.saving&&!force)return;state.editing=null;$("paymentFormTitle").textContent="Record payment";save.textContent="Save payment";$("paymentCancelEdit").hidden=true;$("paymentEditNote").hidden=true;
 form.reset();$("paymentDate").value=today();$("paymentAmount").readOnly=false;$("paymentMode").value="Bank";$("paymentClaim").value="";formMessage("");state.pendingId="";
}
async function refreshAfterSave(){try{await Promise.all([loadBalances(),loadPayments()]);message("Payment data refreshed.");}catch(e){message("Payment saved. Some details could not refresh; tap Refresh to retry.");}}
async function submitPayment(e){
 e.preventDefault();if(state.saving)return;if(!window.PA_ADMIN_SESSION){formMessage("Session expired. Your entries are kept. Please log in again.");window.PA_ADMIN_LOGOUT?.();return;}
 const paymentDate=$("paymentDate").value,amountText=$("paymentAmount").value,mode=$("paymentMode").value,reference=$("paymentReference").value,claimId=$("paymentClaim").value;
 if(!paymentDate||!amountText.trim()||!/^\d+(?:\.\d{1,2})?$/.test(amountText.trim())||Number(amountText)<=0){formMessage("Enter a date and a positive amount with no more than 2 decimal places.");return;}
 if(state.editing){
  setBusy(true);save.textContent="Saving…";formMessage("Saving changes…");
  try{const r=await api("update_payment",{id:state.editing.id,payment_date:paymentDate,mode,reference_note:reference,claim_id:claimId||null});if(!r.payment)throw Error("The server did not confirm the payment update.");
   state.editing=null;cancelEdit(true);formMessage("Saved");await refreshAfterSave();
  }catch(err){if(err.sessionExpired)sessionExpired();else formMessage(err.message||"Could not save changes. Your entries are kept.");}
  finally{setBusy(false);save.textContent=state.editing?"Save changes":"Save payment";}return;
 }
 if(!state.pendingId){if(!crypto.randomUUID){formMessage("This phone cannot create a secure payment ID. No payment was saved.");return;}state.pendingId=crypto.randomUUID();}
 setBusy(true);save.textContent="Checking balance…";formMessage("Rechecking balances before saving…");
 try{
  const due=await loadBalances();if(due===null||!Number.isFinite(due))throw Error("Current Total Due is unavailable. No payment was saved; refresh and retry.");
  const amount=Number(amountText.trim()),excess=amount-due;
  if(due-amount<0){const ok=window.confirm("Overpayment warning: this payment would make Total Due negative by "+money(excess)+". Continue with this payment?");if(!ok){formMessage("Cancelled. Nothing was saved; your entries are kept.");return;}}
  save.textContent="Saving…";formMessage("Saving payment…");
  const r=await api("record_payment",{id:state.pendingId,payment_date:paymentDate,amount:amountText.trim(),mode,reference_note:reference,claim_id:claimId||null});
  if(!r.payment)throw Error("The server did not confirm the saved payment.");state.pendingId="";form.reset();$("paymentDate").value=today();$("paymentMode").value="Bank";formMessage("Saved");await refreshAfterSave();
 }catch(err){if(err.sessionExpired)sessionExpired();else formMessage(err.message||"Payment not saved. Your entries are kept; retry when ready.");}
 finally{setBusy(false);save.textContent=state.editing?"Save changes":"Save payment";}
}
async function deletePayment(row){
 if(state.saving)return;const label="Permanently delete this payment dated "+dateText(row.payment_date)+" for "+money(row.amount)+"? Deletes are permanent and cannot be undone.";
 if(!window.confirm(label))return;setBusy(true);message("Deleting payment permanently…");
 try{const r=await api("delete_payment",{id:row.id});if(r.ok!==true)throw Error("The server did not confirm deletion.");if(state.editing?.id===row.id)cancelEdit(true);message("Payment permanently deleted.");await refreshAfterSave();}
 catch(e){if(e.sessionExpired)formMessage("Session expired. Your entries are kept. Please log in again.");message(e.message||"Could not delete payment.");}
 finally{setBusy(false);}
}
form.addEventListener("submit",submitPayment);$("paymentCancelEdit").addEventListener("click",cancelEdit);$("paymentRefresh").addEventListener("click",()=>void refreshAll());$("paymentDate").value=today();
window.addEventListener("pa-admin-authenticated",()=>{void refreshAll();});
Promise.resolve(window.PA_ADMIN_READY).then(()=>{if(window.PA_ADMIN_SESSION)void refreshAll();else{app.hidden=true;boot.textContent="Admin sign-in is required before payment data can be shown.";}}).catch(()=>{boot.textContent="Admin sign-in is required before payment data can be shown.";});
})();