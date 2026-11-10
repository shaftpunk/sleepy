import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { issueLease, verifyLease } from "./lease.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
    try {
      const input = await req.json();
      const url = Deno.env.get("SUPABASE_URL")!;
      const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      if (input.action === "issue") {
        const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
        const { data: { user }, error } = await caller.auth.getUser();
        if (error || !user) return respond({ error: "Unauthorized" }, 401);
        if (typeof input.sleepId !== "string") return respond({ error: "Invalid request" }, 400);
        // Issuance uses the caller's existing RLS, never a client-supplied owner.
        const { data: sleep, error: sleepError } = await caller.from("sleep").select("id,baby_id,endtime,deleted_at").eq("id", input.sleepId).single();
        if (sleepError || !sleep || sleep.endtime || sleep.deleted_at) return respond({ error: "Active sleep unavailable" }, 403);
        const lease = await issueLease(user.id, sleep.baby_id, sleep.id, secret);
        return respond({ ...lease, url: `${url}/functions/v1/sound-monitor-status` });
      }
      if (input.action !== "validate") return respond({ error: "Invalid request" }, 400);
      const lease = await verifyLease(input.lease, secret);
      if (!lease) return respond({ active: false }, 401);
      if (input.sleepId !== lease.sleepId || input.babyId !== lease.babyId || input.userId !== lease.userId) return respond({ active: false }, 403);
      const db = createClient(url, secret);
      const [{ data: sleep, error }, { data: owner, error: ownerError }] = await Promise.all([
        db.from("sleep").select("id,baby_id,endtime,deleted_at").eq("id", lease.sleepId).single(),
        db.auth.admin.getUserById(lease.userId),
      ]);
      if (error || ownerError) return respond({ active: false }, 503);
      if (!owner.user || !sleep || sleep.endtime || sleep.deleted_at || sleep.baby_id !== lease.babyId) return respond({ active: false });
      // Recheck current household access, using the same joins as family-message.
      const { data: links, error: linkError } = await db.from("baby_households").select("household_id").eq("baby_id", lease.babyId);
      if (linkError) return respond({ active: false }, 503);
      if (!links?.length) return respond({ active: false });
      const { data: memberships, error: membershipError } = await db.from("household_members").select("user_id")
        .eq("user_id", lease.userId).in("household_id", links.map(row => row.household_id)).limit(1);
      if (membershipError) return respond({ active: false }, 503);
      return respond({ active: Boolean(memberships?.length) });
    } catch { return respond({ active: false, error: "Validity unavailable" }, 503); }
  },
};
