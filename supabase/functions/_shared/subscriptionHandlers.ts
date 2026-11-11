import { createRevenueCatAPI, parseWebhook, record, SubscriptionError, uuid, webhookAuthorized,
  type RCConfig, type VerifiedSource } from "./revenuecat.ts";

type Dependencies = { config: () => RCConfig;
  authenticate: (authorization: string) => Promise<string | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  resolve: (authorization: string, household: string) => Promise<unknown>;
  snapshot?: (config: RCConfig, user: string, known: string[],transaction?:string) => Promise<VerifiedSource[]> };
const headers={"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const response=(body: unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
async function input(req: Request): Promise<unknown> {
  const reader=req.body?.getReader();if(!reader)throw new SubscriptionError(400,"invalid_request");
  const chunks:Uint8Array[]=[];let total=0;
  try { for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>131072){await reader.cancel();throw new SubscriptionError(413,"request_too_large");}chunks.push(value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new SubscriptionError(400,"invalid_request");}
}
const errorResponse=(error: unknown)=>error instanceof SubscriptionError ? response({error:error.message},error.status) : response({error:"subscription_verification_unavailable"},503);
export function createSubscriptionHandlers(deps: Dependencies) {
  async function reconcile(user: string,config: RCConfig,intent: string|null=null,transaction?:string) {
    const api=deps.snapshot?null:createRevenueCatAPI(config);
    const started=await deps.rpc("revenuecat_begin",{p_user:user,p_project:config.project,p_app:config.app});
    if(started===null)return null;
    const job=record(started);
    if(!Number.isSafeInteger(job.revision)||!Array.isArray(job.subscription_ids)||job.subscription_ids.some(id=>typeof id!=="string"))throw new SubscriptionError(503,"invalid_reconciliation_job");
    const sources=await (deps.snapshot ? deps.snapshot(config,user,job.subscription_ids as string[],transaction) : api!.snapshot(user,job.subscription_ids as string[],transaction));
    const applied=record(await deps.rpc("revenuecat_apply",{p_user:user,p_project:config.project,p_app:config.app,p_revision:job.revision,p_sources:sources,p_intent:intent,p_transaction:transaction??null}));
    return {applied,sources};
  }
  async function safeResult(authorization:string,result:Record<string,unknown>,sources:VerifiedSource[]) {
    const household=result.householdId;
    const subscriptionState=["production","sandbox","none"].includes(String(result.subscriptionState))?result.subscriptionState:
      sources.some(s=>s.access&&s.environment==="production")?"production":sources.some(s=>s.access&&s.environment==="sandbox")?"sandbox":"none";
    if(household===null)return {state:result.state,subscriptionState,householdId:null,entitlement:null};
    if(!uuid(household))throw new SubscriptionError(503,"invalid_entitlement_result");
    const raw=record(await deps.resolve(authorization,household));
    const allowed=["household_id","tier","is_plus","features","verification_state","verified_at","valid_until","recheck_at","policy_version"];
    if(raw.household_id!==household||!["free","plus"].includes(String(raw.tier))||raw.is_plus!==(raw.tier==="plus"))throw new SubscriptionError(503,"invalid_entitlement_result");
    const entitlement=Object.fromEntries(allowed.map(key=>[key,raw[key]]));
    return {state:raw.tier==="free" && subscriptionState==="sandbox"?"sandboxVerified":"verified",subscriptionState,householdId:household,entitlement};
  }
  async function authenticated(req:Request):Promise<Response> {
    if(req.method==="OPTIONS")return response({});if(req.method!=="POST")return response({error:"method_not_allowed"},405);
    try {
      const authorization=req.headers.get("Authorization")??"";
      if(!authorization.startsWith("Bearer "))return response({error:"unauthorized"},401);
      const user=await deps.authenticate(authorization);if(!uuid(user))return response({error:"unauthorized"},401);
      let body:Record<string,unknown>;try{body=record(await input(req));}catch{throw new SubscriptionError(400,"invalid_request");}
      if(Object.keys(body).some(key=>!["action","householdId","babyId","plan","intentId","transactionId","chainId","attemptId"].includes(key)))throw new SubscriptionError(400,"invalid_request");
      const config=deps.config();
      if(body.action==="cancelIntent"){
        if(!uuid(body.intentId))throw new SubscriptionError(400,"invalid_intent");
        await deps.rpc("revenuecat_cancel_intent",{p_user:user,p_project:config.project,p_app:config.app,p_intent:body.intentId});
        return response({cancelled:true});
      }
      if(body.action==="prepare") {
        if(!uuid(body.householdId)||!uuid(body.babyId)||!uuid(body.attemptId)||!["monthly","annual"].includes(String(body.plan)))throw new SubscriptionError(400,"invalid_purchase_context");
        // Check membership before any expensive provider call, and again atomically
        // in prepare. resolve derives auth.uid() from this caller's original JWT.
        await deps.resolve(authorization,body.householdId);
        const verified=await reconcile(user,config);if(!verified)throw new SubscriptionError(403,"account_unavailable");
        const prepared=record(await deps.rpc("revenuecat_prepare",{p_user:user,p_project:config.project,p_app:config.app,
          p_household:body.householdId,p_baby:body.babyId,p_product:body.plan==="monthly"?"sleepy_plus_monthly":"sleepy_plus_yearly",
          p_known:verified.sources.map(s=>s.id),p_attempt:body.attemptId}));
        return response({intentId:prepared.intentId,expiresAt:prepared.expiresAt});
      }
      if(body.action!=="reconcile" && body.action!=="restore" && body.action!=="transfer")throw new SubscriptionError(400,"invalid_action");
      if(body.action==="restore" && (body.householdId!==undefined||body.intentId!==undefined||body.transactionId!==undefined))throw new SubscriptionError(400,"restore_cannot_assign_household");
      if(body.intentId!==undefined&&!uuid(body.intentId))throw new SubscriptionError(400,"invalid_intent");
      if(body.transactionId!==undefined&&(typeof body.transactionId!=="string"||body.transactionId.length<1||body.transactionId.length>255))throw new SubscriptionError(400,"invalid_transaction_hint");
      const verified=await reconcile(user,config,body.action==="reconcile"?(body.intentId as string|undefined)??null:null,
        body.action==="reconcile"?body.transactionId as string|undefined:undefined);
      if(!verified)throw new SubscriptionError(403,"account_unavailable");
      if(body.action==="transfer") {
        if(!uuid(body.householdId)||!uuid(body.chainId))throw new SubscriptionError(400,"invalid_purchase_context");
        const transferred=record(await deps.rpc("revenuecat_transfer",{p_user:user,p_project:config.project,p_app:config.app,p_chain:body.chainId,p_household:body.householdId}));
        return response(await safeResult(authorization,transferred,verified.sources));
      }
      return response(await safeResult(authorization,verified.applied,verified.sources));
    }catch(error){return errorResponse(error);}
  }
  async function webhook(req:Request):Promise<Response> {
    if(req.method!=="POST")return response({error:"method_not_allowed"},405);
    let accepted: {id:string;hash:string}|null=null;
    try {
      const config=deps.config();
      if(!await webhookAuthorized(req.headers.get("Authorization"),config.webhookAuthorization))return response({error:"unauthorized"},401);
      let event:ReturnType<typeof parseWebhook>;try{event=parseWebhook(await input(req),config);}catch{throw new SubscriptionError(400,"invalid_webhook");}
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(event)));
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      const process=await deps.rpc("revenuecat_accept_event",{p_id:event.id,p_project:config.project,p_app:config.app,p_environment:event.environment,
        p_type:event.type,p_at:event.at,p_users:event.users,p_hash:hash});
      if(process===false)return response({received:true,duplicate:true});
      if(process!==true)throw new SubscriptionError(503,"webhook_inbox_unavailable");
      accepted={id:event.id,hash};
      for(const user of event.users)await reconcile(user,config);
      await deps.rpc("revenuecat_finish_event",{p_id:event.id,p_hash:hash,p_success:true});
      return response({received:true});
    }catch(error){
      if(accepted)try{await deps.rpc("revenuecat_finish_event",{p_id:accepted.id,p_hash:accepted.hash,p_success:false});}catch{/* Leave pending for provider retry/operator replay. */}
      return errorResponse(error);
    }
  }
  async function maintenance(req:Request):Promise<Response>{
    if(req.method!=="POST")return response({error:"method_not_allowed"},405);
    try{
      const config=deps.config();
      if(!await webhookAuthorized(req.headers.get("Authorization"),config.maintenanceAuthorization??""))return response({error:"unauthorized"},401);
      const work=record(await deps.rpc("revenuecat_maintenance_work",{p_project:config.project,p_app:config.app}));
      if(!Array.isArray(work.events)||!Array.isArray(work.users))throw new SubscriptionError(503,"maintenance_unavailable");
      let refreshed=0,failed=0;
      for(const raw of work.events){const e=record(raw);let success=true;
        if(!Array.isArray(e.users))throw new SubscriptionError(503,"maintenance_unavailable");
        for(const user of e.users){if(!uuid(user))throw new SubscriptionError(503,"maintenance_unavailable");
          try{await reconcile(user,config);refreshed++;}catch{success=false;failed++;}}
        await deps.rpc("revenuecat_finish_event",{p_id:e.id,p_hash:e.hash,p_success:success});
      }
      for(const user of work.users){if(!uuid(user))throw new SubscriptionError(503,"maintenance_unavailable");
        try{await reconcile(user,config);refreshed++;}catch{failed++;}}
      return response({refreshed,failed},failed?503:200);
    }catch(error){return errorResponse(error);}
  }
  return {authenticated,webhook,maintenance};
}
