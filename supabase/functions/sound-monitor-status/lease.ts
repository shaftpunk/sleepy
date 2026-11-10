export type SoundLease = { scope: "sleepy-sound-status-v1"; userId: string; babyId: string; sleepId: string; expiresAt: number };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), c => c.charCodeAt(0));
async function key(secret: string) {
  if (!secret) throw new Error("Server configuration unavailable");
  // Domain-separated key; the resulting token is NOT a Supabase JWT and grants
  // only boolean validity checks for one existing, RLS-authorized sleep.
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`Sleepy:sound-status:v1:${secret}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function issueLease(userId: string, babyId: string, sleepId: string, secret: string, now = Date.now()) {
  const payload: SoundLease = { scope: "sleepy-sound-status-v1", userId, babyId, sleepId, expiresAt: now + 24 * 60 * 60 * 1000 };
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), data);
  return { token: `${encode(data)}.${encode(new Uint8Array(signature))}`, expiresAt: payload.expiresAt };
}
export async function verifyLease(token: unknown, secret: string, now = Date.now()): Promise<SoundLease | null> {
  try {
    if (typeof token !== "string" || token.length > 2048) return null;
    const pieces = token.split("."); if (pieces.length !== 2) return null;
    const data = decode(pieces[0]);
    if (!await crypto.subtle.verify("HMAC", await key(secret), decode(pieces[1]), data)) return null;
    const value = JSON.parse(new TextDecoder().decode(data));
    if (value.scope !== "sleepy-sound-status-v1" || ![value.userId, value.babyId, value.sleepId].every(id => typeof id === "string" && uuid.test(id)) ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 24 * 60 * 60 * 1000) return null;
    return value;
  } catch { return null; }
}
