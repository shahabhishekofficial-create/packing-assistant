/* Driver Dashboard UX v2 — presentation-only layer */
(function(){
  "use strict";

  function esc2(s){
    return String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",""":"&quot;","'":"&#39;"}[m]));
  }
  function cfg(key,fallback=true){
    return window.PA_CONFIG_ENABLED ? window.PA_CONFIG_ENABLED(key) : fallback;
  }
  function phoneFor(o){
    return o.phone || o.phone_number || o.mobile || o.mobile_number || o.contact_number || o.outlet_phone || "";
  }
  function mapsFor(o){
    const raw=o.maps_url || o.google_maps_url || o.map_url;
    if(raw) return raw;
    const query=o.address || o.outlet_address || ((o.outlet_name||"")+" Ahmedabad Gujarat");
    return "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(query);
  }
  function qtyTotal(items){
    return items.reduce((s,i)=>s+Number(i.required_qty||0),0);
  }
  function statusLabel(o,index,delivered,packed){
    if(delivered) return "COMPLETED";
    if(index===0 && packed) return "CURRENT STOP";
    if(packed) return "READY FOR DELIVERY";
    return "WAITING FOR PACKING";
  }
  function statusClass(o,index,delivered,packed){
    if(delivered) return "completed";
    if(index===0 && packed) return "current";
    return "upcoming";
  }

  function renderDriverUx(){
    const login=document.getElementById("driverLogin");
    const home=document.getElementById("driverHome");
    const logout=document.getElementById("driverLogout");
    const name=document.getElementById("driverName");
    const box=document.getElementById("driverOutletCards");
    if(!login||!home||!box) return;

    const signed=!!ds.token;
    login.classList.toggle("hidden",signed);
    home.classList.toggle("hidden",!signed);
    if(logout) logout.classList.toggle("hidden",!signed);
    if(name) name.textContent=ds.name||"Driver";

    const head=home.querySelector(".sectionHead");
    if(head){
      head.innerHTML='<div class="driverRouteHeading"><div><span class="eyebrow">TODAY\'S ROUTE</span><h2>'+esc2(ds.name||"Driver")+'</h2></div><div class="driverHeaderEarn">₹'+Number(ds.earned||0).toFixed(0)+' <span>earned</span></div><button id="driverRefresh" class="secondary driverRefreshBtn" type="button">↻ Refresh</button></div>';
      const refresh=document.getElementById("driverRefresh");
      if(refresh){refresh.disabled=!!ds.loading;refresh.textContent=ds.loading?"Refreshing…":"↻ Refresh";refresh.onclick=refreshRoute;}
    }

    const oldEarn=document.getElementById("driverEarnings");
    if(oldEarn) oldEarn.classList.add("driverEarningsHidden");

    let processing=document.getElementById("driverProcessing");
    if(signed && !processing){
      processing=document.createElement("div");
      processing.id="driverProcessing";
      processing.className="driverProcessing hidden";
      home.insertBefore(processing,box);
    }
    if(processing){
      const busyCount=Object.keys(ds.busy||{}).length;
      processing.classList.toggle("hidden",!busyCount&&!ds.loading);
      processing.innerHTML=ds.loading
        ? "<b>Refreshing route…</b><span>Syncing your latest delivery status.</span>"
        : busyCount ? "<b>Processing…</b><span>Your action is being saved. Keep this screen open.</span>" : "";
    }

    if(!signed){box.innerHTML="";return;}
    if(ds.loading && !ds.outlets.length){box.innerHTML=loadingHtml();return;}

    const sorted=[...(ds.outlets||[])].sort((a,b)=>(Number(a.outlet_rank)||999999)-(Number(b.outlet_rank)||999999));
    const active=sorted.filter(o=>String(o.delivery?.status||"").toLowerCase()!=="delivered");
    const completed=sorted.filter(o=>String(o.delivery?.status||"").toLowerCase()==="delivered");
    const nextId=active[0] ? String(active[0].outlet_id) : "";

    function card(o,index,isCompleted){
      const d=o.delivery||{};
      const delivered=String(d.status||"").toLowerCase()==="delivered";
      const packed=o.status==="completed";
      const items=o.items||[];
      const busy=!!ds.busy[o.outlet_id];
      const exceptions=items.filter(i=>i.status==="MISSING"||i.status==="PARTIAL");
      const rejectionPhotos=Array.isArray(d.rejection_photos)?d.rejection_photos:[];
      const required=qtyTotal(items);
      const invoiceRequired=cfg("driver.invoice_photo_required",true);
      const invoiceNumberRequired=cfg("driver.invoice_number_required",true);
      const rejectionRequired=cfg("driver.rejection_confirmation",true);
      const damagePhotoRequired=cfg("driver.damage_photo_required",true);
      const damageRows=(Array.isArray(d.item_rejections)?d.item_rejections:[]).filter(r=>Number(r.rejected_qty||0)>0&&String(r.reason||"").toUpperCase()==="DAMAGE");
      const damagePending=damagePhotoRequired&&damageRows.some(r=>!rejectionPhotos.some(p=>String(p.item_id)===String(r.item_id)));
      const deliveryReady=(!invoiceRequired||!!d.invoice_path)&&(!invoiceNumberRequired||/^\d+$/.test(String(d.invoice_number||"")))&&(!rejectionRequired||!!d.rejections_confirmed)&&!damagePending;
      const activeIndex=active.findIndex(x=>String(x.outlet_id)===String(o.outlet_id));
      const sequence=(Number(o.outlet_rank)||0)>0 ? Number(o.outlet_rank) : sorted.indexOf(o)+1;
      const label=statusLabel(o,activeIndex,delivered,packed);
      const cls=statusClass(o,activeIndex,delivered,packed);
      const phone=phoneFor(o);
      const map=mapsFor(o);

      const itemRows=items.map(i=>{
        const rej=(d.item_rejections||[]).some(r=>String(r.item_id)===String(i.item_id)&&String(r.reason||"").toUpperCase()==="DAMAGE"&&Number(r.rejected_qty||0)>0);
        return '<tr><td><b>'+esc2(i.product_name)+'</b><small>'+esc2(i.item_code||"")+'</small></td><td>'+Number(i.required_qty||0)+'</td><td>'+Number(i.packed_qty||0)+'</td><td>'+Number(i.missing_qty||0)+'</td><td><span class="itemStatus '+String(i.status||"PENDING").toLowerCase()+'">'+esc2(i.status||"PENDING")+'</span>'+(i.reason?'<small>'+esc2(i.reason)+'</small>':"")+(rej?'<button class="photoBtn" data-item-id="'+esc2(i.item_id||"")+'" data-outlet-id="'+esc2(o.outlet_id)+'">Add damage photo</button>':"")+'</td></tr>';
      }).join("");

      const rejection=cfg("driver.rejection_confirmation",true)
        ? (d.rejections_confirmed ? postRejectionHtml(o,d,items) : rejectionHtml(o,d,items))
        : postRejectionHtml(o,d,items);

      const cardBody='<div class="driverModernCardBody">'
        +'<div class="driverModernMeta"><span>📦 <b>'+items.length+'</b> Items · <b>'+required+'</b> Pcs</span><span class="'+(d.invoice_path?"metaOk":"metaPending")+'">'+(d.invoice_path?"✓ Invoice uploaded":"Invoice pending")+'</span></div>'
        +'<div class="driverRejectionMount">'+rejection+'</div>'
        +(exceptions.length?'<div class="driverExceptionBox"><b>⚠ Missing / Partial</b><div class="exceptionList">'+exceptions.map(i=>'<div><span>'+esc2(i.product_name)+'</span><strong>'+Number(i.missing_qty||0)+' missing</strong></div>').join("")+'</div></div>':"")
        +'<details class="driverItems"><summary>Item-wise packing'+(exceptions.length?' • '+exceptions.length+' Missing/Partial':"")+'</summary><div class="tableWrap"><table><thead><tr><th>Item</th><th>Req.</th><th>Packed</th><th>Missing</th><th>Status</th></tr></thead><tbody>'+itemRows+'</tbody></table></div></details>'
        +'<div class="driverModernFooter">'+(delivered
          ? '<span class="driverCompletedNote">✓ Delivered'+(d.delivered_at?' · '+new Date(d.delivered_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"")+'</span>'
          : packed ? '<button class="primary deliverBtn" data-id="'+esc2(o.outlet_id)+'" '+(!deliveryReady||busy?"disabled":"")+'>'+(busy?"Processing…":"Mark delivered")+'</button>'
          : '<span class="driverWaitingNote">Waiting for packing</span>')
          +'</div></div>';

      return '<details class="driverOutletRow driverModernRow '+(delivered?"driverCompletedRow":"")+'" data-outlet-id="'+esc2(o.outlet_id)+'" '+(!delivered&&String(o.outlet_id)===nextId?'open':"")+'><summary class="driverModernSummary">'
        +'<div class="driverStopNumber">STOP '+sequence+'</div>'
        +'<div class="driverModernMain"><div class="driverModernTitleLine"><strong>'+esc2(o.outlet_name)+'</strong><span class="modernStatus '+cls+'">'+label+'</span></div><div class="driverQuickMeta">📦 '+items.length+' Items · '+required+' Pcs · '+(d.invoice_path?"Invoice ready":"Invoice pending")+'</div></div>'
        +'<div class="driverQuickActions"><a class="driverQuickBtn navigateBtn" target="_blank" rel="noopener" href="'+esc2(map)+'">📍 <span>Navigate</span></a>'+(phone?'<a class="driverQuickIcon callBtn" href="tel:'+esc2(phone)+'" aria-label="Call '+esc2(o.outlet_name)+'">📞</a>':"")+'<span class="driverChevron">›</span></div>'
        +'</summary>'+cardBody+'</details>';
    }

    let html="";
    if(active.length){
      html+='<section class="driverRouteSection"><div class="driverRouteSectionHead"><div><span class="eyebrow">ACTIVE & UPCOMING</span><h3>'+active.length+' stop'+(active.length===1?"":"s")+' remaining</h3></div><span class="routeProgress">'+completed.length+' / '+sorted.length+' complete</span></div>';
      html+=active.map((o,i)=>card(o,i,false)).join("");
      html+='</section>';
    }else{
      html+='<section class="driverAllDone"><div class="driverAllDoneIcon">✓</div><h3>Route complete</h3><p>All assigned deliveries are completed.</p></section>';
    }
    if(completed.length){
      html+='<details class="driverCompletedDrawer"><summary><span>Completed Deliveries</span><b>'+completed.length+' / '+sorted.length+'</b><span>›</span></summary><div class="driverCompletedList">'+completed.map(o=>card(o,sorted.indexOf(o),true)).join("")+'</div></details>';
    }
    box.innerHTML=html;

    box.querySelectorAll(".saveRejectionsBtn").forEach(b=>b.onclick=()=>saveRejections(b.dataset.id));
    box.querySelectorAll(".invoiceBtn,.nextInvoiceBtn").forEach(b=>{b.onclick=()=>chooseInvoice(b.dataset.id);if(ds.busy[b.dataset.id])b.disabled=true;});
    box.querySelectorAll(".photoBtn").forEach(b=>b.onclick=()=>chooseRejectedPhoto(b.dataset.outletId,b.dataset.itemId));
    box.querySelectorAll(".deliverBtn,.deliverNowBtn").forEach(b=>{b.onclick=()=>markDelivered(b.dataset.id);if(ds.busy[b.dataset.id])b.disabled=true;});
  }

  async function refreshRoute(){
    if(typeof refresh==="function") return refresh();
  }

  window.PA_DRIVER_RENDER_HOOK=renderDriverUx;
  window.render=renderDriverUx;
  window.addEventListener("load",()=>setTimeout(renderDriverUx,0));
  setTimeout(renderDriverUx,0);
})();
