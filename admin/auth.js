(function(){
  "use strict";

  const SESSION_KEY = "packing_assistant_admin_session";
  const LAST_ACTIVITY_KEY = "packing_assistant_admin_last_activity";
  const SESSION_TOKEN_KEY = "packing_assistant_admin_session_token";
  const SESSION_MS = 60 * 60 * 1000;
  const ITERATIONS = 200000;
  const SALT_B64 = "F6GJ+7oca9r+51tm3FzSwQ==";
  const HASH_B64 = "hx8/4FHwWBPUr43NnskKji0Y4PW0Tee3HHpiQY4pCO4=";
  const db = window.supabase && window.SUPABASE_CONFIG ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key) : null;
  let logoutTimer = null;
  let reauthResolver = null;
  let serverSessionRefreshAt = 0;
  let serverSessionRefreshing = false;

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

  async function refreshServerSession(){
    if(serverSessionRefreshing||!window.PA_ADMIN_SESSION||!db)return;
    serverSessionRefreshing=true;
    try{
      const r=await db.rpc("verify_admin_session",{p_session_token:window.PA_ADMIN_SESSION});
      if(!r.error && r.data===false){forceLogout(true);return;}
      if(!r.error)serverSessionRefreshAt=Date.now();
    }catch(e){
      console.warn("Admin session refresh:",e.message||e);
    }finally{
      serverSessionRefreshing=false;
    }
  }

  function touch(){
    if(localStorage.getItem(SESSION_KEY)!=="1")return;
    const now=Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY,String(now));
    if(now-serverSessionRefreshAt>10*60*1000)void refreshServerSession();
    scheduleLogout();
  }

  function scheduleLogout(){
    clearTimeout(logoutTimer);
    if(!sessionValid()){ forceLogout(false); return; }
    const last=Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    logoutTimer=setTimeout(()=>forceLogout(true),Math.max(0,SESSION_MS-(Date.now()-last)));
  }

  window.PA_ADMIN_PASSWORD=""; window.PA_ADMIN_SESSION="";
  function clearAdminSession(){localStorage.removeItem(SESSION_TOKEN_KEY);window.PA_ADMIN_SESSION="";window.PA_ADMIN_PASSWORD="";}
  function removeBootOverlay(){const el=document.getElementById("adminBootOverlay");if(el)el.remove();}
  function forceLogout(showLogin){
    clearTimeout(logoutTimer);
    removeBootOverlay();
    const token=localStorage.getItem(SESSION_TOKEN_KEY)||"";
    if(token&&db)db.rpc("revoke_admin_session",{p_session_token:token}).catch(()=>{});
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    clearAdminSession();
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

  window.PA_REAUTH_ADMIN = function(){ return new Promise(resolve=>{ reauthResolver=resolve; showLoginBox("Admin password required for this action."); }); };

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
          let ok=false;
          if(db){const r=await db.rpc("verify_admin_password",{p_password:input.value});if(!r.error)ok=!!r.data;}
          if(!ok)ok=same(await hashPassword(input.value),HASH_B64);
          if(!ok){err.textContent="Incorrect password.";input.select();return;}
          const sr=await db.rpc("create_admin_session",{p_password:input.value});
          if(sr.error||!sr.data)throw new Error("Could not create admin session.");
          window.PA_ADMIN_SESSION=sr.data;
          window.PA_ADMIN_PASSWORD="";
          serverSessionRefreshAt=Date.now();
          localStorage.setItem(SESSION_TOKEN_KEY,sr.data);
          localStorage.setItem(SESSION_KEY,"1");if(reauthResolver){const resolve=reauthResolver;reauthResolver=null;resolve(true);}
          localStorage.setItem(LAST_ACTIVITY_KEY,String(Date.now()));
          box.remove();
          document.body.classList.remove("adminLocked");
          window.dispatchEvent(new CustomEvent("pa-admin-authenticated"));
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

  async function changePassword(){
    let box=document.getElementById("adminPasswordDialog");
    if(!box){
      box=document.createElement("dialog"); box.id="adminPasswordDialog"; box.className="settingsDialog";
      box.innerHTML=`<form method="dialog" id="changePasswordForm"><div class="settingsDialogHead"><div><span class="eyebrow">SECURITY</span><h3>Change Admin Password</h3><p class="hint">Minimum 8 characters.</p></div><button class="secondary" value="cancel">✕</button></div><label>Current password<input id="currentAdminPassword" type="password" required></label><label>New password<input id="newAdminPassword" type="password" minlength="8" required></label><label>Confirm new password<input id="confirmAdminPassword" type="password" minlength="8" required></label><p id="changePasswordError" class="adminAuthError"></p><menu><button value="cancel">Cancel</button><button id="changePasswordSubmit" class="primary">Change Password</button></menu></form>`;
      document.body.appendChild(box);
      document.getElementById("changePasswordForm").addEventListener("submit",async e=>{
        e.preventDefault(); const cur=document.getElementById("currentAdminPassword").value, n=document.getElementById("newAdminPassword").value, c=document.getElementById("confirmAdminPassword").value, err=document.getElementById("changePasswordError"), b=document.getElementById("changePasswordSubmit"); err.textContent="";
        if(n!==c){err.textContent="New passwords do not match.";return;} if(n.length<8){err.textContent="Password must be at least 8 characters.";return;}
        b.disabled=true; b.textContent="Saving…";
        try{if(!db)throw new Error("Database unavailable."); const r=await db.rpc("change_admin_password",{p_current_password:cur,p_new_password:n}); if(r.error)throw new Error(r.error.message); if(!r.data)throw new Error("Password change failed."); box.close(); alert("Admin password changed successfully. Use the new password next time you log in.");}
        catch(x){err.textContent=x.message||"Password change failed.";} finally{b.disabled=false;b.textContent="Change Password";}
      });
    }
    box.showModal();
  }

  window.PA_ADMIN_CHANGE_PASSWORD = changePassword;
  window.PA_ADMIN_LOGOUT = ()=>forceLogout(false);

  function addLogoutButton(){
    if(document.getElementById("adminLogoutBtn"))return;
    return;
    const b=document.createElement("button");
    b.id="adminLogoutBtn"; b.className="menuDots adminLogoutBtn"; b.title="Log out"; b.setAttribute("aria-label","Log out"); b.textContent="⇥";
    b.onclick=()=>forceLogout(false);
    actions.insertBefore(b,actions.firstChild);
    if(!document.getElementById("adminChangePasswordBtn")){const cp=document.createElement("button");cp.id="adminChangePasswordBtn";cp.className="menuDots";cp.title="Change password";cp.textContent="🔑";cp.onclick=changePassword;actions.insertBefore(cp,actions.firstChild);}
  }

  async function init(){
    document.body.style.visibility="visible";
    injectStyles();
    document.body.classList.add("adminLocked");
    if(sessionValid()){
      const token=localStorage.getItem(SESSION_TOKEN_KEY)||"";
      if(token && db){
        try{
          const r=await db.rpc("verify_admin_session",{p_session_token:token});
          if(r.error||!r.data){forceLogout(false);return;}
          window.PA_ADMIN_SESSION=token;
          serverSessionRefreshAt=Date.now();
          document.body.classList.remove("adminLocked");
          addLogoutButton();
          touch();
          window.dispatchEvent(new CustomEvent("pa-admin-authenticated"));
        }catch(e){forceLogout(false);return;}
      }else{
        forceLogout(false);
      }
    }else{
      forceLogout(false);
    }
    ["click","keydown","pointerdown","touchstart","mousemove","scroll"].forEach(ev=>{
      window.addEventListener(ev,()=>{ if(!document.body.classList.contains("adminLocked"))touch(); },{passive:true});
    });
    document.addEventListener("visibilitychange",()=>{if(!document.hidden && !sessionValid())forceLogout(true);});
  }

  init();
})();