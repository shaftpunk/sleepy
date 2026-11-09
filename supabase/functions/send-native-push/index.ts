import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { sendNativeNotifications } from "../_shared/nativePush.ts";

const headers = { "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
    try {
      const url = Deno.env.get("SUPABASE_URL")!;
      const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });
      const { data: { user }, error } = await caller.auth.getUser();
      if (error || !user) return new Response("Unauthorized", { status: 401, headers });
      const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const result = await sendNativeNotifications(db, [user.id], {
        title: "Sleepy", body: "Native notifications are working.", url: "/",
      });
      return new Response(JSON.stringify(result), { status: result.sent ? 200 : 503, headers });
    } catch { return new Response(JSON.stringify({ error: "Native push unavailable" }), { status: 503, headers }); }
  },
};
