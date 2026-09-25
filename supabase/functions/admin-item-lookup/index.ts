import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const db=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...cors,"Content-Type":"application/json"}});
const valid=(b:string)=>{if(!/^[0-9]+$/.test(b)||![8,12,13].includes(b.length))return false;let s=0;for(let i=0;i<b.length-1;i++){const d=+b[i];s+=d*(((b.length-i-1)%2)?3:1)}return(10-s%10)%10===+b.at(-1)!};
const qty=(q:string)=>{const m=q.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kg|g|l|ml)$/);if(!m)return{base_uom:null,default_pack_size:null,ambiguous:true};const n=Number(m[1]);return m[2]==="kg"?{base_uom:"kg",default_pack_size:n,ambiguous:false}:m[2]==="g"?{base_uom:"kg",default_pack_size:n/1000,ambiguous:false}:m[2]==="l"?{base_uom:"L",default_pack_size:n,ambiguous:false}:{base_uom:"L",default_pack_size:n/1000,ambiguous:false}};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const d=db();
 try{
  const body=await req.json(),session=String(body.admin_session||"").trim(),barcode=String(body.barcode||"").trim(),force=body.force===true;
  const auth=await d.rpc("verify_admin_session",{p_session_token:session});
  if(auth.error||auth.data!==true)return json({ok:false,message:"Admin session expired. Please sign in again."},403);
  if(!valid(barcode))return json({ok:false,message:"Enter a valid EAN-8, UPC-A or EAN-13 barcode."},400);
  const linked=await d.from("inv_v2_item_barcodes").select("item_id").eq("barcode",barcode).maybeSingle();
  if(linked.data){const item=await d.from("inv_v2_items").select("id,legacy_item_id,name,section,category,base_uom,count_mode,default_pack_size,no_barcode,brand,active").eq("id",linked.data.item_id).single();return json({ok:true,linked:true,item:item.data,message:"Barcode is already linked to an existing item."})}
  if(!force){const cached=await d.from("inv_barcode_lookup_cache").select("*").eq("barcode",barcode).maybeSingle();if(cached.data)return json({ok:true,linked:false,cached:true,found:cached.data.found,data:cached.data.raw_response})}
  const url="https://world.openfoodfacts.org/api/v2/product/"+encodeURIComponent(barcode)+"?product_type=all&fields=code,status,status_verbose,product_name,product_name_en,generic_name_en,brands,categories,quantity,selected_images";
  const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),8000);let rr:Response;
  try{rr=await fetch(url,{headers:{"User-Agent":"BiglyAgroInventory/1.0 (inventory@biglyagro.com)","Accept":"application/json"},signal:ctl.signal})}catch(e){await d.from("inv_barcode_lookup_cache").upsert({barcode,source:"open_food_facts",fetched_at:new Date().toISOString(),found:false,raw_response:{error:String(e)},fetched_by:"admin"});await d.from("inv_v2_audit_log").insert({action:"lookup",actor:"admin",barcode,result:"network_error"});return json({ok:false,message:"Open Food Facts could not be reached. Try again."},502)}finally{clearTimeout(timer)}
  let raw:any={};try{raw=await rr.json()}catch{}const found=rr.ok&&raw.status===1&&raw.product;
  await d.from("inv_barcode_lookup_cache").upsert({barcode,source:"open_food_facts",fetched_at:new Date().toISOString(),found:Boolean(found),raw_response:raw,image_url:raw?.product?.selected_images?.front?.display?.en||null,fetched_by:"admin"});
  await d.from("inv_v2_audit_log").insert({action:"lookup",actor:"admin",barcode,result:found?"success":"not_found",new_data:{status:rr.status,found:Boolean(found)}});
  if(!found){if(rr.status===429||rr.status===503)return json({ok:false,message:"Open Food Facts rate/service limit reached. Try again later."},429);return json({ok:true,linked:false,cached:false,found:false,message:"Product not found in Open Food Facts."})}
  const p=raw.product||{},quantity=String(p.quantity||"").trim(),q=qty(quantity),cats=String(p.categories||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
  return json({ok:true,linked:false,cached:false,found:true,source:"Open Food Facts",attribution:"Data from Open Food Facts",data:{barcode,name:String(p.product_name_en||p.product_name||p.generic_name_en||"").trim(),brand:String(p.brands||"").split(",")[0].trim(),category:cats[0]||"",aliases:[String(p.product_name||"").trim(),String(p.generic_name_en||"").trim()].filter(Boolean),quantity,base_uom:q.base_uom,default_pack_size:q.default_pack_size,quantity_ambiguous:q.ambiguous,image_url:p.selected_images?.front?.display?.en||null}});
 }catch(e){return json({ok:false,message:e instanceof Error?e.message:String(e)},500)}
});