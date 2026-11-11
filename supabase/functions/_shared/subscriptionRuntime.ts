import {createClient} from "npm:@supabase/supabase-js@2.57.4";
import {createSubscriptionHandlers} from "./subscriptionHandlers.ts";
import {SubscriptionError} from "./revenuecat.ts";
import {createRevenueCatAPI} from "./revenuecat.ts";
import {createAppleChainVerifier} from "./appleSubscriptionChain.ts";

export function subscriptionRuntime(){
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!;
  const db=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const caller=(authorization:string)=>createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  function checked(error:{code?:string}|null){if(error)throw new SubscriptionError(error.code==="42501"?403:error.code==="40001"?409:error.code==="53000"?429:503,"subscription_operation_unavailable");}
  return createSubscriptionHandlers({
    snapshot:async(config,user,known,hint)=>{
      const sources=await createRevenueCatAPI(config).snapshot(user,known,hint);
      const verify=createAppleChainVerifier({issuer:Deno.env.get("APPLE_IAP_ISSUER_ID")??"",keyId:Deno.env.get("APPLE_IAP_KEY_ID")??"",privateKey:Deno.env.get("APPLE_IAP_PRIVATE_KEY")??""});
      const verified=[];
      // Serial bounded work; no unbounded fanout against Apple. Limit the batch
      // so a malformed/large account fails closed, never applies a partial list.
      if(sources.length>12)throw new SubscriptionError(503,"provider_snapshot_too_large");
      const deadline=Date.now()+25000;
      for(const source of sources){if(Date.now()>deadline)throw new SubscriptionError(503,"provider_timeout");verified.push(await verify(source,hint));}
      return verified;
    },
    config:()=>({secret:Deno.env.get("REVENUECAT_SECRET_API_KEY")??"",project:Deno.env.get("REVENUECAT_PROJECT_ID")??"",
      app:Deno.env.get("REVENUECAT_APP_ID")??"",webhookApp:Deno.env.get("REVENUECAT_WEBHOOK_APP_ID")??"",
      webhookAuthorization:Deno.env.get("REVENUECAT_WEBHOOK_AUTHORIZATION")??"",
      maintenanceAuthorization:Deno.env.get("REVENUECAT_MAINTENANCE_AUTHORIZATION")??""}),
    authenticate:async authorization=>{const {data,error}=await caller(authorization).auth.getUser();return error?null:data.user?.id??null;},
    rpc:async(name,args)=>{const {data,error}=await db.rpc(name,args);checked(error);return data;},
    resolve:async(authorization,household)=>{const {data,error}=await caller(authorization).rpc("resolve_household_entitlements",{p_household_id:household});checked(error);return data;},
  });
}
