import {record, text, SubscriptionError, type VerifiedSource} from "./revenuecat.ts";

export type AppleConfig = {issuer:string;keyId:string;privateKey:string};
const bundle="no.strandeconsulting.sleepy";
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const encoded=(value:unknown)=>base64url(new TextEncoder().encode(JSON.stringify(value)));
// Identity comes ONLY from Apple's authenticated HTTPS Get Transaction Info API.
// This is not a verifier for client/webhook-supplied JWS. No such JWS is accepted.
export function createAppleChainVerifier(config:AppleConfig,fetcher:typeof fetch=fetch,now=()=>Date.now()){
  let key:Promise<CryptoKey>|undefined;
  async function token(){
    if(!/^[0-9a-f-]{36}$/i.test(config.issuer)||!/^[A-Z0-9]{10}$/.test(config.keyId)||!config.privateKey.includes("-----BEGIN PRIVATE KEY-----"))throw new SubscriptionError(503,"apple_configuration_unavailable");
    try{
      const pem=config.privateKey.replace(/-----[A-Z ]+-----/g,"").replace(/\s/g,"");
      key??=crypto.subtle.importKey("pkcs8",Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
      const seconds=Math.floor(now()/1000),body=encoded({alg:"ES256",kid:config.keyId,typ:"JWT"})+"."+
        encoded({iss:config.issuer,iat:seconds,exp:seconds+120,aud:"appstoreconnect-v1",bid:bundle});
      const signature=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},await key,new TextEncoder().encode(body));
      return body+"."+base64url(new Uint8Array(signature));
    }catch{throw new SubscriptionError(503,"apple_configuration_unavailable");}
  }
  async function transaction(id:string,environment:VerifiedSource["environment"]){
    if(!/^\d{1,64}$/.test(id))throw new SubscriptionError(502,"invalid_apple_transaction");
    const host=environment==="production"?"api.storekit.apple.com":"api.storekit-sandbox.apple.com";
    let response:Response|undefined;
    for(let attempt=0;attempt<2;attempt++){
      try{response=await fetcher(`https://${host}/inApps/v1/transactions/${id}`,{headers:{Authorization:`Bearer ${await token()}`},redirect:"error",signal:AbortSignal.timeout(3500)});}
      catch(error){if(error instanceof SubscriptionError)throw error;if(attempt===1)throw new SubscriptionError(503,"apple_verification_unavailable");continue;}
      if((response.status===429||response.status>=500)&&attempt===0)continue;
      break;
    }
    if(!response?.ok)throw new SubscriptionError(503,"apple_verification_unavailable");
    try{
      const raw=await response.text();if(raw.length>65536)throw Error();
      const jws=text(record(JSON.parse(raw)).signedTransactionInfo,60000),parts=jws.split(".");
      if(parts.length!==3||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))throw Error();
      const payload=parts[1].replace(/-/g,"+").replace(/_/g,"/");
      const value=record(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload),c=>c.charCodeAt(0)))));
      // HTTPS response provenance is mandatory. We do not treat decoding as JWS
      // signature verification, nor use this helper on untrusted input.
      if(value.bundleId!==bundle||value.transactionId!==id||value.environment!==(environment==="production"?"Production":"Sandbox")||
        value.type!=="Auto-Renewable Subscription"||value.inAppOwnershipType!=="PURCHASED"||
        !/^\d{1,64}$/.test(String(value.originalTransactionId))||typeof value.originalTransactionId!=="string"||
        !Number.isSafeInteger(value.purchaseDate)||(value.purchaseDate as number)<=0||(value.purchaseDate as number)>now()+60000)throw Error();
      return {chain:value.originalTransactionId,product:text(value.productId),purchaseAt:new Date(value.purchaseDate as number).toISOString()};
    }catch{throw new SubscriptionError(502,"invalid_apple_response");}
  }
  return async(source:VerifiedSource,hint?:string):Promise<VerifiedSource>=>{
    const latest=await transaction(source.transaction,source.environment);
    if(latest.product!==source.product)throw new SubscriptionError(502,"apple_product_mismatch");
    const result:VerifiedSource={...source,chain:latest.chain,purchaseAt:latest.purchaseAt,correlation:undefined};
    if(hint&&source.correlation===hint){
      const purchased=hint===source.transaction?latest:await transaction(hint,source.environment);
      if(purchased.chain!==latest.chain||purchased.product!==source.product)throw new SubscriptionError(409,"purchase_chain_mismatch");
      result.correlation=hint;result.purchaseAt=purchased.purchaseAt;
    }
    return result;
  };
}
