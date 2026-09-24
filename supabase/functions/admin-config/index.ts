import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const admin=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function adminSessionOk(session:string){
  if(!session||session.length<20)return false;
  const db=admin();
  const {data,error}=await db.rpc("verify_admin_session",{p_session_token:session});
  return !error&&data===true;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const body=await req.json(),db=admin(),action=String(body.action||"");
    if(action==="public_get"){
      const {data,error}=await db.from("app_config_v1").select("config_key,section,enabled").order("section").order("sort_order").order("config_key");
      if(error)return json({ok:false,message:error.message},500);
      return json({ok:true,configs:data||[]});
    }
    if(action==="admin_get"){
      if(!(await adminSessionOk(String(body.admin_session||""))))return json({ok:false,message:"Admin session expired. Please sign in again."},403);
      const {data,error}=await db.from("app_config_v1").select("config_key,section,label,description,enabled,sort_order,updated_at,updated_by").order("section").order("sort_order").order("config_key");
      if(error)return json({ok:false,message:error.message},500);
      return json({ok:true,configs:data||[]});
    }
    if(action==="admin_set"){
      if(!(await adminSessionOk(String(body.admin_session||""))))return json({ok:false,message:"Admin session expired. Please sign in again."},403);
      const key=String(body.config_key||"").trim();
      if(!/^(driver|packing|inventory|system)\.[a-z0-9_]+$/.test(key))return json({ok:false,message:"Invalid configuration key."},400);
      if(typeof body.enabled!=="boolean")return json({ok:false,message:"enabled must be true or false."},400);
      const {data,error}=await db.from("app_config_v1").update({enabled:body.enabled,updated_at:new Date().toISOString(),updated_by:"admin"}).eq("config_key",key).select("config_key,section,label,description,enabled,sort_order,updated_at,updated_by").single();
      if(error)return json({ok:false,message:error.message},500);
      return json({ok:true,config:data});
    }
    return json({ok:false,message:"Unknown action."},400);
  }catch(e){
    return json({ok:false,message:e instanceof Error?e.message:String(e)},500);
  }
});
