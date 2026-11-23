// APNs transport only. Never pass these device tokens to web-push/VAPID.
let cached: { jwt: string; created: number } | undefined;
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
export async function apnsAuthorization(): Promise<string> {
  if (cached && Date.now() - cached.created < 20 * 60 * 1000) return cached.jwt;
  const pem = Deno.env.get("APNS_PRIVATE_KEY");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  if (!pem || !keyId || !teamId) throw new Error("APNs credentials are not configured");
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${encode({ alg: "ES256", kid: keyId })}.${encode({ iss: teamId, iat: Math.floor(Date.now() / 1000) })}`;
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  const jwt = `${input}.${base64url(new Uint8Array(signature))}`;
  cached = { jwt, created: Date.now() };
  return jwt;
}

async function postApns(
  token: string, host: string, topic: string, pushType: "alert" | "liveactivity", payload: unknown,
): Promise<{ status: number; reason?: string }> {
  const authorization = await apnsAuthorization();
  const client = Deno.createHttpClient({ http2: true, http1: false });
  try {
    const response = await fetch(`https://${host}/3/device/${token}`, {
      method: "POST", client, signal: AbortSignal.timeout(15000),
      headers: { authorization: `bearer ${authorization}`, "apns-topic": topic,
        "apns-push-type": pushType, "apns-priority": "10", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    let reason: string | undefined;
    if (pushType === "liveactivity" && !response.ok) {
      try { reason = JSON.parse(body).reason; } catch { /* No usable APNs reason. */ }
    }
    return { status: response.status, reason };
  } finally { client.close(); }
}

export async function sendApns(deviceToken: string, payload: { title: string; body: string; url: string }): Promise<number> {
  const topic = Deno.env.get("APNS_TOPIC");
  if (topic !== "no.strandeconsulting.sleepy") throw new Error("APNs topic must match Sleepy's bundle ID");
  const result = await postApns(deviceToken, "api.push.apple.com", topic, "alert", {
    aps: { alert: { title: payload.title, body: payload.body }, sound: "default" }, url: payload.url,
  });
  return result.status;
}

export function liveActivityEndRequest(environment: string, timestamp = Math.floor(Date.now() / 1000)) {
  if (environment !== "production" && environment !== "sandbox") throw new Error("Invalid APNs environment");
  return {
    host: environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com",
    topic: "no.strandeconsulting.sleepy.push-type.liveactivity",
    pushType: "liveactivity" as const,
    payload: { aps: { timestamp, event: "end", "content-state": { soundMonitoringActive: false },
      "dismissal-date": timestamp - 1 } },
  };
}

export function sendLiveActivityEnd(token: string, environment: string) {
  const { host, topic, pushType, payload } = liveActivityEndRequest(environment);
  return postApns(token, host, topic, pushType, payload);
}
