import {supabase} from "../lib/supabase";
import {sessionGeneration,isSessionGenerationCurrent} from "../auth/sessionLifecycle";
import {parseEntitlementResolution} from "../entitlements/model";
import {PurchaseFailure, type PurchaseContext, type PurchasePlan, type ServerReconciliation} from "../purchases/revenueCatModel";

type Refresh = {userId:string;householdId:string|null};
const listeners=new Set<(event:Refresh)=>void>();
export function subscribeEntitlementReconciliation(listener:(event:Refresh)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
async function invoke(body:Record<string,unknown>){
  const generation=sessionGeneration();
  const {data:auth,error:authError}=await supabase.auth.getUser();
  if(authError||!auth.user||!isSessionGenerationCurrent(generation))throw new PurchaseFailure("authentication");
  const {data,error}=await supabase.functions.invoke("subscription-reconcile",{body,signal:AbortSignal.timeout(20000)});
  if(!isSessionGenerationCurrent(generation))throw new PurchaseFailure("authentication");
  if(error){
    let code="";try{code=(await error.context?.json())?.error??"";}catch{/* Never render raw HTTP/SDK error text. */}
    throw new PurchaseFailure(code==="subscription_ownership_conflict"?"ownership":error.context?.status===401?"authentication":
      error.context?.status===403||error.context?.status===409?"context":error.context?.status===429?"busy":"network");
  }
  if(!data||typeof data!=="object")throw new PurchaseFailure("unknown");
  return {data,userId:auth.user.id};
}
export async function prepareSubscriptionPurchase(context:PurchaseContext,plan:PurchasePlan):Promise<string>{
  // userId is never sent as server authority; the server derives it from JWT.
  const {data,userId}=await invoke({action:"prepare",householdId:context.householdId,babyId:context.babyId,plan,attemptId:crypto.randomUUID()});
  if(userId!==context.userId || typeof data.intentId!=="string" || !/^[0-9a-f-]{36}$/.test(data.intentId) ||
    !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt)<=Date.now())throw new PurchaseFailure("context");
  return data.intentId;
}
export async function cancelSubscriptionPurchase(intentId:string):Promise<void>{await invoke({action:"cancelIntent",intentId});}
export async function reconcileSubscription(intentId?:string,restore=false,transactionId?:string):Promise<ServerReconciliation>{
  const {data,userId}=await invoke({action:restore?"restore":"reconcile",...(intentId?{intentId}:{}),...(transactionId?{transactionId}:{})});
  if(!["verified","verifiedMultiple","sandboxVerified","assignmentRequired","free"].includes(data.state)||
    !["production","sandbox","none"].includes(data.subscriptionState))throw new PurchaseFailure("unknown");
  let entitlement: ServerReconciliation["entitlement"] = null;
  if(data.householdId!==null){
    if(typeof data.householdId!=="string")throw new PurchaseFailure("unknown");
    const parsed = parseEntitlementResolution(data.entitlement,data.householdId);
    entitlement = { householdId: parsed.householdId, tier: parsed.tier, isPlus: parsed.isPlus,
      verificationState: parsed.verificationState, validUntil: parsed.validUntil };
    listeners.forEach(listener=>listener({userId,householdId:data.householdId}));
  }else if(data.state==="verified"||data.state==="sandboxVerified")throw new PurchaseFailure("unknown");
  else listeners.forEach(listener=>listener({userId,householdId:null})); // Re-resolve the provider's own explicit context, never choose a household here.
  return {state:data.state,householdId:data.householdId,subscriptionState:data.subscriptionState,entitlement};
}
