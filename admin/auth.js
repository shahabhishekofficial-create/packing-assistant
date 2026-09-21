(function(){
  "use strict";

  const SESSION_KEY = "packing_assistant_admin_session";
  const LAST_ACTIVITY_KEY = "packing_assistant_admin_last_activity";
  const SESSION_MS = 60 * 60 * 1000;
  const ITERATIONS = 200000;
  const SALT_B64 = "F6GJ+7oca9r+51tm3FzSwQ==";
  const HASH_B64 = "hx8/4FHwWBPUr43NnskKji0Y4PW0Tee3HHpiQY4pCO4=";
  let logoutTimer = null;

  function b64ToBytes(s){ return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

  async function hashPassword(password){
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      {name:"PBKDF2", salt:b64ToBytes(SALT_B64), iterations:ITERATIONS, hash:"SHA-256"},
      key,
      256
    );
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  }

  function same(a,b){
    if(typeof a!=="string" || typeof b!=="string" || a.length!==b.length)return false;
    let x=0; for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);
    return x===0;
  }

  function sessionValid(){
    if(localStorage.getItem(SESSION_KEY)!=="1")return false;
    const last=Number(localStorage.getItem(LAST_ACTIVITY_KEY)||0);
    return last>0 && Date.now()-last<SESSION_MS;
  }

  function touch(){
    if(localStorage.getItem(SESSION_KEY)!=="1")return;
    localStorage.setItem(LAST_ACTIVITY_KEY,String(Date.now()));
    scheduleLogout();
  }

  function scheduleLogout(){
    clearTimeout(logoutTimer);
    if(!sessionValid()){ forceLogout(false); return; }
    const last=Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    logoutTimer=setTimeout(()=>forceLogout(true),Math.max(0,SESSION_MS-(Date.now()-last)));
  }

  function forceLogout(showLogin){
    clearTimeout(logoutTimer);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    document.body.classList.add("adminLocked");
    if(showLogin)showLoginBox("Session expired. Please sign in again.");
    else showLoginBox();
  }

  function injectStyles(){
    const s=document.createElement("style");
    s.textContent=`
      body.adminPage.adminLocked > *:not(#adminAuthOverlay){display:none!important}
      #adminAuthOverlay{position:fixed;inset:0;z-index:99999;background:#f6f8fb;display:flex;align-items:center;justify-content:center;padding:20px}
      .adminAuthCard{width:min(400px,100%);background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:28px;box-shadow:0 18px 50px rgba(15,23,42,.12)}
      .adminAuthCard h2{margin:0 0 6px}.adminAuthCard p{color:#64748b;font-size:13px;margin:0 0 20px}
      .adminAuthCard label{display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px}
      .adminAuthCard input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px}
      .adminAuthCard button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#0f172a;color:#fff;font-weight:700;cursor:pointer}
      .adminAuthError{color:#dc2626;font-size:12px;min-height:18px;margin-top:10px}
      .adminLogoutBtn{margin-left:8px!important}
    `;
    document.head.appendChild(s);
  }

  function showLoginBox(message=""){
    let box=document.getElementById("adminAuthOverlay");
    if(!box){
      box=document.createElement("div");
      box.id="adminAuthOverlay";
      box.innerHTML=`
        <form class="adminAuthCard" id="adminAuthForm">
          <div style="font-size:28px;margin-bottom:10px">🔐</div>
          <h2>Admin Dashboard</h2>
          <p>Enter the Admin password to continue.</p>
          <label for="adminPassword">Password</label>
          <input id="adminPassword" type="password" autocomplete="current-password" required autofocus>
          <div class="adminAuthError" id="adminAuthError"></div>
          <button type="submit">Unlock Dashboard</button>
        </form>`;
      document.body.appendChild(box);
      document.getElementById("adminAuthForm").addEventListener("submit",async e=>{
        e.preventDefault();
        const input=document.getElementById("adminPassword");
        const err=document.getElementById("adminAuthError");
        const button=e.target.querySelector("button");
        button.disabled=true; button.textContent="Checking…"; err.textContent="";
        try{
          const ok=same(await hashPassword(input.value),HASH_B64);
          if(!ok){err.textContent="Incorrect password.";input.select();return;}
          localStorage.setItem(SESSION_KEY,"1");
          localStorage.setItem(LAST_ACTIVITY_KEY,String(Date.now()));
          box.remove();
          document.body.classList.remove("adminLocked");
          addLogoutButton();
          scheduleLogout();
        }catch(x){err.textContent="Could not verify password. Please retry.";}
        finally{button.disabled=false;button.textContent="Unlock Dashboard";}
      });
    }
    box.style.display="flex";
    const err=document.getElementById("adminAuthError");
    if(err)err.textContent=message;
  }

  function addLogoutButton(){
    if(document.getElementById("adminLogoutBtn"))return;
    const actions=document.querySelector(".headerActions");
    if(!actions)return;
    const b=document.createElement("button");
    b.id="adminLogoutBtn"; b.className="menuDots adminLogoutBtn"; b.title="Log out"; b.setAttribute("aria-label","Log out"); b.textContent="⇥";
    b.onclick=()=>forceLogout(false);
    actions.insertBefore(b,actions.firstChild);
  }

  function init(){
    injectStyles();
    document.body.classList.add("adminLocked");
    if(sessionValid()){
      document.body.classList.remove("adminLocked");
      addLogoutButton();
      touch();
    }else{
      forceLogout(false);
    }
    ["click","keydown","pointerdown","touchstart","mousemove","scroll"].forEach(ev=>{
      window.addEventListener(ev,()=>{ if(!document.body.classList.contains("adminLocked"))touch(); },{passive:true});
    });
    document.addEventListener("visibilitychange",()=>{if(!document.hidden && !sessionValid())forceLogout(true);});
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();