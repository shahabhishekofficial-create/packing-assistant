import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const db=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const barcodeValid=(b:string)=>{if(!/^[0-9]+$/.test(b)||![8,12,13].includes(b.length))return false;let s=0,n=b.length;for(let i=0;i<n-1;i++)s+=Number(b[i])*(((n-i-1)%2)?3:1);return((10-s%10)%10)===Number(b[n-1]);};
const parseQuantity=(raw:string)=>{const m=raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs?|pieces?)$/);if(!m)return{base_uom:null,default_pack_size:null,ambiguous:true};const n=Number(m[1]),u=m[2];if(u==="kg")return{base_uom:"kg",default_pack_size:n,ambiguous:false};if(u==="g")return{base_uom:"kg",default_pack_size:n/1000,ambiguous:false};if(u==="l")return{base_uom:"L",default_pack_size:n,ambiguous:false};if(u==="ml")return{base_uom:"L",default_pack_size:n/1000,ambiguous:false};return{base_uom:"pcs",default_pack_size:null,ambiguous:true};};
const productData=(p:any,barcode:string)=>{const quantity=String(p?.quantity||"").trim(),q=parseQuantity(quantity),cats=String(p?.categories||"").split(",").map((x:string)=>x.trim()).filter(Boolean),name=String(p?.product_name_en||p?.product_name||p?.generic_name_en||"").trim(),aliases=[String(p?.product_name||"").trim(),String(p?.generic_name_en||"").trim()].filter(Boolean);return{barcode,name,brand:String(p?.brands||"").split(",")[0].trim(),category:cats[0]||"",aliases:[...new Set(aliases)],quantity,base_uom:q.base_uom,default_pack_size:q.default_pack_size,quantity_ambiguous:q.ambiguous,image_url:p?.selected_images?.front?.display?.en||null};};
const responseData=(raw:any,barcode:string)=>raw?.product?productData(raw.product,barcode):null;
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const d=db();
 try{
  const body=await req.json(),session=String(body.admin_session||"").trim(),barcode=String(body.barcode||"").trim(),force=body.force===true;
  const auth=await d.rpc("verify_admin_session",{p_session_token:session});
  if(auth.error||auth.data!==true)return json({ok:false,message:"Admin session expired. Please sign in again."},403);
  if(!barcodeValid(barcode))return json({ok:false,message:"Enter a valid EAN-8, UPC-A or EAN-13 barcode."},400);
  const linkedV2=await d.from("inv_v2_item_barcodes").select("item_id").eq("barcode",barcode).maybeSingle();
  if(linkedV2.data){const item=await d.from("inv_v2_items").select("id,legacy_item_id,name,section,category,base_uom,count_mode,default_pack_size,no_barcode,brand,active").eq("id",linkedV2.data.item_id).single();await d.from("inv_v2_audit_log").insert({action:"lookup",actor:"admin",barcode,result:"already_linked",item_id:linkedV2.data.item_id});return json({ok:true,linked:true,item:item.data,message:"Barcode is already linked to an existing item."});}
  const linkedLegacy=await d.from("inv_item_barcodes").select("item_id").eq("barcode",barcode).maybeSingle();
  if(linkedLegacy.data){const item=await d.from("inv_items").select("id,name,section,category,unit,aliases,brand,active").eq("id",linkedLegacy.data.item_id).single();await d.from("inv_v2_audit_log").insert({action:"lookup",actor:"admin",barcode,result:"already_linked_legacy"});return json({ok:true,linked:true,legacy_item:item.data,message:"Barcode is already linked to an existing inventory item."});}
  if(!force){const cached=await d.from("inv_barcode_lookup_cache").select("*").eq("barcode",barcode).maybeSingle();if(cached.data){const data=responseData(cached.data.raw_response,barcode);return json({ok:true,linked:false,cached:true,found:cached.data.found,source:"Open Food Facts",attribution:"Data from Open Food Facts",data,message:data?"Details fetched from cache.":"No product was found in the cached result."});}}
  const url="https://world.openfoodfacts.org/api/v2/product/"+encodeURIComponent(barcode)+"?product_type=all&fields=code,status,status_verbose,product_name,product_name_en,generic_name_en,brands,categories,quantity,selected_images";
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);let rr:Response;
  try{rr=await fetch(url,{headers:{"User-Agent":"BiglyAgroInventory/1.0 (inventory@biglyagro.com)","Accept":"application/json"},signal:controller.signal});}
  catch(e){const msg=e instanceof Error?e.message:String(e);await d.from("inv_barcode_lookup_cache").upsert({barcode,source:"open_food_facts",fetched_at:new Date().toISOString(),found:false,raw_response:{error:msg},fetched_by:"admin"});await d.from("inv_v2_audit_log").insert({action:"lookup",actor:"admin",barcode,result:"network_error",new_data:{error:msg}});return json({ok:false,message:"Open Food Facts could not be reached. Please try again."},502);}
  finally{clearTimeout(timeout)}
  let raw:any={};try{raw=await rr.json();}catch{}
  const found=rr.ok&&raw?.status===1&&raw?.product;
  await d.from("inv_barcode_lookup_cache").upsert({barcode,source:"open_food_facts",fetched_at:new Date().toISOString(),found:Boolean(found),raw_response:raw,image_url:raw?.product?.selected_images?.front?.display?.en||null,fetched_by:"admin"});
  await d.from("inv_v2_audit_log").insert({action:"lookup",actor:"admin",barcode,result:found?"success":(rr.status===429?"rate_limited":"not_found"),new_data:{http_status:rr.status,found:Boolean(found)}});
  if(rr.status===429||rr.status===503)return json({ok:false,message:"Open Food Facts is temporarily rate-limited. Please try again later."},429);
  if(!found)return json({ok:true,linked:false,cached:false,found:false,source:"Open Food Facts",attribution:"Data from Open Food Facts",message:"No product was found in Open Food Facts."});
  return json({ok:true,linked:false,cached:false,found:true,source:"Open Food Facts",attribution:"Data from Open Food Facts",note:"Details are from a community database, please verify.",data:responseData(raw,barcode)});
 }catch(e){return json({ok:false,message:e instanceof Error?e.message:String(e)},500);}
});