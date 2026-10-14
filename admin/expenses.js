(() => {
  "use strict";
  const API = "https://pbhkuofylhqcqmspubmb.supabase.co/functions/v1/expense-api";
  const $ = id => document.getElementById(id);
  const app = $("expenseApp"), boot = $("expenseBoot");
  const form = $("expenseForm"), save = $("expenseSave"), saveAnother = $("expenseSaveAnother");
  let categories = [], selectedCategory = "", saving = false, pendingId = "";
  const LAST_CATEGORY_KEY = "pa_expense_last_category";
  const money = value => {
    if (value === null || value === undefined || value === "") return "—";
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(n) : "—";
  };
  function localToday(){
    const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return p.year+"-"+p.month+"-"+p.day;
  }
  function setStatus(message){ $("expenseStatus").textContent = message; }
  function showLoginFallback(){
    app.hidden = true; boot.textContent = "Admin sign-in is required before expense data can be shown.";
  }
  async function api(action, extra = {}){
    const token = window.PA_ADMIN_SESSION || "";
    if(!token) throw Object.assign(new Error("SESSION_EXPIRED"),{sessionExpired:true});
    let response;
    try{
      response = await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,admin_session:token,...extra}),cache:"no-store"});
    }catch(e){ throw Object.assign(new Error("NETWORK_ERROR"),{networkError:true}); }
    let result;
    try{ result = await response.json(); }catch{ throw Object.assign(new Error("BAD_RESPONSE"),{networkError:true}); }
    if(response.status===401 || result.code==="SESSION_EXPIRED"){
      window.PA_ADMIN_LOGOUT?.();
      throw Object.assign(new Error("SESSION_EXPIRED"),{sessionExpired:true});
    }
    if(!response.ok || result.ok!==true) throw new Error(result.message || "Request failed. Please retry.");
    return result;
  }
  function renderCategories(rows){
    categories = Array.isArray(rows) ? rows : [];
    const wrap = $("expenseCategoryChips"); wrap.replaceChildren();
    if(!categories.length){ const empty=document.createElement("span"); empty.textContent="No active categories available."; wrap.append(empty); return; }
    const remembered = localStorage.getItem(LAST_CATEGORY_KEY) || "";
    selectedCategory = categories.some(c=>c.id===remembered) ? remembered : categories[0].id;
    categories.forEach(category=>{
      const b=document.createElement("button"); b.type="button"; b.className="expenseChip"; b.textContent=String(category.name||"Category"); b.setAttribute("aria-pressed",String(category.id===selectedCategory));
      b.addEventListener("click",()=>{selectedCategory=category.id;renderCategoryState();});
      wrap.append(b);
    });
    renderCategoryState();
  }
  function renderCategoryState(){ $("expenseCategoryChips").querySelectorAll("button").forEach((b,i)=>b.setAttribute("aria-pressed",String(categories[i]?.id===selectedCategory))); }
  function field(row, keys){ for(const key of keys){ if(row && row[key]!==undefined && row[key]!==null) return row[key]; } return null; }
  async function loadBalances(){
    const result = await api("balances");
    const rows = Array.isArray(result.balances) ? result.balances : [];
    const employee = rows.find(r=>r.claim_id===null || r.claim_id===undefined) || rows[0] || {};
    const due = field(employee,["total_due","due_amount","balance_due","amount_due","net_due"]);
    const unallocated = field(employee,["unallocated_payments","unallocated_amount","unallocated_total","unallocated_payment_amount"]);
    $("expenseTotalDue").textContent = due===null ? "Unavailable" : money(due);
    $("expenseUnallocated").textContent = unallocated===null ? "Unavailable" : money(unallocated);
  }
  function renderRecent(rows){
    const wrap=$("expenseRecentList"); wrap.replaceChildren();
    const recent=(Array.isArray(rows)?rows:[]).slice(0,5);
    if(!recent.length){const p=document.createElement("p");p.className="expenseMuted";p.textContent="No expenses recorded yet.";wrap.append(p);return;}
    recent.forEach(row=>{
      const item=document.createElement("article");item.className="expenseRecentRow";
      const main=document.createElement("div");main.className="expenseRecentMain";
      const title=document.createElement("div");title.className="expenseRecentTitle";title.textContent=String(row.reason||"Expense");
      const meta=document.createElement("div");meta.className="expenseRecentMeta";
      const category=row.expense_categories?.name || categories.find(c=>c.id===row.category_id)?.name || "Category";
      meta.textContent=[row.expense_date,category,row.notes].filter(Boolean).join(" · ");
      const amount=document.createElement("div");amount.className="expenseRecentAmount";amount.textContent=money(row.amount);
      main.append(title,meta);item.append(main,amount);wrap.append(item);
    });
  }
  async function loadRecent(){
    const result=await api("list_expenses");
    renderRecent(result.expenses);
  }
  async function loadDashboard(){
    if(!window.PA_ADMIN_SESSION){showLoginFallback();return;}
    app.hidden=false;boot.hidden=true;setStatus("Loading balances and recent expenses…");
    try{
      await Promise.all([loadBalances(),loadRecent()]);
      setStatus("Balances and recent entries refreshed.");
    }catch(e){
      if(e.sessionExpired){showLoginFallback();return;}
      setStatus("Could not refresh all expense data. Use Refresh to retry.");
    }
  }
  function setBusy(value){
    saving=value;save.disabled=value;saveAnother.disabled=value;
    save.textContent=value?"Saving…":"Save Expense";
    saveAnother.textContent=value?"Saving…":"Save & add another";
  }
  async function submitExpense(clearAfter){
    if(saving)return;
    if(!window.PA_ADMIN_SESSION){$("expenseSaveMessage").textContent="Please sign in again. Your entries are kept.";window.PA_ADMIN_LOGOUT?.();return;}
    const date=$("expenseDate").value, amount=$("expenseAmount").value, reason=$("expenseReason").value, notes=$("expenseNotes").value;
    if(!date || !selectedCategory || !amount.trim() || !reason.trim()){
      $("expenseSaveMessage").textContent="Enter date, category, amount and reason.";return;
    }
    if(!/^\d+(?:\.\d{1,2})?$/.test(amount.trim()) || Number(amount)<=0){
      $("expenseSaveMessage").textContent="Enter a positive amount with no more than 2 decimal places.";return;
    }
    if(!pendingId) pendingId=crypto.randomUUID();
    setBusy(true);$("expenseSaveMessage").textContent="Saving…";
    try{
      const result=await api("create_expense",{id:pendingId,expense_date:date,amount:amount.trim(),category_id:selectedCategory,reason:reason.trim(),notes:notes});
      if(!result.expense && !result.duplicate && !result.id) throw new Error("The server did not confirm the saved expense.");
      localStorage.setItem(LAST_CATEGORY_KEY,selectedCategory);
      $("expenseSaveMessage").textContent="Saved";
      pendingId="";
      if(clearAfter){
        $("expenseAmount").value="";$("expenseReason").value="";$("expenseNotes").value="";$("expenseDate").value=localToday();$("expenseAmount").focus();
      }else{
        form.reset();$("expenseDate").value=localToday();selectedCategory=categories[0]?.id||"";renderCategoryState();
      }
      try{ await Promise.all([loadBalances(),loadRecent()]); }
      catch(_){ setStatus("Expense saved. Some dashboard details could not refresh; use Refresh to retry."); }
    }catch(e){
      if(e.sessionExpired){
        $("expenseSaveMessage").textContent="Session expired. Your entries are kept. Sign in again, then tap Save.";
        return;
      }
      $("expenseSaveMessage").textContent=(e.networkError ? "Not saved yet. Your entries are kept; tap Save to retry." : (e.message||"Not saved yet. Your entries are kept."));
    }finally{setBusy(false);}
  }
  $("expenseDate").value=localToday();
  form.addEventListener("submit",e=>{e.preventDefault();void submitExpense(false);});
  saveAnother.addEventListener("click",()=>void submitExpense(true));
  $("expenseRefresh").addEventListener("click",()=>void loadDashboard());
  $("expenseNavToggle").addEventListener("click",()=>{
    const side=$("expenseSidebar"),open=side.classList.toggle("open");
    $("expenseNavToggle").setAttribute("aria-expanded",String(open));
  });
  async function initialize(){
    if(!window.PA_ADMIN_SESSION){showLoginFallback();return;}
    app.hidden=false;boot.hidden=true;
    try{
      const result=await api("bootstrap");
      renderCategories(result.categories);
      await loadDashboard();
    }catch(e){
      if(e.sessionExpired){showLoginFallback();return;}
      setStatus("Could not load expense categories. Refresh the page after checking your connection.");
    }
  }
  window.addEventListener("pa-admin-authenticated",()=>{void initialize();});
  Promise.resolve(window.PA_ADMIN_READY).then(()=>{
    if(window.PA_ADMIN_SESSION)void initialize();else showLoginFallback();
  }).catch(showLoginFallback);
})();