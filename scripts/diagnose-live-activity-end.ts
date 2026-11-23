// Privileged local diagnostic. Use only for a controlled test on an ended sleep.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { LiveActivityApnsError, sendLiveActivityEnd } from "../supabase/functions/_shared/apns.ts";

async function main() {
  const [sleepId, installationId, activityId] = Deno.args;
  if (!sleepId || !installationId || !activityId || Deno.args.length !== 3) {
    throw new Error("Expected sleep ID, installation ID, and activity ID");
  }
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase credentials unavailable");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sleep, error: sleepError } = await db.from("sleep").select("baby_id,endtime,deleted_at").eq("id", sleepId).maybeSingle();
  if (sleepError || !sleep?.endtime || sleep.deleted_at) throw new Error("Expected an existing completed sleep");
  const { data, error } = await db.rpc("live_activity_end_targets", {
    p_sleep_id: sleepId, p_baby_id: sleep.baby_id, p_endtime: sleep.endtime,
  });
  if (error) throw new Error("Target lookup failed");
  const matches = data.filter((row: { installation_id: string; activity_id: string }) =>
    row.installation_id === installationId && row.activity_id === activityId);
  if (matches.length !== 1) throw new Error("No matching eligible registration");
  const row = matches[0];
  const { status, reason } = await sendLiveActivityEnd(row.push_token, row.environment, activityId);
  console.log(JSON.stringify({ activityId, environment: row.environment, revision: row.revision, status, reason: reason ?? null }));
  if (status !== 200) Deno.exitCode = 1;
}

try { await main(); }
catch (error) {
  // Never print exceptions from HTTP clients, which can include token-bearing URLs.
  console.error(error instanceof LiveActivityApnsError ? error.message : "Diagnostic stopped; check inputs, credentials, and eligible registrations.");
  Deno.exitCode = 1;
}
