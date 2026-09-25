const {createClient}=supabase;const db=createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.key);const $=id=>document.getElementById(id);const esc=s=>String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));let token="",staff="",sessionId="",items=[],current=null;
function setMsg(id,s){$(id).textContent=s||""}
async function login(){const name=$("staffName").value.trim(),pin=$("staffPin").value.trim();if(!name||!/^[0-9]{4,6}$/.test(pin))return setMsg("loginMsg","Enter staff name and 4–6 digit PIN.");$("loginBtn").disabled=true;try{const {data,error}=await db.rpc("inv_staff_login",{p_name:name,p_pin:pin});if(error)throw error;token=data.token;staff=data.staff_name;sessionStorage.setItem("inv_staff_token",token);sessionStorage.setItem("inv_staff_name",staff);$("login").classList.add("hidden");$("count").classList.remove("hidden");$("staffTitle").textContent=staff}catch(e){setMsg("loginMsg",e.message)}finally{$("loginBtn").disabled=false}}
async function start(){const section=$("section").value;const {data,error}=await db.rpc("inv_staff_start_session",{p_staff_token:token,p_section:section,p_date:new Date().toISOString().slice(0,10)});if(error)throw error;sessionId=data;const r=await db.rpc("inv_staff_get_items",{p_staff_token:token,p_section:section});if(r.error)throw r.error;items=r.data||[];renderList();$("counter").classList.remove("hidden");$("items").classList.remove("hidden");$("submitBtn").classList.remove("hidden");setMsg("sessionMsg",items.length+" items loaded.")}
function renderList(){const q=$("search").value.trim().toLowerCase();const filtered=items.filter(x=>!q||x.name.toLowerCase().includes(q)||String(x.barcode||"").includes(q));$("items").innerHTML=filtered.map(x=>'<button class="secondary itemPick" data-id="'+esc(x.id)+'" style="display:block;width:100%;margin:6px 0;text-align:left"><b>'+esc(x.name)+'</b><br><small>'+esc(x.category)+' · '+esc(x.base_uom)+' · count as '+esc(x.count_unit)+(Number(x.count_to_base)!==1?' · 1 '+esc(x.count_unit)+' = '+esc(x.count_to_base)+' '+esc(x.base_uom):'')+'</small></button>').join("")||'<div class="hint">No matching items.</div>';document.querySelectorAll(".itemPick").forEach(b=>b.onclick=()=>selectItem(b.dataset.id))}
function selectItem(id){current=items.find(x=>String(x.id)===String(id));if(!current)return;document.querySelectorAll(".itemPick").forEach(b=>b.classList.toggle("selected",String(b.dataset.id)===String(id)));$("countUnitLabel").textContent=current.count_unit||current.base_uom||"";$("itemInfo").innerHTML='<b>'+esc(current.name)+'</b><br>'+esc(current.category)+' · Base UOM: '+esc(current.base_uom)+' · Count as: '+esc(current.count_unit)+(Number(current.count_to_base)!==1?' · 1 '+esc(current.count_unit)+' = '+esc(current.count_to_base)+' '+esc(current.base_uom):'');$("countQty").value="";$("countQty").focus();updateConversion()}
let cameraStream=null,cameraVideo=null,cameraOverlay=null,cameraDetector=null;
function closeCamera(){
  if(cameraOverlay){cameraOverlay.remove();cameraOverlay=null}
  if(cameraVideo){cameraVideo.pause();cameraVideo.srcObject=null;cameraVideo=null}
}
async function scanBarcode(){
  if(!("BarcodeDetector" in window))return setMsg("savedMsg","Barcode scanning is not supported on this browser. Use search.");
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Camera access is not available.");
    if(!cameraStream){
      cameraStream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false
      });
    }
    closeCamera();
    cameraOverlay=document.createElement("div");
    cameraOverlay.className="invCameraOverlay";
    cameraOverlay.innerHTML='<div class="invCameraPanel"><div class="invCameraHead"><div><b>Scan barcode</b><small>Point the camera at the barcode, then tap Scan.</small></div><button type="button" class="invCameraClose">✕</button></div><div class="invCameraViewport"><video autoplay muted playsinline></video><div class="invScanFrame"></div></div><div class="invCameraFooter"><span class="invCameraStatus">Camera ready</span><button type="button" class="invCameraScan">Scan barcode</button></div></div>';
    document.body.appendChild(cameraOverlay);
    cameraVideo=cameraOverlay.querySelector("video");
    cameraVideo.srcObject=cameraStream;
    cameraDetector=new BarcodeDetector({formats:["ean_8","ean_13","upc_a","upc_e"]});
    cameraOverlay.querySelector(".invCameraClose").onclick=closeCamera;
    cameraOverlay.querySelector(".invCameraScan").onclick=async()=>{
      const status=cameraOverlay.querySelector(".invCameraStatus"),btn=cameraOverlay.querySelector(".invCameraScan");
      btn.disabled=true;status.textContent="Scanning…";
      try{
        const codes=await cameraDetector.detect(cameraVideo);
        if(!codes.length){status.textContent="No barcode found. Adjust the camera and try again.";return}
        const b=codes[0].rawValue;
        $("search").value=b;renderList();
        const x=items.find(i=>String(i.barcode||"")===String(b));
        if(x)selectItem(x.id);else setMsg("savedMsg","Barcode scanned: "+b);
        closeCamera();
      }catch(e){status.textContent="Could not scan. Try again."}
      finally{btn.disabled=false}
    };
    await cameraVideo.play();
  }catch(e){
    closeCamera();
    if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
    setMsg("savedMsg",e.name==="NotAllowedError"?"Camera permission was denied. Allow camera access in browser settings.":"Could not start camera: "+e.message);
  }
}
function updateConversion(){if(!current)return;const n=Number($("countQty").value);$("conversion").textContent=Number.isFinite(n)&&n>=0?(n+" "+current.count_unit+" = "+(n*Number(current.count_to_base))+" "+current.base_uom):""}
async function save(){if(!current)return setMsg("savedMsg","Select an item.");const n=Number($("countQty").value);if(!Number.isFinite(n)||n<0)return setMsg("savedMsg","Enter a valid quantity.");$("saveBtn").disabled=true;try{const {data,error}=await db.rpc("inv_staff_save_count",{p_staff_token:token,p_session_id:sessionId,p_item_id:current.id,p_qty:n});if(error)throw error;setMsg("savedMsg","Saved: "+n+" "+data.count_unit+" = "+data.base_qty+" "+data.base_uom)}catch(e){setMsg("savedMsg",e.message)}finally{$("saveBtn").disabled=false}}
function next(){document.querySelectorAll(".itemPick").forEach(b=>b.classList.remove("selected"));$("countUnitLabel").textContent="";$("itemInfo").textContent="Select an item.";$("countQty").value="";$("conversion").textContent="";$("savedMsg").textContent="";current=null;$("search").focus()}
async function submit(){const {error}=await db.rpc("inv_staff_submit_session",{p_staff_token:token,p_session_id:sessionId});if(error)return setMsg("sessionMsg",error.message);setMsg("sessionMsg","Count submitted successfully.");$("submitBtn").disabled=true}
function logout(){closeCamera();if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}sessionStorage.clear();location.reload()}
$("loginBtn").onclick=login;$("startBtn").onclick=()=>start().catch(e=>setMsg("sessionMsg",e.message));$("saveBtn").onclick=save;$("nextBtn").onclick=next;$("submitBtn").onclick=submit;$("logoutBtn").onclick=logout;$("search").oninput=renderList;$("scanBtn").onclick=scanBarcode;$("countQty").oninput=updateConversion;$("staffPin").onkeydown=e=>{if(e.key==="Enter")login()};token=sessionStorage.getItem("inv_staff_token")||"";staff=sessionStorage.getItem("inv_staff_name")||"";if(token){$("login").classList.add("hidden");$("count").classList.remove("hidden");$("staffTitle").textContent=staff}