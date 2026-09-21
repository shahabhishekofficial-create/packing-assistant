import { createClient } from "npm:@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type"
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...cors,"Content-Type":"application/json"}
});
const admin=()=>createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const body=await req.json();
    if(body.action!=="report") return json({ok:false,message:"Unknown action"},400);

    const accessToken=String(body.access_token||"").trim();
    if(!accessToken) return json({ok:false,message:"Missing report access token"},401);

    const fromDate=body.from_date ? String(body.from_date) : null;
    const toDate=body.to_date ? String(body.to_date) : null;
    const db=admin();

    const authCheck=await db.from("orders").select("id").eq("access_token",accessToken).limit(1).maybeSingle();
    if(authCheck.error) return json({ok:false,message:authCheck.error.message},500);
    if(!authCheck.data) return json({ok:false,message:"Invalid report access token"},401);

    let orderQuery=db.from("orders")
      .select("id,order_name,created_at,completed_at")
      .order("created_at",{ascending:true});
    if(fromDate) orderQuery=orderQuery.gte("created_at",fromDate+"T00:00:00");
    if(toDate) orderQuery=orderQuery.lt("created_at",toDate+"T00:00:00+00:00");

    const {data:orders,error:ordersError}=await orderQuery;
    if(ordersError) return json({ok:false,message:ordersError.message},500);
    if(!orders?.length) return json({ok:true,orders:[],outlets:[],items:[],events:[],deliveries:[]});

    const orderIds=orders.map(x=>x.id);

    const {data:outlets,error:outletsError}=await db.from("outlets")
      .select("id,order_id,store_name,outlet_rank,driver,status,locked_device_id,started_at,completed_at")
      .in("order_id",orderIds);
    if(outletsError) return json({ok:false,message:outletsError.message},500);

    const outletIds=(outlets||[]).map(x=>x.id);
    const {data:items,error:itemsError}=outletIds.length
      ? await db.from("order_items").select("id,outlet_id,item_code,product_name,required_qty,packed_qty,missing_qty,status,reason,started_at,completed_at,narration_rank").in("outlet_id",outletIds)
      : {data:[],error:null};
    if(itemsError) return json({ok:false,message:itemsError.message},500);

    const itemIds=(items||[]).map(x=>x.id);
    const {data:events,error:eventsError}=itemIds.length
      ? await db.from("packing_events").select("item_id,device_id,event_type,packed_qty,missing_qty,reason,created_at").in("item_id",itemIds).order("created_at",{ascending:true})
      : {data:[],error:null};
    if(eventsError) return json({ok:false,message:eventsError.message},500);

    const {data:deliveries,error:deliveryError}=await db.from("delivery_records")
      .select("order_id,outlet_id,driver_id,status,delivered_at,invoice_filename,invoice_uploaded_at,delivery_charge")
      .in("order_id",orderIds);
    if(deliveryError && !String(deliveryError.message||"").includes("does not exist"))
      return json({ok:false,message:deliveryError.message},500);

    return json({
      ok:true,
      orders:orders||[],
      outlets:outlets||[],
      items:items||[],
      events:events||[],
      deliveries:deliveries||[]
    });
  }catch(e){
    return json({ok:false,message:String(e?.message||e)},500);
  }
});