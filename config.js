window.SUPABASE_CONFIG = {
  url: "https://pbhkuofylhqcqmspubmb.supabase.co",
  key: "sb_publishable_od_hrR-3-scS1xZTi2bMmg_330DGAlV"
};

(function(){
  "use strict";

  const DEFAULTS = {
    "driver.invoice_gallery_upload": true,
    "driver.invoice_number_required": true,
    "driver.invoice_photo_required": true,
    "driver.short_rejection": true,
    "driver.damage_rejection": true,
    "driver.damage_photo_required": true,
    "driver.rejection_confirmation": true,
    "packing.voice_narration": true,
    "packing.auto_advance": true,
    "packing.partial_packing": true,
    "packing.missing_marking": true,
    "packing.show_completed_outlets": false,
    "inventory.barcode_scanning": true,
    "inventory.manual_search": true,
    "inventory.offline_mode": true,
    "inventory.allow_recount": true,
    "system.update_notifications": true,
    "system.dashboard_auto_refresh": true,
    "system.maintenance_mode": false
  };

  const CACHE_KEY = "pa_app_config_v1";
  const db = window.supabase ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key) : null;
  let values = {...DEFAULTS};

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY)||"{}");
    Object.keys(values).forEach(k=>{
      if(typeof cached[k] === "boolean") values[k]=cached[k];
    });
  } catch {}

  function enabled(key){
    return values[key] !== false;
  }

  async function refresh(){
    if(!db) return values;
    try{
      const {data,error}=await db.functions.invoke("admin-config",{body:{action:"public_get"}});
      if(error || !data?.ok) throw error || new Error(data?.message||"Configuration unavailable");
      const next={...DEFAULTS};
      (data.configs||[]).forEach(x=>{
        if(typeof x?.config_key==="string" && typeof x?.enabled==="boolean") next[x.config_key]=x.enabled;
      });
      values=next;
      localStorage.setItem(CACHE_KEY,JSON.stringify(values));
      window.dispatchEvent(new CustomEvent("pa-config-loaded",{detail:{...values}}));
    }catch(e){
      console.warn("App configuration:",e?.message||e);
    }
    applyMaintenance();
    return values;
  }

  function applyMaintenance(){
    if(!enabled("system.maintenance_mode") || /\/admin(?:\/|$)/.test(location.pathname)) return;
    if(document.getElementById("paMaintenanceOverlay")) return;
    const e=document.createElement("div");
    e.id="paMaintenanceOverlay";
    e.innerHTML='<div><div style="font-size:42px">🔧</div><h2>App temporarily unavailable</h2><p>Bigly Agro operations are under maintenance. Please try again shortly.</p></div>';
    e.style.cssText="position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#f6f8fb;color:#10203a;text-align:center;font:600 15px system-ui,-apple-system,sans-serif";
    e.firstElementChild.style.cssText="width:min(420px,100%);padding:32px 24px;border:1px solid #e2e8f0;border-radius:20px;background:#fff;box-shadow:0 18px 60px rgba(15,23,42,.14)";
    document.body.appendChild(e);
  }

  window.PA_CONFIG_DEFAULTS=Object.freeze({...DEFAULTS});
  window.PA_CONFIG_ENABLED=enabled;
  window.PA_CONFIG_GET=()=>({...values});
  async function adminCall(action,extra){
    if(!db) throw new Error("Supabase client unavailable");
    const session=window.PA_ADMIN_SESSION||localStorage.getItem("packing_assistant_admin_session_token")||"";
    const {data,error}=await db.functions.invoke("admin-config",{body:{action,admin_session:session,...(extra||{})}});
    if(error) throw error;
    if(!data?.ok) throw new Error(data?.message||"Configuration request failed");
    return data;
  }

  window.PA_ADMIN_CONFIG_GET=()=>adminCall("admin_get");
  window.PA_ADMIN_CONFIG_SET=(config_key,enabled)=>adminCall("admin_set",{config_key,enabled});
  window.PA_CONFIG_REFRESH=refresh;
  window.PA_CONFIG_READY=Promise.resolve(values).then(()=>refresh());
  window.addEventListener("pa-config-loaded",applyMaintenance);
  setInterval(()=>refresh().catch(()=>{}),300000);
})();
